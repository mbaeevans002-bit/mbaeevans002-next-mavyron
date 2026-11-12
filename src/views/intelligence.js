import { esc, attr, money, prettyDate, prettyTime, relativeTime, isoDate, addDays } from '../lib/util.js';
import { shell, pageActions } from './workspace.js';
import { badge, statusBadge, stat, emptyState, icon, moneyCell, csrfField } from './layout.js';

function providerGate(status) {
  if (status.configured) return '';
  return `<div class="banner warn"><div><strong>AI provider not connected</strong><span>${esc(status.reason || 'Add an AI provider key to activate AI features.')}</span></div><a class="btn btn-sm" href="#provider">Configure</a></div>`;
}

/* ───────────────────────────── AI control centre ───────────────────────────── */

export function aiPage(ctx) {
  const { status, agents, knowledge, usage, byAgent, personality } = ctx;
  const agentRows = agents.map((a) => `<div class="row">
      <div>
        <strong>${esc(a.name)}</strong> ${a.enabled ? badge('enabled', 'ok') : badge('disabled', 'plain')}
        <div class="muted" style="font-size:.78rem">${esc(a.purpose)}</div>
        <div class="chips mt1">${(a.permissions || []).map((p) => `<span class="chip">${esc(p)}</span>`).join('')}</div>
      </div>
      <form method="post" action="${ctx.base}/ai/agents/${attr(a.agent_key)}/toggle">
        ${csrfField(ctx.csrf)}
        <input type="hidden" name="enabled" value="${a.enabled ? '0' : '1'}">
        <button class="btn btn-sm ${a.enabled ? 'btn-ghost' : ''}" type="submit">${a.enabled ? 'Disable' : 'Enable'}</button>
      </form>
    </div>`).join('');

  const usageRows = byAgent.length
    ? `<div class="table-wrap mt2"><table><thead><tr><th>Agent</th><th>Runs</th><th>Failures</th><th>Tokens</th><th>Avg latency</th></tr></thead>
      <tbody>${byAgent.map((r) => `<tr><td>${esc(r.agent_key)}</td><td>${esc(String(r.runs))}</td><td>${esc(String(r.failures))}</td>
        <td class="mono" style="font-size:.74rem">${esc(String(r.tokens))}</td><td class="mono" style="font-size:.74rem">${r.avg_latency ? `${Math.round(r.avg_latency)} ms` : '—'}</td></tr>`).join('')}</tbody></table></div>`
    : '<p class="muted mt1" style="font-size:.84rem">No AI runs recorded yet. Usage appears here after the first real model call.</p>';

  const body = `${providerGate(status)}
  <div class="grid g4">
    ${stat('Provider', status.configured ? status.provider : 'Not configured', status.configured ? status.model : 'AI features blocked')}
    ${stat('Key source', status.source === 'platform' ? 'Platform' : status.source === 'business' ? 'Business' : '—', 'never exposed to the browser')}
    ${stat('Runs', String(usage.runs), `${usage.failures} failed`)}
    ${stat('Tokens', String(usage.tokens), 'input + output recorded per run')}
  </div>
  <div class="grid g2 mt3">
    <div class="card">
      <div class="flex between"><h3>AI agents</h3><span class="mono muted" style="font-size:.66rem">${agents.filter((a) => a.enabled).length} enabled</span></div>
      <p class="muted" style="font-size:.82rem">Agents act only through validated backend operations and their granted permissions.</p>
      <div class="list-rows mt2">${agentRows}</div>
    </div>
    <div>
      <div class="card" id="provider">
        <h3>Provider configuration</h3>
        <p class="muted" style="font-size:.82rem">A platform key is used when present. Otherwise the business can store its own key, encrypted at rest and never returned to the browser.</p>
        <form method="post" action="${ctx.base}/ai/provider" class="mt2">
          ${csrfField(ctx.csrf)}
          <div class="field"><label for="ai-provider">Provider</label><input id="ai-provider" name="provider" value="${attr(personality.provider || 'openai-compatible')}"></div>
          <div class="field"><label for="ai-model">Model</label><input id="ai-model" name="model" value="${attr(personality.model || 'gpt-4o-mini')}"></div>
          <div class="field"><label for="ai-base">Base URL</label><input id="ai-base" name="base_url" value="${attr(personality.base_url || '')}" placeholder="https://api.openai.com/v1"></div>
          <div class="field"><label for="ai-key">API key</label><input id="ai-key" name="api_key" type="password" placeholder="${status.source === 'business' ? 'Saved — enter a new key to replace' : 'sk-…'}" autocomplete="off"></div>
          <div class="field"><label for="ai-tone">Brand voice</label><input id="ai-tone" name="tone" value="${attr(personality.tone || '')}" placeholder="Warm, concise, professional"></div>
          <div class="field"><label for="ai-lang">Default language</label><input id="ai-lang" name="language" value="${attr(personality.language || 'English')}"></div>
          <div class="field"><label for="ai-esc">Escalation phone</label><input id="ai-esc" name="escalation_phone" value="${attr(personality.escalation_phone || ctx.business.phone || '')}"></div>
          <button class="btn btn-primary btn-block" type="submit">Save AI configuration</button>
        </form>
      </div>
      <div class="card mt2">
        <h3>Usage by agent</h3>
        ${usageRows}
      </div>
    </div>
  </div>
  <div class="grid g2 mt3">
    <div class="card">
      <h3>Knowledge base</h3>
      <p class="muted" style="font-size:.82rem">The receptionist answers only from this knowledge and your business facts. Unknown questions are escalated rather than invented.</p>
      ${knowledge.length ? `<div class="table-wrap mt2"><table><thead><tr><th>Title</th><th>Category</th><th>Updated</th><th></th></tr></thead>
        <tbody>${knowledge.map((k) => `<tr><td><strong style="font-size:.86rem">${esc(k.title)}</strong><div class="muted" style="font-size:.74rem">${esc(String(k.content).slice(0, 90))}…</div></td>
          <td>${esc(k.category || '—')}</td><td class="muted" style="font-size:.74rem">${esc(relativeTime(k.updated_at))}</td>
          <td class="right">${k.is_active ? badge('active', 'ok') : badge('inactive', 'plain')}
          <form method="post" action="${ctx.base}/ai/knowledge/${attr(k.id)}/delete" style="display:inline" onsubmit="return confirm('Delete this knowledge entry?')">${csrfField(ctx.csrf)}<button class="btn btn-sm btn-ghost" type="submit">Delete</button></form></td></tr>`).join('')}</tbody></table></div>` : emptyState('No knowledge entries', 'Add opening hours, policies and FAQs so the AI can answer accurately.')}
    </div>
    <div class="card">
      <h3>Add knowledge</h3>
      <form method="post" action="${ctx.base}/ai/knowledge" class="mt2">
        ${csrfField(ctx.csrf)}
        <div class="field"><label for="k-title">Title</label><input id="k-title" name="title" required placeholder="Cancellation policy"></div>
        <div class="field"><label for="k-cat">Category</label><input id="k-cat" name="category" placeholder="Policy"></div>
        <div class="field"><label for="k-content">Content</label><textarea id="k-content" name="content" rows="6" required placeholder="Cancellations require 24 hours notice…"></textarea></div>
        <button class="btn btn-primary btn-block" type="submit">Save knowledge</button>
      </form>
    </div>
  </div>`;
  return shell(ctx, { title: 'AI control centre', subtitle: 'Agents, grounding, provider and usage', active: '/ai', body, wide: true });
}

