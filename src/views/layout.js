import { esc, attr, money, prettyDate, prettyTime, relativeTime } from '../lib/util.js';

export const BRAND = {
  name: 'MAVYRON',
  tagline: 'The Intelligent Business Operating System',
  whatsapp: '0702597951',
  enquiries: '0748734197',
  email: 'mbaeevans002@gmail.com',
  founder: 'Evans Karani Mbae',
  location: 'Nairobi, Kenya',
};

const ICONS = {
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  calendar: 'M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1z',
  users: 'M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM17 11a3 3 0 1 0 0-6M21 20v-1a4 4 0 0 0-3-3.8',
  spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z',
  chat: 'M21 12a8 8 0 0 1-8 8H7l-4 3V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z',
  megaphone: 'M3 11v2a1 1 0 0 0 1 1h2l4 4V6L6 10H4a1 1 0 0 0-1 1zM14 8a4 4 0 0 1 0 8M17 5a8 8 0 0 1 0 14',
  pen: 'M4 20h4L20 8l-4-4L4 16zM14 6l4 4',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  wallet: 'M3 7h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7zM3 7l2-3h11l2 3M16 13h2',
  plug: 'M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 4.6a2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 11a2 2 0 1 1 0 4z',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  health: 'M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.5-7 10-7 10z',
  doc: 'M6 3h8l4 4v14H6zM14 3v5h5M9 13h6M9 17h6',
  life: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 8v5M12 16h.01',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  bell: 'M18 9a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7M10.5 20a2 2 0 0 0 3 0',
  menu: 'M4 7h16M4 12h16M4 17h16',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  check: 'M4 12l5 5L20 6',
  x: 'M6 6l12 12M18 6L6 18',
};

export function icon(name, cls = 'ico') {
  const d = ICONS[name] || ICONS.grid;
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
}

export function flashBars(req) {
  const ok = req.query?.ok;
  const err = req.query?.err;
  const info = req.query?.info;
  const decode = (v) => esc(String(v).slice(0, 400));
  let out = '';
  if (ok) out += `<div class="flash flash-ok" role="status">${icon('check')}<div>${decode(ok)}</div></div>`;
  if (info) out += `<div class="flash flash-info" role="status"><div>${decode(info)}</div></div>`;
  if (err) out += `<div class="flash flash-err" role="alert">${icon('x')}<div>${decode(err)}</div></div>`;
  return out;
}

export function csrfField(csrf) {
  return `<input type="hidden" name="_csrf" value="${attr(csrf)}">`;
}

export function badge(text, kind = '') {
  return `<span class="badge ${kind ? `badge-${kind}` : ''}">${esc(text)}</span>`;
}

export function statusBadge(status) {
  const map = {
    confirmed: 'ok', completed: 'info', pending: 'warn', cancelled: 'bad', no_show: 'bad',
    connected: 'ok', configuration_required: 'warn', disconnected: '', error: 'bad', reconnect_required: 'warn',
    active: 'ok', trialing: 'info', past_due: 'warn', suspended: 'bad', expired: 'bad', cancelled_sub: 'bad',
    queued: 'warn', sent: 'ok', failed: 'bad', blocked: 'warn', waiting: 'warn', scheduled: 'info',
    draft: '', published: 'ok', running: 'info', paused: 'warn', open: 'info', closed: '', paid: 'ok', unpaid: 'warn',
  };
  const label = String(status || '').replace(/_/g, ' ');
  return `<span class="badge badge-${map[status] || ''}">${esc(label)}</span>`;
}

export function stat(label, value, detail = '') {
  return `<div class="card stat"><div class="k"><span>${esc(label)}</span></div>
    <div class="v">${value}</div>${detail ? `<div class="d">${esc(detail)}</div>` : ''}</div>`;
}

export function emptyState(title, detail, action = '') {
  return `<div class="empty"><strong>${esc(title)}</strong>${detail ? `<span class="mono">${esc(detail)}</span>` : ''}${action}</div>`;
}

export function field(label, name, { type = 'text', value = '', placeholder = '', required = false, hint = '', attrs = '' } = {}) {
  return `<div class="field"><label for="f_${attr(name)}">${esc(label)}</label>
    <input id="f_${attr(name)}" type="${attr(type)}" name="${attr(name)}" value="${attr(value ?? '')}"
      placeholder="${attr(placeholder)}" ${required ? 'required' : ''} ${attrs}></div>`;
}

export function selectField(label, name, options, { value = '', hint = '' } = {}) {
  const opts = options.map((o) => {
    const val = typeof o === 'string' ? o : o.value;
    const text = typeof o === 'string' ? o : o.label;
    return `<option value="${attr(val)}" ${String(val) === String(value) ? 'selected' : ''}>${esc(text)}</option>`;
  }).join('');
  return `<div class="field"><label for="f_${attr(name)}">${esc(label)}</label>
    <select id="f_${attr(name)}" name="${attr(name)}">${opts}</select>${hint ? `<div class="hint">${esc(hint)}</div>` : ''}</div>`;
}

