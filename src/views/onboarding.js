import { esc, attr, money, minutesToLabel, labelToMinutes } from '../lib/util.js';
import { appPage, badge, csrfField, emptyState, icon } from './layout.js';

export const STEPS = [
  { key: 'business', title: 'Business', label: 'Name & type' },
  { key: 'location', title: 'Location', label: 'Where you operate' },
  { key: 'branches', title: 'Branches', label: 'Locations' },
  { key: 'hours', title: 'Opening hours', label: 'When you open' },
  { key: 'services', title: 'Services', label: 'What you offer' },
  { key: 'prices', title: 'Prices', label: 'What you charge' },
  { key: 'staff', title: 'Team', label: 'Who delivers' },
  { key: 'rules', title: 'Booking rules', label: 'How booking works' },
  { key: 'ai', title: 'AI personality', label: 'How AI speaks' },
  { key: 'knowledge', title: 'Knowledge', label: 'What AI knows' },
  { key: 'whatsapp', title: 'WhatsApp', label: 'Messaging' },
  { key: 'social', title: 'Social', label: 'Channels' },
  { key: 'payments', title: 'Payments', label: 'Getting paid' },
  { key: 'launch', title: 'Launch', label: 'Go live' },
];

export const INDUSTRIES = [
  ['salon', 'Salon'], ['barbershop', 'Barbershop'], ['spa', 'Spa & wellness'],
  ['clinic', 'Clinic'], ['dental', 'Dental clinic'], ['medical_centre', 'Medical centre'],
  ['hospital', 'Hospital'], ['restaurant', 'Restaurant'], ['hotel', 'Hotel'],
  ['gym', 'Gym & fitness'], ['retail', 'Retail'], ['professional_services', 'Professional services'],
  ['rentals', 'Rentals'], ['other', 'Other service business'],
];

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function stepper(current) {
  return `<ol class="stepper">${STEPS.map((s, i) => {
    const state = i < current ? 'done' : i === current ? 'current' : '';
    return `<li class="${state}"><span class="dot">${i < current ? '✓' : i + 1}</span><em>${esc(s.label)}</em></li>`;
  }).join('')}</ol>`;
}

function progressBar(current) {
  const pct = Math.round((current / STEPS.length) * 100);
  return `<div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>`;
}

/* ── individual step bodies ── */

