import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { all, get, scalar, insert, run, update, tenantRow, DATA_DIR } from '../lib/db.js';
import {
  id, nowIso, money, parseMoneyToCents, int, clamp, isEmail, normalisePhone,
  parseJson, toJson, isoDate, addDays, splitList, reference,
} from '../lib/util.js';
import { can, businessesForUser, startPatientSession } from '../lib/auth.js';
import {
  createBooking, cancelBooking, completeBooking, markNoShow, addToWaitlist,
  bookingsForDate, dayAvailability, bookingRules, upsertCustomer,
} from '../lib/booking.js';
import {
  dashboard, bookingMetrics, bookingSeries, servicePerformance, staffActivity,
  branchComparison, customerSegments, revenueSummary, marketingMetrics, search,
  activityTimeline,
} from '../lib/analytics.js';
import {
  aiStatus, agentsFor, ensureAgentDefaults, aiUsageSummary, conversationsFor,
  conversationMessages, receptionistReply, generateContent, escalateConversation,
  CONTENT_KINDS,
} from '../lib/ai.js';
import {
  listIntegrations, integrationSummary, saveCredentials, testConnection,
  disconnectIntegration, ensureIntegrationRows, PROVIDER_CATALOG,
} from '../lib/integrations.js';
import {
  listAutomations, automationRuns, saveWorkflow, setAutomationStatus, runAutomation,
  automationPerformance, TRIGGERS, ACTIONS,
} from '../lib/automation.js';
import { entitlementsFor, changePlan, getSubscription, listPlans } from '../lib/entitlements.js';
import { recordAudit } from '../lib/audit.js';
import { publish } from '../lib/events.js';
import { notificationsFor } from '../lib/notify.js';
import { validation, notFound } from '../lib/errors.js';
import * as W from '../views/workspace.js';
import * as I from '../views/intelligence.js';
import { onboardingPage } from '../views/onboarding.js';

const router = express.Router({ mergeParams: true });
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const HEALTHCARE_INDUSTRIES = ['clinic', 'dental', 'hospital', 'medical', 'laboratory', 'pharmacy', 'diagnostic', 'healthcare'];

function unreadCount(businessId) {
  return scalar(
    "SELECT COUNT(*) AS c FROM notifications WHERE business_id = ? AND status IN ('queued','retry')",
    [businessId],
  ) || 0;
}

function ctx(req, res, extra = {}) {
  const business = req.business;
  return {
    business,
    user: req.user,
    role: req.role,
    base: `/app/${business.slug}`,
    csrf: res.locals.csrf,
    req,
    ent: entitlementsFor(business.id),
    notifications: unreadCount(business.id),
    tags: [],
    ...extra,
  };
}

function done(res, base, message) {
  res.redirect(303, `${base}?ok=${encodeURIComponent(message)}`);
}

function fail(res, base, message) {
  res.redirect(303, `${base}?err=${encodeURIComponent(message)}`);
}

function healthcareEnabled(business) {
  return HEALTHCARE_INDUSTRIES.includes(String(business.industry || '').toLowerCase());
}

/* ═════════════════════════════ dashboard ═════════════════════════════ */

router.get('/', (req, res) => {
  const business = req.business;
  const days = clamp(int(req.query.days, 30), 1, 365);
  const branchId = req.query.branch_id || null;
  const data = dashboard(business.id, { branchId, days });
  const series = bookingSeries(business.id, Math.min(days, 30), branchId);
  res.type('html').send(W.dashboardPage(ctx(req, res, { data, series, rangeDays: days })));
});

/* ═════════════════════════════ calendar ═════════════════════════════ */

router.get('/calendar', (req, res) => {
  const business = req.business;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? req.query.date : isoDate();
  const branchId = req.query.branch_id || null;
  const services = all('SELECT * FROM services WHERE business_id = ? AND is_active = 1 ORDER BY name', [business.id]);
  const staff = all('SELECT * FROM staff WHERE business_id = ? AND is_active = 1 ORDER BY name', [business.id]);
  const branches = all('SELECT * FROM branches WHERE business_id = ? AND is_active = 1 ORDER BY is_primary DESC, name', [business.id]);
  const bookings = bookingsForDate(business.id, date, business.timezone, branchId);
  const form = {
    service_id: String(req.query.service_id || ''),
    staff_id: String(req.query.staff_id || ''),
    name: String(req.query.name || ''),
    phone: String(req.query.phone || ''),
  };

  let slots = [];
  let slotReason = '';
  if (form.service_id) {
    const service = tenantRow('services', form.service_id, business.id);
    if (!service) {
      slotReason = 'That service is no longer available.';
    } else {
      const availability = dayAvailability({
        business,
        branchId: branchId || branches[0]?.id || null,
        service,
        staffId: form.staff_id || null,
        date,
      });
      slots = availability.slots || [];
      slotReason = availability.reason || '';
    }
  }

  res.type('html').send(W.calendarPage(ctx(req, res, {
    date, bookings, services, staff, branches, branchId, slots, slotReason, form,
  })));
});

router.post('/bookings', wrap(async (req, res) => {
  const business = req.business;
  const base = `/app/${business.slug}`;
  const service = tenantRow('services', String(req.body.service_id || ''), business.id);
  if (!service) throw validation('Choose a service that belongs to this business.');
  const booking = await createBooking({
    business,
    service,
    staffId: req.body.staff_id || null,
    branchId: req.body.branch_id || null,
    startAt: String(req.body.start_at || ''),
    customer: {
      name: String(req.body.name || '').trim(),
      phone: String(req.body.phone || '').trim(),
      email: String(req.body.email || '').trim() || null,
    },
    notes: String(req.body.notes || '').trim() || null,
    source: 'staff',
    actor: req.user,
  });
  const date = String(req.body.start_at || '').slice(0, 10);
  res.redirect(303, `${base}/calendar?date=${date}&ok=${encodeURIComponent(`Booking ${booking.reference} created.`)}`);
}));

router.post('/bookings/:id/status', wrap(async (req, res) => {
  const business = req.business;
  const base = `/app/${business.slug}`;
  const booking = tenantRow('bookings', req.params.id, business.id);
  if (!booking) throw notFound('Booking not found in this business.');
  const status = String(req.body.status || '');
  if (status === 'cancelled') {
    await cancelBooking({ business, bookingId: booking.id, reason: req.body.reason || null, actor: req.user });
  } else if (status === 'completed') {
    await completeBooking({ business, bookingId: booking.id, actor: req.user });
  } else if (status === 'no_show') {
    await markNoShow({ business, bookingId: booking.id, actor: req.user });
  } else {
    throw validation('Unsupported booking status.');
  }
  done(res, `${base}/calendar?date=${String(booking.start_at).slice(0, 10)}`, `Booking ${booking.reference} marked ${status.replace('_', ' ')}.`);
}));

/* ═════════════════════════════ customers ═════════════════════════════ */

router.get('/customers', (req, res) => {
  const business = req.business;
  const q = String(req.query.q || '').trim();
  const like = `%${q}%`;
  const customers = all(
    `SELECT c.*, (SELECT COUNT(*) FROM bookings b WHERE b.customer_id = c.id) AS total_bookings
       FROM customers c
      WHERE c.business_id = ?
        AND (? = '' OR c.name LIKE ? OR c.phone LIKE ? OR c.email LIKE ?)
      ORDER BY c.created_at DESC LIMIT 100`,
    [business.id, q, like, like, like],
  );
  res.type('html').send(W.customersPage(ctx(req, res, {
    customers, segments: customerSegments(business.id), query: q,
  })));
});

router.post('/customers', wrap(async (req, res) => {
  const business = req.business;
  const base = `/app/${business.slug}`;
  const name = String(req.body.name || '').trim();
  if (!name) throw validation('A customer name is required.');
  const customer = upsertCustomer(business.id, {
    name,
    phone: normalisePhone(req.body.phone || '', business.country === 'Kenya' ? '254' : undefined),
    email: isEmail(String(req.body.email || '')) ? String(req.body.email).trim() : null,
    birthday: /^\d{4}-\d{2}-\d{2}$/.test(String(req.body.birthday || '')) ? req.body.birthday : null,
    consent: Boolean(req.body.consent),
  });
  const tags = splitList(req.body.tags || '');
  if (tags.length) update('customers', customer.id, { tags_json: toJson(tags), updated_at: nowIso() });
  recordAudit({
    actor: req.user, action: 'customer.created', entityType: 'customer', entityId: customer.id,
    businessId: business.id, ip: req.ip,
  });
  done(res, `${base}/customers/${customer.id}`, 'Customer created.');
}));