export function textareaField(label, name, { value = '', placeholder = '', rows = 4 } = {}) {
  return `<div class="field"><label for="f_${attr(name)}">${esc(label)}</label>
    <textarea id="f_${attr(name)}" name="${attr(name)}" rows="${rows}" placeholder="${attr(placeholder)}">${esc(value ?? '')}</textarea></div>`;
}

function publicHead({ title, description, canonical = '', jsonLd = null }) {
  const fullTitle = title ? `${title} · MAVYRON` : 'MAVYRON — The Intelligent Business Operating System';
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${attr(description || BRAND.tagline)}">
<meta name="theme-color" content="#07090d">
<meta property="og:title" content="${attr(fullTitle)}">
<meta property="og:description" content="${attr(description || BRAND.tagline)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="MAVYRON">
${canonical ? `<link rel="canonical" href="${attr(canonical)}">` : ''}
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/app.css">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : ''}`;
}

export function publicPage({ title, description, body, user = null, canonical = '', jsonLd = null, active = '' }) {
  const navLink = (href, label) =>
    `<a href="${href}" ${active === label.toLowerCase() ? 'style="color:#fff"' : ''}>${esc(label)}</a>`;
  return `<!doctype html><html lang="en"><head>${publicHead({ title, description, canonical, jsonLd })}</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-head"><div class="wrap bar">
  <a class="brand" href="/"><span class="brand-mark" aria-hidden="true"></span>MAVYRON</a>
  <nav class="site-nav" aria-label="Primary">
    ${navLink('/#platform', 'Platform')}
    ${navLink('/industries', 'Industries')}
    ${navLink('/solutions/healthcare', 'Healthcare')}
    ${navLink('/security', 'Security')}
    ${navLink('/pricing', 'Pricing')}
    ${navLink('/partners', 'Partners')}
    ${navLink('/contact', 'Contact')}
  </nav>
  <div class="flex" style="gap:.5rem">
    ${user
      ? `<a class="btn btn-sm" href="/app">Open workspace</a>`
      : `<a class="btn btn-sm btn-ghost" href="/login">Sign in</a><a class="btn btn-sm btn-primary" href="/signup">Start free trial</a>`}
  </div>
</div></header>
<main id="main">${body}</main>
<footer class="site-foot"><div class="wrap">
  <div class="foot-grid">
    <div>
      <a class="brand" href="/"><span class="brand-mark" aria-hidden="true"></span>MAVYRON</a>
      <p class="muted" style="font-size:.85rem;margin-top:.8rem;max-width:34ch">The intelligent business operating system for service businesses and healthcare organisations.</p>
      <p class="mono muted" style="margin:0">Nairobi, Kenya</p>
    </div>
    <div><h4>Platform</h4>
      <a href="/#platform">Overview</a><a href="/pricing">Pricing</a><a href="/industries">Industries</a>
      <a href="/solutions/healthcare">Healthcare</a><a href="/security">Security</a>
    </div>
    <div><h4>Company</h4>
      <a href="/partners">Partnerships</a><a href="/contact">Contact</a><a href="/status">System status</a>
      <a href="/legal/privacy">Privacy</a><a href="/legal/terms">Terms</a>
    </div>
    <div><h4>Talk to us</h4>
      <a href="https://wa.me/254702597951" rel="noopener">WhatsApp ${esc(BRAND.whatsapp)}</a>
      <a href="tel:+254748734197">Enquiries ${esc(BRAND.enquiries)}</a>
      <a href="mailto:${attr(BRAND.email)}">${esc(BRAND.email)}</a>
      <a href="/login">Sign in</a><a href="/signup">Create account</a>
    </div>
  </div>
  <div class="hr"></div>
  <div class="flex between" style="font-size:.75rem;color:var(--silver)">
    <span>© ${new Date().getFullYear()} MAVYRON. All rights reserved.</span>
    <span class="mono">Built in Nairobi · Designed for global scale</span>
  </div>
</div></footer>
</body></html>`;
}

