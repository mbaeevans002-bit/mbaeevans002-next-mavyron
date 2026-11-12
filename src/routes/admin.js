import express from 'express';
import fs from 'node:fs';
import { all, get, insert, run, update, scalar, DB_FILE } from '../lib/db.js';
import { id, nowIso, parseJson, toJson } from '../lib/util.js';
import { requireAuth, requirePlatformAdmin } from '../lib/auth.js';
import { listPlans, getSubscription } from '../lib/entitlements.js';
import { recordAudit } from '../lib/audit.js';
import { validation, notFound } from '../lib/errors.js';
import { adminPage } from '../views/admin.js';

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.use(requireAuth, requirePlatformAdmin);

function uptimeLabel() {
  const seconds = Math.floor(process.uptime());
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

router.get('/', (req, res) => {
  const businesses = all(
    `SELECT b.*, s.status AS sub_status, p.name AS plan_name,
            (SELECT COUNT(*) FROM bookings bk WHERE bk.business_id = b.id AND bk.created_at >= ?) AS bookings_30d
       FROM businesses b
       LEFT JOIN subscriptions s ON s.business_id = b.id
       LEFT JOIN plans p ON p.id = s.plan_id
      ORDER BY b.created_at DESC`,
    [new Date(Date.now() - 30 * 86_400_000).toISOString()],
  );

  const subscriptionRows = all('SELECT status, COUNT(*) AS n FROM subscriptions GROUP BY status');
  const subscriptions = Object.fromEntries(subscriptionRows.map((r) => [r.status, r.n]));

  const usage = all(
    `SELECT COALESCE(model, 'unrecorded') AS model, COUNT(*) AS runs,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failures,
            SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)) AS tokens
       FROM ai_runs WHERE created_at >= ? GROUP BY COALESCE(model, 'unrecorded')`,
    [new Date(Date.now() - 30 * 86_400_000).toISOString()],
  );

  const integrations = all(
    `SELECT provider, COUNT(*) AS total,
            SUM(CASE WHEN status = 'connected' THEN 1 ELSE 0 END) AS connected
       FROM integrations GROUP BY provider ORDER BY provider`,
  );

  const audit = all(
    `SELECT a.*, b.name AS business_name FROM audit_logs a
       LEFT JOIN businesses b ON b.id = a.business_id
      ORDER BY a.created_at DESC LIMIT 60`,
  );

  const revenueCents = scalar(
    "SELECT COALESCE(SUM(amount_cents),0) AS total FROM payments WHERE status IN ('confirmed','succeeded','paid') AND created_at >= ?",
    [new Date(Date.now() - 30 * 86_400_000).toISOString()],
  ) || 0;

  const aiRuns = scalar('SELECT COUNT(*) AS c FROM ai_runs WHERE created_at >= ?', [
    new Date(Date.now() - 30 * 86_400_000).toISOString(),
  ]) || 0;
  const aiFailures = scalar("SELECT COUNT(*) AS c FROM ai_runs WHERE status = 'failed' AND created_at >= ?", [
    new Date(Date.now() - 30 * 86_400_000).toISOString(),
  ]) || 0;

  let sizeLabel = 'unknown';
  try {
    const bytes = fs.statSync(DB_FILE).size;
    sizeLabel = bytes > 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
  } catch { /* size unknown */ }

  const health = {
    dbOk: Boolean(scalar('SELECT 1 AS ok')),
    sizeLabel,
    uptime: uptimeLabel(),
    node: process.version,
    memory: `${Math.round(process.memoryUsage().rss / 1_048_576)} MB`,
    email: Boolean(process.env.RESEND_API_KEY || process.env.SMTP_URL),
    sms: Boolean(process.env.AFRICASTALKING_API_KEY || process.env.TWILIO_AUTH_TOKEN),
    ai: Boolean(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.GROQ_API_KEY),
    backup: Boolean(process.env.BACKUP_BUCKET),
  };

  res.type('html').send(adminPage({
    totals: {
      businesses: businesses.length,
      activeBusinesses: businesses.filter((b) => b.status === 'active').length,
      users: scalar('SELECT COUNT(*) AS c FROM users') || 0,
      admins: scalar('SELECT COUNT(*) AS c FROM users WHERE is_platform_admin = 1') || 0,
      revenueCents,
      aiRuns,
      aiFailures,
    },
    businesses,
    subscriptions,
    usage,
    health,
    audit,
    integrations,
    plans: listPlans(),
    user: req.user,
    csrf: res.locals.csrf,
    req,
  }));
});

router.post('/subscription', wrap(async (req, res) => {
  const businessId = String(req.body.business_id || '');
  const planId = String(req.body.plan_id || '');
  const status = String(req.body.status || '');
  const note = String(req.body.note || '').trim() || null;

  const business = get('SELECT * FROM businesses WHERE id = ?', [businessId]);
  if (!business) throw notFound('That business does not exist.');
  const plan = get('SELECT * FROM plans WHERE id = ?', [planId]);
  if (!plan) throw validation('Choose a plan.');
  if (!['trialing', 'active', 'past_due', 'cancelled', 'suspended'].includes(status)) {
    throw validation('Choose a valid subscription status.');
  }

  const existing = getSubscription(businessId);
  const periodEnd = new Date(Date.now() + 30 * 86_400_000).toISOString();
  if (existing) {
    update('subscriptions', existing.id, {
      plan_id: plan.id, status, current_period_end: periodEnd,
      updated_at: nowIso(),
    });
  } else {
    insert('subscriptions', {
      id: id('sub'), business_id: businessId, plan_id: plan.id, status,
      provider: 'manual', provider_ref: null, trial_ends_at: null,
      current_period_end: periodEnd, seats: 1, created_at: nowIso(), updated_at: nowIso(),
    });
  }

  recordAudit({
    actor: req.user, action: 'subscription.admin_changed', entityType: 'business',
    entityId: businessId, businessId, ip: req.ip,
    meta: { plan: plan.id, status, note },
  });
  res.redirect(303, '/admin?ok=' + encodeURIComponent(`${business.name} set to ${plan.name} (${status}).`));
}));

export default router;
