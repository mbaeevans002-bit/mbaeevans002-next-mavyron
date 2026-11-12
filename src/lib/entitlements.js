import { all, get, scalar, insert, run } from './db.js';
import { id, nowIso, parseJson, int } from './util.js';
import { AppError } from './errors.js';
import { recordAudit } from './audit.js';

export const PLAN_SEED = [
  {
    id: 'starter', name: 'Starter', price_cents: 250_000, currency: 'KES', interval: 'month', sort: 1,
    features: ['bookings', 'crm', 'mini_site', 'ai_receptionist', 'email_notifications'],
    limits: { staff: 3, branches: 1, ai_messages: 300, whatsapp_messages: 500, voice_minutes: 0, documents: 50, api_keys: 1, automations: 5 },
  },
  {
    id: 'professional', name: 'Professional', price_cents: 750_000, currency: 'KES', interval: 'month', sort: 2,
    features: ['bookings', 'crm', 'mini_site', 'ai_receptionist', 'email_notifications', 'whatsapp', 'automation', 'analytics', 'content_studio', 'finance'],
    limits: { staff: 10, branches: 3, ai_messages: 1_500, whatsapp_messages: 3_000, voice_minutes: 200, documents: 500, api_keys: 3, automations: 25 },
  },
  {
    id: 'business', name: 'Business', price_cents: 1_800_000, currency: 'KES', interval: 'month', sort: 3,
    features: ['bookings', 'crm', 'mini_site', 'ai_receptionist', 'email_notifications', 'whatsapp', 'automation', 'analytics', 'content_studio', 'finance', 'voice', 'healthcare', 'multi_branch', 'api_access', 'command_centre'],
    limits: { staff: 40, branches: 10, ai_messages: 6_000, whatsapp_messages: 12_000, voice_minutes: 1_000, documents: 2_000, api_keys: 10, automations: 100 },
  },
  {
    id: 'enterprise', name: 'Enterprise', price_cents: 0, currency: 'KES', interval: 'month', sort: 4,
    features: ['bookings', 'crm', 'mini_site', 'ai_receptionist', 'email_notifications', 'whatsapp', 'automation', 'analytics', 'content_studio', 'finance', 'voice', 'healthcare', 'multi_branch', 'api_access', 'command_centre', 'sso', 'custom_agreement'],
    limits: { staff: -1, branches: -1, ai_messages: -1, whatsapp_messages: -1, voice_minutes: -1, documents: -1, api_keys: -1, automations: -1 },
  },
];

const TRIAL_DAYS = 14;

export function seedPlans() {
  for (const plan of PLAN_SEED) {
    const existing = get('SELECT id FROM plans WHERE id = ?', [plan.id]);
    if (existing) {
      run('UPDATE plans SET name = ?, price_cents = ?, currency = ?, interval = ?, features_json = ?, limits_json = ?, sort = ? WHERE id = ?', [
        plan.name, plan.price_cents, plan.currency, plan.interval, JSON.stringify(plan.features), JSON.stringify(plan.limits), plan.sort, plan.id,
      ]);
    } else {
      insert('plans', {
        id: plan.id, name: plan.name, price_cents: plan.price_cents, currency: plan.currency,
        interval: plan.interval, features_json: JSON.stringify(plan.features), limits_json: JSON.stringify(plan.limits), sort: plan.sort,
      });
    }
  }
}

export function listPlans() {
  seedPlans();
  return all('SELECT * FROM plans ORDER BY sort ASC').map((p) => ({
    ...p,
    features: parseJson(p.features_json, []),
    limits: parseJson(p.limits_json, {}),
  }));
}

export function getSubscription(businessId) {
  return get(
    `SELECT s.*, p.name AS plan_name, p.price_cents, p.currency AS plan_currency, p.features_json, p.limits_json
     FROM subscriptions s LEFT JOIN plans p ON p.id = s.plan_id
     WHERE s.business_id = ? ORDER BY s.created_at DESC LIMIT 1`,
    [businessId]
  );
}