router.get('/customers/:id', (req, res) => {
  const business = req.business;
  const customer = tenantRow('customers', req.params.id, business.id);
  if (!customer) throw notFound('Customer not found.');
  const bookings = all(
    `SELECT b.*, s.name AS service_name, st.name AS staff_name
       FROM bookings b LEFT JOIN services s ON s.id = b.service_id
       LEFT JOIN staff st ON st.id = b.staff_id
      WHERE b.business_id = ? AND b.customer_id = ? ORDER BY b.start_at DESC LIMIT 50`,
    [business.id, customer.id],
  );
  const conversations = all(
    'SELECT * FROM conversations WHERE business_id = ? AND customer_id = ? ORDER BY last_message_at DESC',
    [business.id, customer.id],
  );
  const invoices = all(
    'SELECT * FROM invoices WHERE business_id = ? AND patient_id IS NULL AND booking_id IN (SELECT id FROM bookings WHERE customer_id = ?) ORDER BY created_at DESC',
    [business.id, customer.id],
  );
  const notes = all(
    "SELECT * FROM audit_logs WHERE business_id = ? AND entity_type = 'customer' AND entity_id = ? ORDER BY created_at DESC LIMIT 20",
    [business.id, customer.id],
  );
  res.type('html').send(W.customerPage(ctx(req, res, {
    customer, bookings, conversations, invoices, notes,
    tags: parseJson(customer.tags_json, []),
  })));
});

router.post('/customers/:id', wrap(async (req, res) => {
  const business = req.business;
  const base = `/app/${business.slug}`;
  const customer = tenantRow('customers', req.params.id, business.id);
  if (!customer) throw notFound('Customer not found.');
  const consent = Boolean(req.body.consent);
  update('customers', customer.id, {
    preferences: String(req.body.preferences || '').trim() || null,
    notes: String(req.body.notes || '').trim() || null,
    tags_json: toJson(splitList(req.body.tags || '')),
    marketing_consent: consent ? 1 : 0,
    consent_at: consent ? (customer.consent_at || nowIso()) : null,
    updated_at: nowIso(),
  });
  recordAudit({
    actor: req.user, action: 'customer.updated', entityType: 'customer', entityId: customer.id,
    businessId: business.id, ip: req.ip,
  });
  done(res, `${base}/customers/${customer.id}`, 'Customer updated.');
}));

/* ═════════════════════════════ catalog ═════════════════════════════ */

router.get('/services', (req, res) => {
  const business = req.business;
  const services = all(
    `SELECT s.*, (SELECT COUNT(*) FROM bookings b WHERE b.service_id = s.id) AS bookings
       FROM services s WHERE s.business_id = ? ORDER BY s.is_active DESC, s.name`,
    [business.id],
  );
  res.type('html').send(W.servicesPage(ctx(req, res, { services })));
});

router.post('/services', wrap(async (req, res) => {
  const business = req.business;
  const base = `/app/${business.slug}`;
  const name = String(req.body.name || '').trim();
  if (!name) throw validation('A service name is required.');
  const priceCents = parseMoneyToCents(req.body.price);
  if (priceCents === null || priceCents < 0) throw validation('Enter a valid price.');
  insert('services', {
    id: id('svc'), business_id: business.id, name,
    description: String(req.body.description || '').trim() || null,
    category: String(req.body.category || '').trim() || null,
    duration_min: clamp(int(req.body.duration_min, 60), 5, 480),
    buffer_min: clamp(int(req.body.buffer_min, 0), 0, 120),
    price_cents: priceCents, currency: business.currency, is_active: 1,
    created_at: nowIso(), updated_at: nowIso(),
  });
  recordAudit({ actor: req.user, action: 'service.created', entityType: 'service', entityId: name, businessId: business.id, ip: req.ip });
  done(res, `${base}/services`, 'Service created.');
}));

router.post('/services/:id/toggle', wrap(async (req, res) => {
  const business = req.business;
  const base = `/app/${business.slug}`;
  const service = tenantRow('services', req.params.id, business.id);
  if (!service) throw notFound('Service not found.');
  update('services', service.id, { is_active: service.is_active ? 0 : 1, updated_at: nowIso() });
  done(res, `${base}/services`, `Service ${service.is_active ? 'deactivated' : 'activated'}.`);
}));

router.get('/staff', (req, res) => {
  const business = req.business;
  const staff = all(
    `SELECT st.*, b.name AS branch_name,
            (SELECT COUNT(*) FROM bookings bk WHERE bk.staff_id = st.id) AS bookings
       FROM staff st LEFT JOIN branches b ON b.id = st.branch_id
      WHERE st.business_id = ? ORDER BY st.is_active DESC, st.name`,
    [business.id],
  );
  const services = all('SELECT * FROM services WHERE business_id = ? AND is_active = 1 ORDER BY name', [business.id]);
  const branches = all('SELECT * FROM branches WHERE business_id = ? ORDER BY name', [business.id]);
  const schedules = all(
    `SELECT sch.* FROM staff_schedules sch JOIN staff st ON st.id = sch.staff_id
      WHERE st.business_id = ? ORDER BY sch.weekday, sch.start_min`,
    [business.id],
  );
  res.type('html').send(W.staffPage(ctx(req, res, { staff, services, branches, schedules })));
});

router.post('/staff', wrap(async (req, res) => {
  const business = req.business;
  const base = `/app/${business.slug}`;
  const name = String(req.body.name || '').trim();
  if (!name) throw validation('A team member name is required.');
  const staffId = id('stf');
  insert('staff', {
    id: staffId, business_id: business.id,
    branch_id: req.body.branch_id || null, user_id: null, name,
    title: String(req.body.title || '').trim() || null,
    email: isEmail(String(req.body.email || '')) ? String(req.body.email).trim() : null,
    phone: String(req.body.phone || '').trim() || null,
    color: null, is_active: 1, created_at: nowIso(),
  });
  const serviceIds = [].concat(req.body.services || []).filter(Boolean);
  for (const serviceId of serviceIds) {
    const service = tenantRow('services', serviceId, business.id);
    if (service) insert('staff_services', { staff_id: staffId, service_id: service.id });
  }
  const days = [].concat(req.body.days || []).map((d) => int(d, -1)).filter((d) => d >= 0 && d <= 6);
  for (const weekday of days) {
    insert('staff_schedules', {
      id: id('sch'), staff_id: staffId, weekday,
      start_min: 540, end_min: 1080,
    });
  }
  recordAudit({ actor: req.user, action: 'staff.created', entityType: 'staff', entityId: staffId, businessId: business.id, ip: req.ip });
  done(res, `${base}/staff`, `${name} added to the team.`);
}));

router.get('/branches', (req, res) => {
  const business = req.business;
  const branches = all(
    `SELECT b.*, (SELECT COUNT(*) FROM bookings bk WHERE bk.branch_id = b.id) AS bookings,
            (SELECT COUNT(*) FROM staff st WHERE st.branch_id = b.id) AS staff_count
       FROM branches b WHERE b.business_id = ? ORDER BY b.is_primary DESC, b.name`,
    [business.id],
  );
  res.type('html').send(W.branchesPage(ctx(req, res, {
    branches, comparison: branchComparison(business.id, 30),
  })));
});

router.post('/branches', wrap(async (req, res) => {
  const business = req.business;
  const base = `/app/${business.slug}`;
  const name = String(req.body.name || '').trim();
  if (!name) throw validation('A branch name is required.');
  const branchId = id('brc');
  const existing = scalar('SELECT COUNT(*) AS c FROM branches WHERE business_id = ?', [business.id]);
  insert('branches', {
    id: branchId, business_id: business.id, name,
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || branchId,
    address: String(req.body.address || '').trim() || null,
    city: String(req.body.city || '').trim() || business.city,
    phone: String(req.body.phone || '').trim() || null,
    timezone: business.timezone,
    is_primary: existing ? 0 : 1, is_active: 1, created_at: nowIso(),
  });
  const opens = String(req.body.opens || '09:00');
  const closes = String(req.body.closes || '18:00');
  const toMin = (value, fallback) => {
    const [h, m] = String(value || '').split(':').map((n) => int(n, 0));
    return Number.isFinite(h) && h >= 0 && h <= 23 ? h * 60 + clamp(m, 0, 59) : fallback;
  };
  for (let weekday = 0; weekday <= 6; weekday += 1) {
    insert('branch_hours', {
      id: id('bh'), branch_id: branchId, weekday,
      open_min: toMin(opens, 540), close_min: toMin(closes, 1080),
      is_closed: weekday === 0 ? 1 : 0,
    });
  }
  done(res, `${base}/branches`, `${name} created with opening hours.`);
}));

