import { all, get, insert, run } from './db.js';
import { id, nowIso, parseJson, toJson, money } from './util.js';
import { decryptSecret } from './security.js';

/**
 * Notification channels. Every adapter performs a real provider call and
 * returns ok:false with `configurationRequired` when credentials are absent.
 */

export function channelStatus(businessId) {
  const email = Boolean(process.env.RESEND_API_KEY && process.env.NOTIFICATION_FROM_EMAIL);
  const sms = Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER);
  const wa = businessId ? whatsappConfig(businessId) : null;
  return {
    email: email ? 'ready' : 'configuration_required',
    sms: sms ? 'ready' : 'configuration_required',
    whatsapp: wa ? 'ready' : 'configuration_required',
    in_app: 'ready',
  };
}

export function whatsappConfig(businessId) {
  const row = get("SELECT * FROM integrations WHERE business_id = ? AND provider = 'whatsapp'", [businessId]);
  if (!row || row.status !== 'connected' || !row.config_enc) return null;
  const config = parseJson(decryptSecret(row.config_enc), null);
  if (!config?.phone_number_id || !config?.access_token) return null;
  return config;
}

async function sendEmail({ to, subject, text }) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFICATION_FROM_EMAIL;
  if (!key || !from) return { ok: false, configurationRequired: true, error: 'RESEND_API_KEY and NOTIFICATION_FROM_EMAIL are not configured.' };
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, text }),
      signal: AbortSignal.timeout(10000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, error: body.message || `Email provider responded ${response.status}` };
    return { ok: true, providerId: body.id || null };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function sendSms({ to, text }) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) return { ok: false, configurationRequired: true, error: 'Twilio credentials are not configured.' };
  try {
    const params = new URLSearchParams({ To: to, From: from, Body: text });
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: params,
      signal: AbortSignal.timeout(10000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, error: body.message || `Twilio responded ${response.status}` };
    return { ok: true, providerId: body.sid || null };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function sendWhatsAppMessage(businessId, { to, text }) {
  const config = whatsappConfig(businessId);
  if (!config) return { ok: false, configurationRequired: true, error: 'WhatsApp Business is not connected for this business.' };
  try {
    const response = await fetch(`https://graph.facebook.com/v21.0/${config.phone_number_id}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.access_token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: String(to).replace(/^\+/, ''),
        type: 'text',
        text: { preview_url: false, body: text },
      }),
      signal: AbortSignal.timeout(10000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, error: body?.error?.message || `WhatsApp Cloud API responded ${response.status}` };
    }
    return { ok: true, providerId: body?.messages?.[0]?.id || null };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export function renderTemplate(template, payload) {
  const name = payload.customer_name || 'there';
  const business = payload.business_name || 'the business';
  switch (template) {
    case 'booking_confirmed':
      return {
        subject: `Booking confirmed — ${business}`,
        text: `Hi ${name}, your ${payload.service_name} appointment at ${business} is confirmed for ${payload.when}. Reference ${payload.reference}. Reply to this message if you need to change it.`,
      };
    case 'booking_rescheduled':
      return {
        subject: `Booking updated — ${business}`,
        text: `Hi ${name}, your appointment at ${business} has been moved to ${payload.when}. Reference ${payload.reference}.`,
      };
    case 'booking_cancelled':
      return {
        subject: `Booking cancelled — ${business}`,
        text: `Hi ${name}, your ${payload.service_name} appointment on ${payload.when} has been cancelled. Reference ${payload.reference}.`,
      };
    case 'booking_reminder':
      return {
        subject: `Reminder: your appointment at ${business}`,
        text: `Hi ${name}, this is a reminder of your ${payload.service_name} appointment at ${business} on ${payload.when}.`,
      };
    case 'feedback_request':
      return {
        subject: `How was your visit to ${business}?`,
        text: `Hi ${name}, thanks for visiting ${business}. We would love to know how your ${payload.service_name} experience was.`,
      };
    case 'payment_confirmed':
      return {
        subject: `Payment received — ${business}`,
        text: `Hi ${name}, we received your payment of ${money(payload.amount_cents, payload.currency)} for ${business}.`,
      };
    case 'password_reset':
      return {
        subject: 'Reset your MAVYRON password',
        text: `Use this link to reset your MAVYRON password: ${payload.link} (expires in 30 minutes). If you did not request it, ignore this email.`,
      };
    case 'verify_email':
      return {
        subject: 'Verify your MAVYRON email',
        text: `Confirm your email address to secure your account: ${payload.link}`,
      };
    case 'patient_portal_invite':
      return {
        subject: `Your ${business} patient portal access`,
        text: `Hi ${name}, your patient portal is ready. Activate it here: ${payload.link} (expires in 72 hours).`,
      };
    case 'automation_message':
      return {
        subject: payload.subject || `${business}`,
        text: payload.body || '',
      };
    default:
      return { subject: `${business}`, text: payload.body || '' };
  }
}

export function queueNotification({ businessId, userId = null, channel, template, payload = {} }) {
  const row = {
    id: id('ntf'),
    business_id: businessId,
    user_id: userId,
    channel,
    template,
    payload_json: toJson(payload),
    status: 'queued',
    error: null,
    sent_at: null,
    created_at: nowIso(),
  };
  insert('notifications', row);
  return row;
}

export async function dispatchNotification(notificationId) {
  const row = get('SELECT * FROM notifications WHERE id = ?', [notificationId]);
  if (!row || row.status !== 'queued') return row;
  const payload = parseJson(row.payload_json, {});
  const rendered = renderTemplate(row.template, payload);
  let result;
  if (row.channel === 'email') {
    if (!payload.to_email) {
      result = { ok: false, error: 'No email address on record for the recipient.' };
    } else {
      result = await sendEmail({ to: payload.to_email, ...rendered });
    }
  } else if (row.channel === 'sms') {
    if (!payload.to_phone) result = { ok: false, error: 'No phone number on record for the recipient.' };
    else result = await sendSms({ to: payload.to_phone, text: rendered.text });
  } else if (row.channel === 'whatsapp') {
    if (!payload.to_phone) result = { ok: false, error: 'No phone number on record for the recipient.' };
    else result = await sendWhatsAppMessage(row.business_id, { to: payload.to_phone, text: rendered.text });
  } else if (row.channel === 'in_app') {
    result = { ok: true };
  } else {
    result = { ok: false, error: `Unsupported channel: ${row.channel}` };
  }

  const status = result.ok ? 'sent' : result.configurationRequired ? 'blocked' : 'failed';
  run('UPDATE notifications SET status = ?, error = ?, sent_at = ? WHERE id = ?', [
    status,
    result.ok ? null : result.error || 'Delivery failed',
    result.ok ? nowIso() : null,
    row.id,
  ]);
  return { ...row, status, error: result.ok ? null : result.error };
}

/** Dispatch queued notifications for a business without blocking the request. */
export function flushQueue(businessId, limit = 10) {
  const rows = all(
    "SELECT id FROM notifications WHERE business_id = ? AND status = 'queued' ORDER BY created_at ASC LIMIT ?",
    [businessId, limit]
  );
  if (!rows.length) return Promise.resolve([]);
  return Promise.all(rows.map((r) => dispatchNotification(r.id).catch(() => null)));
}

export function notificationsFor(businessId, limit = 50) {
  return all('SELECT * FROM notifications WHERE business_id = ? ORDER BY created_at DESC LIMIT ?', [businessId, limit]);
}