/* ───────────────────────────── conversations ───────────────────────────── */

export function conversationsPage(ctx) {
  const { conversations } = ctx;
  const body = `<div class="card">
    <h3>Conversations</h3>
    <p class="muted" style="font-size:.82rem">Inbound channels create conversations. The AI replies only when its provider is configured; otherwise messages are stored with a blocked status.</p>
    ${conversations.length ? `<div class="table-wrap mt2"><table><thead><tr><th>Channel</th><th>Contact</th><th>Customer</th><th>Messages</th><th>Status</th><th>Last activity</th><th></th></tr></thead>
      <tbody>${conversations.map((c) => `<tr><td>${esc(c.channel)}</td><td class="mono" style="font-size:.74rem">${esc(c.contact_ref)}</td>
        <td>${esc(c.customer_name || '—')}</td><td>${esc(String(c.message_count))}</td><td>${statusBadge(c.status)}</td>
        <td class="muted" style="font-size:.74rem">${esc(relativeTime(c.last_message_at))}</td>
        <td class="right"><a class="btn btn-sm btn-ghost" href="${ctx.base}/conversations/${attr(c.id)}">Open</a></td></tr>`).join('')}</tbody></table></div>`
      : emptyState('No conversations yet', 'WhatsApp, web chat and voice conversations appear here once a channel is connected.')}
  </div>`;
  return shell(ctx, { title: 'Conversations', subtitle: 'AI receptionist activity', active: '/conversations', body, wide: true });
}

export function conversationPage(ctx) {
  const { conversation, messages, customer } = ctx;
  const body = `<div class="grid g2">
    <div class="card">
      <div class="flex between"><h3>${esc(conversation.contact_ref)}</h3>${statusBadge(conversation.status)}</div>
      <p class="muted" style="font-size:.78rem">${esc(conversation.channel)} · opened ${esc(relativeTime(conversation.created_at))}${customer ? ` · <a href="${ctx.base}/customers/${attr(customer.id)}">${esc(customer.name)}</a>` : ''}</p>
      <div class="thread mt2">
        ${messages.length ? messages.map((m) => `<div class="msg ${m.direction === 'inbound' ? 'in' : 'out'}">
          <div class="mono" style="font-size:.62rem">${esc(m.author)} · ${esc(relativeTime(m.created_at))} · ${esc(m.status)}</div>
          <div>${esc(m.body)}</div>
          ${m.error ? `<div class="err" style="font-size:.72rem">${esc(m.error)}</div>` : ''}
        </div>`).join('') : '<p class="muted" style="font-size:.84rem">No messages stored.</p>'}
      </div>
    </div>
    <div class="card">
      <h3>Reply as staff</h3>
      <p class="muted" style="font-size:.82rem">Outbound delivery requires a connected channel. The message is stored with its real provider status.</p>
      <form method="post" action="${ctx.base}/conversations/${attr(conversation.id)}/reply" class="mt2">
        ${csrfField(ctx.csrf)}
        <div class="field"><label for="cv-body">Message</label><textarea id="cv-body" name="body" rows="5" required></textarea></div>
        <button class="btn btn-primary btn-block" type="submit">Send message</button>
      </form>
      ${conversation.escalated_reason ? `<div class="banner warn mt2"><div><strong>Escalated</strong><span>${esc(conversation.escalated_reason)}</span></div></div>` : ''}
      <form method="post" action="${ctx.base}/conversations/${attr(conversation.id)}/escalate" class="mt2">
        ${csrfField(ctx.csrf)}
        <div class="field"><label for="cv-reason">Escalation reason</label><input id="cv-reason" name="reason" placeholder="Requires human decision"></div>
        <button class="btn btn-sm" type="submit">Escalate to staff</button>
      </form>
      <div class="hr"></div>
      <h4>AI test</h4>
      <p class="muted" style="font-size:.8rem">Runs the receptionist against this conversation using real tenant data.</p>
      <form method="post" action="${ctx.base}/conversations/${attr(conversation.id)}/ai" class="mt2">
        ${csrfField(ctx.csrf)}
        <div class="field"><label for="cv-ai">Customer message</label><input id="cv-ai" name="text" placeholder="What time do you open on Saturday?" required></div>
        <button class="btn btn-sm btn-primary" type="submit">Run receptionist</button>
      </form>
    </div>
  </div>`;
  return shell(ctx, { title: 'Conversation', subtitle: conversation.contact_ref, active: '/conversations', actions: pageActions([['All conversations', `${ctx.base}/conversations`]]), body, wide: true });
}

/* ───────────────────────────── content studio ───────────────────────────── */