export const NAV_GROUPS = [
  {
    label: 'Operations',
    items: [
      { href: '', label: 'Dashboard', icon: 'grid', perm: 'dashboard.view' },
      { href: '/calendar', label: 'Calendar', icon: 'calendar', perm: 'calendar.view' },
      { href: '/customers', label: 'Customers', icon: 'users', perm: 'customers.view' },
      { href: '/services', label: 'Services', icon: 'spark', perm: 'catalog.view' },
      { href: '/staff', label: 'Team', icon: 'users', perm: 'staff.view' },
      { href: '/branches', label: 'Branches', icon: 'grid', perm: 'branches.view' },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { href: '/ai', label: 'AI control', icon: 'spark', perm: 'ai.view' },
      { href: '/conversations', label: 'Conversations', icon: 'chat', perm: 'ai.view' },
      { href: '/marketing', label: 'Automation', icon: 'megaphone', perm: 'marketing.view' },
      { href: '/content', label: 'Content studio', icon: 'pen', perm: 'content.view' },
      { href: '/analytics', label: 'Analytics', icon: 'chart', perm: 'analytics.view' },
      { href: '/command', label: 'Command centre', icon: 'shield', perm: 'analytics.view' },
    ],
  },
  {
    label: 'Business',
    items: [
      { href: '/finance', label: 'Finance', icon: 'wallet', perm: 'analytics.view' },
      { href: '/healthcare', label: 'Healthcare', icon: 'health', perm: 'healthcare.view' },
      { href: '/documents', label: 'Documents', icon: 'doc', perm: 'settings.view' },
      { href: '/integrations', label: 'Integrations', icon: 'plug', perm: 'integrations.view' },
      { href: '/settings', label: 'Settings', icon: 'gear', perm: 'settings.view' },
      { href: '/support', label: 'Support', icon: 'life', perm: 'support.view' },
    ],
  },
];

export function appPage({
  business, user, role, active = '', title, subtitle = '', body, csrf, req,
  actions = '', wide = false, showSearch = true, notifications = 0,
}) {
  const base = `/app/${business.slug}`;
  const can = (perm) => role === 'owner' || (NAV_PERMISSIONS[role] || []).includes(perm);
  const groups = NAV_GROUPS.map((group) => {
    const items = group.items.filter((item) => can(item.perm));
    if (!items.length) return '';
    return `<div class="group">${esc(group.label)}</div>` + items.map((item) => {
      const href = `${base}${item.href}`;
      const on = active === (item.href || '/') || (item.href && active.startsWith(item.href));
      return `<a class="item ${on ? 'on' : ''}" href="${href}">${icon(item.icon)}<span>${esc(item.label)}</span></a>`;
    }).join('');
  }).join('');

  const quick = [
    { href: '', label: 'Home', icon: 'grid', perm: 'dashboard.view' },
    { href: '/calendar', label: 'Calendar', icon: 'calendar', perm: 'calendar.view' },
    { href: '/customers', label: 'Clients', icon: 'users', perm: 'customers.view' },
    { href: '/ai', label: 'AI', icon: 'spark', perm: 'ai.view' },
    { href: '/settings', label: 'More', icon: 'menu', perm: 'settings.view' },
  ].filter((i) => can(i.perm));

  return `<!doctype html><html lang="en"><head>${publicHead({ title: `${title} · ${business.name}`, description: subtitle || BRAND.tagline })}</head>
<body>
<div class="app">
  <aside class="side">
    <a class="brand" href="/app"><span class="brand-mark" aria-hidden="true"></span>MAVYRON</a>
    <div class="panel" style="padding:.7rem">
      <div class="mono muted" style="font-size:.6rem;letter-spacing:.16em">WORKSPACE</div>
      <div style="font-weight:500;font-size:.9rem;margin-top:.15rem">${esc(business.name)}</div>
      <div class="flex between mt1">
        ${badge(role, 'info')}
        <a class="mono" href="/app" style="font-size:.66rem;color:var(--silver)">switch</a>
      </div>
    </div>
    <nav aria-label="Workspace">${groups}</nav>
    <div class="side-foot">
      <div class="flex between"><span>${esc(user.name)}</span><span class="mono">${esc(user.email.slice(0, 18))}</span></div>
      ${user.is_platform_admin ? `<a class="mono" href="/admin" style="display:block;margin-top:.4rem;color:var(--gold)">Platform admin →</a>` : ''}
      <form method="post" action="/logout" style="margin-top:.5rem">${csrfField(csrf)}<button class="btn btn-sm btn-ghost btn-block" type="submit">Sign out</button></form>
    </div>
  </aside>
  <div class="main">
    <div class="topbar">
      <button class="btn btn-sm btn-ghost mobile-only" type="button" onclick="document.getElementById('mnav').showModal()" aria-label="Open navigation">${icon('menu')}</button>
      ${showSearch ? `<form class="search" method="get" action="${base}/search" role="search">
        ${icon('search')}<input type="search" name="q" placeholder="Search customers, bookings, invoices…" aria-label="Search workspace" value="${attr(req?.query?.q || '')}">
      </form>` : '<div class="f1"></div>'}
      <div class="who">
        <a href="${base}/notifications" class="flex" style="gap:.35rem" aria-label="Notifications">${icon('bell')}${notifications ? `<span class="badge badge-info">${notifications}</span>` : ''}</a>
        <span class="avatar" aria-hidden="true">${esc((user.name || 'U').slice(0, 1).toUpperCase())}</span>
      </div>
    </div>
    <div class="content" style="${wide ? 'max-width:1600px' : ''}">
      ${flashBars(req || { query: {} })}
      <div class="page-head">
        <div>
          <div class="breadcrumb">${esc(business.name)} · ${esc(business.industry || 'business')}</div>
          <h1>${esc(title)}</h1>
          ${subtitle ? `<p>${esc(subtitle)}</p>` : ''}
        </div>
        <div class="btn-row">${actions}</div>
      </div>
      ${body}
    </div>
    <nav class="bottom-nav" aria-label="Mobile">
      ${quick.map((i) => `<a href="${base}${i.href}" class="${active === (i.href || '/') ? 'on' : ''}">${icon(i.icon)}<span>${esc(i.label)}</span></a>`).join('')}
    </nav>
  </div>
</div>
<dialog id="mnav" style="border:1px solid var(--line);background:var(--graphite);color:var(--platinum);border-radius:16px;padding:1rem;max-width:92vw;width:340px">
  <div class="flex between"><strong>${esc(business.name)}</strong><button class="btn btn-sm btn-ghost" onclick="document.getElementById('mnav').close()" aria-label="Close">✕</button></div>
  <div class="hr"></div>
  <nav style="display:grid;gap:.15rem">
    ${NAV_GROUPS.flatMap((g) => g.items.filter((i) => can(i.perm))).map((i) => `<a class="item" href="${base}${i.href}">${icon(i.icon)}<span>${esc(i.label)}</span></a>`).join('')}
  </nav>
</dialog>
</body></html>`;
}

