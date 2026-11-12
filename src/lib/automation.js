import { all, get, insert, run } from './db.js';
import { id, nowIso, parseJson, toJson, int } from './util.js';
import { queueNotification, dispatchNotification } from './notify.js';
import { generateContent } from './ai.js';
import { publish } from './events.js';
import { recordAudit } from './audit.js';
import { AppError } from './errors.js';

export const TRIGGERS = {
  'customer.created': 'New customer added',
  'customer.inactive': 'Customer has not returned',
  'customer.birthday': 'Customer birthday',
  'booking.created': 'New booking',
  'booking.cancelled': 'Booking cancelled',
  'booking.completed': 'Booking completed',
  'booking.no_show': 'Customer did not arrive',
  'appointment.approaching': 'Appointment approaching',
  'payment.confirmed': 'Payment confirmed',
  'inquiry.created': 'New inquiry',
  'subscription.changed': 'Subscription changed',
  'integration.event': 'Integration event',
};

export const ACTIONS = {
  send_notification: 'Send an authorised notification',
  add_tag: 'Update the customer record',
  create_task: 'Create a team task',
  request_approval: 'Request human approval',
  draft_content: 'Generate a content draft',
  create_ticket: 'Open a support ticket',
  trigger_workflow: 'Trigger another workflow',
  publish_event: 'Emit a platform event',
};

const MARKETING_TEMPLATES = new Set(['marketing', 'retention', 'birthday', 'promotion', 'welcome', 'feedback']);

export function validateWorkflow(definition) {
  const errors = [];
  const def = definition || {};
  if (!TRIGGERS[def.trigger]) errors.push('Choose a supported trigger.');
  const nodes = Array.isArray(def.nodes) ? def.nodes : [];
  if (!nodes.length) errors.push('Add at least one node.');
  const actionNodes = nodes.filter((n) => n.type === 'action');
  if (!actionNodes.length) errors.push('A workflow needs at least one action node.');
  for (const node of nodes) {
    if (node.type === 'action' && !ACTIONS[node.action]) errors.push(`Unsupported action: ${node.action || 'none'}.`);
    if (node.type === 'condition' && !node.field) errors.push('A condition node needs a field.');
    if (node.type === 'delay' && !(int(node.minutes) > 0)) errors.push('A delay node needs a positive number of minutes.');
  }
  return { ok: errors.length === 0, errors, nodes };
}

function conditionPass(node, context) {
  const customer = context.customer || {};
  const booking = context.booking || {};
  const value = {
    customer_tags: parseJson(customer.tags_json, []),
    customer_total_bookings: int(customer.total_bookings),
    customer_marketing_consent: int(customer.marketing_consent),
    customer_last_visit_at: customer.last_visit_at || null,
    booking_service_id: booking.service_id || null,
    booking_branch_id: booking.branch_id || null,
    booking_price_cents: int(booking.price_cents),
    booking_status: booking.status || null,
  }[node.field];

  switch (node.op || 'equals') {
    case 'contains': return Array.isArray(value) ? value.includes(node.value) : String(value ?? '').includes(String(node.value));
    case 'not_equals': return String(value) !== String(node.value);
    case 'gt': return Number(value) > Number(node.value);
    case 'gte': return Number(value) >= Number(node.value);
    case 'lt': return Number(value) < Number(node.value);
    case 'lte': return Number(value) <= Number(node.value);
    case 'is_true': return Boolean(value);
    case 'is_false': return !value;
    default: return String(value) === String(node.value);
  }
}

export function evaluateConditions(conditions, context) {
  const nodes = Array.isArray(conditions?.nodes)
    ? conditions.nodes.filter((n) => n.type === 'condition')
    : Array.isArray(conditions)
      ? conditions
      : [];
  return nodes.every((node) => conditionPass(node, context));
}