function stepBusiness(ctx) {
  const b = ctx.business;
  return `<form method="post" action="${ctx.base}/onboarding/1">
    ${csrfField(ctx.csrf)}
    <div class="field"><label for="ob-name">Business name</label><input id="ob-name" name="name" value="${attr(b.name || '')}" required placeholder="Serene Studio"></div>
    <div class="field"><label for="ob-industry">Business type</label>
      <select id="ob-industry" name="industry" required>${INDUSTRIES.map(([v, l]) => `<option value="${attr(v)}" ${b.industry === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
      <p class="hint">Industry determines the modules and booking rules that apply to your workspace.</p></div>
    <div class="field"><label for="ob-desc">Short description</label><textarea id="ob-desc" name="description" rows="3" placeholder="What your business does">${esc(b.description || '')}</textarea></div>
    <div class="field-row">
      <div class="field"><label for="ob-phone">Business phone</label><input id="ob-phone" name="phone" value="${attr(b.phone || '')}"></div>
      <div class="field"><label for="ob-wa">WhatsApp number</label><input id="ob-wa" name="whatsapp" value="${attr(b.whatsapp || '')}"></div>
    </div>
    <div class="field"><label for="ob-email">Business email</label><input id="ob-email" name="email" type="email" value="${attr(b.email || '')}"></div>
    <button class="btn btn-primary" type="submit">Continue</button>
  </form>`;
}

function stepLocation(ctx) {
  const b = ctx.business;
  return `<form method="post" action="${ctx.base}/onboarding/2">
    ${csrfField(ctx.csrf)}
    <div class="field"><label for="ob-address">Street address</label><input id="ob-address" name="address" value="${attr(b.address || '')}" placeholder="Kimathi Street, CBD"></div>
    <div class="field-row">
      <div class="field"><label for="ob-city">City</label><input id="ob-city" name="city" value="${attr(b.city || '')}" placeholder="Nairobi"></div>
      <div class="field"><label for="ob-country">Country</label><input id="ob-country" name="country" value="${attr(b.country || 'Kenya')}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label for="ob-tz">Timezone</label><input id="ob-tz" name="timezone" value="${attr(b.timezone || 'Africa/Nairobi')}"></div>
      <div class="field"><label for="ob-currency">Currency</label><input id="ob-currency" name="currency" value="${attr(b.currency || 'KES')}" maxlength="3"></div>
    </div>
    <button class="btn btn-primary" type="submit">Continue</button>
  </form>`;
}

function stepBranches(ctx) {
  const rows = ctx.branches.map((br) => `<tr><td><strong>${esc(br.name)}</strong>${br.is_primary ? ' ' + badge('primary', 'info') : ''}</td>
      <td class="muted" style="font-size:.78rem">${esc([br.address, br.city].filter(Boolean).join(', ') || '—')}</td>
      <td class="mono" style="font-size:.72rem">${esc(br.phone || '—')}</td></tr>`).join('');
  return `<p class="muted" style="font-size:.86rem">Every branch has its own hours, staff, services and bookings. The primary branch is created with your business.</p>
    ${ctx.branches.length ? `<div class="table-wrap mt2"><table><thead><tr><th>Branch</th><th>Address</th><th>Phone</th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}
    <form method="post" action="${ctx.base}/onboarding/3" class="mt3">
      ${csrfField(ctx.csrf)}
      <h4>Add another branch</h4>
      <div class="field-row">
        <div class="field"><label for="br-name">Branch name</label><input id="br-name" name="name" placeholder="Westlands"></div>
        <div class="field"><label for="br-phone">Phone</label><input id="br-phone" name="phone"></div>
      </div>
      <div class="field-row">
        <div class="field"><label for="br-address">Address</label><input id="br-address" name="address"></div>
        <div class="field"><label for="br-city">City</label><input id="br-city" name="city"></div>
      </div>
      <div class="btn-row"><button class="btn" type="submit">Add branch</button>
      <button class="btn btn-primary" type="submit" formaction="${ctx.base}/onboarding/3/continue">Continue</button></div>
    </form>`;
}

function stepHours(ctx) {
  const hours = ctx.hours || {};
  const rows = DAYS.map((label, wd) => {
    const h = hours[wd] || { open_min: 540, close_min: 1080, is_closed: wd === 0 ? 1 : 0 };
    return `<tr>
      <td>${esc(label)}</td>
      <td><input name="open_${wd}" value="${attr(minutesToLabel(h.open_min ?? 540))}" placeholder="09:00" style="max-width:110px"></td>
      <td><input name="close_${wd}" value="${attr(minutesToLabel(h.close_min ?? 1080))}" placeholder="18:00" style="max-width:110px"></td>
      <td><label class="check"><input type="checkbox" name="closed_${wd}" value="1" ${h.is_closed ? 'checked' : ''}> Closed</label></td>
    </tr>`;
  }).join('');
  return `<form method="post" action="${ctx.base}/onboarding/4">
    ${csrfField(ctx.csrf)}
    <p class="muted" style="font-size:.86rem">These hours apply to ${esc(ctx.branches[0]?.name || 'your primary branch')} and drive available booking slots.</p>
    <div class="table-wrap mt2"><table><thead><tr><th>Day</th><th>Opens</th><th>Closes</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    <button class="btn btn-primary mt2" type="submit">Save hours</button>
  </form>`;
}

function stepServices(ctx) {
  const list = ctx.services.length ? `<div class="table-wrap mt2"><table><thead><tr><th>Service</th><th>Duration</th><th>Price</th><th></th></tr></thead>
    <tbody>${ctx.services.map((s) => `<tr><td><strong>${esc(s.name)}</strong></td><td>${esc(minutesToLabel(s.duration_min))}</td><td>${money(s.price_cents, s.currency)}</td>
      <td class="right"><form method="post" action="${ctx.base}/onboarding/5/${attr(s.id)}/delete">${csrfField(ctx.csrf)}<button class="btn btn-sm btn-ghost" type="submit">Remove</button></form></td></tr>`).join('')}</tbody></table></div>`
    : emptyState('No services yet', 'Add the services customers can book.');
  return `${list}
    <form method="post" action="${ctx.base}/onboarding/5" class="mt3">
      ${csrfField(ctx.csrf)}
      <h4>Add a service</h4>
      <div class="field"><label for="sv-name">Service name</label><input id="sv-name" name="name" required placeholder="Signature facial"></div>
      <div class="field-row">
        <div class="field"><label for="sv-dur">Duration (minutes)</label><input id="sv-dur" name="duration_min" type="number" min="5" step="5" value="60" required></div>
        <div class="field"><label for="sv-price">Price</label><input id="sv-price" name="price" placeholder="3500" required></div>
      </div>
      <div class="field"><label for="sv-cat">Category</label><input id="sv-cat" name="category" placeholder="Facials"></div>
      <div class="btn-row"><button class="btn" type="submit">Add service</button>
      <button class="btn btn-primary" type="submit" formaction="${ctx.base}/onboarding/5/continue">Continue</button></div>
    </form>`;
}

function stepPrices(ctx) {
  return `<form method="post" action="${ctx.base}/onboarding/6">
    ${csrfField(ctx.csrf)}
    <p class="muted" style="font-size:.86rem">Confirm pricing. These amounts are what customers see and what bookings record.</p>
    ${ctx.services.length ? `<div class="table-wrap mt2"><table><thead><tr><th>Service</th><th>Duration</th><th>Price</th><th>Buffer</th></tr></thead>
      <tbody>${ctx.services.map((s) => `<tr><td>${esc(s.name)}</td><td>${esc(minutesToLabel(s.duration_min))}</td>
        <td><input name="price_${attr(s.id)}" value="${attr((s.price_cents / 100).toFixed(2))}" style="max-width:120px"></td>
        <td><input name="buffer_${attr(s.id)}" type="number" min="0" step="5" value="${attr(String(s.buffer_min || 0))}" style="max-width:90px"></td></tr>`).join('')}</tbody></table></div>`
      : emptyState('Add services first', 'Pricing applies to the services you created.')}
    <button class="btn btn-primary mt2" type="submit">Save prices</button>
  </form>`;
}

function stepStaff(ctx) {
  const list = ctx.staff.length ? `<div class="table-wrap mt2"><table><thead><tr><th>Name</th><th>Role</th><th>Branch</th><th></th></tr></thead>
    <tbody>${ctx.staff.map((s) => `<tr><td><strong>${esc(s.name)}</strong></td><td>${esc(s.title || '—')}</td><td>${esc(s.branch_name || '—')}</td>
      <td class="right"><form method="post" action="${ctx.base}/onboarding/7/${attr(s.id)}/delete">${csrfField(ctx.csrf)}<button class="btn btn-sm btn-ghost" type="submit">Remove</button></form></td></tr>`).join('')}</tbody></table></div>`
    : emptyState('No team members yet', 'Add the people who deliver your services.');
  return `${list}
    <form method="post" action="${ctx.base}/onboarding/7" class="mt3">
      ${csrfField(ctx.csrf)}
      <h4>Add team member</h4>
      <div class="field-row">
        <div class="field"><label for="stf-name">Name</label><input id="stf-name" name="name" required></div>
        <div class="field"><label for="stf-title">Role</label><input id="stf-title" name="title" placeholder="Senior stylist"></div>
      </div>
      <div class="field-row">
        <div class="field"><label for="stf-phone">Phone</label><input id="stf-phone" name="phone"></div>
        <div class="field"><label for="stf-branch">Branch</label><select id="stf-branch" name="branch_id">${ctx.branches.map((b) => `<option value="${attr(b.id)}">${esc(b.name)}</option>`).join('')}</select></div>
      </div>
      <div class="btn-row"><button class="btn" type="submit">Add member</button>
      <button class="btn btn-primary" type="submit" formaction="${ctx.base}/onboarding/7/continue">Continue</button></div>
    </form>`;
}

function stepRules(ctx) {
  const r = ctx.rules || {};
  return `<form method="post" action="${ctx.base}/onboarding/8">
    ${csrfField(ctx.csrf)}
    <div class="field-row">
      <div class="field"><label for="ob-step">Slot interval (minutes)</label><input id="ob-step" name="slot_step_min" type="number" min="5" max="60" value="${attr(String(r.slot_step_min ?? 15))}"></div>
      <div class="field"><label for="ob-notice">Minimum notice (minutes)</label><input id="ob-notice" name="min_notice_min" type="number" min="0" value="${attr(String(r.min_notice_min ?? 60))}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label for="ob-max">Book up to (days ahead)</label><input id="ob-max" name="max_days_ahead" type="number" min="1" max="365" value="${attr(String(r.max_days_ahead ?? 60))}"></div>
      <div class="field"><label for="ob-cancel">Cancellation notice (hours)</label><input id="ob-cancel" name="cancel_notice_hours" type="number" min="0" value="${attr(String(r.cancel_notice_hours ?? 24))}"></div>
    </div>
    <label class="check"><input type="checkbox" name="allow_waitlist" value="1" ${r.allow_waitlist ? 'checked' : ''}> Offer a waitlist when a day is full</label>
    <label class="check"><input type="checkbox" name="auto_confirm" value="1" ${r.auto_confirm !== 0 ? 'checked' : ''}> Confirm bookings automatically</label>
    <button class="btn btn-primary mt2" type="submit">Save rules</button>
  </form>`;
}

function stepAi(ctx) {
  const p = ctx.personality || {};
  return `<form method="post" action="${ctx.base}/onboarding/9">
    ${csrfField(ctx.csrf)}
    <p class="muted" style="font-size:.86rem">This shapes how your AI receptionist speaks. It never invents business facts.</p>
    <div class="field"><label for="ai-tone">Brand voice</label><input id="ai-tone" name="tone" value="${attr(p.tone || '')}" placeholder="Warm, calm, professional"></div>
    <div class="field-row">
      <div class="field"><label for="ai-lang">Primary language</label><input id="ai-lang" name="language" value="${attr(p.language || 'English')}"></div>
      <div class="field"><label for="ai-esc">Escalation phone</label><input id="ai-esc" name="escalation_phone" value="${attr(p.escalation_phone || ctx.business.phone || '')}"></div>
    </div>
    <div class="field"><label for="ai-sign">Sign-off</label><input id="ai-sign" name="signoff" value="${attr(p.signoff || '')}" placeholder="— The team at your business"></div>
    <button class="btn btn-primary" type="submit">Save personality</button>
  </form>`;
}

function stepKnowledge(ctx) {
  return `<p class="muted" style="font-size:.86rem">Add the facts your AI may quote: policies, FAQs, parking, payment methods. Anything not stored here is escalated to staff.</p>
    ${ctx.knowledge.length ? `<div class="list-rows mt2">${ctx.knowledge.map((k) => `<div class="row"><div><strong>${esc(k.title)}</strong><div class="muted" style="font-size:.76rem">${esc(String(k.content).slice(0, 120))}</div></div>
      <form method="post" action="${ctx.base}/onboarding/10/${attr(k.id)}/delete">${csrfField(ctx.csrf)}<button class="btn btn-sm btn-ghost" type="submit">Delete</button></form></div>`).join('')}</div>` : ''}
    <form method="post" action="${ctx.base}/onboarding/10" class="mt3">
      ${csrfField(ctx.csrf)}
      <div class="field"><label for="k-title">Title</label><input id="k-title" name="title" required placeholder="Cancellation policy"></div>
      <div class="field"><label for="k-content">Content</label><textarea id="k-content" name="content" rows="4" required></textarea></div>
      <div class="btn-row"><button class="btn" type="submit">Add entry</button>
      <button class="btn btn-primary" type="submit" formaction="${ctx.base}/onboarding/10/continue">Continue</button></div>
    </form>`;
}

function stepWhatsApp(ctx) {
  return `<div class="card">
    <h3>WhatsApp Business</h3>
    <p class="muted" style="font-size:.86rem">MAVYRON connects through the official WhatsApp Business Cloud API. You need a Meta Business account, an approved phone number and a permanent access token. Until those are saved and verified, no messages are sent and the integration reports “Configuration required”.</p>
    <div class="btn-row mt2">
      <a class="btn btn-primary" href="${ctx.base}/integrations#whatsapp">Configure WhatsApp</a>
      <form method="post" action="${ctx.base}/onboarding/11">${csrfField(ctx.csrf)}<button class="btn" type="submit">Skip for now</button></form>
    </div>
  </div>`;
}

function stepSocial(ctx) {
  return `<div class="card">
    <h3>Social channels</h3>
    <p class="muted" style="font-size:.86rem">Instagram, Facebook, TikTok and X connect through each provider's official OAuth app. Publishing is only reported after the provider confirms it.</p>
    <div class="btn-row mt2">
      <a class="btn btn-primary" href="${ctx.base}/integrations">Open integrations</a>
      <form method="post" action="${ctx.base}/onboarding/12">${csrfField(ctx.csrf)}<button class="btn" type="submit">Skip for now</button></form>
    </div>
  </div>`;
}

function stepPayments(ctx) {
  return `<div class="card">
    <h3>Payments</h3>
    <p class="muted" style="font-size:.86rem">Subscription billing and customer deposits use hosted checkout. Card details are entered on the provider's page and never reach MAVYRON. Payment status changes only from verified provider webhooks.</p>
    <div class="btn-row mt2">
      <a class="btn btn-primary" href="${ctx.base}/billing">Choose a plan</a>
      <form method="post" action="${ctx.base}/onboarding/13">${csrfField(ctx.csrf)}<button class="btn" type="submit">Skip for now</button></form>
    </div>
  </div>`;
}

function stepLaunch(ctx) {
  const checks = [
    ['Business details', !!ctx.business.name, `${ctx.base}/onboarding/1`],
    ['Location', !!(ctx.business.city || ctx.business.address), `${ctx.base}/onboarding/2`],
    ['Branches', ctx.branches.length > 0, `${ctx.base}/onboarding/3`],
    ['Opening hours', !!ctx.hoursConfigured, `${ctx.base}/onboarding/4`],
    ['Services', ctx.services.length > 0, `${ctx.base}/onboarding/5`],
    ['Team', ctx.staff.length > 0, `${ctx.base}/onboarding/7`],
    ['Booking rules', !!ctx.business.booking_rules_json, `${ctx.base}/onboarding/8`],
    ['Knowledge base', ctx.knowledge.length > 0, `${ctx.base}/onboarding/10`],
  ];
  const ready = checks.filter((c) => c[1]).length;
  return `<div class="grid g2">
    <div class="card">
      <h3>Readiness</h3>
      <div class="list-rows mt2">${checks.map(([label, ok, href]) => `<div class="row"><div>${ok ? badge('ready', 'ok') : badge('missing', 'warn')} <strong style="font-size:.86rem">${esc(label)}</strong></div><a class="btn btn-sm btn-ghost" href="${attr(href)}">Fix</a></div>`).join('')}</div>
      <p class="muted mt2" style="font-size:.82rem">${ready}/${checks.length} essentials complete. You can launch and finish the rest later — every step is saved as you go.</p>
    </div>
    <div class="card">
      <h3>Your public page</h3>
      <p class="muted" style="font-size:.86rem">Customers book from your public page. It only shows what you have configured.</p>
      <div class="mono mt2" style="font-size:.78rem;word-break:break-all">/business/${esc(ctx.business.slug)}</div>
      <div class="btn-row mt2">
        <a class="btn btn-sm" href="/business/${attr(ctx.business.slug)}" target="_blank" rel="noopener">Preview page</a>
        <a class="btn btn-sm btn-ghost" href="${ctx.base}/site">Page settings</a>
      </div>
      <div class="hr"></div>
      <form method="post" action="${ctx.base}/onboarding/14">
        ${csrfField(ctx.csrf)}
        <button class="btn btn-primary btn-block" type="submit">Launch workspace</button>
      </form>
    </div>
  </div>`;
}

export function onboardingPage(ctx) {
  const step = ctx.step;
  const meta = STEPS[step - 1];
  const bodies = [stepBusiness, stepLocation, stepBranches, stepHours, stepServices, stepPrices, stepStaff, stepRules, stepAi, stepKnowledge, stepWhatsApp, stepSocial, stepPayments, stepLaunch];
  const body = `${progressBar(step - 1)}
    ${stepper(step - 1)}
    <div class="card mt3">
      <div class="flex between wrap">
        <div><h3>${esc(meta.title)}</h3><p class="muted" style="font-size:.82rem">Step ${step} of ${STEPS.length} · ${esc(meta.label)}</p></div>
        <a class="btn btn-sm btn-ghost" href="${ctx.base}">Save and exit</a>
      </div>
      <div class="hr"></div>
      ${bodies[step - 1](ctx)}
    </div>
    <div class="flex between mt2">
      ${step > 1 ? `<a class="btn btn-sm btn-ghost" href="${ctx.base}/onboarding/${step - 1}">← Back</a>` : '<span></span>'}
      ${step < STEPS.length ? `<form method="post" action="${ctx.base}/onboarding/${step}/continue">${csrfField(ctx.csrf)}<button class="btn btn-sm" type="submit">Skip this step →</button></form>` : '<span></span>'}
    </div>`;
  return appPage({
    business: ctx.business, user: ctx.user, role: ctx.role, csrf: ctx.csrf, req: ctx.req,
    title: 'Set up your business', subtitle: `${STEPS.length - 1} steps · progress saved automatically`,
    active: '', body, wide: true, onboarding: true,
  });
}
