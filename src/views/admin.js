import { esc, attr, money, relativeTime } from '../lib/util.js';
import { appPage, badge, statusBadge, stat, emptyState, csrfField } from './layout.js';

export function adminPage(ctx) {
  const { totals, businesses, subscriptions, usage, health, audit, integrations } = ctx;
  const body = `<div class="grid g4">
    ${stat('Businesses', String(totals.businesses), `${totals.activeBusinesses} active`)}
    ${stat('Users', String(totals.users), `${totals.admins} platform admins`)}
    ${stat('Revenue (30d)', money(totals.revenueCents, 'KES'), 'verified payments')}
    ${stat('AI runs (30d)', String(totals.aiRuns), `${totals.aiFailures} failed`)}
  </div>

  <div class="grid g2 mt3">
    <div class="card">
      <h3>Tenants</h3>
      ${businesses.length ? `<div class="table-wrap mt2"><table><thead><tr><th>Business</th><th>Industry</th><th>Bookings 30d</th><th>Plan</th><th>Status</th></tr></thead>
        <tbody>${businesses.map((b) => `<tr><td><strong>${esc(b.name)}</strong><div class="muted" style="font-size:.72rem">${esc(b.slug)}</div></td>
          <td style="font-size:.78rem">${esc(String(b.industry || '—').replace(/_/g, ' '))}</td><td>${esc(String(b.bookings_30d))}</td>
          <td>${esc(b.plan_name || 'none')}</td><td>${statusBadge(b.status)}</td></tr>`).join('')}</tbody></table></div>`
        : emptyState('No businesses yet', 'Tenants appear here after signup.')}
    </div>
    <div class="card">
      <h3>Subscriptions</h3>
      <div class="grid g2" style="gap:.4rem;font-size:.84rem">
        ${Object.entries(subscriptions).map(([k, v]) => `<div class="flex between"><span class="muted">${esc(k)}</span><span class="mono">${esc(String(v))}</span></div>`).join('') || '<span class="muted">No subscriptions recorded.</span>'}
      </div>
      <div class="hr"></div>
      <h4>AI usage by provider</h4>
      ${usage.length ? `<div class="table-wrap mt2"><table><thead><tr><th>Provider</th><th>Runs</th><th>Tokens</th><th>Failures</th></tr></thead>
        <tbody>${usage.map((u) => `<tr><td>${esc(u.provider || '—')}</td><td>${esc(String(u.runs))}</td><td class="mono" style="font-size:.72rem">${esc(String(u.tokens))}</td><td>${esc(String(u.failures))}</td></tr>`).join('')}</tbody></table></div>`
        : '<p class="muted mt1" style="font-size:.84rem">No AI usage recorded.</p>'}
    </div>
  </div>

  <div class="grid g2 mt3">
    <div class="card">
      <h3>Integration health</h3>
      ${integrations.length ? `<div class="table-wrap mt2"><table><thead><tr><th>Provider</th><th>Tenants</th><th>Status</th></tr></thead>
        <tbody>${integrations.map((i) => `<tr><td>${esc(i.provider)}</td><td>${esc(String(i.total))}</td><td>${badge(`${i.connected} connected`, i.connected ? 'ok' : 'plain')}</td></tr>`).join('')}</tbody></table></div>`
        : '<p class="muted mt1" style="font-size:.84rem">No integration records.</p>'}
    </div>
    <div class="card">
      <h3>System health</h3>
      <dl class="kv mt2">
        <dt>Database</dt><dd>${health.dbOk ? badge('reachable', 'ok') : badge('error', 'bad')}</dd>
        <dt>Size</dt><dd class="mono">${esc(health.sizeLabel)}</dd>
        <dt>Uptime</dt><dd class="mono">${esc(health.uptime)}</dd>
        <dt>Node</dt><dd class="mono">${esc(health.node)}</dd>
        <dt>Memory</dt><dd class="mono">${esc(health.memory)}</dd>
        <dt>Email</dt><dd>${health.email ? badge('configured', 'ok') : badge('configuration required', 'warn')}</dd>
        <dt>SMS</dt><dd>${health.sms ? badge('configured', 'ok') : badge('configuration required', 'warn')}</dd>
        <dt>AI provider</dt><dd>${health.ai ? badge('configured', 'ok') : badge('configuration required', 'warn')}</dd>
        <dt>Backups</dt><dd>${health.backup ? badge('configured', 'ok') : badge('not configured', 'warn')}</dd>
      </dl>
      <p class="hint">Health reflects runtime state only. “Configured” means credentials are present, not that a provider was verified.</p>
    </div>
  </div>

  <div class="card mt3">
    <h3>Platform audit</h3>
    ${audit.length ? `<div class="table-wrap mt2"><table><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Business</th><th>Result</th></tr></thead>
      <tbody>${audit.map((a) => `<tr><td class="muted" style="font-size:.72rem">${esc(relativeTime(a.created_at))}</td><td style="font-size:.78rem">${esc(a.actor_label)}</td>
        <td class="mono" style="font-size:.72rem">${esc(a.action)}</td><td class="muted" style="font-size:.72rem">${esc(a.business_name || '—')}</td><td>${statusBadge(a.result)}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="muted mt1" style="font-size:.84rem">No platform audit entries.</p>'}
  </div>

  <div class="card mt3">
    <h3>Manage plan</h3>
    <form method="post" action="/admin/subscription" class="mt2">
      ${csrfField(ctx.csrf)}
      <div class="field-row">
        <div class="field"><label for="ad-biz">Business</label><select id="ad-biz" name="business_id" required>${businesses.map((b) => `<option value="${attr(b.id)}">${esc(b.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="ad-plan">Plan</label><select id="ad-plan" name="plan_id">${ctx.plans.map((p) => `<option value="${attr(p.id)}">${esc(p.name)}</option>`).join('')}</select></div>
      </div>
      <div class="field-row">
        <div class="field"><label for="ad-status">Status</label><select id="ad-status" name="status"><option value="trialing">Trialing</option><option value="active">Active</option><option value="past_due">Past due</option><option value="cancelled">Cancelled</option><option value="suspended">Suspended</option></select></div>
        <div class="field"><label for="ad-note">Reason</label><input id="ad-note" name="note" placeholder="Support ticket #123"></div>
      </div>
      <button class="btn btn-sm btn-primary" type="submit">Apply change</button>
      <p class="hint">Administrative changes are audited. Paid activation normally arrives from a verified provider webhook.</p>
    </form>
  </div>`;
  return appPage({
    title: 'Platform administration', subtitle: 'Tenants, billing, integrations and system health',
    user: ctx.user, role: 'owner', csrf: ctx.csrf, req: ctx.req, active: '', body, wide: true, admin: true,
  });
}