export function contentPage(ctx) {
  const { items, kinds, platforms, status } = ctx;
  const body = `${providerGate(status)}
  <div class="grid g2">
    <div class="card">
      <h3>Generate content</h3>
      <p class="muted" style="font-size:.82rem">Generation requires a configured AI provider. Drafts stay editable and are never published automatically.</p>
      <form method="post" action="${ctx.base}/content" class="mt2">
        ${csrfField(ctx.csrf)}
        <div class="field-row">
          <div class="field"><label for="ct-kind">Format</label><select id="ct-kind" name="kind">${kinds.map(([v, l]) => `<option value="${attr(v)}">${esc(l)}</option>`).join('')}</select></div>
          <div class="field"><label for="ct-platform">Platform</label><select id="ct-platform" name="platform">${platforms.map((p) => `<option value="${attr(p)}">${esc(p)}</option>`).join('')}</select></div>
        </div>
        <div class="field"><label for="ct-prompt">Brief</label><textarea id="ct-prompt" name="prompt" rows="4" required placeholder="Promote the weekend spa package to existing customers"></textarea></div>
        <div class="field-row">
          <div class="field"><label for="ct-audience">Audience</label><input id="ct-audience" name="audience" placeholder="Returning customers"></div>
          <div class="field"><label for="ct-offer">Offer</label><input id="ct-offer" name="offer" placeholder="15% off"></div>
        </div>
        <button class="btn btn-primary btn-block" type="submit">Generate draft</button>
      </form>
    </div>
    <div class="card">
      <h3>Drafts & publishing</h3>
      <p class="muted" style="font-size:.82rem">Publishing requires a connected social provider. Without one, items remain drafts and the reason is shown.</p>
      ${items.length ? `<div class="list-rows mt2">${items.map((i) => `<div class="row">
        <div><strong style="font-size:.88rem">${esc(i.title || i.kind)}</strong> ${statusBadge(i.status)}
          <div class="muted" style="font-size:.76rem">${esc(i.platform || 'general')} · ${esc(relativeTime(i.created_at))}</div>
          <div style="font-size:.82rem;margin-top:.35rem;white-space:pre-wrap">${esc(String(i.body).slice(0, 220))}${String(i.body).length > 220 ? '…' : ''}</div>
          ${i.error ? `<div class="err" style="font-size:.72rem">${esc(i.error)}</div>` : ''}
        </div>
        <div class="right" style="display:grid;gap:.35rem">
          <form method="post" action="${ctx.base}/content/${attr(i.id)}/publish">${csrfField(ctx.csrf)}<button class="btn btn-sm" type="submit">Publish</button></form>
          <form method="post" action="${ctx.base}/content/${attr(i.id)}/delete" onsubmit="return confirm('Delete this draft?')">${csrfField(ctx.csrf)}<button class="btn btn-sm btn-ghost" type="submit">Delete</button></form>
        </div>
      </div>`).join('')}</div>` : emptyState('No content yet', 'Generate your first caption or campaign draft.')}
    </div>
  </div>`;
  return shell(ctx, { title: 'Content studio', subtitle: 'Brand-consistent drafts with human review', active: '/content', body, wide: true });
}

/* ───────────────────────────── automations ───────────────────────────── */

export function automationsPage(ctx) {
  const { automations, triggers, actions, runs, performance } = ctx;
  const body = `<div class="grid g4">
    ${stat('Workflows', String(automations.length), `${automations.filter((a) => a.status === 'active').length} active`)}
    ${stat('Runs (30d)', String(performance.total), '')}
    ${stat('Succeeded', String(performance.success), '')}
    ${stat('Failed', String(performance.failed), performance.blocked ? `${performance.blocked} blocked by consent/channel` : '')}
  </div>
  <div class="grid g2 mt3">
    <div class="card">
      <h3>Workflows</h3>
      ${automations.length ? `<div class="list-rows mt2">${automations.map((a) => `<div class="row">
        <div><strong>${esc(a.name)}</strong> ${statusBadge(a.status)}
          <div class="muted" style="font-size:.76rem">${esc(triggers[a.trigger] || a.trigger)} → ${esc(actions[a.action_type] || a.action_type)}</div>
          <div class="muted" style="font-size:.72rem">${a.last_run_at ? `last run ${relativeTime(a.last_run_at)}` : 'never run'}</div>
        </div>
        <div class="right" style="display:grid;gap:.35rem">
          <form method="post" action="${ctx.base}/automations/${attr(a.id)}/status">${csrfField(ctx.csrf)}
            <input type="hidden" name="status" value="${a.status === 'active' ? 'paused' : 'active'}">
            <button class="btn btn-sm" type="submit">${a.status === 'active' ? 'Pause' : 'Activate'}</button></form>
          <form method="post" action="${ctx.base}/automations/${attr(a.id)}/test">${csrfField(ctx.csrf)}<button class="btn btn-sm btn-ghost" type="submit">Test run</button></form>
        </div>
      </div>`).join('')}</div>` : emptyState('No workflows', 'Create a workflow from the builder on the right.')}
      <div class="hr"></div>
      <h4>Execution log</h4>
      ${runs.length ? `<div class="table-wrap mt2"><table><thead><tr><th>When</th><th>Workflow</th><th>Subject</th><th>Status</th><th>Detail</th></tr></thead>
        <tbody>${runs.slice(0, 25).map((r) => `<tr><td class="muted" style="font-size:.72rem">${esc(relativeTime(r.created_at))}</td><td>${esc(r.name || '')}</td>
          <td class="mono" style="font-size:.7rem">${esc(r.subject_type || '')}</td><td>${statusBadge(r.status)}</td><td class="muted" style="font-size:.72rem">${esc(r.detail || '')}</td></tr>`).join('')}</tbody></table></div>`
        : '<p class="muted mt1" style="font-size:.84rem">No executions recorded.</p>'}
    </div>
    <div class="card">
      <h3>Workflow builder</h3>
      <p class="muted" style="font-size:.82rem">Workflows execute on the backend. Conditions and actions are validated before saving.</p>
      <form method="post" action="${ctx.base}/automations" class="mt2">
        ${csrfField(ctx.csrf)}
        <div class="field"><label for="w-name">Name</label><input id="w-name" name="name" required placeholder="Win-back after 30 days"></div>
        <div class="field"><label for="w-trigger">Trigger</label><select id="w-trigger" name="trigger">${Object.entries(triggers).map(([v, l]) => `<option value="${attr(v)}">${esc(l)}</option>`).join('')}</select></div>
        <div class="field"><label for="w-action">Action</label><select id="w-action" name="action_type">${Object.entries(actions).map(([v, l]) => `<option value="${attr(v)}">${esc(l)}</option>`).join('')}</select></div>
        <div class="field"><label for="w-cond">Conditions</label><textarea id="w-cond" name="conditions" rows="3" placeholder="consent=true&#10;days_since_visit>=30"></textarea>
          <p class="hint">One condition per line as field operator value, e.g. <code>consent=true</code> or <code>days_since_visit&gt;=30</code>.</p></div>
        <div class="field"><label for="w-template">Message template</label><textarea id="w-template" name="template" rows="3" placeholder="Hi {{name}}, we have missed you…"></textarea></div>
        <div class="field"><label for="w-channel">Channel</label><select id="w-channel" name="channel"><option value="whatsapp">WhatsApp</option><option value="sms">SMS</option><option value="email">Email</option><option value="in_app">In-app task</option></select></div>
        <button class="btn btn-primary btn-block" type="submit">Save workflow</button>
      </form>
      <p class="hint">Marketing actions require recorded consent and a connected channel; otherwise the run is logged as blocked.</p>
    </div>
  </div>`;
  return shell(ctx, { title: 'Automations', subtitle: 'Triggers, conditions, actions and execution logs', active: '/automations', body, wide: true });
}

