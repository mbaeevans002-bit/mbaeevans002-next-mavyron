import express from 'express';
import { all, get, insert, run, scalar } from '../lib/db.js';
import { id, nowIso, parseJson, toJson, isoDate, isEmail, normalisePhone } from '../lib/util.js';
import { sha256 } from '../lib/security.js';
import { createBooking } from '../lib/booking.js';
import { bookingMetrics, revenueSummary } from '../lib/analytics.js';
import { recordAudit } from '../lib/audit.js';
import { validation } from '../lib/errors.js';

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ───────────────────────── API key authentication ───────────────────────── */

router.use((req, res, next) => {
  const header = req.get('x-api-key') || (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!header) {
    return res.status(401).json({ error: 'An API key is required.', code: 'unauthorized' });
  }
  const key = get('SELECT * FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL', [sha256(header)]);
  if (!key) return res.status(401).json({ error: 'That API key is not valid.', code: 'unauthorized' });
  const business = get('SELECT * FROM businesses WHERE id = ?', [key.business_id]);
  if (!business) return res.status(401).json({ error: 'The key is not linked to a business.', code: 'unauthorized' });
  run('UPDATE api_keys SET last_used_at = ? WHERE id = ?', [nowIso(), key.id]);
  req.apiKey = key;
  req.business = business;
  req.scopes = parseJson(key.scopes_json, []);
  next();
});

/* ───────────────────────── discovery document ───────────────────────── */

router.get('/', (req, res) => {
  res.json({
    name: 'MAVYRON API',
    version: 'v1',
    business: { slug: req.business.slug, name: req.business.name },
    authentication: 'Send x-api-key or Authorization: Bearer <key>. Keys are scoped to one business.',
    endpoints: [
      { method: 'GET', path: '/api/v1/health', description: 'Service and tenant readiness.' },
      { method: 'GET', path: '/api/v1/business', description: 'Public business profile and branches.' },
      { method: 'GET', path: '/api/v1/services', description: 'Active services with prices and durations.' },
      { method: 'GET', path: '/api/v1/bookings?date=YYYY-MM-DD', description: 'Bookings for one day (default today).' },
      { method: 'POST', path: '/api/v1/bookings', description: 'Create a booking: service_id, start_at, name, phone, email?, staff_id?, branch_id?' },
      { method: 'GET', path: '/api/v1/customers?q=', description: 'Search customers for this business.' },
      { method: 'GET', path: '/api/v1/analytics?days=30', description: 'Booking and revenue metrics from stored data.' },
    ],
    rate_limits: '300 requests per minute per address. Tenant isolation is enforced on every query.',
  });
});

router.get('/health', (req, res) => {
  res.json({
    ok: true,
    business: req.business.slug,
    database: Boolean(scalar('SELECT 1 AS ok')),
    time: nowIso(),
  });
});

router.get('/business', (req, res) => {
  const business = req.business;
  const branches = all(
    'SELECT id, name, slug, address, city, phone FROM branches WHERE business_id = ? AND is_active = 1',
    [business.id],
  );
  res.json({
    id: business.id,
    name: business.name,
    slug: business.slug,
    industry: business.industry,
    description: business.description,
    phone: business.phone,
    email: business.email,
    whatsapp: business.whatsapp,
    address: business.address,
    city: business.city,
    country: business.country,
    timezone: business.timezone,
    currency: business.currency,
    booking_page: `/business/${business.slug}`,
    branches,
  });
});

router.get('/services', (req, res) => {
  const rows = all(
    'SELECT id, name, description, category, duration_min, buffer_min, price_cents, currency FROM services WHERE business_id = ? AND is_active = 1 ORDER BY name',
    [req.business.id],
  );
  res.json({ count: rows.length, services: rows });
});

router.get('/bookings', (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? req.query.date : isoDate();
  const rows = all(
    `SELECT b.id, b.reference, b.start_at, b.end_at, b.status, b.price_cents, b.currency,
            s.name AS service, st.name AS staff, c.name AS customer
       FROM bookings b LEFT JOIN services s ON s.id = b.service_id
       LEFT JOIN staff st ON st.id = b.staff_id LEFT JOIN customers c ON c.id = b.customer_id
      WHERE b.business_id = ? AND date(b.start_at) = ? ORDER BY b.start_at`,
    [req.business.id, date],
  );
  res.json({ date, count: rows.length, bookings: rows });
});

router.post('/bookings', wrap(async (req, res) => {
  const business = req.business;
  const service = get('SELECT * FROM services WHERE id = ? AND business_id = ?', [
    String(req.body.service_id || ''), business.id,
  ]);
  if (!service) throw validation('service_id must reference an active service for this business.');
  const name = String(req.body.name || '').trim();
  const phone = String(req.body.phone || '').trim();
  if (name.length < 2) throw validation('A customer name is required.');
  if (phone.replace(/\D/g, '').length < 9) throw validation('A reachable phone number is required.');

  const { booking } = await createBooking({
    business,
    serviceId: service.id,
    staffId: req.body.staff_id || null,
    branchId: req.body.branch_id || null,
    startAt: String(req.body.start_at || ''),
    customer: {
      name, phone: normalisePhone(phone),
      email: isEmail(String(req.body.email || '')) ? String(req.body.email).trim() : null,
    },
    notes: String(req.body.notes || '').trim() || null,
    source: 'api',
    actor: null,
  });

  recordAudit({
    action: 'booking.created', entityType: 'booking', entityId: booking.id,
    businessId: business.id, actorLabel: `api:${req.apiKey.prefix}`, ip: req.ip,
  });
  res.status(201).json({
    id: booking.id, reference: booking.reference, start_at: booking.start_at,
    end_at: booking.end_at, status: booking.status, price_cents: booking.price_cents,
  });
}));

router.get('/customers', (req, res) => {
  const q = String(req.query.q || '').trim();
  const like = `%${q}%`;
  const rows = all(
    `SELECT id, name, phone, email, marketing_consent, total_bookings, total_spend_cents, created_at
       FROM customers WHERE business_id = ? AND (? = '' OR name LIKE ? OR phone LIKE ? OR email LIKE ?)
      ORDER BY created_at DESC LIMIT 100`,
    [req.business.id, q, like, like, like],
  );
  res.json({ count: rows.length, customers: rows });
});

router.get('/analytics', (req, res) => {
  const days = Math.min(Math.max(Number.parseInt(req.query.days, 10) || 30, 1), 365);
  res.json({
    days,
    metrics: bookingMetrics(req.business.id, { days }),
    revenue: revenueSummary(req.business.id, days),
  });
});

export default router;
