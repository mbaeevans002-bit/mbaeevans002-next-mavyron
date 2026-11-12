import { esc, attr, money, prettyDate, prettyTime, relativeTime, minutesToLabel, isoDate, addDays } from '../lib/util.js';
import { appPage, badge, statusBadge, stat, emptyState, icon, moneyCell, whenCell, relCell, csrfField } from './layout.js';

export function shell(ctx, { title, subtitle = '', active, actions = '', body, wide = false }) {
  return appPage({
    business: ctx.business, user: ctx.user, role: ctx.role, csrf: ctx.csrf, req: ctx.req,
    notifications: ctx.notifications || 0, title, subtitle, active, actions, body, wide,
  });
}

export function pageActions(items) {
  return items.map(([label, href, kind = '']) => `<a class="btn btn-sm ${kind}" href="${attr(href)}">${esc(label)}</a>`).join('');
}

function trialBanner(ent) {
  if (!ent || ent.status !== 'trialing') return '';
  const days = ent.trialDaysLeft;
  return `<div class="banner">
    <div><strong>Trial · ${esc(ent.planName)}</strong><span>${days > 0 ? `${days} day${days === 1 ? '' : 's'} remaining` : 'Trial period ended'} — paid activation requires a provider-confirmed payment.</span></div>
    <a class="btn btn-sm" href="${esc(ent.base || '')}/billing">View plans</a>
  </div>`;
}

function bars(series, key = 'total') {
  if (!series.length) return '';
  const max = Math.max(...series.map((s) => Number(s[key]) || 0), 1);
  return `<div class="chart-bars" role="img" aria-label="Daily bookings for the last ${series.length} days">
    ${series.map((s) => `<div class="bar" title="${esc(s.day)}: ${esc(s[key])}">
      <span style="height:${Math.max(3, Math.round(((Number(s[key]) || 0) / max) * 100))}%"></span>
      <em>${esc(String(s.day).slice(8))}</em>
    </div>`).join('')}
  </div>`;
}

/* ───────────────────────────── dashboard ───────────────────────────── */

export function dashboardPage(ctx) {
  const { data, ent } = ctx;
  const today = data.today || [];
  const upcoming = data.upcoming || [];
  const m = data.metrics || {};
  const rev = data.revenue || {};
  const cust = data.customers || {};
  const ai = data.ai || { runs: 0, tokens: 0, failures: 0 };
  const ints = data.integrations || {};

  const kpis = `<div class="grid g4">
    ${stat("Today's bookings", String(today.length), `${today.filter((b) => b.status === 'confirmed').length} confirmed`)}
    ${stat('Revenue confirmed', money(rev.confirmedCents || 0, ctx.business.currency), `${rev.confirmedCount || 0} payments · ${ctx.rangeDays} days`)}
    ${stat('Customers', String(cust.total || 0), `${cust.newCustomers || 0} new · ${cust.withConsent || 0} consented`)}
    ${stat('AI runs', String(ai.runs || 0), ai.failures ? `${ai.failures} failed` : `${ai.tokens || 0} tokens`)}
  </div>`;

  const schedule = today.length
    ? `<div class="table-wrap"><table>
        <thead><tr><th>Time</th><th>Customer</th><th>Service</th><th>Team</th><th>Status</th><th></th></tr></thead>
        <tbody>${today.map((b) => `<tr>
          <td class="mono">${esc(prettyTime(b.start_at, ctx.business.timezone))}</td>
          <td><a href="${ctx.base}/customers/${attr(b.customer_id)}">${esc(b.customer_name)}</a><div class="muted" style="font-size:.74rem">${esc(b.customer_phone || '')}</div></td>
          <td>${esc(b.service_name)}</td>
          <td>${esc(b.staff_name)}</td>
          <td>${statusBadge(b.status)}</td>
          <td class="right"><a class="btn btn-sm btn-ghost" href="${ctx.base}/calendar?date=${esc(isoDate(new Date()))}">Open</a></td>
        </tr>`).join('')}</tbody></table></div>`
    : emptyState('No bookings today', 'Take a booking from the calendar or share your booking page.', `<a class="btn btn-sm btn-primary" href="${ctx.base}/calendar">Open calendar</a>`);

  const upcomingList = upcoming.length
    ? `<div class="list-rows">${upcoming.map((b) => `<div class="row">
        <div><strong>${esc(b.customer_name)}</strong><div class="muted" style="font-size:.78rem">${esc(b.service_name)} · ${esc(b.staff_name)}</div></div>
        <div class="right mono" style="font-size:.76rem">${esc(prettyDate(String(b.start_at).slice(0, 10), ctx.business.timezone))}<br>${esc(prettyTime(b.start_at, ctx.business.timezone))}</div>
      </div>`).join('')}</div>`
    : emptyState('Nothing scheduled yet', 'Confirmed future bookings appear here.');

  const health = `<div class="grid g2">
    <div class="panel"><div class="flex between"><strong>Integration health</strong><a class="mono" style="font-size:.7rem" href="${ctx.base}/integrations">manage</a></div>
      <div class="mt1" style="display:grid;gap:.35rem;font-size:.84rem">
        <div class="flex between"><span>Connected</span><span>${badge(String(ints.connected || 0), ints.connected ? 'ok' : 'plain')}</span></div>
        <div class="flex between"><span>Configuration required</span><span>${badge(String(ints.configurationRequired || 0), 'warn')}</span></div>
        <div class="flex between"><span>Needs attention</span><span>${badge(String(ints.needsAttention || 0), ints.needsAttention ? 'bad' : 'plain')}</span></div>
      </div>
    </div>
    <div class="panel"><div class="flex between"><strong>Operational quality</strong><a class="mono" style="font-size:.7rem" href="${ctx.base}/analytics">analytics</a></div>
      <div class="mt1" style="display:grid;gap:.35rem;font-size:.84rem">
        <div class="flex between"><span>Completion rate</span><span>${m.completionRate === null || m.completionRate === undefined ? '—' : `${m.completionRate}%`}</span></div>
        <div class="flex between"><span>Cancellation rate</span><span>${m.cancellationRate === null || m.cancellationRate === undefined ? '—' : `${m.cancellationRate}%`}</span></div>
        <div class="flex between"><span>No-show rate</span><span>${m.noShowRate === null || m.noShowRate === undefined ? '—' : `${m.noShowRate}%`}</span></div>
      </div>
    </div>
  </div>`;

  const series = ctx.series || [];

  const body = `${trialBanner({ ...ent, base: ctx.base })}
  ${kpis}
  <div class="grid g2 mt3">
    <div class="card"><div class="flex between"><h3>Bookings trend</h3><span class="mono muted" style="font-size:.68rem">${ctx.rangeDays} days</span></div>${series.length ? bars(series) : '<p class="muted mt2" style="font-size:.86rem">No bookings recorded in this period yet.</p>'}</div>
    <div class="card"><div class="flex between"><h3>Today</h3><span class="mono muted" style="font-size:.68rem">${esc(prettyDate(data.day, ctx.business.timezone))}</span></div>${schedule}</div>
  </div>
  <div class="grid g2 mt3">
    <div class="card"><h3>Upcoming</h3>${upcomingList}</div>
    <div>${health}</div>
  </div>
  ${!data.hasData ? `<div class="card mt3"><h3>Start operating</h3><p class="muted" style="font-size:.88rem">This workspace has no recorded bookings or customers yet. The dashboard shows real data only — nothing here is simulated.</p><div class="btn-row mt2"><a class="btn btn-primary btn-sm" href="${ctx.base}/calendar">Take a booking</a><a class="btn btn-sm" href="${ctx.base}/services">Add services</a><a class="btn btn-sm" href="${ctx.base}/onboarding">Finish onboarding</a></div></div>` : ''}`;

  return shell(ctx, {
    title: 'Dashboard', subtitle: `${ctx.business.name} · ${ctx.rangeDays}-day view`, active: '/',
    actions: pageActions([['New booking', `${ctx.base}/calendar`, 'btn-primary'], ['Share booking page', `/business/${ctx.business.slug}`, '']]),
    body, wide: true,
  });
}