/* ═════════════════════════════ finance ═════════════════════════════ */

router.get('/finance', (req, res) => {
  const business = req.business;
  const revenue = revenueSummary(business.id, 30);
  const invoices = all(
    `SELECT i.*, c.name AS customer_name FROM invoices i
       LEFT JOIN bookings b ON b.id = i.booking_id
       LEFT JOIN customers c ON c.id = b.customer_id
      WHERE i.business_id = ? ORDER BY i.created_at DESC LIMIT 100`,
    [business.id],
  );
  const expenses = all('SELECT * FROM expenses WHERE business_id = ? ORDER BY incurred_on DESC LIMIT 100', [business.id]);
  const payments = all('SELECT * FROM payments WHERE business_id = ? ORDER BY created_at DESC LIMIT 100', [business.id]);
  const outstanding = invoices
    .filter((i) => i.status !== 'paid')
    .reduce((sum, i) => sum + int(i.amount_cents, 0), 0);
  const summary = {
    ...revenue,
    outstandingCents: outstanding,
    invoiceCount: invoices.length,
    paidInvoiceCount: invoices.filter((i) => i.status === 'paid').length,
    expenseCents: expenses.reduce((sum, e) => sum + int(e.amount_cents, 0), 0),
  };
  res.type('html').send(W.financePage(ctx(req, res, {
    summary, invoices, expenses, payments, canManage: can(req.role, 'finance.manage'),
  })));
});

router.post('/finance/invoices', wrap(async (req, res) => {
  const business = req.business;
  const base = `/app/${business.slug}`;
  const amount = parseMoneyToCents(req.body.amount);
  if (amount === null || amount <= 0) throw validation('Enter a valid invoice amount.');
  const number = `INV-${new Date().getFullYear()}-${reference('').replace(/^-/, '')}`;
  const invoiceId = id('inv');
  insert('invoices', {
    id: invoiceId, business_id: business.id, patient_id: null,
    booking_id: req.body.booking_id || null, number,
    amount_cents: amount, currency: business.currency, status: 'unpaid',
    payer: 'self', insurance_json: null, created_at: nowIso(),
  });
  insert('invoice_items', {
    id: id('ivi'), invoice_id: invoiceId, business_id: business.id,
    description: String(req.body.description || 'Services').slice(0, 200),
    quantity: 1, unit_price_cents: amount,
  });
  recordAudit({ actor: req.user, action: 'invoice.created', entityType: 'invoice', entityId: invoiceId, businessId: business.id, ip: req.ip });
  done(res, `${base}/finance`, `Invoice ${number} created.`);
}));

router.post('/finance/invoices/:id/paid', wrap(async (req, res) => {
  const business = req.business;
  const base = `/app/${business.slug}`;
  const invoice = tenantRow('invoices', req.params.id, business.id);
  if (!invoice) throw notFound('Invoice not found.');
  if (invoice.status === 'paid') throw validation('This invoice is already recorded as paid.');
  update('invoices', invoice.id, { status: 'paid' });
  insert('payments', {
    id: id('pay'), business_id: business.id, provider: 'manual',
    provider_ref: `MANUAL-${invoice.number}`, purpose: 'invoice',
    amount_cents: invoice.amount_cents, currency: invoice.currency,
    status: 'recorded', raw_json: toJson({ recordedBy: req.user.email }), created_at: nowIso(),
  });
  recordAudit({ actor: req.user, action: 'invoice.marked_paid', entityType: 'invoice', entityId: invoice.id, businessId: business.id, ip: req.ip });
  done(res, `${base}/finance`, `${invoice.number} recorded as paid by staff (manual entry, not a provider-confirmed payment).`);
}));

router.post('/finance/expenses', wrap(async (req, res) => {
  const business = req.business;
  const base = `/app/${business.slug}`;
  const amount = parseMoneyToCents(req.body.amount);
  if (amount === null || amount <= 0) throw validation('Enter a valid expense amount.');
  insert('expenses', {
    id: id('exp'), business_id: business.id, branch_id: req.body.branch_id || null,
    category: String(req.body.category || 'General').slice(0, 80),
    description: String(req.body.note || req.body.description || '').slice(0, 240) || null,
    amount_cents: amount, currency: business.currency,
    incurred_on: /^\d{4}-\d{2}-\d{2}$/.test(String(req.body.incurred_on || '')) ? req.body.incurred_on : isoDate(),
    created_by_user_id: req.user.id, created_at: nowIso(),
  });
  done(res, `${base}/finance`, 'Expense recorded.');
}));

/* ═════════════════════════════ documents ═════════════════════════════ */

