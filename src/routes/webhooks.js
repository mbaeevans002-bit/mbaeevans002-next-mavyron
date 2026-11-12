import express from 'express';
import { all, get, insert, run, scalar, update } from '../lib/db.js';
import { id, nowIso, parseJson, toJson, normalisePhone, isoDate } from '../lib/util.js';
import {
  decryptSecret, verifyStripeSignature, verifyMetaSignature, verifyTwilioSignature,
} from '../lib/security.js';
import { upsertCustomer, createBooking } from '../lib/booking.js';
import { addMessage, receptionistReply } from '../lib/ai.js';
import { sendWhatsAppMessage } from '../lib/notify.js';
import { publish } from '../lib/events.js';
import { recordAudit } from '../lib/audit.js';

const router = express.Router();

function providerConfig(businessId, provider) {
  const row = get('SELECT * FROM integrations WHERE business_id = ? AND provider = ?', [businessId, provider]);
  if (!row || !row.config_enc) return null;
  try {
    return decryptSecret(row.config_enc);
  } catch {
    return null;
  }
}

function businessFor(param) {
  if (!param) return null;
  return get('SELECT * FROM businesses WHERE id = ? OR slug = ?', [param, param]);
}

function rawBody(req) {
  return Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === 'string' ? req.body : '');
}

/* ───────────────────────── WhatsApp Cloud API ───────────────────────── */

router.post('/whatsapp/:businessId', async (req, res) => {
  const business = businessFor(req.params.businessId);
  if (!business) return res.status(404).json({ error: 'Unknown business.' });
  const config = providerConfig(business.id, 'whatsapp');
  if (!config) return res.status(409).json({ error: 'WhatsApp is not configured for this business.' });

  const raw = rawBody(req);
  const signature = req.get('x-hub-signature-256');
  if (config.app_secret || config.appSecret) {
    const secret = config.app_secret || config.appSecret;
    if (!verifyMetaSignature(raw, signature, secret)) {
      return res.status(401).json({ error: 'Invalid webhook signature.' });
    }
  }

  let payload;
  try {
    payload = JSON.parse(raw.toString('utf8') || '{}');
  } catch {
    return res.status(400).json({ error: 'Malformed payload.' });
  }

  const messages = payload?.entry?.[0]?.changes?.[0]?.value?.messages || [];
  for (const message of messages) {
    const from = message.from;
    const text = message.text?.body || message.button?.text || '';
    if (!from || !text) continue;

    const phone = normalisePhone(from);
    const customer = upsertCustomer(business.id, { name: phone || from, phone, consent: true });
    let conversation = get(
      'SELECT * FROM conversations WHERE business_id = ? AND customer_id = ? ORDER BY created_at DESC LIMIT 1',
      [business.id, customer.id],
    );
    if (!conversation) {
      const conversationId = id('cnv');
      insert('conversations', {
        id: conversationId, business_id: business.id, channel: 'whatsapp',
        customer_id: customer.id, contact_ref: from, status: 'open',
        assigned_staff_id: null, escalated_reason: null,
        last_message_at: nowIso(), created_at: nowIso(),
      });
      conversation = get('SELECT * FROM conversations WHERE id = ?', [conversationId]);
    }

    addMessage({
      businessId: business.id, conversationId: conversation.id, direction: 'inbound',
      channel: 'whatsapp', body: text, status: 'received',
      providerMessageId: message.id || null, author: 'customer',
    });
    run('UPDATE conversations SET last_message_at = ?, status = ? WHERE id = ?', [
      nowIso(), conversation.status === 'escalated' ? 'escalated' : 'open', conversation.id,
    ]);

    const reply = await receptionistReply({
      business, conversationId: conversation.id, text, channel: 'whatsapp',
      contactRef: from, customerId: customer.id,
    });

    if (reply.ok && reply.reply) {
      const outbound = addMessage({
        businessId: business.id, conversationId: conversation.id, direction: 'outbound',
        channel: 'whatsapp', body: reply.reply, status: 'queued', author: 'ai:reception',
      });
      const sent = await sendWhatsAppMessage(business.id, { to: from, text: reply.reply });
      run('UPDATE messages SET status = ?, error = ?, provider_message_id = ? WHERE id = ?', [
        sent.ok ? 'sent' : 'failed', sent.ok ? null : (sent.error || 'delivery failed'),
        sent.providerMessageId || null, outbound.id,
      ]);
    }
  }

  return res.json({ received: true });
});

router.get('/whatsapp/:businessId', (req, res) => {
  const business = businessFor(req.params.businessId);
  if (!business) return res.status(404).send('Unknown business.');
  const config = providerConfig(business.id, 'whatsapp');
  const expected = config?.verify_token || config?.verifyToken;
  if (!expected) return res.status(409).send('Webhook not configured.');
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === expected) {
    return res.status(200).send(String(req.query['hub.challenge'] || ''));
  }
  return res.status(403).send('Verification failed.');
});

/* ───────────────────────── Stripe ───────────────────────── */