export function startTrial(businessId, actor = null, planId = 'starter') {
  seedPlans();
  const existing = getSubscription(businessId);
  if (existing) return existing;
  const now = new Date();
  const row = {
    id: id('sub'),
    business_id: businessId,
    plan_id: planId,
    status: 'trialing',
    provider: null,
    provider_ref: null,
    trial_ends_at: new Date(now.getTime() + TRIAL_DAYS * 86_400_000).toISOString(),
    current_period_end: new Date(now.getTime() + TRIAL_DAYS * 86_400_000).toISOString(),
    seats: 1,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  insert('subscriptions', row);
  recordAudit({ businessId, actor, role: actor?.role || 'system', action: 'subscription.trial_started', entityType: 'subscription', entityId: row.id, meta: { planId } });
  return getSubscription(businessId);
}

function usageFor(businessId) {
  return {
    staff: scalar('SELECT COUNT(*) FROM staff WHERE business_id = ? AND is_active = 1', [businessId]) || 0,
    branches: scalar('SELECT COUNT(*) FROM branches WHERE business_id = ? AND is_active = 1', [businessId]) || 0,
    documents: scalar('SELECT COUNT(*) FROM documents WHERE business_id = ?', [businessId]) || 0,
    api_keys: scalar('SELECT COUNT(*) FROM api_keys WHERE business_id = ? AND revoked_at IS NULL', [businessId]) || 0,
    automations: scalar('SELECT COUNT(*) FROM automations WHERE business_id = ?', [businessId]) || 0,
    ai_messages: scalar(
      "SELECT COUNT(*) FROM ai_runs WHERE business_id = ? AND created_at >= ?",
      [businessId, new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()]
    ) || 0,
    whatsapp_messages: scalar(
      "SELECT COUNT(*) FROM messages WHERE business_id = ? AND channel = 'whatsapp' AND direction = 'outbound' AND created_at >= ?",
      [businessId, new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()]
    ) || 0,
    voice_minutes: scalar(
      "SELECT COUNT(*) FROM voice_calls WHERE business_id = ? AND created_at >= ?",
      [businessId, new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()]
    ) || 0,
  };
}

export function entitlementsFor(businessId) {
  seedPlans();
  let subscription = getSubscription(businessId);
  if (!subscription) subscription = startTrial(businessId);
  const plan = PLAN_SEED.find((p) => p.id === subscription.plan_id) || PLAN_SEED[0];
  const features = parseJson(subscription.features_json, plan.features);
  const limits = parseJson(subscription.limits_json, plan.limits);
  const usage = usageFor(businessId);
  const trialEndsAt = subscription.trial_ends_at;
  const trialDaysLeft = trialEndsAt ? Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86_400_000) : null;
  const status = subscription.status;
  const active = ['trialing', 'active', 'past_due'].includes(status) && !(status === 'trialing' && trialDaysLeft !== null && trialDaysLeft < -3);
  return {
    subscription, plan, features, limits, usage, status, active, trialDaysLeft,
    planName: subscription.plan_name || plan.name,
    priceCents: int(subscription.price_cents ?? plan.price_cents),
    currency: subscription.plan_currency || plan.currency,
  };
}

export function hasFeature(businessId, feature) {
  const ent = entitlementsFor(businessId);
  if (!ent.active) return { allowed: false, reason: `Subscription is ${ent.status}. Update billing to continue.` };
  if (!ent.features.includes(feature)) return { allowed: false, reason: `${feature.replace(/_/g, ' ')} is not included in the ${ent.planName} plan.` };
  return { allowed: true };
}

export function withinLimit(businessId, key, increment = 1) {
  const ent = entitlementsFor(businessId);
  const limit = ent.limits[key];
  if (limit === undefined) return { allowed: true };
  if (limit === -1) return { allowed: true };
  const used = int(ent.usage[key]);
  if (used + increment > limit) {
    return { allowed: false, reason: `${key.replace(/_/g, ' ')} limit reached (${used}/${limit}) on the ${ent.planName} plan.` };
  }
  return { allowed: true, used, limit };
}

export function assertEntitlement(businessId, feature) {
  const result = hasFeature(businessId, feature);
  if (!result.allowed) throw new AppError(402, result.reason, 'entitlement_required');
  return result;
}

export function assertLimit(businessId, key, increment = 1) {
  const result = withinLimit(businessId, key, increment);
  if (!result.allowed) throw new AppError(402, result.reason, 'limit_reached');
  return result;
}

export function changePlan({ businessId, planId, actor = null, activate = false }) {
  seedPlans();
  const plan = PLAN_SEED.find((p) => p.id === planId);
  if (!plan) throw new AppError(422, 'Unknown plan.', 'validation_error');
  const current = getSubscription(businessId) || startTrial(businessId);
  const requiresPayment = plan.price_cents > 0 && !activate;
  const status = requiresPayment ? 'pending_payment' : 'active';
  run(
    `UPDATE subscriptions SET plan_id = ?, status = ?, updated_at = ?,
       current_period_end = CASE WHEN ? = 'active' THEN ? ELSE current_period_end END
     WHERE id = ? AND business_id = ?`,
    [planId, status, nowIso(), status, new Date(Date.now() + 30 * 86_400_000).toISOString(), current.id, businessId]
  );
  recordAudit({
    businessId, actor, role: actor?.role || 'system', action: 'subscription.plan_changed',
    entityType: 'subscription', entityId: current.id, meta: { from: current.plan_id, to: planId, status },
  });
  return { subscription: getSubscription(businessId), requiresPayment, plan };
}

export function setSubscriptionStatus({ businessId, status, providerRef = null, provider = null }) {
  if (!['trialing', 'active', 'past_due', 'cancelled', 'expired', 'suspended', 'pending_payment'].includes(status)) {
    throw new AppError(422, 'Unsupported subscription status.', 'validation_error');
  }
  const current = getSubscription(businessId);
  if (!current) throw new AppError(404, 'Subscription not found.', 'not_found');
  run(
    'UPDATE subscriptions SET status = ?, provider = COALESCE(?, provider), provider_ref = COALESCE(?, provider_ref), updated_at = ? WHERE id = ?',
    [status, provider, providerRef, nowIso(), current.id]
  );
  return getSubscription(businessId);
}

export function subscriptionLabel(status) {
  return {
    trialing: 'Trial', active: 'Active', past_due: 'Past due', cancelled: 'Cancelled',
    expired: 'Expired', suspended: 'Suspended', pending_payment: 'Payment pending',
  }[status] || status;
}