/* ───────────────────────────── integrations ───────────────────────────── */

export function integrationsPage(ctx) {
  const { integrations, summary } = ctx;
  const cards = integrations.map((i) => `<div class="card">
      <div class="flex between">
        <div><h4>${esc(i.name)}</h4><div class="muted" style="font-size:.72rem">${esc(i.category)}</div></div>
        ${statusBadge(i.status)}
      </div>
      <p class="muted" style="font-size:.8rem;margin-top:.4rem">${esc(i.description || '')}</p>
      ${i.account_label ? `<div class="mono" style="font-size:.72rem">${esc(i.account_label)}</div>` : ''}
      ${i.config_hint ? `<div class="mono muted" style="font-size:.7rem">${esc(i.config_hint)}</div>` : ''}
      ${i.last_error ? `<div class="err" style="font-size:.74rem">${esc(i.last_error)}</div>` : ''}
      <div class="chips mt1">${(i.capabilities || []).map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</div>
      <details class="mt2">
        <summary class="mono" style="font-size:.72rem;cursor:pointer">Configuration</summary>
        <form method="post" action="${ctx.base}/integrations/${attr(i.provider)}" class="mt2">
          ${csrfField(ctx.csrf)}
          ${(i.fields || []).map((f) => `<div class="field"><label for="f-${attr(i.provider)}-${attr(f.key)}">${esc(f.label)}${f.required ? ' *' : ''}</label>
            <input id="f-${attr(i.provider)}-${attr(f.key)}" name="${attr(f.key)}" type="${f.secret ? 'password' : 'text'}" ${f.required ? 'required' : ''} autocomplete="off"
              placeholder="${i.configured && f.secret ? 'saved — enter to replace' : ''}"></div>`).join('')}
          <div class="btn-row">
            <button class="btn btn-sm btn-primary" type="submit">Save credentials</button>
            ${i.configured ? `<button class="btn btn-sm" type="submit" formaction="${ctx.base}/integrations/${attr(i.provider)}/test">Test connection</button>
            <button class="btn btn-sm btn-ghost" type="submit" formaction="${ctx.base}/integrations/${attr(i.provider)}/disconnect" formnovalidate onclick="return confirm('Disconnect this integration?')">Disconnect</button>` : ''}
          </div>
        </form>
        ${i.docs ? `<p class="hint"><a href="${attr(i.docs)}" target="_blank" rel="noopener">Provider documentation</a></p>` : ''}
      </details>
    </div>`).join('');

  const body = `<div class="grid g4">
    ${stat('Connected', String(summary.connected), 'verified by the provider')}
    ${stat('Configuration required', String(summary.configurationRequired), 'credentials missing')}
    ${stat('Needs attention', String(summary.needsAttention), 'error or reconnect')}
    ${stat('Total providers', String(integrations.length), 'available in this build')}
  </div>
  <div class="banner mt3"><div><strong>Verification rule</strong><span>An integration shows Connected only after the provider API confirms the credentials. Saving credentials alone never marks it connected.</span></div></div>
  <div class="grid g2 mt3">${cards}</div>`;
  return shell(ctx, { title: 'Integrations', subtitle: 'Official providers, verification and health', active: '/integrations', body, wide: true });
}

/* ───────────────────────────── analytics ───────────────────────────── */

