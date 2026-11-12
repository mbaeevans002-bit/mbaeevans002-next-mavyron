import { all, get, scalar } from './db.js';
import { int, isoDate, parseJson } from './util.js';
import { can } from './auth.js';
import { aiUsageSummary } from './ai.js';
import { automationPerformance } from './automation.js';

function sinceIso(days) {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function pct(part, whole) {
  if (!whole) return null;
  return Math.round((part / whole) * 1000) / 10;
}

export function bookingMetrics(businessId, { branchId = null, days = 30 } = {}) {
  const since = sinceIso(days);
  const branchSql = branchId ? ' AND branch_id = ?' : '';
  const params = branchId ? [businessId, since, branchId] : [businessId, since];
  const rows = all(
    `SELECT status, COUNT(*) AS n, SUM(price_cents) AS value FROM bookings
     WHERE business_id = ? AND created_at >= ?${branchSql} GROUP BY status`,
    params
  );
  const byStatus = Object.fromEntries(rows.map((r) => [r.status, r.n]));
  const total = rows.reduce((s, r) => s + r.n, 0);
  const completed = byStatus.completed || 0;
  const noShow = byStatus.no_show || 0;
  const cancelled = byStatus.cancelled || 0;
  const confirmed = byStatus.confirmed || 0;
  const scheduledValue = rows
    .filter((r) => ['confirmed', 'completed'].includes(r.status))
    .reduce((s, r) => s + int(r.value), 0);
  return {
    total, confirmed, completed, cancelled, noShow,
    completionRate: pct(completed, total),
    cancellationRate: pct(cancelled, total),
    noShowRate: pct(noShow, completed + noShow || total),
    scheduledValueCents: scheduledValue,
  };
}

export function todaySnapshot(businessId, { branchId = null } = {}) {
  const day = isoDate(new Date());
  const branchSql = branchId ? ' AND b.branch_id = ?' : '';
  const params = branchId ? [businessId, day, branchId] : [businessId, day];
  const today = all(
    `SELECT b.*, s.name AS service_name, st.name AS staff_name, c.name AS customer_name, c.phone AS customer_phone
     FROM bookings b JOIN services s ON s.id = b.service_id
     JOIN staff st ON st.id = b.staff_id JOIN customers c ON c.id = b.customer_id
     WHERE b.business_id = ? AND date(b.start_at) = ?${branchSql}
     ORDER BY b.start_at ASC`,
    params
  );
  const upcoming = all(
    `SELECT b.*, s.name AS service_name, st.name AS staff_name, c.name AS customer_name
     FROM bookings b JOIN services s ON s.id = b.service_id
     JOIN staff st ON st.id = b.staff_id JOIN customers c ON c.id = b.customer_id
     WHERE b.business_id = ? AND b.start_at > ? AND b.status = 'confirmed'${branchSql}
     ORDER BY b.start_at ASC LIMIT 8`,
    branchId ? [businessId, new Date().toISOString(), branchId] : [businessId, new Date().toISOString()]
  );
  return { day, today, upcoming };
}

export function bookingSeries(businessId, days = 14, branchId = null) {
  const since = sinceIso(days);
  const rows = all(
    `SELECT date(start_at) AS day, status, COUNT(*) AS n, SUM(price_cents) AS value
     FROM bookings WHERE business_id = ? AND start_at >= ?${branchId ? ' AND branch_id = ?' : ''}
     GROUP BY day, status ORDER BY day ASC`,
    branchId ? [businessId, since, branchId] : [businessId, since]
  );
  const map = new Map();
  for (const row of rows) {
    const entry = map.get(row.day) || { day: row.day, total: 0, completed: 0, cancelled: 0, noShow: 0, valueCents: 0 };
    entry.total += row.n;
    if (row.status === 'completed') entry.completed += row.n;
    if (row.status === 'cancelled') entry.cancelled += row.n;
    if (row.status === 'no_show') entry.noShow += row.n;
    if (['confirmed', 'completed'].includes(row.status)) entry.valueCents += int(row.value);
    map.set(row.day, entry);
  }
  return [...map.values()];
}

export function servicePerformance(businessId, days = 30, branchId = null) {
  return all(
    `SELECT s.id, s.name, s.price_cents, COUNT(b.id) AS bookings,
            SUM(CASE WHEN b.status = 'completed' THEN 1 ELSE 0 END) AS completed,
            SUM(CASE WHEN b.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled
     FROM services s LEFT JOIN bookings b ON b.service_id = s.id AND b.created_at >= ?
       ${branchId ? 'AND b.branch_id = ?' : ''}
     WHERE s.business_id = ? AND s.is_active = 1
     GROUP BY s.id ORDER BY bookings DESC`,
    branchId ? [sinceIso(days), branchId, businessId] : [sinceIso(days), businessId]
  );
}

export function staffActivity(businessId, days = 30, branchId = null) {
  return all(
    `SELECT st.id, st.name, st.title, COUNT(b.id) AS bookings,
            SUM(CASE WHEN b.status = 'completed' THEN 1 ELSE 0 END) AS completed,
            SUM(CASE WHEN b.status = 'no_show' THEN 1 ELSE 0 END) AS no_shows,
            SUM(CASE WHEN b.status IN ('confirmed','completed') THEN b.price_cents ELSE 0 END) AS value_cents
     FROM staff st LEFT JOIN bookings b ON b.staff_id = st.id AND b.created_at >= ?
       ${branchId ? 'AND b.branch_id = ?' : ''}
     WHERE st.business_id = ? AND st.is_active = 1
     GROUP BY st.id ORDER BY bookings DESC`,
    branchId ? [sinceIso(days), branchId, businessId] : [sinceIso(days), businessId]
  );
}

export function branchComparison(businessId, days = 30) {
  return all(
    `SELECT br.id, br.name, br.city,
            COUNT(b.id) AS bookings,
            SUM(CASE WHEN b.status = 'completed' THEN 1 ELSE 0 END) AS completed,
            SUM(CASE WHEN b.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
            SUM(CASE WHEN b.status IN ('confirmed','completed') THEN b.price_cents ELSE 0 END) AS value_cents
     FROM branches br LEFT JOIN bookings b ON b.branch_id = br.id AND b.created_at >= ?
     WHERE br.business_id = ? AND br.is_active = 1
     GROUP BY br.id ORDER BY bookings DESC`,
    [sinceIso(days), businessId]
  );
}

export function customerMetrics(businessId, days = 30) {
  const total = scalar('SELECT COUNT(*) FROM customers WHERE business_id = ?', [businessId]) || 0;
  const newCustomers = scalar('SELECT COUNT(*) FROM customers WHERE business_id = ? AND created_at >= ?', [businessId, sinceIso(days)]) || 0;
  const withConsent = scalar('SELECT COUNT(*) FROM customers WHERE business_id = ? AND marketing_consent = 1', [businessId]) || 0;
  const repeat = scalar('SELECT COUNT(*) FROM customers WHERE business_id = ? AND total_bookings > 1', [businessId]) || 0;
  const inactive = scalar(
    "SELECT COUNT(*) FROM customers WHERE business_id = ? AND last_visit_at IS NOT NULL AND last_visit_at < ?",
    [businessId, sinceIso(60)]
  ) || 0;
  return {
    total, newCustomers, withConsent, repeat, inactive,
    repeatRate: pct(repeat, total),
    consentRate: pct(withConsent, total),
  };
}

export function customerSegments(businessId) {
  const customers = all('SELECT * FROM customers WHERE business_id = ?', [businessId]);
  const now = new Date();
  const monthDay = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const since30 = sinceIso(30);
  const since60 = sinceIso(60);
  return {
    new: customers.filter((c) => c.created_at >= since30).length,
    returning: customers.filter((c) => int(c.total_bookings) > 1).length,
    vip: customers.filter((c) => int(c.total_bookings) >= 8 || parseJson(c.tags_json, []).includes('vip')).length,
    inactive: customers.filter((c) => c.last_visit_at && c.last_visit_at < since60).length,
    birthdayToday: customers.filter((c) => c.birthday && c.birthday.slice(5) === monthDay).length,
    noConsent: customers.filter((c) => !int(c.marketing_consent)).length,
  };
}

export function revenueSummary(businessId, days = 30) {
  const since = sinceIso(days);
  const payments = all(
    `SELECT provider, status, COUNT(*) AS n, SUM(amount_cents) AS amount
     FROM payments WHERE business_id = ? AND created_at >= ? GROUP BY provider, status`,
    [businessId, since]
  );
  const confirmed = payments.filter((p) => ['succeeded', 'paid', 'completed'].includes(p.status));
  const pending = payments.filter((p) => ['pending', 'processing', 'requires_action'].includes(p.status));
  const failed = payments.filter((p) => ['failed', 'cancelled', 'refunded'].includes(p.status));
  const invoiceOutstanding = scalar(
    "SELECT COALESCE(SUM(amount_cents),0) FROM invoices WHERE business_id = ? AND status IN ('unpaid','partial')",
    [businessId]
  ) || 0;
  const expenses = scalar(
    'SELECT COALESCE(SUM(amount_cents),0) FROM expenses WHERE business_id = ? AND incurred_on >= ?',
    [businessId, since]
  ) || 0;
  return {
    days,
    confirmedCents: confirmed.reduce((s, p) => s + int(p.amount), 0),
    pendingCents: pending.reduce((s, p) => s + int(p.amount), 0),
    failedCents: failed.reduce((s, p) => s + int(p.amount), 0),
    confirmedCount: confirmed.reduce((s, p) => s + int(p.n), 0),
    pendingCount: pending.reduce((s, p) => s + int(p.n), 0),
    failedCount: failed.reduce((s, p) => s + int(p.n), 0),
    invoiceOutstandingCents: invoiceOutstanding,
    expensesCents: expenses,
    netCents: confirmed.reduce((s, p) => s + int(p.amount), 0) - expenses,
    providers: payments,
  };
}

export function marketingMetrics(businessId, days = 30) {
  const since = sinceIso(days);
  const content = all('SELECT status, COUNT(*) AS n FROM content_items WHERE business_id = ? AND created_at >= ? GROUP BY status', [businessId, since]);
  const notifications = all('SELECT channel, status, COUNT(*) AS n FROM notifications WHERE business_id = ? AND created_at >= ? GROUP BY channel, status', [businessId, since]);
  const conversations = scalar('SELECT COUNT(*) FROM conversations WHERE business_id = ? AND created_at >= ?', [businessId, since]) || 0;
  return {
    days,
    contentByStatus: Object.fromEntries(content.map((r) => [r.status, r.n])),
    notifications,
    conversations,
    automations: automationPerformance(businessId, days),
  };
}

export function dashboard(businessId, { branchId = null, days = 30 } = {}) {
  const snapshot = todaySnapshot(businessId, { branchId });
  const metrics = bookingMetrics(businessId, { branchId, days });
  const customers = customerMetrics(businessId, days);
  const revenue = revenueSummary(businessId, days);
  const ai = aiUsageSummary(businessId, days);
  const integrations = all('SELECT provider, status FROM integrations WHERE business_id = ?', [businessId]);
  const subscription = get(
    `SELECT s.*, p.name AS plan_name, p.price_cents, p.currency AS plan_currency, p.limits_json
     FROM subscriptions s LEFT JOIN plans p ON p.id = s.plan_id
     WHERE s.business_id = ? ORDER BY s.created_at DESC LIMIT 1`,
    [businessId]
  );
  return {
    ...snapshot,
    metrics,
    customers,
    revenue,
    ai,
    integrations: {
      total: integrations.length,
      connected: integrations.filter((i) => i.status === 'connected').length,
      needsAttention: integrations.filter((i) => ['error', 'reconnect_required'].includes(i.status)).length,
      configurationRequired: integrations.filter((i) => ['configuration_required', 'disconnected'].includes(i.status)).length,
    },
    subscription,
    hasData: metrics.total > 0 || customers.total > 0,
  };
}

export function search(businessId, role, query) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];
  const like = `%${q}%`;
  const results = [];
  if (can(role, 'customers.view')) {
    for (const row of all('SELECT id, name, phone, email FROM customers WHERE business_id = ? AND (name LIKE ? OR phone LIKE ? OR email LIKE ?) LIMIT 5', [businessId, like, like, like])) {
      results.push({ type: 'customer', id: row.id, label: row.name, detail: row.phone || row.email || '', href: `/app/customers/${row.id}` });
    }
  }
  for (const row of all('SELECT id, reference, start_at, status FROM bookings WHERE business_id = ? AND reference LIKE ? LIMIT 5', [businessId, like])) {
    results.push({ type: 'booking', id: row.id, label: row.reference, detail: `${row.start_at.slice(0, 16).replace('T', ' ')} · ${row.status}`, href: `/app/calendar?date=${row.start_at.slice(0, 10)}` });
  }
  if (can(role, 'catalog.read')) {
    for (const row of all('SELECT id, name, price_cents FROM services WHERE business_id = ? AND name LIKE ? LIMIT 4', [businessId, like])) {
      results.push({ type: 'service', id: row.id, label: row.name, detail: 'Service', href: '/app/services' });
    }
    for (const row of all('SELECT id, name, title FROM staff WHERE business_id = ? AND name LIKE ? LIMIT 4', [businessId, like])) {
      results.push({ type: 'staff', id: row.id, label: row.name, detail: row.title || 'Team member', href: '/app/staff' });
    }
  }
  if (can(role, 'finance.view')) {
    for (const row of all('SELECT id, number, amount_cents, status FROM invoices WHERE business_id = ? AND number LIKE ? LIMIT 4', [businessId, like])) {
      results.push({ type: 'invoice', id: row.id, label: row.number, detail: `Invoice · ${row.status}`, href: '/app/finance' });
    }
  }
  if (can(role, 'conversations.manage')) {
    for (const row of all('SELECT id, contact_ref, channel FROM conversations WHERE business_id = ? AND contact_ref LIKE ? LIMIT 4', [businessId, like])) {
      results.push({ type: 'conversation', id: row.id, label: row.contact_ref, detail: row.channel, href: `/app/conversations/${row.id}` });
    }
  }
  if (can(role, 'marketing.manage')) {
    for (const row of all('SELECT id, name, trigger FROM automations WHERE business_id = ? AND name LIKE ? LIMIT 4', [businessId, like])) {
      results.push({ type: 'automation', id: row.id, label: row.name, detail: row.trigger, href: '/app/marketing' });
    }
  }
  for (const row of all('SELECT id, name, category FROM documents WHERE business_id = ? AND name LIKE ? LIMIT 4', [businessId, like])) {
    results.push({ type: 'document', id: row.id, label: row.name, detail: row.category || 'Document', href: '/app/documents' });
  }
  return results;
}

export function activityTimeline(businessId, limit = 20) {
  const events = all('SELECT id, type, payload_json, created_at FROM events WHERE business_id = ? ORDER BY created_at DESC LIMIT ?', [businessId, limit]);
  const audits = all('SELECT id, action, entity_type, actor_label, result, created_at FROM audit_logs WHERE business_id = ? ORDER BY created_at DESC LIMIT ?', [businessId, limit]);
  return [
    ...events.map((e) => ({ id: e.id, kind: 'event', title: e.type, detail: parseJson(e.payload_json, {}), at: e.created_at })),
    ...audits.map((a) => ({ id: a.id, kind: 'audit', title: a.action, detail: { entity: a.entity_type, actor: a.actor_label, result: a.result }, at: a.created_at })),
  ].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, limit);
}