const NAV_PERMISSIONS = {
  owner: ['*'],
  manager: ['dashboard.view', 'bookings.view', 'bookings.manage', 'calendar.view', 'customers.view', 'customers.manage',
    'catalog.view', 'catalog.manage', 'staff.view', 'staff.manage', 'branches.view', 'branches.manage', 'analytics.view',
    'ai.view', 'ai.manage', 'marketing.view', 'marketing.manage', 'content.view', 'content.manage', 'integrations.view',
    'integrations.manage', 'settings.view', 'support.view', 'support.manage', 'healthcare.view', 'healthcare.manage',
    'api.manage', 'audit.view', 'notifications.view'],
  receptionist: ['dashboard.view', 'bookings.view', 'bookings.manage', 'calendar.view', 'customers.view', 'customers.manage',
    'catalog.view', 'staff.view', 'healthcare.view', 'healthcare.manage', 'support.view', 'analytics.view', 'notifications.view'],
  staff: ['dashboard.view', 'bookings.view', 'calendar.view', 'customers.view', 'healthcare.view', 'notifications.view'],
  ai: ['bookings.view', 'customers.view'],
};

export function authPage({ title, subtitle, body, footer = '', csrf, error = '' }) {
  return `<!doctype html><html lang="en"><head>${publicHead({ title, description: subtitle })}</head>
<body>
<main class="wrap-sm" style="padding:clamp(2rem,6vw,4.5rem) 0">
  <a class="brand" href="/" style="margin-bottom:2rem"><span class="brand-mark" aria-hidden="true"></span>MAVYRON</a>
  <div class="card" style="padding:clamp(1.4rem,4vw,2.2rem)">
    <h1 style="font-size:1.7rem">${esc(title)}</h1>
    <p class="muted" style="font-size:.9rem;margin-top:.4rem">${esc(subtitle || '')}</p>
    ${error ? `<div class="flash flash-err" role="alert">${esc(error)}</div>` : ''}
    ${body}
  </div>
  <div class="center" style="margin-top:1.2rem;font-size:.85rem;color:var(--silver)">${footer}</div>
  <p class="center mono" style="margin-top:2rem;font-size:.66rem;color:rgba(174,184,200,.6)">Nairobi · Kenya</p>
</main></body></html>`;
}

export function moneyCell(cents, currency = 'KES') {
  return `<span class="nowrap">${esc(money(cents, currency))}</span>`;
}

export function whenCell(iso, tz = 'Africa/Nairobi') {
  if (!iso) return '<span class="muted">—</span>';
  return `<span class="nowrap">${esc(prettyDate(iso, tz))}</span><span class="sub">${esc(prettyTime(iso, tz))}</span>`;
}

export function relCell(iso) {
  return iso ? `<span class="mono muted">${esc(relativeTime(iso))}</span>` : '<span class="muted">—</span>';
}