export function analyticsPage(ctx) {
  const { metrics, series, services, staff, branches, segments, revenue, marketing, ai, automation, days } = ctx;
  const max = Math.max(...series.map((s) => Number(s.total) || 0), 1);
  const chart = series.length ? `<div class="chart-bars">${series.map((s) => `<div class="bar" title="${esc(s.day)}: ${esc(s.total)} bookings">
      <span style="height:${Math.max(3, Math.round(((Number(s.total) || 0) / max) * 100))}%"></span><em>${esc(String(s.day).slice(8))}</em></div>`).join('')}</div>` : '<p class="muted" style="font-size:.86rem">No bookings in this period.</p>';

  const body = `<div class="flex between wrap gap">
    <div class="btn-row">${[7, 30, 90].map((d) => `<a class="btn btn-sm ${d === days ? 'btn-primary' : ''}" href="${ctx.base}/analytics?days=${d}">${d} days</a>`).join('')}</div>
    <span class="mono muted" style="font-size:.68rem">all figures from stored records</span>
  </div>
  <div class="grid g4 mt2">
    ${stat('Bookings', String(metrics.total), `${metrics.completed} completed`)}
    ${stat('Revenue', money(revenue.confirmedCents, ctx.business.currency), 'provider-confirmed only')}
    ${stat('Completion rate', metrics.completionRate === null ? '—' : `${metrics.completionRate}%`, `${metrics.cancelled} cancelled`)}
    ${stat('No-show rate', metrics.noShowRate === null ? '—' : `${metrics.noShowRate}%`, `${metrics.noShow} no-shows`)}
  </div>
  <div class="card mt3"><h3>Booking volume</h3>${chart}</div>
  <div class="grid g2 mt3">
    <div class="card"><h3>Service performance</h3>
      ${services.length ? `<div class="table-wrap mt2"><table><thead><tr><th>Service</th><th>Bookings</th><th>Revenue</th></tr></thead>
        <tbody>${services.map((s) => `<tr><td>${esc(s.name)}</td><td>${esc(String(s.bookings))}</td><td>${moneyCell(s.revenue_cents, ctx.business.currency)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted mt1" style="font-size:.84rem">No service activity recorded.</p>'}
    </div>
    <div class="card"><h3>Team activity</h3>
      ${staff.length ? `<div class="table-wrap mt2"><table><thead><tr><th>Member</th><th>Bookings</th><th>Completed</th></tr></thead>
        <tbody>${staff.map((s) => `<tr><td>${esc(s.name)}</td><td>${esc(String(s.bookings))}</td><td>${esc(String(s.completed))}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted mt1" style="font-size:.84rem">No team activity recorded.</p>'}
    </div>
  </div>
  <div class="grid g2 mt3">
    <div class="card"><h3>Branches</h3>
      ${branches.length ? `<div class="table-wrap mt2"><table><thead><tr><th>Branch</th><th>Bookings</th><th>Value</th></tr></thead>
        <tbody>${branches.map((b) => `<tr><td>${esc(b.name)}</td><td>${esc(String(b.bookings))}</td><td>${moneyCell(b.value_cents, ctx.business.currency)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted mt1" style="font-size:.84rem">No branches configured.</p>'}
    </div>
    <div class="card"><h3>Customer intelligence</h3>
      <div class="grid g2" style="gap:.4rem;font-size:.84rem">
        ${[['Total', segments.total], ['New', segments.new], ['Returning', segments.returning], ['VIP', segments.vip], ['Inactive', segments.inactive], ['Consented', segments.consented]]
          .map(([l, v]) => `<div class="flex between"><span class="muted">${esc(l)}</span><span class="mono">${esc(String(v ?? 0))}</span></div>`).join('')}
      </div>
      <div class="hr"></div>
      <div class="grid g2" style="gap:.4rem;font-size:.84rem">
        <div class="flex between"><span class="muted">AI runs</span><span class="mono">${esc(String(ai.runs))}</span></div>
        <div class="flex between"><span class="muted">Automation runs</span><span class="mono">${esc(String(automation.total))}</span></div>
        <div class="flex between"><span class="muted">Campaign drafts</span><span class="mono">${esc(String(marketing.drafts))}</span></div>
        <div class="flex between"><span class="muted">Published</span><span class="mono">${esc(String(marketing.published))}</span></div>
      </div>
    </div>
  </div>`;
  return shell(ctx, { title: 'Analytics', subtitle: 'Verified operational intelligence', active: '/analytics', body, wide: true });
}

/* ───────────────────────────── command centre ───────────────────────────── */

export function commandPage(ctx) {
  const { businesses, alerts, timeline, totals, subscriptions } = ctx;
  const body = `<div class="grid g4">
    ${stat('Businesses', String(totals.businesses), 'in your organisation')}
    ${stat('Bookings (30d)', String(totals.bookings), 'all branches')}
    ${stat('Revenue (30d)', money(totals.revenueCents, ctx.business.currency), 'confirmed payments')}
    ${stat('Open alerts', String(alerts.length), alerts.length ? 'review required' : 'none')}
  </div>
  <div class="grid g2 mt3">
    <div class="card">
      <h3>Operational alerts</h3>
      ${alerts.length ? `<div class="list-rows mt2">${alerts.map((a) => `<div class="row"><div><strong>${esc(a.title)}</strong><div class="muted" style="font-size:.76rem">${esc(a.detail)}</div></div>${badge(a.level, a.level === 'critical' ? 'bad' : 'warn')}</div>`).join('')}</div>`
        : '<p class="muted mt1" style="font-size:.86rem">No operational alerts. Integrations, billing and AI configuration are within expected states.</p>'}
    </div>
    <div class="card">
      <h3>Business health</h3>
      <div class="list-rows mt2">
        ${businesses.map((b) => `<div class="row"><div><strong>${esc(b.name)}</strong><div class="muted" style="font-size:.74rem">${esc(b.industry || '')} · ${esc(b.city || '')}</div></div>
          <div class="right"><span class="mono" style="font-size:.74rem">${esc(String(b.bookings_30d))} bookings</span><div>${statusBadge(b.status)}</div></div></div>`).join('')}
      </div>
      <div class="hr"></div>
      <h4>Subscriptions</h4>
      <div class="grid g2" style="gap:.35rem;font-size:.82rem">
        ${Object.entries(subscriptions).map(([k, v]) => `<div class="flex between"><span class="muted">${esc(k)}</span><span class="mono">${esc(String(v))}</span></div>`).join('') || '<span class="muted">No subscriptions yet.</span>'}
      </div>
    </div>
  </div>
  <div class="card mt3">
    <h3>Activity timeline</h3>
    ${timeline.length ? `<div class="timeline mt2">${timeline.map((t) => `<div class="tl-item"><span class="tl-dot"></span><div><strong style="font-size:.84rem">${esc(t.action)}</strong><div class="muted" style="font-size:.76rem">${esc(t.actor_label)} · ${esc(t.result)}</div></div><span class="mono muted" style="font-size:.7rem">${esc(relativeTime(t.created_at))}</span></div>`).join('')}</div>`
      : '<p class="muted mt1" style="font-size:.86rem">No recorded activity yet.</p>'}
  </div>`;
  return shell(ctx, { title: 'Command centre', subtitle: 'Executive view of operations and intelligence', active: '/command', body, wide: true });
}

/* ───────────────────────────── settings ───────────────────────────── */

export function settingsPage(ctx) {
  const { branches, members, apiKeys, webhooks, rules, personality, org } = ctx;
  const body = `<div class="grid g2">
    <div class="card">
      <h3>Business profile</h3>
      <form method="post" action="${ctx.base}/settings" class="mt2">
        ${csrfField(ctx.csrf)}
        <div class="field"><label for="st-name">Business name</label><input id="st-name" name="name" value="${attr(ctx.business.name)}" required></div>
        <div class="field"><label for="st-desc">Description</label><textarea id="st-desc" name="description" rows="3">${esc(ctx.business.description || '')}</textarea></div>
        <div class="field-row">
          <div class="field"><label for="st-phone">Phone</label><input id="st-phone" name="phone" value="${attr(ctx.business.phone || '')}"></div>
          <div class="field"><label for="st-wa">WhatsApp</label><input id="st-wa" name="whatsapp" value="${attr(ctx.business.whatsapp || '')}"></div>
        </div>
        <div class="field-row">
          <div class="field"><label for="st-email">Email</label><input id="st-email" name="email" type="email" value="${attr(ctx.business.email || '')}"></div>
          <div class="field"><label for="st-city">City</label><input id="st-city" name="city" value="${attr(ctx.business.city || '')}"></div>
        </div>
        <div class="field-row">
          <div class="field"><label for="st-tz">Timezone</label><input id="st-tz" name="timezone" value="${attr(ctx.business.timezone || 'Africa/Nairobi')}"></div>
          <div class="field"><label for="st-cur">Currency</label><input id="st-cur" name="currency" value="${attr(ctx.business.currency || 'KES')}"></div>
        </div>
        <div class="field"><label for="st-address">Address</label><input id="st-address" name="address" value="${attr(ctx.business.address || '')}"></div>
        <div class="field"><label for="st-policies">Policies</label><textarea id="st-policies" name="policies" rows="3">${esc(ctx.business.policies || '')}</textarea></div>
        <div class="field-row">
          <div class="field"><label for="st-primary">Brand colour</label><input id="st-primary" name="brand_primary" type="color" value="${attr(ctx.business.brand_primary || '#6366f1')}"></div>
          <div class="field"><label for="st-accent">Accent colour</label><input id="st-accent" name="brand_accent" type="color" value="${attr(ctx.business.brand_accent || '#35d5e8')}"></div>
        </div>
        <button class="btn btn-primary" type="submit">Save profile</button>
      </form>
    </div>
    <div>
      <div class="card">
        <h3>Booking rules</h3>
        <form method="post" action="${ctx.base}/settings/rules" class="mt2">
          ${csrfField(ctx.csrf)}
          <div class="field-row">
            <div class="field"><label for="r-step">Slot step (min)</label><input id="r-step" name="slot_step_min" type="number" min="5" max="60" value="${attr(String(rules.slot_step_min ?? 15))}"></div>
            <div class="field"><label for="r-notice">Minimum notice (min)</label><input id="r-notice" name="min_notice_min" type="number" min="0" value="${attr(String(rules.min_notice_min ?? 60))}"></div>
          </div>
          <div class="field-row">
            <div class="field"><label for="r-max">Max days ahead</label><input id="r-max" name="max_days_ahead" type="number" min="1" max="365" value="${attr(String(rules.max_days_ahead ?? 60))}"></div>
            <div class="field"><label for="r-cancel">Cancellation notice (h)</label><input id="r-cancel" name="cancel_notice_hours" type="number" min="0" value="${attr(String(rules.cancel_notice_hours ?? 24))}"></div>
          </div>
          <label class="check"><input type="checkbox" name="allow_waitlist" value="1" ${rules.allow_waitlist ? 'checked' : ''}> Enable waitlist</label>
          <label class="check"><input type="checkbox" name="require_deposit" value="1" ${rules.require_deposit ? 'checked' : ''}> Require deposit (needs payment provider)</label>
          <button class="btn btn-sm btn-primary mt2" type="submit">Save rules</button>
        </form>
      </div>
      <div class="card mt2">
        <h3>Team access</h3>
        <div class="table-wrap"><table><thead><tr><th>Member</th><th>Role</th><th>Branch</th><th>Status</th></tr></thead>
          <tbody>${members.map((m) => `<tr><td>${esc(m.name || m.email)}<div class="muted" style="font-size:.72rem">${esc(m.email)}</div></td><td>${badge(m.role, 'info')}</td><td>${esc(m.branch_name || 'All')}</td><td>${statusBadge(m.status)}</td></tr>`).join('')}</tbody></table></div>
        <form method="post" action="${ctx.base}/settings/invite" class="mt2">
          ${csrfField(ctx.csrf)}
          <div class="field-row">
            <div class="field"><label for="iv-email">Email</label><input id="iv-email" name="email" type="email" required></div>
            <div class="field"><label for="iv-role">Role</label><select id="iv-role" name="role"><option value="manager">Manager</option><option value="receptionist">Receptionist</option><option value="staff">Staff</option></select></div>
          </div>
          <button class="btn btn-sm" type="submit">Invite member</button>
          <p class="hint">Invitations create a pending membership with a signed token link. The member sets their own password.</p>
        </form>
      </div>
    </div>
  </div>
  <div class="grid g2 mt3">
    <div class="card">
      <h3>API keys</h3>
      <p class="muted" style="font-size:.82rem">Keys are shown once at creation and stored as hashes. Use them with the v1 API.</p>
      ${ctx.newKey ? `<div class="banner ok"><div><strong>New API key</strong><span class="mono" style="word-break:break-all">${esc(ctx.newKey)}</span></div></div>` : ''}
      ${apiKeys.length ? `<div class="table-wrap mt2"><table><thead><tr><th>Name</th><th>Prefix</th><th>Last used</th><th></th></tr></thead>
        <tbody>${apiKeys.map((k) => `<tr><td>${esc(k.name)}</td><td class="mono" style="font-size:.72rem">${esc(k.prefix)}…</td><td class="muted" style="font-size:.74rem">${k.last_used_at ? esc(relativeTime(k.last_used_at)) : 'never'}</td>
          <td class="right"><form method="post" action="${ctx.base}/settings/api-keys/${attr(k.id)}/revoke">${csrfField(ctx.csrf)}<button class="btn btn-sm btn-ghost" type="submit">Revoke</button></form></td></tr>`).join('')}</tbody></table></div>` : ''}
      <form method="post" action="${ctx.base}/settings/api-keys" class="mt2">
        ${csrfField(ctx.csrf)}
        <div class="field"><label for="ak-name">Key name</label><input id="ak-name" name="name" required placeholder="Zapier integration"></div>
        <button class="btn btn-sm" type="submit">Create API key</button>
      </form>
    </div>
    <div class="card">
      <h3>Webhooks</h3>
      <p class="muted" style="font-size:.82rem">Events are signed with HMAC-SHA256 using the endpoint secret.</p>
      ${webhooks.length ? `<div class="table-wrap mt2"><table><thead><tr><th>URL</th><th>Events</th><th>Status</th></tr></thead>
        <tbody>${webhooks.map((w) => `<tr><td class="mono" style="font-size:.72rem;word-break:break-all">${esc(w.url)}</td><td style="font-size:.74rem">${esc((w.events || []).join(', ') || 'all')}</td><td>${w.is_active ? badge('active', 'ok') : badge('inactive', 'plain')}</td></tr>`).join('')}</tbody></table></div>` : ''}
      <form method="post" action="${ctx.base}/settings/webhooks" class="mt2">
        ${csrfField(ctx.csrf)}
        <div class="field"><label for="wh-url">Endpoint URL</label><input id="wh-url" name="url" type="url" required placeholder="https://example.com/hooks/mavyron"></div>
        <div class="field"><label for="wh-events">Events</label><input id="wh-events" name="events" placeholder="booking.created, payment.confirmed"></div>
        <button class="btn btn-sm" type="submit">Add webhook</button>
      </form>
      <div class="hr"></div>
      <h4>Organisation</h4>
      <dl class="kv">
        <dt>Organisation</dt><dd>${esc(org?.name || '—')}</dd>
        <dt>Country</dt><dd>${esc(org?.country || ctx.business.country || '—')}</dd>
        <dt>Public page</dt><dd><a href="/business/${attr(ctx.business.slug)}" target="_blank" rel="noopener">/business/${esc(ctx.business.slug)}</a></dd>
      </dl>
    </div>
  </div>`;
  return shell(ctx, { title: 'Settings', subtitle: 'Business configuration, access and developer tools', active: '/settings', body, wide: true });
}

/* ───────────────────────────── billing ───────────────────────────── */

export function billingPage(ctx) {
  const { ent, plans, payments, providers } = ctx;
  const statusLine = ent.active ? badge(ent.status, 'ok') : badge(ent.status, 'bad');
  const body = `<div class="grid g3">
    ${stat('Current plan', ent.planName, `${money(ent.priceCents, ent.currency)} / month`)}
    ${stat('Status', ent.status, ent.trialDaysLeft !== null && ent.status === 'trialing' ? `${ent.trialDaysLeft} days left` : '')}
    ${stat('AI runs this month', String(ent.usage.ai_messages), `limit ${ent.limits.ai_messages === -1 ? 'unlimited' : ent.limits.ai_messages}`)}
  </div>
  <div class="banner mt2"><div><strong>Subscription state</strong><span>${esc(ent.planName)} · ${esc(ent.status)}. Plan changes that require payment stay in “payment pending” until a verified provider event activates them.</span></div>${statusLine}</div>
  <div class="grid g4 mt3">
    ${plans.map((p) => `<div class="card plan ${p.id === ent.plan.id ? 'plan-current' : ''}">
      <div class="flex between"><h4>${esc(p.name)}</h4>${p.id === ent.plan.id ? badge('current', 'info') : ''}</div>
      <div class="price">${money(p.price_cents, p.currency)}<span>/mo</span></div>
      <ul class="feature-list">${p.features.slice(0, 6).map((f) => `<li>${esc(f.replace(/_/g, ' '))}</li>`).join('')}</ul>
      <form method="post" action="${ctx.base}/billing/plan">
        ${csrfField(ctx.csrf)}
        <input type="hidden" name="plan_id" value="${attr(p.id)}">
        <button class="btn btn-sm btn-block ${p.id === ent.plan.id ? 'btn-ghost' : 'btn-primary'}" type="submit" ${p.id === ent.plan.id ? 'disabled' : ''}>${p.id === ent.plan.id ? 'Active' : `Switch to ${esc(p.name)}`}</button>
      </form>
    </div>`).join('')}
  </div>
  <div class="grid g2 mt3">
    <div class="card">
      <h3>Payment providers</h3>
      <p class="muted" style="font-size:.82rem">Checkout is hosted by the provider. MAVYRON never receives card numbers or CVV.</p>
      <div class="list-rows mt2">
        ${providers.map((p) => `<div class="row"><div><strong>${esc(p.name)}</strong><div class="muted" style="font-size:.74rem">${esc(p.description)}</div></div>
          <div class="right">${statusBadge(p.status)}<div><a class="btn btn-sm btn-ghost" href="${ctx.base}/integrations#${attr(p.provider)}">Configure</a></div></div></div>`).join('')}
      </div>
    </div>
    <div class="card">
      <h3>Payment history</h3>
      ${payments.length ? `<div class="table-wrap mt2"><table><thead><tr><th>Provider</th><th>Purpose</th><th>Amount</th><th>Status</th><th>When</th></tr></thead>
        <tbody>${payments.map((p) => `<tr><td>${esc(p.provider)}</td><td>${esc(p.purpose || '—')}</td><td>${moneyCell(p.amount_cents, p.currency)}</td><td>${statusBadge(p.status)}</td><td class="muted" style="font-size:.74rem">${esc(relativeTime(p.created_at))}</td></tr>`).join('')}</tbody></table></div>`
        : '<p class="muted mt1" style="font-size:.84rem">No payments recorded. A payment appears only after a verified provider webhook.</p>'}
    </div>
  </div>`;
  return shell(ctx, { title: 'Billing', subtitle: 'Plans, entitlements and verified payments', active: '/billing', body, wide: true });
}

/* ───────────────────────────── healthcare ───────────────────────────── */

export function healthcarePage(ctx) {
  const { patients, encounters, queue, counts, enabled } = ctx;
  if (!enabled) {
    return shell(ctx, {
      title: 'Healthcare', subtitle: 'Clinical operations module', active: '/healthcare',
      body: `<div class="card">${emptyState('Healthcare is not enabled for this business', 'This module is available to clinics, dental practices, laboratories, pharmacies and hospitals. Change the business industry in settings to activate the patient, encounter and queue workflows.', `<a class="btn btn-sm" href="${ctx.base}/settings">Open settings</a>`)}</div>`,
    });
  }
  const body = `<div class="grid g4">
    ${stat('Patients', String(counts.patients), 'registered in this facility')}
    ${stat('Open encounters', String(counts.openEncounters), 'active clinical records')}
    ${stat('In queue', String(counts.queued), 'waiting to be seen')}
    ${stat('Today', String(counts.todayAppointments), 'appointments')}
  </div>
  <div class="banner warn mt2"><div><strong>Clinical governance</strong><span>AI assists with administration only. It never diagnoses, prescribes or makes high-risk clinical decisions. All clinical records are audited.</span></div></div>
  <div class="grid g2 mt3">
    <div class="card">
      <h3>Patients</h3>
      ${patients.length ? `<div class="table-wrap mt2"><table><thead><tr><th>Patient no.</th><th>Name</th><th>Contact</th><th>Created</th></tr></thead>
        <tbody>${patients.map((p) => `<tr><td class="mono" style="font-size:.72rem">${esc(p.patient_no)}</td><td>${esc(`${p.first_name} ${p.last_name}`)}</td><td class="mono" style="font-size:.72rem">${esc(p.phone || '')}</td><td class="muted" style="font-size:.72rem">${esc(relativeTime(p.created_at))}</td></tr>`).join('')}</tbody></table></div>` : emptyState('No patients registered', 'Register a patient to open encounters and queue entries.')}
      <form method="post" action="${ctx.base}/healthcare/patients" class="mt2">
        ${csrfField(ctx.csrf)}
        <h4>Register patient</h4>
        <div class="field-row">
          <div class="field"><label for="p-first">First name</label><input id="p-first" name="first_name" required></div>
          <div class="field"><label for="p-last">Last name</label><input id="p-last" name="last_name" required></div>
        </div>
        <div class="field-row">
          <div class="field"><label for="p-phone">Phone</label><input id="p-phone" name="phone"></div>
          <div class="field"><label for="p-dob">Date of birth</label><input id="p-dob" name="dob" type="date"></div>
        </div>
        <div class="field-row">
          <div class="field"><label for="p-sex">Sex</label><select id="p-sex" name="sex"><option value="">—</option><option>female</option><option>male</option><option>other</option></select></div>
          <div class="field"><label for="p-blood">Blood group</label><input id="p-blood" name="blood_group"></div>
        </div>
        <div class="field"><label for="p-allergies">Allergies</label><input id="p-allergies" name="allergies"></div>
        <button class="btn btn-sm btn-primary" type="submit">Register patient</button>
      </form>
    </div>
    <div>
      <div class="card">
        <h3>Open encounters</h3>
        ${encounters.length ? `<div class="list-rows mt2">${encounters.map((e) => `<div class="row"><div><strong>${esc(e.patient_name || e.patient_id)}</strong><div class="muted" style="font-size:.74rem">${esc(e.encounter_type)} · ${esc(e.reason || '')}</div></div><div class="right">${statusBadge(e.status)}<div class="muted" style="font-size:.7rem">${esc(relativeTime(e.started_at))}</div></div></div>`).join('')}</div>` : '<p class="muted mt1" style="font-size:.84rem">No open encounters.</p>'}
        <form method="post" action="${ctx.base}/healthcare/encounters" class="mt2">
          ${csrfField(ctx.csrf)}
          <div class="field"><label for="e-patient">Patient</label><select id="e-patient" name="patient_id" required>${patients.map((p) => `<option value="${attr(p.id)}">${esc(`${p.first_name} ${p.last_name}`)} · ${esc(p.patient_no)}</option>`).join('')}</select></div>
          <div class="field-row">
            <div class="field"><label for="e-type">Type</label><select id="e-type" name="encounter_type"><option value="consultation">Consultation</option><option value="follow_up">Follow-up</option><option value="procedure">Procedure</option><option value="emergency">Emergency</option></select></div>
            <div class="field"><label for="e-reason">Reason</label><input id="e-reason" name="reason"></div>
          </div>
          <button class="btn btn-sm" type="submit">Open encounter</button>
        </form>
      </div>
      <div class="card mt2">
        <h3>Queue</h3>
        ${queue.length ? `<div class="list-rows mt1">${queue.map((q) => `<div class="row"><div><strong>${esc(q.patient_name || 'Patient')}</strong><div class="muted" style="font-size:.74rem">${esc(q.queue_type)}</div></div><div class="right">${statusBadge(q.status)}<div class="mono" style="font-size:.7rem">${esc(relativeTime(q.created_at))}</div></div></div>`).join('')}</div>` : '<p class="muted mt1" style="font-size:.84rem">Queue is empty.</p>'}
      </div>
    </div>
  </div>`;
  return shell(ctx, { title: 'Healthcare', subtitle: 'Patients, encounters and clinical operations', active: '/healthcare', body, wide: true });
}

/* ───────────────────────────── audit ───────────────────────────── */

export function auditPage(ctx) {
  const { logs } = ctx;
  const body = `<div class="card">
    <h3>Audit log</h3>
    <p class="muted" style="font-size:.82rem">Who, what, when, where and the result for every sensitive action.</p>
    ${logs.length ? `<div class="table-wrap mt2"><table><thead><tr><th>When</th><th>Actor</th><th>Role</th><th>Action</th><th>Entity</th><th>Result</th><th>IP</th></tr></thead>
      <tbody>${logs.map((l) => `<tr><td class="muted" style="font-size:.72rem">${esc(relativeTime(l.created_at))}</td><td style="font-size:.78rem">${esc(l.actor_label)}</td>
        <td>${esc(l.actor_role || '—')}</td><td class="mono" style="font-size:.72rem">${esc(l.action)}</td><td class="muted" style="font-size:.72rem">${esc(l.entity_type || '')}</td>
        <td>${statusBadge(l.result)}</td><td class="mono muted" style="font-size:.68rem">${esc(l.ip || '—')}</td></tr>`).join('')}</tbody></table></div>`
      : emptyState('No audit entries', 'Sensitive actions are recorded here automatically.')}
  </div>`;
  return shell(ctx, { title: 'Audit log', subtitle: 'Immutable record of sensitive actions', active: '/audit', body, wide: true });
}