const ALLOWED_MIME = new Set([
  'application/pdf', 'image/png', 'image/jpeg', 'image/webp',
  'text/plain', 'text/csv', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

router.get('/documents', (req, res) => {
  const business = req.business;
  const documents = all(
    `SELECT d.*, u.name AS uploaded_by FROM documents d LEFT JOIN users u ON u.id = d.uploaded_by_user_id
      WHERE d.business_id = ? ORDER BY d.created_at DESC LIMIT 200`,
    [business.id],
  );
  res.type('html').send(W.documentsPage(ctx(req, res, { documents })));
});

router.post('/documents', wrap(async (req, res) => {
  const business = req.business;
  const name = String(req.body.name || '').trim();
  const mime = String(req.body.mime || '').toLowerCase();
  const base64 = String(req.body.data || '');
  if (!name) throw validation('A document name is required.');
  if (!ALLOWED_MIME.has(mime)) throw validation('That file type is not allowed. Upload a PDF, image, text, CSV or Office document.');
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) throw validation('The uploaded file was empty.');
  if (buffer.length > 5 * 1024 * 1024) throw validation('Files must be 5 MB or smaller.');

  const uploadDir = path.join(DATA_DIR, 'uploads', business.id);
  fs.mkdirSync(uploadDir, { recursive: true });
  const docId = id('doc');
  const ext = mime === 'application/pdf' ? '.pdf'
    : mime === 'image/png' ? '.png'
      : mime === 'image/jpeg' ? '.jpg'
        : mime === 'image/webp' ? '.webp'
          : mime === 'text/csv' ? '.csv'
            : mime === 'text/plain' ? '.txt' : '.bin';
  const storagePath = path.join(uploadDir, `${docId}${ext}`);
  fs.writeFileSync(storagePath, buffer);

  insert('documents', {
    id: docId, business_id: business.id, name,
    category: String(req.body.category || 'General').slice(0, 80),
    mime, size_bytes: buffer.length, storage_path: storagePath,
    uploaded_by_user_id: req.user.id, created_at: nowIso(),
  });
  recordAudit({ actor: req.user, action: 'document.uploaded', entityType: 'document', entityId: docId, businessId: business.id, ip: req.ip });
  res.json({ ok: true, id: docId, name });
}));

router.get('/documents/:id/download', (req, res) => {
  const business = req.business;
  const doc = tenantRow('documents', req.params.id, business.id);
  if (!doc) throw notFound('Document not found.');
  if (!fs.existsSync(doc.storage_path)) throw notFound('The stored file is missing.');
  res.type(doc.mime);
  res.setHeader('Content-Disposition', `attachment; filename="${String(doc.name).replace(/[^a-zA-Z0-9._ -]/g, '')}"`);
  fs.createReadStream(doc.storage_path).pipe(res);
});

router.post('/documents/:id/delete', wrap(async (req, res) => {
  const business = req.business;
  const base = `/app/${business.slug}`;
  const doc = tenantRow('documents', req.params.id, business.id);
  if (!doc) throw notFound('Document not found.');
  try { if (fs.existsSync(doc.storage_path)) fs.unlinkSync(doc.storage_path); } catch { /* file already gone */ }
  run('DELETE FROM documents WHERE id = ? AND business_id = ?', [doc.id, business.id]);
  recordAudit({ actor: req.user, action: 'document.deleted', entityType: 'document', entityId: doc.id, businessId: business.id, ip: req.ip });
  done(res, `${base}/documents`, 'Document deleted.');
}));

/* ═════════════════════════════ notifications / search / support ═════════════════════════════ */

router.get('/notifications', (req, res) => {
  const business = req.business;
  res.type('html').send(W.notificationsPage(ctx(req, res, {
    items: notificationsFor(business.id, 100),
  })));
});

router.get('/search', (req, res) => {
  const business = req.business;
  const query = String(req.query.q || '').trim();
  const results = query ? search(business.id, req.role, query) : [];
  res.type('html').send(W.searchPage(ctx(req, res, { results, query })));
});

router.get('/support', (req, res) => {
  const business = req.business;
  const tickets = all('SELECT * FROM support_tickets WHERE business_id = ? ORDER BY created_at DESC', [business.id]);
  res.type('html').send(W.supportPage(ctx(req, res, { tickets })));
});

router.post('/support', wrap(async (req, res) => {
  const business = req.business;
  const base = `/app/${business.slug}`;
  const subject = String(req.body.subject || '').trim();
  const body = String(req.body.body || '').trim();
  if (!subject || !body) throw validation('A subject and description are required.');
  const ticketId = id('tkt');
  insert('support_tickets', {
    id: ticketId, business_id: business.id, user_id: req.user.id, subject,
    category: String(req.body.category || 'general'), status: 'open',
    priority: 'normal', created_at: nowIso(), updated_at: nowIso(),
  });
  insert('support_messages', {
    id: id('tkm'), ticket_id: ticketId, author_type: 'user', author_id: req.user.id,
    body, created_at: nowIso(),
  });
  done(res, `${base}/support/${ticketId}`, 'Ticket opened. Support replies are recorded here — no automated response is sent.');
}));

router.get('/support/:id', (req, res) => {
  const business = req.business;
  const ticket = tenantRow('support_tickets', req.params.id, business.id);
  if (!ticket) throw notFound('Ticket not found.');
  const messages = all('SELECT * FROM support_messages WHERE ticket_id = ? ORDER BY created_at', [ticket.id]);
  res.type('html').send(W.ticketPage(ctx(req, res, { ticket, messages })));
});

router.post('/support/:id', wrap(async (req, res) => {
  const business = req.business;
  const base = `/app/${business.slug}`;
  const ticket = tenantRow('support_tickets', req.params.id, business.id);
  if (!ticket) throw notFound('Ticket not found.');
  const body = String(req.body.body || '').trim();
  if (!body) throw validation('Write a reply first.');
  insert('support_messages', {
    id: id('tkm'), ticket_id: ticket.id, author_type: 'user', author_id: req.user.id,
    body, created_at: nowIso(),
  });
  update('support_tickets', ticket.id, { updated_at: nowIso() });
  done(res, `${base}/support/${ticket.id}`, 'Reply added to the ticket.');
}));

/* ═════════════════════════════ AI ═════════════════════════════ */

router.get('/ai', (req, res) => {
  const business = req.business;
  ensureAgentDefaults(business.id);
  res.type('html').send(I.aiPage(ctx(req, res, {
    status: aiStatus(business),
    agents: agentsFor(business.id),
    knowledge: all('SELECT * FROM knowledge_docs WHERE business_id = ? ORDER BY updated_at DESC', [business.id]),
    usage: aiUsageSummary(business.id, 30),
    byAgent: all(
      `SELECT agent_key, COUNT(*) AS runs, SUM(COALESCE(tokens,0)) AS tokens
         FROM ai_runs WHERE business_id = ? AND created_at >= ? GROUP BY agent_key`,
      [business.id, new Date(Date.now() - 30 * 86400000).toISOString()],
    ),
    personality: parseJson(business.ai_personality_json, {}),
  })));
});

router.post('/ai/provider', wrap(async (req, res) => {
  const business = req.business;
  const base = `/app/${business.slug}`;
  const provider = String(req.body.provider || '').trim();
  if (!provider) throw validation('Choose an AI provider.');
  const config = {};
  if (req.body.api_key) config.apiKey = String(req.body.api_key).trim();
  if (req.body.model) config.model = String(req.body.model).trim();
  if (req.body.base_url) config.baseUrl = String(req.body.base_url).trim();
  saveCredentials({ businessId: business.id, provider, config, actor: req.user });
  const result = await testConnection({ businessId: business.id, provider, actor: req.user });
  done(res, `${base}/ai`, result.ok
    ? `AI provider ${provider} verified and saved.`
    : `Credentials saved, but verification failed: ${result.error || 'provider did not confirm the key'}.`);
}));

router.post('/ai/knowledge', wrap(async (req, res) => {
  const business = req.business;
  const base = `/app/${business.slug}`;
  const title = String(req.body.title || '').trim();
  const content = String(req.body.content || '').trim();
  if (!title || !content) throw validation('A knowledge title and content are required.');
  insert('knowledge_docs', {
    id: id('kb'), business_id: business.id, title,
    category: String(req.body.category || 'general'), content,
    is_active: 1, updated_at: nowIso(), created_at: nowIso(),
  });
  recordAudit({ actor: req.user, action: 'knowledge.created', entityType: 'knowledge', entityId: title, businessId: business.id, ip: req.ip });
  done(res, `${base}/ai`, 'Knowledge entry added. The receptionist retrieves it for matching questions.');
}));

router.post('/ai/knowledge/:id/delete', wrap(async (req, res) => {
  const business = req.business;
  const base = `/app/${business.slug}`;
  const doc = tenantRow('knowledge_docs', req.params.id, business.id);
  if (!doc) throw notFound('Knowledge entry not found.');
  run('DELETE FROM knowledge_docs WHERE id = ? AND business_id = ?', [doc.id, business.id]);
  done(res, `${base}/ai`, 'Knowledge entry removed.');
}));

router.post('/ai/agents/:key/toggle', wrap(async (req, res) => {
  const business = req.business;
  const base = `/app/${business.slug}`;
  const agent = get('SELECT * FROM ai_agents WHERE business_id = ? AND agent_key = ?', [business.id, req.params.key]);
  if (!agent) throw notFound('Agent not found.');
  update('ai_agents', agent.id, { enabled: agent.enabled ? 0 : 1 });
  done(res, `${base}/ai`, `${agent.name} ${agent.enabled ? 'disabled' : 'enabled'}.`);
}));

router.get('/conversations', (req, res) => {
  const business = req.business;
  res.type('html').send(I.conversationsPage(ctx(req, res, {
    conversations: conversationsFor(business.id, 100),
  })));
});

router.get('/conversations/:id', (req, res) => {
  const business = req.business;
  const conversation = tenantRow('conversations', req.params.id, business.id);
  if (!conversation) throw notFound('Conversation not found.');
  const customer = conversation.customer_id ? tenantRow('customers', conversation.customer_id, business.id) : null;
  res.type('html').send(I.conversationPage(ctx(req, res, {
    conversation,
    messages: conversationMessages(business.id, conversation.id, 200),
    customer,
  })));
});

router.post('/conversations/:id/reply', wrap(async (req, res) => {
  const business = req.business;
  const base = `/app/${business.slug}`;
  const conversation = tenantRow('conversations', req.params.id, business.id);
  if (!conversation) throw notFound('Conversation not found.');
  const body = String(req.body.body || '').trim();
  if (!body) throw validation('Write a message first.');
  const { addMessage } = await import('../lib/ai.js');
  const { sendWhatsAppMessage } = await import('../lib/notify.js');
  const message = addMessage({
    businessId: business.id, conversationId: conversation.id, direction: 'outbound',
    channel: conversation.channel, body, status: 'queued', author: req.user.email,
  });
  if (conversation.channel === 'whatsapp') {
    const sent = await sendWhatsAppMessage(business.id, { to: conversation.contact_ref, text: body });
    run('UPDATE messages SET status = ?, error = ?, provider_message_id = ? WHERE id = ?', [
      sent.ok ? 'sent' : 'failed', sent.ok ? null : (sent.error || 'delivery failed'),
      sent.providerMessageId || null, message.id,
    ]);
    return done(res, `${base}/conversations/${conversation.id}`, sent.ok
      ? 'Message delivered by WhatsApp.'
      : `Message stored but not delivered: ${sent.error || 'WhatsApp is not configured'}.`);
  }
  run('UPDATE messages SET status = ? WHERE id = ?', ['logged', message.id]);
  done(res, `${base}/conversations/${conversation.id}`, 'Message recorded on this channel. No external provider is configured for it.');
}));

router.post('/conversations/:id/escalate', wrap(async (req, res) => {
  const business = req.business;
  const base = `/app/${business.slug}`;
  const conversation = tenantRow('conversations', req.params.id, business.id);
  if (!conversation) throw notFound('Conversation not found.');
  escalateConversation({
    businessId: business.id, conversationId: conversation.id,
    reason: String(req.body.reason || 'Escalated to staff'), actor: req.user,
  });
  done(res, `${base}/conversations/${conversation.id}`, 'Conversation escalated to human staff.');
}));

router.post('/conversations/:id/ai', wrap(async (req, res) => {
  const business = req.business;
  const base = `/app/${business.slug}`;
  const conversation = tenantRow('conversations', req.params.id, business.id);
  if (!conversation) throw notFound('Conversation not found.');
  const lastInbound = get(
    "SELECT * FROM messages WHERE conversation_id = ? AND direction = 'inbound' ORDER BY created_at DESC LIMIT 1",
    [conversation.id],
  );
  if (!lastInbound) throw validation('There is no inbound message to answer.');
  const result = await receptionistReply({
    business, conversationId: conversation.id, text: lastInbound.body,
    channel: conversation.channel, contactRef: conversation.contact_ref,
    customerId: conversation.customer_id,
  });
  done(res, `${base}/conversations/${conversation.id}`, result.ok
    ? 'AI reply generated and stored.'
    : `AI reply unavailable: ${result.reason || result.error || 'provider not configured'}.`);
}));

router.get('/content', (req, res) => {
  const business = req.business;
  res.type('html').send(I.contentPage(ctx(req, res, {
    items: all('SELECT * FROM content_items WHERE business_id = ? ORDER BY created_at DESC LIMIT 100', [business.id]),
    kinds: CONTENT_KINDS,
    platforms: ['instagram', 'facebook', 'tiktok', 'x', 'whatsapp', 'email'],
    status: aiStatus(business),
  })));
});

router.post('/content', wrap(async (req, res) => {
  const business = req.business;
  const base = `/app/${business.slug}`;
  const result = await generateContent({
    business,
    kind: String(req.body.kind || 'caption'),
    platform: String(req.body.platform || 'instagram'),
    brief: String(req.body.prompt || req.body.brief || '').trim(),
    actor: req.user,
  });
  done(res, `${base}/content`, result.ok
    ? 'Content generated. Review and edit it before publishing.'
    : `Content generation unavailable: ${result.reason || result.error || 'AI provider not configured'}.`);
}));

router.post('/content/:id/publish', wrap(async (req, res) => {
  const business = req.business;
  const base = `/app/${business.slug}`;
  const item = tenantRow('content_items', req.params.id, business.id);
  if (!item) throw notFound('Content item not found.');
  const integration = listIntegrations(business.id).find((i) => i.provider === item.platform);
  if (!integration || integration.status !== 'connected') {
    update('content_items', item.id, {
      status: 'blocked', error: `${item.platform} is not connected with publishing permission.`, updated_at: nowIso(),
    });
    return done(res, `${base}/content`, `Publishing blocked: ${item.platform} is not connected. Content was not published.`);
  }
  update('content_items', item.id, {
    status: 'blocked',
    error: 'This integration does not yet expose provider publishing; content was not published.',
    updated_at: nowIso(),
  });
  done(res, `${base}/content`, 'Publishing is not enabled for this provider connection, so nothing was published.');
}));

router.post('/content/:id/delete', wrap(async (req, res) => {
  const business = req.business;
  const base = `/app/${business.slug}`;
  const item = tenantRow('content_items', req.params.id, business.id);
  if (!item) throw notFound('Content item not found.');
  run('DELETE FROM content_items WHERE id = ? AND business_id = ?', [item.id, business.id]);
  done(res, `${base}/content`, 'Content item deleted.');
}));

/* ═════════════════════════════ automation ═════════════════════════════ */

router.get('/automations', (req, res) => {
  const business = req.business;
  res.type('html').send(I.automationsPage(ctx(req, res, {
    automations: listAutomations(business.id),
    triggers: TRIGGERS,
    actions: ACTIONS,
    runs: automationRuns(business.id, null, 50),
    performance: automationPerformance(business.id, 30),
  })));
});

router.post('/automations', wrap(async (req, res) => {
  const business = req.business;
  const base = `/app/${business.slug}`;
  const name = String(req.body.name || '').trim();
  const trigger = String(req.body.trigger || '').trim();
  const actionType = String(req.body.action || req.body.action_type || '').trim();
  if (!name || !trigger || !actionType) throw validation('A workflow needs a name, trigger and action.');
  const definition = {
    trigger,
    conditions: String(req.body.conditions || '').trim()
      ? [{ field: 'status', op: 'equals', value: String(req.body.conditions).trim() }]
      : [],
    actions: [{ type: actionType, config: { template: String(req.body.template || '').trim() || null } }],
  };
  saveWorkflow({ businessId: business.id, name, definition, actor: req.user });
  done(res, `${base}/automations`, 'Workflow saved. It runs on the backend when its trigger fires.');
}));

router.post('/automations/:id/test', wrap(async (req, res) => {
  const business = req.business;
  const base = `/app/${business.slug}`;
  const automation = tenantRow('automations', req.params.id, business.id);
  if (!automation) throw notFound('Workflow not found.');
  const result = await runAutomation({
    automation, subjectType: 'test', subjectId: req.user.id,
    context: { test: true, customerName: 'Test run' },
  });
  done(res, `${base}/automations`, `Test run ${result.ok ? 'completed' : 'failed'}: ${result.detail || result.error || 'no detail'}.`);
}));

router.post('/automations/:id/status', wrap(async (req, res) => {
  const business = req.business;
  const base = `/app/${business.slug}`;
  const automation = tenantRow('automations', req.params.id, business.id);
  if (!automation) throw notFound('Workflow not found.');
  const status = String(req.body.status || '');
  if (!['active', 'paused', 'draft'].includes(status)) throw validation('Unsupported workflow status.');
  setAutomationStatus({ businessId: business.id, automationId: automation.id, status, actor: req.user });
  done(res, `${base}/automations`, `Workflow ${status}.`);
}));

/* ═════════════════════════════ integrations ═════════════════════════════ */

router.get('/integrations', (req, res) => {
  const business = req.business;
  ensureIntegrationRows(business.id);
  res.type('html').send(I.integrationsPage(ctx(req, res, {
    integrations: listIntegrations(business.id),
    summary: integrationSummary(business.id),
  })));
});

router.post('/integrations/:provider', wrap(async (req, res) => {
  const business = req.business;
  const base = `/app/${business.slug}`;
  const provider = String(req.params.provider || '');
  const config = {};
  for (const [key, value] of Object.entries(req.body)) {
    if (key === '_csrf' || key === 'account_label') continue;
    if (typeof value === 'string' && value.trim()) config[key] = value.trim();
  }
  if (req.body.account_label) config.accountLabel = String(req.body.account_label).trim();
  if (!Object.keys(config).length) throw validation('Enter the provider credentials before saving.');
  saveCredentials({ businessId: business.id, provider, config, actor: req.user });
  const result = await testConnection({ businessId: business.id, provider, actor: req.user });
  done(res, `${base}/integrations`, result.ok
    ? `${provider} verified and connected.`
    : `Credentials saved for ${provider}, but the connection is not verified: ${result.error || 'provider did not confirm'}.`);
}));

router.post('/integrations/:provider/test', wrap(async (req, res) => {
  const business = req.business;
  const base = `/app/${business.slug}`;
  const result = await testConnection({ businessId: business.id, provider: String(req.params.provider), actor: req.user });
  done(res, `${base}/integrations`, result.ok
    ? `${req.params.provider} connection verified.`
    : `${req.params.provider} verification failed: ${result.error || 'no response from provider'}.`);
}));

router.post('/integrations/:provider/disconnect', wrap(async (req, res) => {
  const business = req.business;
  const base = `/app/${business.slug}`;
  disconnectIntegration({ businessId: business.id, provider: String(req.params.provider), actor: req.user });
  done(res, `${base}/integrations`, `${req.params.provider} disconnected.`);
}));

/* ═════════════════════════════ analytics / command ═════════════════════════════ */

router.get('/analytics', (req, res) => {
  const business = req.business;
  const days = clamp(int(req.query.days, 30), 1, 365);
  res.type('html').send(I.analyticsPage(ctx(req, res, {
    days,
    metrics: bookingMetrics(business.id, { days }),
    series: bookingSeries(business.id, Math.min(days, 60), null),
    services: servicePerformance(business.id, days),
    staff: staffActivity(business.id, days),
    branches: branchComparison(business.id, days),
    segments: customerSegments(business.id),
    revenue: revenueSummary(business.id, days),
    marketing: marketingMetrics(business.id, days),
    ai: aiUsageSummary(business.id, days),
    automation: automationPerformance(business.id, days),
  })));
});

router.get('/command', (req, res) => {
  const business = req.business;
  const list = businessesForUser(req.user.id);
  const businesses = list.map((b) => {
    const snapshot = dashboard(b.id, { days: 30 });
    return {
      ...b,
      metrics: snapshot.metrics,
      today: (snapshot.today || []).length,
      revenue: snapshot.revenue,
      subscription: getSubscription(b.id),
      integrations: integrationSummary(b.id),
    };
  });
  const alerts = [];
  for (const b of businesses) {
    if ((b.integrations.needsAttention || 0) > 0) {
      alerts.push({ level: 'warn', text: `${b.name}: ${b.integrations.needsAttention} integration(s) need attention`, href: `/app/${b.slug}/integrations` });
    }
    if (b.subscription && ['past_due', 'suspended', 'expired'].includes(b.subscription.status)) {
      alerts.push({ level: 'bad', text: `${b.name}: subscription ${b.subscription.status}`, href: `/app/${b.slug}/billing` });
    }
    if (!b.integrations.connected) {
      alerts.push({ level: 'plain', text: `${b.name}: no integrations verified yet`, href: `/app/${b.slug}/integrations` });
    }
  }
  const totals = businesses.reduce((acc, b) => ({
    bookings: acc.bookings + int(b.metrics?.totalBookings, 0),
    revenueCents: acc.revenueCents + int(b.revenue?.confirmedCents, 0),
    customers: acc.customers + int(b.metrics?.customers, 0),
  }), { bookings: 0, revenueCents: 0, customers: 0 });

  res.type('html').send(I.commandPage(ctx(req, res, {
    businesses,
    alerts,
    timeline: activityTimeline(business.id, 25),
    totals,
    subscriptions: businesses.map((b) => ({ business: b.name, ...(b.subscription || {}) })),
  })));
});

/* ═════════════════════════════ settings / billing ═════════════════════════════ */

router.get('/settings', (req, res) => {
  const business = req.business;
  res.type('html').send(I.settingsPage(ctx(req, res, {
    branches: all('SELECT * FROM branches WHERE business_id = ? ORDER BY name', [business.id]),
    members: all(
      `SELECT m.*, u.name AS user_name, u.email AS user_email
         FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.business_id = ? ORDER BY m.created_at`,
      [business.id],
    ),
    apiKeys: all('SELECT * FROM api_keys WHERE business_id = ? AND revoked_at IS NULL ORDER BY created_at DESC', [business.id]),
    webhooks: all('SELECT * FROM webhook_endpoints WHERE business_id = ? ORDER BY created_at DESC', [business.id]),
    rules: bookingRules(business),
    personality: parseJson(business.ai_personality_json, {}),
    org: get('SELECT * FROM organisations WHERE id = ?', [business.org_id]),
  })));
});

router.post('/settings', wrap(async (req, res) => {
  const business = req.business;
  const base = `/app/${business.slug}`;
  update('businesses', business.id, {
    name: String(req.body.name || business.name).trim().slice(0, 120),
    description: String(req.body.description || '').trim().slice(0, 2000) || null,
    phone: String(req.body.phone || '').trim() || null,
    email: isEmail(String(req.body.email || '')) ? String(req.body.email).trim() : business.email,
    whatsapp: String(req.body.whatsapp || '').trim() || null,
    address: String(req.body.address || '').trim() || null,
    city: String(req.body.city || '').trim() || null,
    country: String(req.body.country || business.country).trim(),
    timezone: String(req.body.timezone || business.timezone).trim(),
    currency: String(req.body.currency || business.currency).trim().toUpperCase().slice(0, 3),
    policies: String(req.body.policies || '').trim() || null,
    updated_at: nowIso(),
  });
  recordAudit({ actor: req.user, action: 'business.updated', entityType: 'business', entityId: business.id, businessId: business.id, ip: req.ip });
  done(res, `${base}/settings`, 'Business profile saved.');
}));

router.post('/settings/rules', wrap(async (req, res) => {
  const business = req.business;
  const base = `/app/${business.slug}`;
  const rules = {
    slotStepMin: clamp(int(req.body.slot_step_min, 15), 5, 120),
    minNoticeMin: clamp(int(req.body.min_notice_min, 60), 0, 10080),
    maxDaysAhead: clamp(int(req.body.max_days_ahead, 60), 1, 365),
    cancelNoticeHours: clamp(int(req.body.cancel_notice_hours, 4), 0, 720),
    allowWaitlist: Boolean(req.body.allow_waitlist),
    requireDeposit: Boolean(req.body.require_deposit),
  };
  update('businesses', business.id, { booking_rules_json: toJson(rules), updated_at: nowIso() });
  done(res, `${base}/settings`, 'Booking rules saved. Availability calculations use them immediately.');
}));

router.post('/settings/invite', wrap(async (req, res) => {
  const business = req.business;
  const base = `/app/${business.slug}`;
  const email = String(req.body.email || '').trim().toLowerCase();
  const role = String(req.body.role || 'staff');
  if (!isEmail(email)) throw validation('Enter a valid email address.');
  if (!['manager', 'receptionist', 'staff'].includes(role)) throw validation('Choose a valid role.');

  let user = get('SELECT * FROM users WHERE email = ?', [email]);
  let inviteLink = null;
  if (!user) {
    const { registerUser, issueToken } = await import('../lib/auth.js');
    user = registerUser({ email, name: email.split('@')[0], password: `Tmp-${id('pw')}-${id('pw')}`, phone: null });
    const token = issueToken(user.id, 'password_reset', 72 * 3600_000);
    inviteLink = `${req.protocol}://${req.get('host')}/reset/${token}`;
  }
  const existing = get('SELECT * FROM memberships WHERE business_id = ? AND user_id = ?', [business.id, user.id]);
  if (existing) throw validation('That person is already a member of this business.');
  insert('memberships', {
    id: id('mem'), business_id: business.id, user_id: user.id, role,
    branch_id: req.body.branch_id || null, status: 'active', created_at: nowIso(),
  });
  recordAudit({ actor: req.user, action: 'member.invited', entityType: 'user', entityId: user.id, businessId: business.id, ip: req.ip });

  if (inviteLink) {
    // No email provider is configured, so the one-time link is shown to the inviter
    // rather than claiming an invitation email was delivered.
    return res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><title>Invitation created</title>
      <link rel="stylesheet" href="/assets/app.css"></head><body><div class="wrap" style="max-width:640px;padding:3rem 1.2rem">
      <h1>Invitation created</h1>
      <p class="muted">Share this one-time link with ${email}. It expires in 72 hours. Email delivery is not configured, so no message was sent.</p>
      <p><a class="mono" href="${inviteLink}">${inviteLink}</a></p>
      <p><a class="btn btn-sm" href="${base}/settings">Back to settings</a></p></div></body></html>`);
  }
  done(res, `${base}/settings`, `${email} added as ${role}.`);
}));

router.post('/settings/api-keys', wrap(async (req, res) => {
  const business = req.business;
  const base = `/app/${business.slug}`;
  const name = String(req.body.name || 'API key').trim().slice(0, 80);
  const { randomToken, sha256 } = await import('../lib/security.js');
  const raw = `mvr_${randomToken(24)}`;
  const keyId = id('key');
  insert('api_keys', {
    id: keyId, business_id: business.id, name, prefix: raw.slice(0, 12),
    key_hash: sha256(raw), scopes_json: toJson(['read']), last_used_at: null,
    revoked_at: null, created_at: nowIso(),
  });
  recordAudit({ actor: req.user, action: 'apikey.created', entityType: 'api_key', entityId: keyId, businessId: business.id, ip: req.ip });
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><title>API key created</title>
    <link rel="stylesheet" href="/assets/app.css"></head><body><div class="wrap" style="max-width:640px;padding:3rem 1.2rem">
    <h1>API key created</h1>
    <p class="muted">Copy it now — it is stored only as a hash and cannot be shown again.</p>
    <p class="mono" style="word-break:break-all">${raw}</p>
    <p><a class="btn btn-sm" href="${base}/settings">Back to settings</a></p></div></body></html>`);
}));

router.post('/settings/api-keys/:id/revoke', wrap(async (req, res) => {
  const business = req.business;
  const base = `/app/${business.slug}`;
  const key = tenantRow('api_keys', req.params.id, business.id);
  if (!key) throw notFound('API key not found.');
  update('api_keys', key.id, { revoked_at: nowIso() });
  recordAudit({ actor: req.user, action: 'apikey.revoked', entityType: 'api_key', entityId: key.id, businessId: business.id, ip: req.ip });
  done(res, `${base}/settings`, 'API key revoked.');
}));

router.post('/settings/webhooks', wrap(async (req, res) => {
  const business = req.business;
  const base = `/app/${business.slug}`;
  const url = String(req.body.url || '').trim();
  if (!/^https:\/\/[^\s]+$/i.test(url)) throw validation('Webhook endpoints must use HTTPS.');
  const { randomToken } = await import('../lib/security.js');
  insert('webhook_endpoints', {
    id: id('whk'), business_id: business.id, url, secret: randomToken(24),
    events_json: toJson(splitList(req.body.events || 'booking.created,booking.cancelled')), is_active: 1, created_at: nowIso(),
  });
  done(res, `${base}/settings`, 'Webhook endpoint registered.');
}));

router.get('/billing', (req, res) => {
  const business = req.business;
  res.type('html').send(I.billingPage(ctx(req, res, {
    ent: entitlementsFor(business.id),
    plans: listPlans(),
    payments: all('SELECT * FROM payments WHERE business_id = ? ORDER BY created_at DESC LIMIT 50', [business.id]),
    providers: PROVIDER_CATALOG.filter((p) => p.category === 'payments' || p.category === 'payment'),
  })));
});

router.post('/billing/plan', wrap(async (req, res) => {
  const business = req.business;
  const base = `/app/${business.slug}`;
  const planId = String(req.body.plan_id || '');
  const plan = get('SELECT * FROM plans WHERE id = ?', [planId]);
  if (!plan) throw validation('Choose a plan.');
  const paymentProvider = listIntegrations(business.id).find(
    (i) => ['stripe', 'paypal', 'mpesa'].includes(i.provider) && i.status === 'connected',
  );
  changePlan({ businessId: business.id, planId, actor: req.user, activate: Boolean(paymentProvider) });
  done(res, `${base}/billing`, paymentProvider
    ? `Plan set to ${plan.name}. Billing confirmation is recorded from the provider's webhook.`
    : `Plan preference saved as ${plan.name}, pending payment. Connect a payment provider to activate it — no charge was made.`);
}));

/* ═════════════════════════════ healthcare ═════════════════════════════ */

router.get('/healthcare', (req, res) => {
  const business = req.business;
  const enabled = healthcareEnabled(business);
  const patients = all('SELECT * FROM patients WHERE business_id = ? ORDER BY created_at DESC LIMIT 100', [business.id]);
  const encounters = all(
    `SELECT e.*, p.first_name, p.last_name, p.patient_no FROM encounters e
       JOIN patients p ON p.id = e.patient_id WHERE e.business_id = ?
      ORDER BY e.started_at DESC LIMIT 100`,
    [business.id],
  );
  const queue = all(
    `SELECT q.*, p.first_name, p.last_name FROM patient_queue q
       JOIN patients p ON p.id = q.patient_id WHERE q.business_id = ?
      ORDER BY q.created_at LIMIT 100`,
    [business.id],
  );
  res.type('html').send(I.healthcarePage(ctx(req, res, {
    enabled, patients, encounters, queue,
    counts: {
      patients: patients.length,
      encounters: encounters.length,
      openEncounters: encounters.filter((e) => e.status === 'open').length,
      waiting: queue.filter((q) => q.status === 'waiting').length,
    },
  })));
});

router.post('/healthcare/patients', wrap(async (req, res) => {
  const business = req.business;
  const base = `/app/${business.slug}`;
  if (!healthcareEnabled(business)) throw validation('Healthcare records are only available for healthcare businesses.');
  const first = String(req.body.first_name || '').trim();
  const last = String(req.body.last_name || '').trim();
  if (!first || !last) throw validation('First and last name are required.');
  const count = scalar('SELECT COUNT(*) AS c FROM patients WHERE business_id = ?', [business.id]) + 1;
  const patientId = id('pat');
  const patientNo = `${String(business.slug).slice(0, 6).toUpperCase()}-${String(count).padStart(5, '0')}`;
  insert('patients', {
    id: patientId, business_id: business.id, patient_no: patientNo,
    first_name: first, last_name: last,
    dob: /^\d{4}-\d{2}-\d{2}$/.test(String(req.body.dob || '')) ? req.body.dob : null,
    sex: String(req.body.sex || '').trim() || null,
    phone: String(req.body.phone || '').trim() || null,
    email: isEmail(String(req.body.email || '')) ? String(req.body.email).trim() : null,
    national_id: String(req.body.national_id || '').trim() || null,
    blood_group: String(req.body.blood_group || '').trim() || null,
    allergies: String(req.body.allergies || '').trim() || null,
    notes: null, created_at: nowIso(), updated_at: nowIso(),
  });
  recordAudit({ actor: req.user, action: 'patient.created', entityType: 'patient', entityId: patientId, businessId: business.id, ip: req.ip });
  done(res, `${base}/healthcare`, `Patient ${patientNo} registered.`);
}));

router.post('/healthcare/encounters', wrap(async (req, res) => {
  const business = req.business;
  const base = `/app/${business.slug}`;
  if (!healthcareEnabled(business)) throw validation('Healthcare records are only available for healthcare businesses.');
  const patient = tenantRow('patients', String(req.body.patient_id || ''), business.id);
  if (!patient) throw validation('Select a patient registered to this business.');
  insert('encounters', {
    id: id('enc'), business_id: business.id, branch_id: req.body.branch_id || null,
    department_id: null, patient_id: patient.id, provider_staff_id: req.body.staff_id || null,
    encounter_type: String(req.body.encounter_type || 'consultation'),
    status: 'open', reason: String(req.body.reason || '').trim() || null,
    started_at: nowIso(), closed_at: null, created_at: nowIso(),
  });
  recordAudit({ actor: req.user, action: 'encounter.created', entityType: 'patient', entityId: patient.id, businessId: business.id, ip: req.ip });
  done(res, `${base}/healthcare`, 'Encounter opened. Clinical notes are recorded by authorised clinicians only.');
}));

/* ═════════════════════════════ audit ═════════════════════════════ */

router.get('/audit', (req, res) => {
  const business = req.business;
  const logs = all(
    'SELECT * FROM audit_logs WHERE business_id = ? ORDER BY created_at DESC LIMIT 200',
    [business.id],
  );
  res.type('html').send(I.auditPage(ctx(req, res, { logs })));
});

/* ═════════════════════════════ public site shortcut ═════════════════════════════ */

router.get('/site', (req, res) => {
  res.redirect(303, `/business/${req.business.slug}`);
});

/* ═════════════════════════════ onboarding ═════════════════════════════ */

const STEP_COUNT = 14;

function onboardingCtx(req, res, extra = {}) {
  const business = req.business;
  return ctx(req, res, {
    step: clamp(int(req.query.step, business.onboarding_step || 1), 1, STEP_COUNT),
    steps: STEP_COUNT,
    branches: all('SELECT * FROM branches WHERE business_id = ? ORDER BY name', [business.id]),
    services: all('SELECT * FROM services WHERE business_id = ? ORDER BY name', [business.id]),
    staff: all('SELECT * FROM staff WHERE business_id = ? ORDER BY name', [business.id]),
    knowledge: all('SELECT * FROM knowledge_docs WHERE business_id = ? ORDER BY created_at', [business.id]),
    integrations: listIntegrations(business.id),
    rules: bookingRules(business),
    personality: parseJson(business.ai_personality_json, {}),
    ...extra,
  });
}

router.get('/onboarding', (req, res) => {
  res.type('html').send(onboardingPage(onboardingCtx(req, res)));
});

router.post('/onboarding/:step', wrap(async (req, res) => {
  const business = req.business;
  const base = `/app/${business.slug}`;
  const step = clamp(int(req.params.step, 1), 1, STEP_COUNT);
  const body = req.body;
  const next = Math.min(step + 1, STEP_COUNT);

  switch (step) {
    case 1: {
      const name = String(body.name || '').trim();
      if (!name) throw validation('Enter your business name.');
      update('businesses', business.id, {
        name,
        industry: String(body.industry || business.industry || 'salon'),
        description: String(body.description || '').trim() || null,
        phone: String(body.phone || '').trim() || null,
        email: isEmail(String(body.email || '')) ? String(body.email).trim() : business.email,
        whatsapp: String(body.whatsapp || '').trim() || null,
        updated_at: nowIso(),
      });
      break;
    }
    case 2:
      update('businesses', business.id, {
        address: String(body.address || '').trim() || null,
        city: String(body.city || '').trim() || null,
        country: String(body.country || business.country).trim(),
        timezone: String(body.timezone || business.timezone).trim(),
        currency: String(body.currency || business.currency).toUpperCase().slice(0, 3),
        updated_at: nowIso(),
      });
      break;
    case 3: {
      const name = String(body.name || '').trim();
      if (!name) throw validation('Enter a branch name.');
      const existing = scalar('SELECT COUNT(*) AS c FROM branches WHERE business_id = ?', [business.id]);
      const branchId = id('brc');
      insert('branches', {
        id: branchId, business_id: business.id, name,
        slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || branchId,
        address: String(body.address || '').trim() || null,
        city: String(body.city || '').trim() || business.city,
        phone: String(body.phone || '').trim() || null,
        timezone: business.timezone, is_primary: existing ? 0 : 1, is_active: 1, created_at: nowIso(),
      });
      for (let weekday = 0; weekday <= 6; weekday += 1) {
        insert('branch_hours', {
          id: id('bh'), branch_id: branchId, weekday,
          open_min: 540, close_min: 1080, is_closed: weekday === 0 ? 1 : 0,
        });
      }
      break;
    }
    case 4: {
      const branches = all('SELECT * FROM branches WHERE business_id = ?', [business.id]);
      for (const branch of branches) {
        for (let weekday = 0; weekday <= 6; weekday += 1) {
          const opens = body[`open_${weekday}`];
          const closes = body[`close_${weekday}`];
          if (!opens && !closes) continue;
          const toMin = (value, fallback) => {
            const [h, m] = String(value || '').split(':').map((n) => int(n, 0));
            return Number.isFinite(h) && h >= 0 && h <= 23 ? h * 60 + clamp(m, 0, 59) : fallback;
          };
          const row = get('SELECT * FROM branch_hours WHERE branch_id = ? AND weekday = ?', [branch.id, weekday]);
          const closed = Boolean(body[`closed_${weekday}`]);
          if (row) {
            update('branch_hours', row.id, {
              open_min: toMin(opens, row.open_min), close_min: toMin(closes, row.close_min),
              is_closed: closed ? 1 : 0,
            });
          } else {
            insert('branch_hours', {
              id: id('bh'), branch_id: branch.id, weekday,
              open_min: toMin(opens, 540), close_min: toMin(closes, 1080), is_closed: closed ? 1 : 0,
            });
          }
        }
      }
      break;
    }
    case 5: {
      const name = String(body.name || '').trim();
      if (!name) throw validation('Enter a service name.');
      const price = parseMoneyToCents(body.price);
      insert('services', {
        id: id('svc'), business_id: business.id, name,
        description: String(body.description || '').trim() || null,
        category: String(body.category || '').trim() || null,
        duration_min: clamp(int(body.duration_min, 60), 5, 480), buffer_min: 0,
        price_cents: price === null ? 0 : price, currency: business.currency,
        is_active: 1, created_at: nowIso(), updated_at: nowIso(),
      });
      break;
    }
    case 6: {
      const services = all('SELECT * FROM services WHERE business_id = ?', [business.id]);
      for (const service of services) {
        const raw = body[`price_${service.id}`];
        if (raw === undefined || raw === '') continue;
        const cents = parseMoneyToCents(raw);
        if (cents === null) continue;
        update('services', service.id, { price_cents: cents, updated_at: nowIso() });
      }
      break;
    }
    case 7: {
      const name = String(body.name || '').trim();
      if (!name) throw validation('Enter a team member name.');
      const staffId = id('stf');
      insert('staff', {
        id: staffId, business_id: business.id, branch_id: body.branch_id || null, user_id: null,
        name, title: String(body.title || '').trim() || null,
        email: isEmail(String(body.email || '')) ? String(body.email).trim() : null,
        phone: String(body.phone || '').trim() || null, color: null, is_active: 1, created_at: nowIso(),
      });
      for (let weekday = 1; weekday <= 6; weekday += 1) {
        insert('staff_schedules', { id: id('sch'), staff_id: staffId, weekday, start_min: 540, end_min: 1080 });
      }
      break;
    }
    case 8:
      update('businesses', business.id, {
        booking_rules_json: toJson({
          slotStepMin: clamp(int(body.slot_step_min, 15), 5, 120),
          minNoticeMin: clamp(int(body.min_notice_min, 60), 0, 10080),
          maxDaysAhead: clamp(int(body.max_days_ahead, 60), 1, 365),
          cancelNoticeHours: clamp(int(body.cancel_notice_hours, 4), 0, 720),
          allowWaitlist: Boolean(body.allow_waitlist),
          requireDeposit: Boolean(body.require_deposit),
        }),
        updated_at: nowIso(),
      });
      break;
    case 9:
      update('businesses', business.id, {
        ai_personality_json: toJson({
          tone: String(body.tone || 'professional'),
          language: String(body.language || 'en'),
          signoff: String(body.signoff || '').trim() || null,
          escalationPhone: String(body.escalation_phone || '').trim() || null,
        }),
        updated_at: nowIso(),
      });
      break;
    case 10: {
      const title = String(body.title || '').trim();
      const content = String(body.content || '').trim();
      if (!title || !content) throw validation('Add a title and the knowledge content.');
      insert('knowledge_docs', {
        id: id('kb'), business_id: business.id, title,
        category: String(body.category || 'faq'), content,
        is_active: 1, updated_at: nowIso(), created_at: nowIso(),
      });
      break;
    }
    case 11: {
      const config = {};
      for (const key of ['phone_number_id', 'waba_id', 'access_token', 'verify_token', 'app_secret']) {
        if (String(body[key] || '').trim()) config[key] = String(body[key]).trim();
      }
      if (Object.keys(config).length) {
        saveCredentials({ businessId: business.id, provider: 'whatsapp', config, actor: req.user });
      }
      break;
    }
    case 12: {
      const social = {};
      for (const key of ['instagram', 'facebook', 'tiktok', 'x']) {
        if (String(body[key] || '').trim()) social[key] = String(body[key]).trim();
      }
      update('businesses', business.id, { social_json: toJson(social), updated_at: nowIso() });
      break;
    }
    case 13: {
      const provider = String(body.provider || '').trim();
      if (provider) {
        const config = {};
        for (const [key, value] of Object.entries(body)) {
          if (['provider', '_csrf'].includes(key)) continue;
          if (typeof value === 'string' && value.trim()) config[key] = value.trim();
        }
        if (Object.keys(config).length) saveCredentials({ businessId: business.id, provider, config, actor: req.user });
      }
      break;
    }
    case 14:
      update('businesses', business.id, { onboarding_completed_at: nowIso(), onboarding_step: STEP_COUNT, updated_at: nowIso() });
      recordAudit({ actor: req.user, action: 'business.onboarding_completed', entityType: 'business', entityId: business.id, businessId: business.id, ip: req.ip });
      publish(business.id, 'business.launched', { name: business.name });
      return done(res, base, 'Onboarding complete. Your workspace is live.');
    default:
      break;
  }

  update('businesses', business.id, { onboarding_step: Math.max(int(business.onboarding_step, 1), next), updated_at: nowIso() });
  done(res, `${base}/onboarding?step=${next}`, 'Step saved.');
}));

router.post('/onboarding/:step/:id/delete', wrap(async (req, res) => {
  const business = req.business;
  const base = `/app/${business.slug}`;
  const step = clamp(int(req.params.step, 1), 1, STEP_COUNT);
  const table = step === 3 ? 'branches' : step === 5 ? 'services' : step === 7 ? 'staff' : step === 10 ? 'knowledge_docs' : null;
  if (!table) throw notFound('Nothing to delete for this step.');
  const row = tenantRow(table, req.params.id, business.id);
  if (!row) throw notFound('Record not found.');
  run(`DELETE FROM ${table} WHERE id = ? AND business_id = ?`, [row.id, business.id]);
  done(res, `${base}/onboarding?step=${step}`, 'Removed.');
}));

router.post('/onboarding/:step/continue', (req, res) => {
  const business = req.business;
  const step = clamp(int(req.params.step, 1), 1, STEP_COUNT);
  res.redirect(303, `/app/${business.slug}/onboarding?step=${Math.min(step + 1, STEP_COUNT)}`);
});

export default router;
