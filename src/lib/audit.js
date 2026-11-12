import { insert } from './db.js';
import { id, nowIso, toJson } from './util.js';

/** Immutable record of a sensitive action: who, what, when, where, result. */
export function recordAudit({
  businessId = null,
  actor = null,
  role = null,
  action,
  entityType = null,
  entityId = null,
  context = null,
  ip = null,
  userAgent = null,
  result = 'success',
  meta = {},
}) {
  const row = {
    id: id('aud'),
    business_id: businessId,
    actor_user_id: actor?.id || actor?.userId || null,
    actor_label: actor?.email || actor?.label || 'system',
    actor_role: role || actor?.role || null,
    action,
    entity_type: entityType,
    entity_id: entityId,
    context,
    ip,
    user_agent: userAgent ? String(userAgent).slice(0, 300) : null,
    result,
    meta_json: toJson(meta),
    created_at: nowIso(),
  };
  insert('audit_logs', row);
  return row.id;
}

export function requestMeta(req) {
  return {
    ip: req.ip || req.socket?.remoteAddress || null,
    userAgent: req.get('user-agent') || null,
  };
}