/* ───────────────────────────── calendar ───────────────────────────── */

export function calendarPage(ctx) {
  const { date, bookings, services, staff, branches, branchId, slots, slotReason, form } = ctx;
  const prev = addDays(date, -1);
  const next = addDays(date, 1);
  const q = (d) => `${ctx.base}/calendar?date=${d}${branchId ? `&branch_id=${branchId}` : ''}`;

  const rows = bookings.length
    ? `<div class="table-wrap"><table><thead><tr><th>Time</th><th>Ref</th><th>Customer</th><th>Service</th><th>Team</th><th>Price</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${bookings.map((b) => `<tr>
        <td class="mono">${esc(prettyTime(b.start_at, ctx.business.timezone))}<div class="muted" style="font-size:.68rem">${esc(minutesToLabel(Math.round((new Date(b.end_at) - new Date(b.start_at)) / 60000)))}</div></td>
        <td class="mono" style="font-size:.72rem">${esc(b.reference)}</td>
        <td>${esc(b.customer_name || '')}<div class="muted" style="font-size:.72rem">${esc(b.customer_phone || '')}</div></td>
        <td>${esc(b.service_name || '')}</td>
        <td>${esc(b.staff_name || '')}</td>
        <td>${moneyCell(b.price_cents, b.currency)}</td>
        <td>${statusBadge(b.status)}</td>
        <td class="right" style="white-space:nowrap">
          ${['confirmed', 'pending'].includes(b.status) ? `
            <form method="post" action="${ctx.base}/bookings/${attr(b.id)}/status" style="display:inline">${csrfField(ctx.csrf)}
              <input type="hidden" name="status" value="completed"><button class="btn btn-sm btn-ghost" type="submit" title="Mark completed">${icon('check')}</button></form>
            <form method="post" action="${ctx.base}/bookings/${attr(b.id)}/status" style="display:inline">${csrfField(ctx.csrf)}
              <input type="hidden" name="status" value="no_show"><button class="btn btn-sm btn-ghost" type="submit" title="Mark no-show">NS</button></form>
            <form method="post" action="${ctx.base}/bookings/${attr(b.id)}/status" style="display:inline" onsubmit="return confirm('Cancel this booking?')">${csrfField(ctx.csrf)}
              <input type="hidden" name="status" value="cancelled"><button class="btn btn-sm btn-ghost" type="submit" title="Cancel booking">${icon('x')}</button></form>` : `<span class="mono muted" style="font-size:.68rem">${esc(b.status)}</span>`}
        </td>
      </tr>`).join('')}</tbody></table></div>`
    : emptyState('No bookings on this date', 'Choose another date, or create a booking using the panel.');

  const slotButtons = slots && slots.length
    ? `<div class="slot-grid">${slots.slice(0, 60).map((s) => `<form method="post" action="${ctx.base}/bookings">
        ${csrfField(ctx.csrf)}
        <input type="hidden" name="service_id" value="${attr(form.service_id)}">
        <input type="hidden" name="staff_id" value="${attr(s.staff[0]?.id || '')}">
        <input type="hidden" name="branch_id" value="${attr(branchId || '')}">
        <input type="hidden" name="start_at" value="${attr(s.start)}">
        <input type="hidden" name="name" value="${attr(form.name || '')}">
        <input type="hidden" name="phone" value="${attr(form.phone || '')}">
        <button class="slot" type="submit">${esc(prettyTime(s.start, ctx.business.timezone))}</button>
      </form>`).join('')}</div>`
    : `<p class="muted" style="font-size:.84rem">${esc(slotReason || 'Select a service and date to see available times.')}</p>`;

  const body = `<div class="card">
      <div class="flex between wrap gap">
        <div class="btn-row">
          <a class="btn btn-sm" href="${q(prev)}">← Previous</a>
          <span class="mono" style="padding:.4rem .6rem">${esc(prettyDate(date, ctx.business.timezone))}</span>
          <a class="btn btn-sm" href="${q(next)}">Next →</a>
          <a class="btn btn-sm btn-ghost" href="${ctx.base}/calendar">Today</a>
        </div>
        <form method="get" action="${ctx.base}/calendar" class="btn-row">
          <input type="date" name="date" value="${attr(date)}" aria-label="Date">
          ${branches.length > 1 ? `<select name="branch_id" aria-label="Branch"><option value="">All branches</option>${branches.map((b) => `<option value="${attr(b.id)}" ${branchId === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select>` : ''}
          <button class="btn btn-sm" type="submit">Go</button>
        </form>
      </div>
      <div class="mt2">${rows}</div>
    </div>
    <div class="grid g2 mt3">
      <div class="card">
        <h3>New booking</h3>
        <p class="muted" style="font-size:.82rem">Availability is calculated from service duration, team schedules, breaks, holidays, opening hours and existing bookings. Conflicts are rejected by the backend.</p>
        <form method="get" action="${ctx.base}/calendar" class="mt2">
          <input type="hidden" name="date" value="${attr(date)}">
          <div class="field"><label for="nb-service">Service</label>
            <select id="nb-service" name="service_id" required>
              <option value="">Select a service</option>
              ${services.map((s) => `<option value="${attr(s.id)}" ${form.service_id === s.id ? 'selected' : ''}>${esc(s.name)} · ${esc(money(s.price_cents, s.currency))} · ${esc(minutesToLabel(s.duration_min))}</option>`).join('')}
            </select>
          </div>
          <div class="field-row">
            <div class="field"><label for="nb-staff">Team member</label>
              <select id="nb-staff" name="staff_id"><option value="">Any available</option>${staff.map((s) => `<option value="${attr(s.id)}" ${form.staff_id === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
            </div>
            <div class="field"><label for="nb-name">Customer name</label><input id="nb-name" name="name" value="${attr(form.name || '')}" placeholder="Customer name"></div>
          </div>
          <div class="field"><label for="nb-phone">Phone</label><input id="nb-phone" name="phone" value="${attr(form.phone || '')}" placeholder="07…"></div>
          <button class="btn btn-sm btn-block" type="submit">Show available times</button>
        </form>
      </div>
      <div class="card">
        <h3>Available times</h3>
        <p class="muted" style="font-size:.82rem">${form.service_id ? 'Times below are free for the selected service. Selecting one creates a real booking.' : 'Choose a service to load availability.'}</p>
        <div class="mt2">${slotButtons}</div>
      </div>
    </div>`;

  return shell(ctx, {
    title: 'Calendar', subtitle: 'Availability, bookings and daily operations', active: '/calendar',
    actions: pageActions([['Booking page', `/business/${ctx.business.slug}`, '']]), body, wide: true,
  });
}

/* ───────────────────────────── customers ───────────────────────────── */

export function customersPage(ctx) {
  const { customers, segments, query } = ctx;
  const body = `<div class="grid g3 mt1">
    ${stat('Total customers', String(segments.total ?? ctx.totalCustomers ?? customers.length), '')}
    ${stat('Returning', String(segments.returning || 0), 'more than one booking')}
    ${stat('Marketing consent', String(segments.consented ?? ctx.consented ?? 0), 'may receive campaigns')}
  </div>
  <div class="grid g2 mt3">
    <div class="card">
      <div class="flex between"><h3>Customers</h3><span class="mono muted" style="font-size:.68rem">${customers.length} shown</span></div>
      <form method="get" action="${ctx.base}/customers" class="mt1" style="display:flex;gap:.5rem">
        <input type="search" name="q" value="${attr(query || '')}" placeholder="Search name, phone or email" aria-label="Search customers">
        <button class="btn btn-sm" type="submit">Search</button>
      </form>
      ${customers.length ? `<div class="table-wrap mt2"><table><thead><tr><th>Name</th><th>Contact</th><th>Visits</th><th>Last visit</th><th>Consent</th></tr></thead>
        <tbody>${customers.map((c) => `<tr>
          <td><a href="${ctx.base}/customers/${attr(c.id)}">${esc(c.name)}</a></td>
          <td class="mono" style="font-size:.74rem">${esc(c.phone || '')}${c.email ? `<div class="muted">${esc(c.email)}</div>` : ''}</td>
          <td>${esc(String(c.total_bookings || 0))}</td>
          <td class="muted" style="font-size:.76rem">${c.last_visit_at ? esc(relativeTime(c.last_visit_at)) : '—'}</td>
          <td>${c.marketing_consent ? badge('yes', 'ok') : badge('no', 'plain')}</td>
        </tr>`).join('')}</tbody></table></div>` : emptyState('No customers yet', 'Customers are created when you take a booking or add one manually.')}
    </div>
    <div class="card">
      <h3>Add a customer</h3>
      <p class="muted" style="font-size:.82rem">Records are tenant-scoped and deduplicated by phone within this business.</p>
      <form method="post" action="${ctx.base}/customers" class="mt2">
        ${csrfField(ctx.csrf)}
        <div class="field"><label for="c-name">Full name</label><input id="c-name" name="name" required></div>
        <div class="field-row">
          <div class="field"><label for="c-phone">Phone</label><input id="c-phone" name="phone" placeholder="07…"></div>
          <div class="field"><label for="c-email">Email</label><input id="c-email" name="email" type="email"></div>
        </div>
        <div class="field-row">
          <div class="field"><label for="c-birthday">Birthday</label><input id="c-birthday" name="birthday" type="date"></div>
          <div class="field"><label for="c-tags">Tags</label><input id="c-tags" name="tags" placeholder="vip, referral"></div>
        </div>
        <label class="check"><input type="checkbox" name="consent" value="1"> Customer consented to marketing messages</label>
        <button class="btn btn-primary btn-block mt2" type="submit">Create customer</button>
      </form>
      <div class="hr"></div>
      <h4>Segments</h4>
      <div class="grid g2" style="gap:.4rem;font-size:.8rem">
        ${[['New (30 days)', segments.new], ['Returning', segments.returning], ['VIP', segments.vip], ['Inactive 60d', segments.inactive], ['Birthday today', segments.birthdayToday], ['No consent', segments.noConsent]]
          .map(([label, value]) => `<div class="flex between"><span class="muted">${esc(label)}</span><span class="mono">${esc(String(value ?? 0))}</span></div>`).join('')}
      </div>
    </div>
  </div>`;
  return shell(ctx, { title: 'Customers', subtitle: 'CRM, consent and customer intelligence', active: '/customers', body, wide: true });
}

export function customerPage(ctx) {
  const { customer, bookings, conversations, invoices, notes } = ctx;
  const body = `<div class="grid g3">
    ${stat('Total bookings', String(customer.total_bookings || 0), '')}
    ${stat('Lifetime value', money(customer.lifetime_value_cents || 0, ctx.business.currency), 'completed bookings only')}
    ${stat('Last visit', customer.last_visit_at ? relativeTime(customer.last_visit_at) : '—', customer.next_appointment_at ? `next ${prettyDate(String(customer.next_appointment_at).slice(0, 10))}` : 'no upcoming')}
  </div>
  <div class="grid g2 mt3">
    <div class="card">
      <div class="flex between"><h3>${esc(customer.name)}</h3>${customer.marketing_consent ? badge('Marketing consent', 'ok') : badge('No marketing consent', 'warn')}</div>
      <dl class="kv mt2">
        <dt>Phone</dt><dd>${esc(customer.phone || '—')}</dd>
        <dt>Email</dt><dd>${esc(customer.email || '—')}</dd>
        <dt>Birthday</dt><dd>${esc(customer.birthday || '—')}</dd>
        <dt>Tags</dt><dd>${esc(ctx.tags.join(', ') || '—')}</dd>
        <dt>Created</dt><dd>${esc(prettyDate(String(customer.created_at).slice(0, 10)))}</dd>
      </dl>
      <div class="hr"></div>
      <h4>Preferences & notes</h4>
      <form method="post" action="${ctx.base}/customers/${attr(customer.id)}">
        ${csrfField(ctx.csrf)}
        <div class="field"><label for="cp-pref">Preferences</label><input id="cp-pref" name="preferences" value="${attr(customer.preferences || '')}" placeholder="e.g. prefers evening slots"></div>
        <div class="field"><label for="cp-tags">Tags</label><input id="cp-tags" name="tags" value="${attr(ctx.tags.join(', '))}" placeholder="vip, referral"></div>
        <div class="field"><label for="cp-notes">Internal notes</label><textarea id="cp-notes" name="notes" rows="3">${esc(customer.notes || '')}</textarea></div>
        <label class="check"><input type="checkbox" name="consent" value="1" ${customer.marketing_consent ? 'checked' : ''}> Marketing consent recorded</label>
        <button class="btn btn-sm btn-primary mt2" type="submit">Save changes</button>
      </form>
    </div>
    <div>
      <div class="card">
        <h3>Booking history</h3>
        ${bookings.length ? `<div class="list-rows mt1">${bookings.map((b) => `<div class="row"><div><strong>${esc(b.service_name || 'Service')}</strong><div class="muted" style="font-size:.76rem">${esc(prettyDate(String(b.start_at).slice(0, 10)))} · ${esc(prettyTime(b.start_at, ctx.business.timezone))} · ${esc(b.staff_name || '')}</div></div><div class="right">${statusBadge(b.status)}<div class="mono" style="font-size:.72rem">${moneyCell(b.price_cents, b.currency)}</div></div></div>`).join('')}</div>` : '<p class="muted mt1" style="font-size:.84rem">No bookings recorded for this customer.</p>'}
      </div>
      <div class="card mt2">
        <h3>Conversations</h3>
        ${conversations.length ? `<div class="list-rows mt1">${conversations.map((c) => `<div class="row"><div><strong>${esc(c.channel)}</strong><div class="muted" style="font-size:.76rem">${esc(c.contact_ref)}</div></div><div class="right"><a class="btn btn-sm btn-ghost" href="${ctx.base}/conversations/${attr(c.id)}">Open</a></div></div>`).join('')}</div>` : '<p class="muted mt1" style="font-size:.84rem">No conversations yet.</p>'}
      </div>
      <div class="card mt2">
        <h3>Invoices</h3>
        ${invoices.length ? `<div class="list-rows mt1">${invoices.map((i) => `<div class="row"><div><strong>${esc(i.number)}</strong><div class="muted" style="font-size:.76rem">${esc(prettyDate(i.issued_on))}</div></div><div class="right">${moneyCell(i.total_cents, i.currency)}<div>${statusBadge(i.status)}</div></div></div>`).join('')}</div>` : '<p class="muted mt1" style="font-size:.84rem">No invoices recorded.</p>'}
      </div>
      ${notes ? `<div class="card mt2"><h3>Audit history</h3><div class="list-rows mt1">${notes.map((n) => `<div class="row"><div><strong style="font-size:.84rem">${esc(n.action)}</strong><div class="muted" style="font-size:.74rem">${esc(n.actor_label)} · ${esc(n.result)}</div></div><div class="right mono" style="font-size:.72rem">${esc(relativeTime(n.created_at))}</div></div>`).join('')}</div></div>` : ''}
    </div>
  </div>`;
  return shell(ctx, {
    title: customer.name, subtitle: 'Customer profile, history and consent', active: '/customers',
    actions: pageActions([['Back to customers', `${ctx.base}/customers`], ['New booking', `${ctx.base}/calendar`, 'btn-primary']]), body, wide: true,
  });
}

/* ───────────────────────────── services ───────────────────────────── */

export function servicesPage(ctx) {
  const { services } = ctx;
  const body = `<div class="grid g2">
    <div class="card">
      <h3>Services & pricing</h3>
      ${services.length ? `<div class="table-wrap mt2"><table><thead><tr><th>Service</th><th>Duration</th><th>Price</th><th>Bookings</th><th>Status</th><th></th></tr></thead>
        <tbody>${services.map((s) => `<tr>
          <td><strong>${esc(s.name)}</strong>${s.description ? `<div class="muted" style="font-size:.74rem">${esc(s.description)}</div>` : ''}</td>
          <td class="mono" style="font-size:.76rem">${esc(minutesToLabel(s.duration_min))}${s.buffer_min ? ` +${s.buffer_min}m` : ''}</td>
          <td>${moneyCell(s.price_cents, s.currency)}</td>
          <td>${esc(String(s.bookings ?? 0))}</td>
          <td>${s.is_active ? badge('active', 'ok') : badge('inactive', 'plain')}</td>
          <td class="right" style="white-space:nowrap">
            <form method="post" action="${ctx.base}/services/${attr(s.id)}/toggle" style="display:inline">${csrfField(ctx.csrf)}<button class="btn btn-sm btn-ghost" type="submit">${s.is_active ? 'Deactivate' : 'Activate'}</button></form>
          </td>
        </tr>`).join('')}</tbody></table></div>` : emptyState('No services yet', 'Add the services customers can book.')}
    </div>
    <div class="card">
      <h3>Add a service</h3>
      <form method="post" action="${ctx.base}/services" class="mt2">
        ${csrfField(ctx.csrf)}
        <div class="field"><label for="s-name">Name</label><input id="s-name" name="name" required placeholder="e.g. Signature haircut"></div>
        <div class="field"><label for="s-desc">Description</label><textarea id="s-desc" name="description" rows="2"></textarea></div>
        <div class="field-row">
          <div class="field"><label for="s-dur">Duration (minutes)</label><input id="s-dur" name="duration_min" type="number" min="5" max="480" value="30" required></div>
          <div class="field"><label for="s-buf">Buffer (minutes)</label><input id="s-buf" name="buffer_min" type="number" min="0" max="120" value="0"></div>
        </div>
        <div class="field-row">
          <div class="field"><label for="s-price">Price</label><input id="s-price" name="price" placeholder="1500" required></div>
          <div class="field"><label for="s-cat">Category</label><input id="s-cat" name="category" placeholder="Hair"></div>
        </div>
        <button class="btn btn-primary btn-block" type="submit">Create service</button>
      </form>
      <p class="hint">Prices are stored in the smallest currency unit after parsing. Duration and buffer determine slot length.</p>
    </div>
  </div>`;
  return shell(ctx, { title: 'Services', subtitle: 'Catalogue, duration and pricing', active: '/services', body, wide: true });
}

/* ───────────────────────────── staff ───────────────────────────── */

export function staffPage(ctx) {
  const { staff, services, branches, schedules } = ctx;
  const body = `<div class="grid g2">
    <div class="card">
      <h3>Team</h3>
      ${staff.length ? `<div class="table-wrap mt2"><table><thead><tr><th>Name</th><th>Title</th><th>Branch</th><th>Bookings</th><th>Status</th></tr></thead>
        <tbody>${staff.map((s) => `<tr>
          <td><strong>${esc(s.name)}</strong><div class="muted" style="font-size:.74rem">${esc(s.email || s.phone || '')}</div></td>
          <td>${esc(s.title || '—')}</td>
          <td>${esc(s.branch_name || 'All')}</td>
          <td>${esc(String(s.bookings ?? 0))}</td>
          <td>${s.is_active ? badge('active', 'ok') : badge('inactive', 'plain')}</td>
        </tr>`).join('')}</tbody></table></div>` : emptyState('No team members yet', 'Add staff so bookings can be assigned.')}
      <div class="hr"></div>
      <h4>Weekly schedules</h4>
      <p class="muted" style="font-size:.8rem">Availability requires a schedule row per working day. Missing days are treated as non-working.</p>
      ${schedules && schedules.length ? `<div class="table-wrap mt2"><table><thead><tr><th>Member</th><th>Day</th><th>Hours</th></tr></thead><tbody>${schedules.slice(0, 40).map((s) => `<tr><td>${esc(s.staff_name)}</td><td>${esc(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][s.weekday] || s.weekday)}</td><td class="mono">${esc(minutesToLabel(s.start_min))}–${esc(minutesToLabel(s.end_min))}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted mt1" style="font-size:.84rem">No schedule rows recorded.</p>'}
    </div>
    <div class="card">
      <h3>Add a team member</h3>
      <form method="post" action="${ctx.base}/staff" class="mt2">
        ${csrfField(ctx.csrf)}
        <div class="field"><label for="t-name">Full name</label><input id="t-name" name="name" required></div>
        <div class="field-row">
          <div class="field"><label for="t-title">Title</label><input id="t-title" name="title" placeholder="Stylist"></div>
          <div class="field"><label for="t-branch">Branch</label>
            <select id="t-branch" name="branch_id"><option value="">All branches</option>${branches.map((b) => `<option value="${attr(b.id)}">${esc(b.name)}</option>`).join('')}</select>
          </div>
        </div>
        <div class="field-row">
          <div class="field"><label for="t-email">Email</label><input id="t-email" name="email" type="email"></div>
          <div class="field"><label for="t-phone">Phone</label><input id="t-phone" name="phone"></div>
        </div>
        <div class="field"><label>Services offered</label>
          <div class="check-grid">${services.map((s) => `<label class="check"><input type="checkbox" name="services" value="${attr(s.id)}"> ${esc(s.name)}</label>`).join('') || '<span class="muted" style="font-size:.8rem">Add services first.</span>'}</div>
        </div>
        <div class="field"><label>Working days (09:00–17:00 default)</label>
          <div class="check-grid">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => `<label class="check"><input type="checkbox" name="days" value="${(i + 1) % 7}" ${i < 5 ? 'checked' : ''}> ${d}</label>`).join('')}</div>
        </div>
        <button class="btn btn-primary btn-block" type="submit">Add team member</button>
      </form>
    </div>
  </div>`;
  return shell(ctx, { title: 'Team', subtitle: 'Staff, schedules and service assignment', active: '/staff', body, wide: true });
}

/* ───────────────────────────── branches ───────────────────────────── */

export function branchesPage(ctx) {
  const { branches, comparison } = ctx;
  const body = `<div class="grid g2">
    <div class="card">
      <h3>Branches</h3>
      ${branches.length ? `<div class="table-wrap mt2"><table><thead><tr><th>Branch</th><th>Location</th><th>Bookings (30d)</th><th>Value</th><th>Status</th></tr></thead>
        <tbody>${branches.map((b) => {
          const row = comparison.find((c) => c.id === b.id) || {};
          return `<tr><td><strong>${esc(b.name)}</strong>${b.is_primary ? ` ${badge('primary', 'info')}` : ''}</td>
            <td class="muted" style="font-size:.78rem">${esc([b.address, b.city].filter(Boolean).join(', ') || '—')}</td>
            <td>${esc(String(row.bookings ?? 0))}</td><td>${moneyCell(row.value_cents || 0, ctx.business.currency)}</td>
            <td>${b.is_active ? badge('active', 'ok') : badge('inactive', 'plain')}</td></tr>`;
        }).join('')}</tbody></table></div>` : emptyState('No branches yet', 'Add a branch to take bookings.')}
    </div>
    <div class="card">
      <h3>Add a branch</h3>
      <form method="post" action="${ctx.base}/branches" class="mt2">
        ${csrfField(ctx.csrf)}
        <div class="field"><label for="b-name">Branch name</label><input id="b-name" name="name" required></div>
        <div class="field"><label for="b-address">Address</label><input id="b-address" name="address"></div>
        <div class="field-row">
          <div class="field"><label for="b-city">City</label><input id="b-city" name="city" value="${attr(ctx.business.city || '')}"></div>
          <div class="field"><label for="b-phone">Phone</label><input id="b-phone" name="phone"></div>
        </div>
        <div class="field-row">
          <div class="field"><label for="b-open">Opens</label><input id="b-open" name="opens" type="time" value="09:00"></div>
          <div class="field"><label for="b-close">Closes</label><input id="b-close" name="closes" type="time" value="18:00"></div>
        </div>
        <p class="hint">Opening hours are written for every weekday. Adjust individual days afterwards in settings.</p>
        <button class="btn btn-primary btn-block" type="submit">Create branch</button>
      </form>
    </div>
  </div>`;
  return shell(ctx, { title: 'Branches', subtitle: 'Locations and consolidated performance', active: '/branches', body, wide: true });
}

/* ───────────────────────────── finance ───────────────────────────── */

export function financePage(ctx) {
  const { summary, invoices, expenses, payments, canManage } = ctx;
  const body = `<div class="grid g4">
    ${stat('Confirmed revenue', money(summary.confirmedCents, ctx.business.currency), `${summary.confirmedCount} provider-confirmed payments`)}
    ${stat('Outstanding invoices', money(summary.invoiceOutstandingCents, ctx.business.currency), 'unpaid or partial')}
    ${stat('Expenses', money(summary.expensesCents, ctx.business.currency), `last ${summary.days} days`)}
    ${stat('Net', money(summary.netCents, ctx.business.currency), 'confirmed revenue minus expenses')}
  </div>
  ${summary.pendingCount ? `<div class="banner mt2"><div><strong>${summary.pendingCount} payment(s) pending</strong><span>${money(summary.pendingCents, ctx.business.currency)} awaiting provider confirmation.</span></div></div>` : ''}
  <div class="grid g2 mt3">
    <div class="card">
      <h3>Invoices</h3>
      ${invoices.length ? `<div class="table-wrap mt2"><table><thead><tr><th>Number</th><th>Customer</th><th>Issued</th><th>Total</th><th>Status</th><th></th></tr></thead>
        <tbody>${invoices.map((i) => `<tr><td class="mono" style="font-size:.74rem">${esc(i.number)}</td><td>${esc(i.customer_name || '—')}</td>
          <td class="muted" style="font-size:.76rem">${esc(prettyDate(i.issued_on))}</td><td>${moneyCell(i.total_cents, i.currency)}</td><td>${statusBadge(i.status)}</td>
          <td class="right">${i.status !== 'paid' && canManage ? `<form method="post" action="${ctx.base}/finance/invoices/${attr(i.id)}/paid" style="display:inline">${csrfField(ctx.csrf)}<button class="btn btn-sm btn-ghost" type="submit">Mark paid</button></form>` : ''}</td></tr>`).join('')}</tbody></table></div>` : emptyState('No invoices yet', 'Create an invoice for a customer or booking.')}
      ${canManage ? `<form method="post" action="${ctx.base}/finance/invoices" class="mt3">
        ${csrfField(ctx.csrf)}
        <h4>New invoice</h4>
        <div class="field-row">
          <div class="field"><label for="i-cust">Customer</label><select id="i-cust" name="customer_id"><option value="">No customer</option>${ctx.customers.map((c) => `<option value="${attr(c.id)}">${esc(c.name)}</option>`).join('')}</select></div>
          <div class="field"><label for="i-amount">Amount</label><input id="i-amount" name="amount" required placeholder="2500"></div>
        </div>
        <div class="field"><label for="i-desc">Description</label><input id="i-desc" name="description" placeholder="Service package"></div>
        <button class="btn btn-sm btn-primary" type="submit">Issue invoice</button>
        <p class="hint">Invoices are recorded as unpaid until a verified payment event marks them paid.</p>
      </form>` : ''}
    </div>
    <div>
      <div class="card">
        <h3>Payments</h3>
        ${payments.length ? `<div class="table-wrap mt2"><table><thead><tr><th>Provider</th><th>Amount</th><th>Status</th><th>When</th></tr></thead>
          <tbody>${payments.map((p) => `<tr><td>${esc(p.provider)}</td><td>${moneyCell(p.amount_cents, p.currency)}</td><td>${statusBadge(p.status)}</td><td class="muted" style="font-size:.74rem">${esc(relativeTime(p.created_at))}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted mt1" style="font-size:.84rem">No payments recorded. Payments appear only from verified provider events or manual records you create.</p>'}
      </div>
      <div class="card mt2">
        <h3>Expenses</h3>
        ${expenses.length ? `<div class="table-wrap mt2"><table><thead><tr><th>Date</th><th>Category</th><th>Amount</th></tr></thead>
          <tbody>${expenses.map((e) => `<tr><td class="muted" style="font-size:.76rem">${esc(e.incurred_on)}</td><td>${esc(e.category || 'General')}</td><td>${moneyCell(e.amount_cents, e.currency)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted mt1" style="font-size:.84rem">No expenses recorded.</p>'}
        ${canManage ? `<form method="post" action="${ctx.base}/finance/expenses" class="mt3">
          ${csrfField(ctx.csrf)}
          <div class="field-row">
            <div class="field"><label for="e-amount">Amount</label><input id="e-amount" name="amount" required></div>
            <div class="field"><label for="e-date">Date</label><input id="e-date" name="incurred_on" type="date" value="${esc(isoDate(new Date()))}"></div>
          </div>
          <div class="field"><label for="e-cat">Category</label><input id="e-cat" name="category" placeholder="Supplies"></div>
          <div class="field"><label for="e-note">Note</label><input id="e-note" name="note"></div>
          <button class="btn btn-sm" type="submit">Record expense</button>
        </form>` : ''}
      </div>
    </div>
  </div>`;
  return shell(ctx, { title: 'Finance', subtitle: 'Invoices, payments, expenses and reconciliation', active: '/finance', body, wide: true });
}

/* ───────────────────────────── documents ───────────────────────────── */

export function documentsPage(ctx) {
  const { documents } = ctx;
  const body = `<div class="grid g2">
    <div class="card">
      <h3>Documents</h3>
      <p class="muted" style="font-size:.82rem">Files are stored outside the public directory and served only through an authorised route. Maximum 8 MB.</p>
      ${documents.length ? `<div class="table-wrap mt2"><table><thead><tr><th>Name</th><th>Category</th><th>Size</th><th>Uploaded</th><th></th></tr></thead>
        <tbody>${documents.map((d) => `<tr><td><strong style="font-size:.86rem">${esc(d.name)}</strong></td><td>${esc(d.category || '—')}</td>
          <td class="mono" style="font-size:.72rem">${esc(fmtSize(d.size_bytes))}</td><td class="muted" style="font-size:.74rem">${esc(relativeTime(d.created_at))}</td>
          <td class="right" style="white-space:nowrap"><a class="btn btn-sm btn-ghost" href="${ctx.base}/documents/${attr(d.id)}/download">Download</a>
          <form method="post" action="${ctx.base}/documents/${attr(d.id)}/delete" style="display:inline" onsubmit="return confirm('Delete this document?')">${csrfField(ctx.csrf)}<button class="btn btn-sm btn-ghost" type="submit">Delete</button></form></td></tr>`).join('')}</tbody></table></div>` : emptyState('No documents yet', 'Upload policies, price lists, forms or clinical documents.')}
    </div>
    <div class="card">
      <h3>Upload</h3>
      <form id="doc-form" class="mt2">
        <div class="field"><label for="d-name">Document name</label><input id="d-name" name="name" required placeholder="Price list 2026"></div>
        <div class="field"><label for="d-cat">Category</label><input id="d-cat" name="category" placeholder="Policy"></div>
        <div class="field"><label for="d-file">File</label><input id="d-file" name="file" type="file" required></div>
        <button class="btn btn-primary btn-block" type="submit">Upload document</button>
        <p class="hint" id="doc-status">Uploads are validated server-side for type and size.</p>
      </form>
      <script>
      document.getElementById('doc-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const status = document.getElementById('doc-status');
        const file = document.getElementById('d-file').files[0];
        if (!file) { status.textContent = 'Choose a file first.'; return; }
        if (file.size > 8 * 1024 * 1024) { status.textContent = 'File exceeds the 8 MB limit.'; return; }
        status.textContent = 'Uploading…';
        const buf = await file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = '';
        for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
        const res = await fetch('${ctx.base}/documents', {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf': '${esc(ctx.csrf)}' },
          body: JSON.stringify({ name: document.getElementById('d-name').value, category: document.getElementById('d-cat').value, mime: file.type, data: btoa(binary) }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) { location.href = '${ctx.base}/documents?uploaded=1'; }
        else { status.textContent = data.error || 'Upload failed.'; }
      });
      </script>
    </div>
  </div>`;
  return shell(ctx, { title: 'Documents', subtitle: 'Secure file management', active: '/documents', body, wide: true });
}

function fmtSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/* ───────────────────────────── notifications ───────────────────────────── */

export function notificationsPage(ctx) {
  const { items } = ctx;
  const body = `<div class="card">
    <h3>Notifications</h3>
    <p class="muted" style="font-size:.82rem">Every row reflects a real event. Delivery status comes from the provider response, not from the queue request.</p>
    ${items.length ? `<div class="table-wrap mt2"><table><thead><tr><th>When</th><th>Channel</th><th>Template</th><th>Status</th><th>Detail</th></tr></thead>
      <tbody>${items.map((n) => `<tr><td class="muted" style="font-size:.74rem">${esc(relativeTime(n.created_at))}</td><td>${esc(n.channel)}</td><td>${esc(n.template)}</td>
        <td>${statusBadge(n.status)}</td><td class="muted" style="font-size:.74rem">${esc(n.error || (n.sent_at ? `sent ${relativeTime(n.sent_at)}` : 'queued'))}</td></tr>`).join('')}</tbody></table></div>` : emptyState('No notifications', 'Booking confirmations and reminders will appear here once generated.')}
  </div>`;
  return shell(ctx, { title: 'Notifications', subtitle: 'Delivery queue and provider results', active: '/notifications', body });
}

/* ───────────────────────────── search ───────────────────────────── */

export function searchPage(ctx) {
  const { results, query } = ctx;
  const grouped = results.reduce((acc, r) => { (acc[r.type] = acc[r.type] || []).push(r); return acc; }, {});
  const body = `<div class="card">
    <form method="get" action="${ctx.base}/search" style="display:flex;gap:.5rem">
      <input type="search" name="q" value="${attr(query)}" placeholder="Search customers, bookings, invoices, documents" aria-label="Search">
      <button class="btn btn-sm btn-primary" type="submit">Search</button>
    </form>
    ${query.length < 2 ? '<p class="muted mt2" style="font-size:.86rem">Enter at least two characters. Results respect your role permissions.</p>'
      : results.length ? Object.entries(grouped).map(([type, rows]) => `<div class="mt3"><div class="mono muted" style="font-size:.66rem;letter-spacing:.14em">${esc(type.toUpperCase())}</div>
        <div class="list-rows mt1">${rows.map((r) => `<a class="row" href="${attr(r.href)}"><div><strong>${esc(r.label)}</strong><div class="muted" style="font-size:.76rem">${esc(r.detail || '')}</div></div><span>${icon('arrow')}</span></a>`).join('')}</div></div>`).join('')
        : emptyState('No matches', `Nothing matched “${query}” in records you can access.`)}
  </div>`;
  return shell(ctx, { title: 'Search', subtitle: 'Authorised results only', active: '/search', body, showSearch: false });
}

/* ───────────────────────────── support ───────────────────────────── */

export function supportPage(ctx) {
  const { tickets } = ctx;
  const body = `<div class="grid g2">
    <div class="card">
      <h3>Support tickets</h3>
      ${tickets.length ? `<div class="list-rows mt2">${tickets.map((t) => `<a class="row" href="${ctx.base}/support/${attr(t.id)}">
        <div><strong>${esc(t.subject)}</strong><div class="muted" style="font-size:.76rem">${esc(t.category || 'general')} · ${esc(relativeTime(t.created_at))}</div></div>
        <div class="right">${statusBadge(t.status)}</div></a>`).join('')}</div>` : emptyState('No tickets', 'Open a ticket and the MAVYRON team will respond.')}
    </div>
    <div class="card">
      <h3>Open a ticket</h3>
      <form method="post" action="${ctx.base}/support" class="mt2">
        ${csrfField(ctx.csrf)}
        <div class="field"><label for="t-subject">Subject</label><input id="t-subject" name="subject" required></div>
        <div class="field"><label for="t-cat">Category</label>
          <select id="t-cat" name="category"><option value="general">General</option><option value="billing">Billing</option><option value="integration">Integration</option><option value="booking">Bookings</option><option value="ai">AI</option><option value="technical">Technical</option></select>
        </div>
        <div class="field"><label for="t-body">Describe the issue</label><textarea id="t-body" name="body" rows="4" required></textarea></div>
        <button class="btn btn-primary btn-block" type="submit">Create ticket</button>
      </form>
      <div class="hr"></div>
      <h4>Help centre</h4>
      <ul class="feature-list">
        <li>Booking engine: availability, buffers and conflict rules</li>
        <li>Integrations: required credentials per provider</li>
        <li>AI: grounding, escalation and usage</li>
        <li>Billing: trial, activation and plan limits</li>
      </ul>
      <a class="btn btn-sm mt2" href="/status">System status</a>
    </div>
  </div>`;
  return shell(ctx, { title: 'Support', subtitle: 'Tickets and platform guidance', active: '/support', body, wide: true });
}

export function ticketPage(ctx) {
  const { ticket, messages } = ctx;
  const body = `<div class="card">
    <div class="flex between"><h3>${esc(ticket.subject)}</h3>${statusBadge(ticket.status)}</div>
    <p class="muted" style="font-size:.8rem">${esc(ticket.category || 'general')} · opened ${esc(relativeTime(ticket.created_at))}</p>
    <div class="thread mt2">
      ${messages.map((m) => `<div class="msg ${m.author_role === 'customer' ? 'in' : 'out'}"><div class="mono" style="font-size:.64rem">${esc(m.author_label || m.author_role)} · ${esc(relativeTime(m.created_at))}</div><div>${esc(m.body)}</div></div>`).join('')}
    </div>
    <form method="post" action="${ctx.base}/support/${attr(ticket.id)}" class="mt2">
      ${csrfField(ctx.csrf)}
      <div class="field"><label for="tm-body">Reply</label><textarea id="tm-body" name="body" rows="3" required></textarea></div>
      <button class="btn btn-primary" type="submit">Send reply</button>
    </form>
  </div>`;
  return shell(ctx, { title: 'Ticket', subtitle: ticket.subject, active: '/support', actions: pageActions([['Back to support', `${ctx.base}/support`]]), body });
}
