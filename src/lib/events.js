import { all, insert, get } from './db.js';
import { id, nowIso, toJson } from './util.js';
import { signWebhookPayload } from './security.js';

/** Server-sent event subscribers, grouped by tenant. */
const subscribers = new Map();

export function subscribe(businessId, res) {
  if (!subscribers.has(businessId)) subscribers.set(businessId, new Set());
  subscribers.get(businessId).add(res);
  res.on('close', () => {
    const set = subscribers.get(businessId);
    if (set) set.delete(res);
    if (set && set.size === 0) subscribers.delete(businessId);
  });
}

export function publish(businessId, type, payload = {}) {
  const row = { id: id('evt'), business_id: businessId, type, payload_json: toJson(payload), created_at: nowIso() };
  insert('events', row);
  const set = subscribers.get(businessId);
  if (set) {
    const frame = `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`;
    for (const res of set) {
      try { res.write(frame); } catch { set.delete(res); }
    }
  }
  deliverWebhooks(businessId, type, payload).catch(() => {});
  return row.id;
}

async function deliverWebhooks(businessId, type, payload) {
  if (!businessId) return;
  const endpoints = all(
    'SELECT * FROM webhook_endpoints WHERE business_id = ? AND is_active = 1',
    [businessId]
  );
  for (const endpoint of endpoints) {
    const events = JSON.parse(endpoint.events_json || '[]');
    if (events.length && !events.includes(type) && !events.includes('*')) continue;
    const body = JSON.stringify({ type, business_id: businessId, data: payload, sent_at: nowIso() });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = signWebhookPayload(endpoint.secret, timestamp, body);
    let status = 'failed';
    let responseCode = null;
    let error = null;
    try {
      const response = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-mavyron-event': type,
          'x-mavyron-timestamp': timestamp,
          'x-mavyron-signature': `sha256=${signature}`,
        },
        body,
        signal: AbortSignal.timeout(8000),
      });
      responseCode = response.status;
      status = response.ok ? 'delivered' : 'failed';
      if (!response.ok) error = `Endpoint responded ${response.status}`;
    } catch (err) {
      error = err.message;
    }
    insert('webhook_deliveries', {
      id: id('whd'),
      endpoint_id: endpoint.id,
      business_id: businessId,
      event_type: type,
      status,
      response_code: responseCode,
      error,
      created_at: nowIso(),
    });
  }
}

export function recentEvents(businessId, limit = 20) {
  return all(
    'SELECT * FROM events WHERE business_id = ? ORDER BY created_at DESC LIMIT ?',
    [businessId, limit]
  );
}

export function tenantExists(businessId) {
  return Boolean(get('SELECT id FROM businesses WHERE id = ?', [businessId]));
}