function logRun({ automationId, businessId, subjectType, subjectId, status, detail }) {
  insert('automation_runs', {
    id: id('arn'),
    automation_id: automationId,
    business_id: businessId,
    subject_type: subjectType || null,
    subject_id: subjectId || null,
    status,
    detail: typeof detail === 'string' ? detail : JSON.stringify(detail || {}),
    created_at: nowIso(),
  });
}

function recipientFor(context) {
  const customer = context.customer || {};
  return {
    name: customer.name || null,
    phone: customer.phone || null,
    email: customer.email || null,
    marketing_consent: int(customer.marketing_consent),
  };
}

async function executeAction({ automation, action, config, businessId, context, subjectType, subjectId, depth = 0 }) {
  const customer = context.customer || {};
  const recipient = recipientFor(context);

  if (action === 'send_notification') {
    const template = config.template || 'generic';
    const marketing = Boolean(config.marketing) || MARKETING_TEMPLATES.has(template);
    if (marketing && recipient.marketing_consent !== 1) {
      return { status: 'skipped', detail: 'Customer has not granted marketing consent.' };
    }
    if (config.channel === 'whatsapp' && !recipient.phone) return { status: 'skipped', detail: 'Customer has no phone number.' };
    if (config.channel === 'email' && !recipient.email) return { status: 'skipped', detail: 'Customer has no email address.' };
    const notification = queueNotification({
      businessId,
      channel: config.channel || 'in_app',
      template,
      payload: {
        customer_name: recipient.name,
        customer_phone: recipient.phone,
        customer_email: recipient.email,
        message: config.message || null,
        booking_reference: context.booking?.reference || null,
        business_name: context.business?.name || null,
        ...(config.payload || {}),
      },
      userId: context.user_id || null,
    });
    if (notification?.id) {
      try { await dispatchNotification(notification); } catch { /* status recorded on the notification row */ }
    }
    const stored = notification?.id ? get('SELECT status, error FROM notifications WHERE id = ?', [notification.id]) : null;
    if (stored && stored.status === 'failed') return { status: 'failed', detail: stored.error || 'Provider rejected the message.' };
    if (stored && stored.status === 'blocked') return { status: 'blocked', detail: 'Notification channel is not configured.' };
    return { status: 'success', detail: `Notification ${notification?.id || ''} ${stored?.status || 'queued'}.` };
  }

  if (action === 'add_tag') {
    if (!customer.id) return { status: 'skipped', detail: 'No customer attached to this event.' };
    const tags = new Set(parseJson(customer.tags_json, []));
    if (config.tag) tags.add(String(config.tag).slice(0, 40));
    run('UPDATE customers SET tags_json = ?, updated_at = ? WHERE id = ? AND business_id = ?', [toJson([...tags]), nowIso(), customer.id, businessId]);
    return { status: 'success', detail: `Customer tags updated.` };
  }

  if (action === 'create_task') {
    insert('tasks', {
      id: id('tsk'),
      business_id: businessId,
      title: String(config.title || automation.name).slice(0, 200),
      detail: config.detail || null,
      assignee_user_id: config.assignee_user_id || null,
      due_at: config.due_at || null,
      status: 'open',
      source: `automation:${automation.id}`,
      created_at: nowIso(),
      updated_at: nowIso(),
    });
    return { status: 'success', detail: 'Task created.' };
  }

  if (action === 'request_approval') {
    insert('tasks', {
      id: id('tsk'),
      business_id: businessId,
      title: `Approval needed: ${String(config.title || automation.name).slice(0, 160)}`,
      detail: config.detail || 'Automation requested human approval before continuing.',
      assignee_user_id: config.assignee_user_id || null,
      due_at: null,
      status: 'open',
      source: `approval:${automation.id}`,
      created_at: nowIso(),
      updated_at: nowIso(),
    });
    queueNotification({ businessId, channel: 'in_app', template: 'approval_requested', payload: { title: config.title || automation.name } });
    return { status: 'success', detail: 'Approval task created.' };
  }

  if (action === 'draft_content') {
    const business = context.business;
    if (!business) return { status: 'failed', detail: 'Business context missing.' };
    try {
      const item = await generateContent({
        business,
        kind: config.kind || 'caption',
        platform: config.platform || 'instagram',
        brief: config.brief || `Automated draft from workflow ${automation.name}`,
      });
      return { status: 'success', detail: `Draft content ${item.id} created for review.` };
    } catch (err) {
      return { status: 'blocked', detail: err.message };
    }
  }

  if (action === 'create_ticket') {
    const ticket = {
      id: id('tkt'),
      business_id: businessId,
      user_id: null,
      subject: String(config.subject || `Automation: ${automation.name}`).slice(0, 200),
      category: config.category || 'general',
      status: 'open',
      priority: config.priority || 'normal',
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    insert('support_tickets', ticket);
    insert('support_messages', {
      id: id('smg'), ticket_id: ticket.id, author_type: 'system', author_id: null,
      body: config.message || 'Created automatically by a MAVYRON workflow.', created_at: nowIso(),
    });
    return { status: 'success', detail: `Ticket ${ticket.id} opened.` };
  }

  if (action === 'publish_event') {
    publish(businessId, config.event_type || 'automation.event', { automation_id: automation.id, subject_type: subjectType, subject_id: subjectId });
    return { status: 'success', detail: 'Event published.' };
  }

  if (action === 'trigger_workflow') {
    if (depth >= 3) return { status: 'skipped', detail: 'Workflow nesting limit reached.' };
    const target = get('SELECT * FROM automations WHERE id = ? AND business_id = ? AND status = ?', [config.automation_id, businessId, 'active']);
    if (!target) return { status: 'failed', detail: 'Target workflow not found or inactive.' };
    return runAutomation({ automation: target, subjectType, subjectId, context, depth: depth + 1 });
  }

  return { status: 'failed', detail: `Unsupported action ${action}.` };
}

export async function runAutomation({ automation, subjectType, subjectId, context = {}, depth = 0 }) {
  if (automation.status !== 'active') return { status: 'paused', detail: 'Workflow is paused.' };
  const conditions = parseJson(automation.conditions_json, {});
  if (!evaluateConditions(conditions, context)) {
    logRun({ automationId: automation.id, businessId: automation.business_id, subjectType, subjectId, status: 'skipped', detail: 'Conditions not met.' });
    return { status: 'skipped', detail: 'Conditions not met.' };
  }
  const config = parseJson(automation.action_config_json, {});
  let result;
  try {
    result = await executeAction({
      automation, action: automation.action_type, config, businessId: automation.business_id,
      context, subjectType, subjectId, depth,
    });
  } catch (err) {
    result = { status: 'failed', detail: err.message };
  }
  logRun({ automationId: automation.id, businessId: automation.business_id, subjectType, subjectId, status: result.status, detail: result.detail });
  run('UPDATE automations SET last_run_at = ? WHERE id = ?', [nowIso(), automation.id]);
  if (result.status === 'failed') {
    recordAudit({
      businessId: automation.business_id, actor: null, role: 'system', action: 'automation.failed',
      entityType: 'automation', entityId: automation.id, result: 'failed', meta: { detail: result.detail },
    });
  }
  return result;
}

export async function runAutomationsForEvent({ businessId, trigger, subjectType, subjectId, context = {} }) {
  const automations = all(
    'SELECT * FROM automations WHERE business_id = ? AND trigger = ? AND status = ?',
    [businessId, trigger, 'active']
  );
  const results = [];
  for (const automation of automations) {
    results.push({ automation_id: automation.id, ...(await runAutomation({ automation, subjectType, subjectId, context })) });
  }
  return results;
}

/* Scheduled triggers: appointment reminders, inactive customers, birthdays. */
export async function runScheduledAutomations(now = new Date()) {
  const businesses = all("SELECT * FROM businesses WHERE status = 'active'");
  const summary = { businesses: businesses.length, executed: 0, skipped: 0 };
  for (const business of businesses) {
    const automations = all('SELECT * FROM automations WHERE business_id = ? AND status = ?', [business.id, 'active']);
    for (const automation of automations) {
      if (!['appointment.approaching', 'customer.inactive', 'customer.birthday'].includes(automation.trigger)) continue;
      const config = parseJson(automation.action_config_json, {});
      const hoursAhead = int(config.hours_ahead) || 24;
      const daysInactive = int(config.days_inactive) || 30;

      if (automation.trigger === 'appointment.approaching') {
        const from = now.toISOString();
        const to = new Date(now.getTime() + hoursAhead * 3_600_000).toISOString();
        const bookings = all(
          `SELECT b.*, c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email,
                  c.marketing_consent, c.tags_json, c.total_bookings, c.last_visit_at, c.id AS c_id
           FROM bookings b JOIN customers c ON c.id = b.customer_id
           WHERE b.business_id = ? AND b.status = 'confirmed' AND b.start_at >= ? AND b.start_at <= ?`,
          [business.id, from, to]
        );
        for (const booking of bookings) {
          if (alreadyRan(automation.id, booking.id)) { summary.skipped += 1; continue; }
          const result = await runAutomation({
            automation, subjectType: 'booking', subjectId: booking.id,
            context: { business, booking, customer: customerFrom(booking) },
          });
          result.status === 'success' ? (summary.executed += 1) : (summary.skipped += 1);
        }
      }

      if (automation.trigger === 'customer.inactive') {
        const cutoff = new Date(now.getTime() - daysInactive * 86_400_000).toISOString();
        const customers = all(
          `SELECT * FROM customers WHERE business_id = ? AND marketing_consent = 1
             AND (last_visit_at IS NULL OR last_visit_at < ?) AND created_at < ?`,
          [business.id, cutoff, cutoff]
        );
        for (const customer of customers) {
          if (alreadyRan(automation.id, customer.id, 20)) { summary.skipped += 1; continue; }
          const result = await runAutomation({
            automation, subjectType: 'customer', subjectId: customer.id,
            context: { business, customer },
          });
          result.status === 'success' ? (summary.executed += 1) : (summary.skipped += 1);
        }
      }

      if (automation.trigger === 'customer.birthday') {
        const monthDay = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const customers = all(
          `SELECT * FROM customers WHERE business_id = ? AND marketing_consent = 1 AND birthday IS NOT NULL AND substr(birthday, 6, 5) = ?`,
          [business.id, monthDay]
        );
        for (const customer of customers) {
          if (alreadyRan(automation.id, customer.id, 20)) { summary.skipped += 1; continue; }
          const result = await runAutomation({
            automation, subjectType: 'customer', subjectId: customer.id,
            context: { business, customer },
          });
          result.status === 'success' ? (summary.executed += 1) : (summary.skipped += 1);
        }
      }
    }
  }
  return summary;
}

function customerFrom(row) {
  return {
    id: row.c_id || row.customer_id, name: row.customer_name, phone: row.customer_phone,
    email: row.customer_email, marketing_consent: row.marketing_consent,
    tags_json: row.tags_json, total_bookings: row.total_bookings, last_visit_at: row.last_visit_at,
  };
}

function alreadyRan(automationId, subjectId, hours = 1) {
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();
  return Boolean(get(
    'SELECT id FROM automation_runs WHERE automation_id = ? AND subject_id = ? AND created_at >= ? LIMIT 1',
    [automationId, subjectId, since]
  ));
}

/* ───────────────────────── management ───────────────────────── */

export function listAutomations(businessId) {
  return all(
    `SELECT a.*, (SELECT COUNT(*) FROM automation_runs r WHERE r.automation_id = a.id) AS run_count,
            (SELECT COUNT(*) FROM automation_runs r WHERE r.automation_id = a.id AND r.status = 'failed') AS failure_count
     FROM automations a WHERE a.business_id = ? ORDER BY a.created_at DESC`,
    [businessId]
  );
}

export function automationRuns(businessId, automationId = null, limit = 50) {
  if (automationId) {
    return all(
      `SELECT r.*, a.name FROM automation_runs r JOIN automations a ON a.id = r.automation_id
       WHERE r.business_id = ? AND r.automation_id = ? ORDER BY r.created_at DESC LIMIT ?`,
      [businessId, automationId, limit]
    );
  }
  return all(
    `SELECT r.*, a.name FROM automation_runs r JOIN automations a ON a.id = r.automation_id
     WHERE r.business_id = ? ORDER BY r.created_at DESC LIMIT ?`,
    [businessId, limit]
  );
}

export function saveWorkflow({ businessId, name, definition, actor = null, automationId = null }) {
  const check = validateWorkflow(definition);
  if (!check.ok) throw new AppError(422, check.errors.join(' '), 'validation_error');
  const actionNode = check.nodes.find((n) => n.type === 'action');
  const conditions = { nodes: check.nodes.filter((n) => n.type === 'condition') };
  let row;
  if (automationId) {
    row = get('SELECT * FROM automations WHERE id = ? AND business_id = ?', [automationId, businessId]);
    if (!row) throw new AppError(404, 'Workflow not found.', 'not_found');
    run(
      `UPDATE automations SET name = ?, trigger = ?, conditions_json = ?, action_type = ?, action_config_json = ?
       WHERE id = ? AND business_id = ?`,
      [String(name).slice(0, 120), definition.trigger, toJson(conditions), actionNode.action, toJson(actionNode.config || {}), automationId, businessId]
    );
  } else {
    row = {
      id: id('aut'),
      business_id: businessId,
      name: String(name).slice(0, 120),
      trigger: definition.trigger,
      conditions_json: toJson(conditions),
      action_type: actionNode.action,
      action_config_json: toJson(actionNode.config || {}),
      status: 'active',
      last_run_at: null,
      created_at: nowIso(),
    };
    insert('automations', row);
  }
  const version = (get('SELECT MAX(version) AS v FROM automation_versions WHERE automation_id = ?', [row.id])?.v || 0) + 1;
  insert('automation_versions', {
    id: id('avr'), automation_id: row.id, business_id: businessId, version,
    definition_json: toJson(definition), created_by: actor?.id || null, created_at: nowIso(),
  });
  recordAudit({ businessId, actor, role: actor?.role || 'system', action: 'automation.saved', entityType: 'automation', entityId: row.id, meta: { version } });
  return get('SELECT * FROM automations WHERE id = ?', [row.id]);
}

export function setAutomationStatus({ businessId, automationId, status, actor = null }) {
  if (!['active', 'paused'].includes(status)) throw new AppError(422, 'Status must be active or paused.', 'validation_error');
  const row = get('SELECT * FROM automations WHERE id = ? AND business_id = ?', [automationId, businessId]);
  if (!row) throw new AppError(404, 'Workflow not found.', 'not_found');
  run('UPDATE automations SET status = ? WHERE id = ? AND business_id = ?', [status, automationId, businessId]);
  recordAudit({ businessId, actor, role: actor?.role || 'system', action: 'automation.status', entityType: 'automation', entityId: automationId, meta: { status } });
  return get('SELECT * FROM automations WHERE id = ?', [automationId]);
}

export function automationPerformance(businessId, days = 30) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = all('SELECT status, COUNT(*) AS n FROM automation_runs WHERE business_id = ? AND created_at >= ? GROUP BY status', [businessId, since]);
  const byStatus = Object.fromEntries(rows.map((r) => [r.status, r.n]));
  return { days, success: byStatus.success || 0, failed: byStatus.failed || 0, skipped: byStatus.skipped || 0, blocked: byStatus.blocked || 0, total: rows.reduce((s, r) => s + r.n, 0) };
}