router.post('/stripe/:businessId', async (req, res) => {
  const business = businessFor(req.params.businessId);
  if (!business) return res.status(404).json({ error: 'Unknown business.' });
  const config = providerConfig(business.id, 'stripe');
  const raw = rawBody(req);
  const secret = config?.webhook_secret || config?.webhookSecret;
  if (!secret) return res.status(409).json({ error: 'Stripe webhook secret is not configured.' });
  if (!verifyStripeSignature(raw.toString('utf8'), req.get('stripe-signature'), secret)) {
    return res.status(401).json({ error: 'Invalid Stripe signature.' });
  }

  let event;
  try {
    event = JSON.parse(raw.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Malformed payload.' });
  }

  const object = event?.data?.object || {};
  const handled = new Set([
    'checkout.session.completed', 'payment_intent.succeeded', 'invoice.payment_succeeded',
    'payment_intent.payment_failed', 'invoice.payment_failed',
  ]);
  if (!handled.has(event.type)) return res.json({ received: true, ignored: true });

  const failed = String(event.type).includes('failed');
  const amount = Number(object.amount_total ?? object.amount_received ?? object.amount ?? 0);
  const ref = String(object.id || object.payment_intent || '');

  insert('payments', {
    id: id('pay'), business_id: business.id, provider: 'stripe', provider_ref: ref,
    purpose: 'subscription', amount_cents: amount,
    currency: String(object.currency || business.currency).toUpperCase(),
    status: failed ? 'failed' : 'confirmed', raw_json: toJson(event), created_at: nowIso(),
  });

  if (!failed) {
    const subscription = get('SELECT * FROM subscriptions WHERE business_id = ?', [business.id]);
    if (subscription) {
      update('subscriptions', subscription.id, {
        status: 'active',
        current_period_end: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        updated_at: nowIso(),
      });
    }
    publish(business.id, 'payment.confirmed', { provider: 'stripe', reference: ref, amount });
  }

  recordAudit({
    action: failed ? 'payment.failed' : 'payment.confirmed', entityType: 'payment',
    entityId: ref, businessId: business.id, actorLabel: 'stripe-webhook', ip: req.ip,
  });
  return res.json({ received: true });
});

/* ───────────────────────── M-Pesa (Daraja) ───────────────────────── */

router.post('/mpesa/:businessId', async (req, res) => {
  const business = businessFor(req.params.businessId);
  if (!business) return res.status(404).json({ error: 'Unknown business.' });
  const config = providerConfig(business.id, 'mpesa');
  if (!config) return res.status(409).json({ error: 'M-Pesa is not configured for this business.' });

  const raw = rawBody(req);
  let payload;
  try {
    payload = JSON.parse(raw.toString('utf8') || '{}');
  } catch {
    return res.status(400).json({ error: 'Malformed payload.' });
  }

  const callback = payload?.Body?.stkCallback;
  if (!callback) return res.json({ received: true, ignored: true });

  const success = Number(callback.ResultCode) === 0;
  const items = callback.CallbackMetadata?.Item || [];
  const amount = Number(items.find((i) => i.Name === 'Amount')?.Value || 0) * 100;
  const receipt = String(items.find((i) => i.Name === 'MpesaReceiptNumber')?.Value || callback.CheckoutRequestID || '');

  insert('payments', {
    id: id('pay'), business_id: business.id, provider: 'mpesa', provider_ref: receipt,
    purpose: 'subscription', amount_cents: Math.round(amount), currency: business.currency,
    status: success ? 'confirmed' : 'failed', raw_json: toJson(payload), created_at: nowIso(),
  });

  if (success) publish(business.id, 'payment.confirmed', { provider: 'mpesa', reference: receipt });
  recordAudit({
    action: success ? 'payment.confirmed' : 'payment.failed', entityType: 'payment',
    entityId: receipt, businessId: business.id, actorLabel: 'mpesa-webhook', ip: req.ip,
  });
  return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

/* ───────────────────────── Voice (Twilio-compatible) ───────────────────────── */

router.post('/voice/:businessId', async (req, res) => {
  const business = businessFor(req.params.businessId);
  if (!business) return res.status(404).type('text/xml').send('<Response><Say>Unknown business.</Say></Response>');
  const config = providerConfig(business.id, 'voice');
  if (!config) {
    return res.type('text/xml').send('<Response><Say>This number is not configured yet. Goodbye.</Say><Hangup/></Response>');
  }

  const raw = rawBody(req).toString('utf8');
  const params = Object.fromEntries(new URLSearchParams(raw));
  const authToken = config.auth_token || config.authToken;
  const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  if (authToken && !verifyTwilioSignature(url, params, req.get('x-twilio-signature'), authToken)) {
    return res.status(401).type('text/xml').send('<Response><Say>Unauthorized.</Say><Hangup/></Response>');
  }

  const from = params.From || null;
  const speech = params.SpeechResult || '';
  const escalation = config.escalation_number || config.escalationNumber;

  let say = `Thank you for calling ${business.name}. `;
  if (speech) {
    const reply = await receptionistReply({
      business, text: speech, channel: 'voice', contactRef: from, customerId: null,
    });
    say = reply.ok && reply.reply ? reply.reply : 'A team member will assist you shortly.';
  } else {
    const hours = all(
      `SELECT bh.* FROM branch_hours bh JOIN branches b ON b.id = bh.branch_id
        WHERE b.business_id = ? AND b.is_primary = 1 ORDER BY bh.weekday`,
      [business.id],
    );
    say += hours.length
      ? 'Our opening hours are available on our booking page.'
      : 'Please tell me how I can help, or press 0 to speak with the team.';
  }

  const twiml = `<Response><Say voice="alice">${String(say).replace(/[<>&]/g, ' ')}</Say>${
    escalation ? `<Dial>${String(escalation).replace(/[^+0-9]/g, '')}</Dial>` : '<Hangup/>'
  }</Response>`;
  return res.type('text/xml').send(twiml);
});

/* ───────────────────────── generic partner webhook ───────────────────────── */

router.post('/events/:businessId', (req, res) => {
  const business = businessFor(req.params.businessId);
  if (!business) return res.status(404).json({ error: 'Unknown business.' });
  const raw = rawBody(req);
  let payload;
  try {
    payload = JSON.parse(raw.toString('utf8') || '{}');
  } catch {
    return res.status(400).json({ error: 'Malformed payload.' });
  }
  const type = String(payload.type || 'partner.event');
  publish(business.id, type, payload);
  return res.json({ received: true });
});

export default router;
