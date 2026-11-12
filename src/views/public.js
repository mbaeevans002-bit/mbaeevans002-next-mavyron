import { esc, attr, money, prettyDate } from '../lib/util.js';
import { publicPage, icon, BRAND, badge } from './layout.js';

export function coreVisual({ label = true } = {}) {
  const nodes = [
    { x: 250, y: 64, label: 'BUSINESS' },
    { x: 402, y: 148, label: 'DATA' },
    { x: 420, y: 320, label: 'AI' },
    { x: 250, y: 428, label: 'AUTOMATION' },
    { x: 82, y: 320, label: 'ACTION' },
    { x: 78, y: 148, label: 'GROWTH' },
  ];
  return `<div class="core-stage" aria-label="MAVYRON intelligence core: business data flowing through AI into automation and growth">
  <svg viewBox="0 0 500 500" role="img">
    <defs>
      <radialGradient id="cg" cx="50%" cy="50%">
        <stop offset="0%" stop-color="#a5b4fc" stop-opacity=".95"/>
        <stop offset="45%" stop-color="#6366f1" stop-opacity=".5"/>
        <stop offset="100%" stop-color="#0a1220" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#35d5e8" stop-opacity=".85"/>
        <stop offset="50%" stop-color="#6366f1" stop-opacity=".55"/>
        <stop offset="100%" stop-color="#c9a96e" stop-opacity=".7"/>
      </linearGradient>
    </defs>
    <circle cx="250" cy="250" r="170" fill="none" stroke="rgba(174,184,200,.12)"/>
    <circle cx="250" cy="250" r="120" fill="url(#cg)" opacity=".55"/>
    <circle cx="250" cy="250" r="74" fill="rgba(10,18,32,.92)" stroke="url(#ring)" stroke-width="1.2"/>
    <circle class="pulse" cx="250" cy="250" r="48" fill="none" stroke="rgba(53,213,232,.5)" stroke-width=".8"/>
    <g class="core-glow">
      <circle cx="250" cy="250" r="17" fill="#0a1220" stroke="#a5b4fc" stroke-width="1.4"/>
      <circle cx="250" cy="250" r="6" fill="#35d5e8"/>
    </g>
    <g class="orbit">${Array.from({ length: 6 }, (_, i) => {
      const a = (i / 6) * Math.PI * 2;
      return `<circle cx="${(250 + Math.cos(a) * 120).toFixed(1)}" cy="${(250 + Math.sin(a) * 120).toFixed(1)}" r="3.2" fill="${i % 2 ? '#35d5e8' : '#c9a96e'}"/>`;
    }).join('')}</g>
    <g class="orbit rev">${Array.from({ length: 3 }, (_, i) => {
      const a = (i / 3) * Math.PI * 2 + 0.6;
      return `<circle cx="${(250 + Math.cos(a) * 168).toFixed(1)}" cy="${(250 + Math.sin(a) * 168).toFixed(1)}" r="2.4" fill="#a5b4fc"/>`;
    }).join('')}</g>
    ${nodes.map((n, i) => {
      const midX = (250 + n.x) / 2 + (i % 2 ? 16 : -16);
      const midY = (250 + n.y) / 2;
      return `<path d="M250 250 Q ${midX} ${midY} ${n.x} ${n.y}" fill="none" stroke="rgba(99,102,241,.28)" stroke-width=".9" stroke-dasharray="3 6"/>
        <circle cx="${n.x}" cy="${n.y}" r="5.5" fill="#0a1220" stroke="rgba(53,213,232,.75)" stroke-width="1"/>
        <circle cx="${n.x}" cy="${n.y}" r="2" fill="#35d5e8"/>
        ${label ? `<text class="node-label" x="${n.x}" y="${n.y + 20}" text-anchor="middle">${n.label}</text>` : ''}`;
    }).join('')}
  </svg>
</div>`;
}

function sectionHead(eyebrow, title, lede) {
  return `<div style="max-width:70ch;margin-bottom:2rem">
    <span class="eyebrow">${esc(eyebrow)}</span>
    <h2 style="margin:.7rem 0 .8rem">${title}</h2>
    ${lede ? `<p class="lede">${esc(lede)}</p>` : ''}
  </div>`;
}

const INDUSTRIES = [
  ['Salons & barbershops', 'Chair utilisation, stylist schedules, WhatsApp booking and rebooking prompts.'],
  ['Spas & wellness', 'Multi-room capacity, packages, therapist rosters and consent-aware marketing.'],
  ['Clinics & dental', 'Patient records, provider schedules, queues, encounters and billing in one tenancy.'],
  ['Medical centres & hospitals', 'Facilities, departments, admissions, beds, wards and consolidated reporting.'],
  ['Restaurants & hotels', 'Reservations, service windows, guest history and campaign automation.'],
  ['Gyms & studios', 'Class capacity, memberships, attendance and retention workflows.'],
  ['Professional services', 'Consultation booking, document exchange and engagement tracking.'],
  ['Rentals & retail', 'Appointment-based service, customer history and branch operations.'],
];

const AGENTS = [
  ['Reception Intelligence', 'Answers real business questions from the tenant knowledge base and books through validated backend actions.'],
  ['Booking Intelligence', 'Checks availability against staff schedules, breaks, holidays and existing bookings.'],
  ['Customer Retention', 'Finds lapsed customers from real visit data and prepares consent-aware follow-ups.'],
  ['Marketing Intelligence', 'Drafts campaigns and segments from recorded consent and booking history.'],
  ['Content Creation', 'Generates captions, offers and scripts that stay editable until a provider confirms publishing.'],
  ['Voice Reception', 'Architecture for approved telephony providers, with honest configuration states.'],
  ['Business Analytics', 'Reads live database metrics: bookings, conversion, no-shows, revenue and utilisation.'],
  ['Financial Operations', 'Invoices, expenses, refunds and reconciliation from provider-confirmed payments.'],
  ['Customer Support', 'Tickets, attachments and support history inside the tenant workspace.'],
  ['Workflow Automation', 'Executes trigger, condition and action graphs on the backend with execution logs.'],
  ['Healthcare Administration', 'Patient administration, queues and encounters under strict clinical permissions.'],
  ['Enterprise Operations', 'Organisation, branch and department level oversight with enforced scoping.'],
];

export function landing({ user, plans = [], stats = null }) {
  const body = `
<section class="hero"><div class="wrap split">
  <div>
    <span class="eyebrow">The intelligent business operating system</span>
    <h1>Run the entire business from <em>one intelligent core</em>.</h1>
    <p class="lede">MAVYRON connects customers, bookings, communication, payments, marketing, AI and analytics into a single multi-tenant operating system — built in Nairobi for businesses that intend to scale.</p>
    <div class="hero-actions">
      <a class="btn btn-primary" href="/signup">Start 14-day trial ${icon('arrow')}</a>
      <a class="btn" href="/contact?topic=demo">Book a walkthrough</a>
    </div>
    <div class="hero-meta">
      <div><strong>Multi-tenant</strong>Isolated by database and authorization</div>
      <div><strong>Real integrations</strong>Verified before “Connected” appears</div>
      <div><strong>Mobile-first</strong>Operate from an Android phone</div>
    </div>
  </div>
  <div>${coreVisual()}</div>
</div></section>

<section class="section" id="problem"><div class="wrap">
  ${sectionHead('The operating gap', 'Service businesses run on disconnected tools.', 'Bookings live in one app, customer history in a notebook, payments in mobile money, marketing in a group chat, and the owner’s decisions in their head. The cost is not software licences — it is lost bookings, silent customers and decisions made without evidence.')}
  <div class="grid g3">
    ${[
      ['Fragmented records', 'A customer books, pays and messages in three places. Nobody can answer “what happened last time?” without searching.'],
      ['Unverifiable numbers', 'Dashboards that display invented statistics train owners to distrust every metric. MAVYRON only shows what the database can prove.'],
      ['Integration theatre', 'Green “Connected” badges that never send a message. Every provider state here is derived from a real verification attempt.'],
    ].map(([t, d]) => `<div class="card"><h3>${esc(t)}</h3><p class="muted" style="font-size:.9rem;margin-top:.5rem">${esc(d)}</p></div>`).join('')}
  </div>
</div></section>

<section class="section" id="platform"><div class="wrap">
  ${sectionHead('The platform', 'One system, from first enquiry to consolidated reporting.', 'Every module writes to the same tenant-scoped database, so a booking immediately updates the calendar, the customer record, the staff schedule, the notification queue and the analytics layer.')}
  <div class="grid g3">
    ${[
      ['grid', 'Business workspace', 'Dashboard, calendar, CRM, services, team, branches, finance, documents and audit history.'],
      ['spark', 'Intelligence engine', 'Provider-agnostic AI orchestration with tenant knowledge retrieval and permission-controlled actions.'],
      ['calendar', 'Booking engine', 'Availability from duration, schedules, breaks, holidays, opening hours and existing bookings — with backend conflict prevention.'],
      ['megaphone', 'Automation builder', 'Trigger, condition, action graphs executed on the server, with version history and execution logs.'],
      ['plug', 'Integration hub', 'WhatsApp Business, payments, calendar, social and voice providers with encrypted credentials and honest states.'],
      ['chart', 'Analytics & command centre', 'Bookings, conversion, retention, revenue, staff activity and AI usage from real queries.'],
    ].map(([ic, t, d]) => `<div class="card"><div class="flex" style="gap:.6rem"><span class="badge badge-info">${icon(ic)}</span><h3>${esc(t)}</h3></div><p class="muted" style="font-size:.9rem;margin-top:.6rem">${esc(d)}</p></div>`).join('')}
  </div>
</div></section>

<section class="section"><div class="wrap split">
  <div>${coreVisual({ label: false })}</div>
  <div>
    ${sectionHead('MAVYRON intelligence core', 'AI that answers from your business — or says it does not know.', 'The receptionist agent is grounded in the tenant’s services, prices, hours, staff, policies and knowledge documents. If the answer is not in the knowledge base, it says so and offers a handover instead of inventing a price or policy.')}
    <ul class="list">
      <li><span class="dot"></span><div><strong>Tenant-isolated retrieval.</strong> Knowledge search is scoped to one business ID before ranking.</div></li>
      <li><span class="dot"></span><div><strong>Validated actions only.</strong> Booking, rescheduling and cancellation run through the same backend engine as the UI.</div></li>
      <li><span class="dot"></span><div><strong>Human handover.</strong> Escalation is recorded on the conversation with a reason and an assignee.</div></li>
      <li><span class="dot"></span><div><strong>Usage transparency.</strong> Token and cost tracking appear only when the provider returns usage data.</div></li>
    </ul>
    <a class="btn mt2" href="/security">How access is enforced ${icon('arrow')}</a>
  </div>
</div></section>

<section class="section"><div class="wrap">
  ${sectionHead('Agent architecture', 'Twelve specialised agents, one governed runtime.', 'Each agent has a purpose, permissions, required integrations, usage limits, activity history and an honest activation state. An agent whose provider or integration is missing reports configuration required — it never pretends to run.')}
  <div class="grid g3">
    ${AGENTS.map(([t, d]) => `<div class="card tight"><div class="flex between"><h3 style="font-size:.98rem">${esc(t)}</h3>${badge('Configurable', 'plain')}</div><p class="muted" style="font-size:.84rem;margin:.5rem 0 0">${esc(d)}</p></div>`).join('')}
  </div>
</div></section>

<section class="section" id="industries"><div class="wrap">
  ${sectionHead('Industries', 'Vertical-ready from day one.', 'The industry determines terminology, defaults and enabled modules — not a separate codebase. Adding a vertical does not require rebuilding the platform.')}
  <div class="grid g4">
    ${INDUSTRIES.map(([t, d]) => `<div class="card tight"><h3 style="font-size:.95rem">${esc(t)}</h3><p class="muted" style="font-size:.8rem;margin:.4rem 0 0">${esc(d)}</p></div>`).join('')}
  </div>
  <div class="mt3"><a class="btn" href="/industries">Explore industries ${icon('arrow')}</a></div>
</div></section>

<section class="section" id="healthcare"><div class="wrap">
  <div class="card" style="padding:clamp(1.4rem,4vw,2.6rem);background:linear-gradient(150deg,rgba(53,213,232,.09),rgba(10,18,32,.9) 55%)">
    <div class="split">
      <div>
        <span class="eyebrow">MAVYRON Health</span>
        <h2 style="margin:.7rem 0 .8rem">Healthcare administration inside the same platform.</h2>
        <p class="lede">Facilities, departments, providers, patients, encounters, queues, admissions, beds, billing and a patient portal — with stricter access control and a complete audit trail.</p>
        <ul class="feature-list">
          <li>Clinical permissions enforced on the backend, not the interface</li>
          <li>AI restricted to administrative assistance and documentation drafts</li>
          <li>No claim of HIPAA, GDPR or Kenya DPA certification — those require verified audits</li>
        </ul>
        <a class="btn" href="/solutions/healthcare">Healthcare architecture ${icon('arrow')}</a>
      </div>
      <div class="grid">
        ${[
          ['Patient administration', 'Registration, patient numbers, demographics and consent.'],
          ['Clinical workflow', 'Encounters, vitals, notes, prescriptions, laboratory and imaging orders.'],
          ['Operations', 'Queues, admissions, beds, wards, discharge and insurance billing.'],
        ].map(([t, d]) => `<div class="panel"><strong>${esc(t)}</strong><div class="muted" style="font-size:.84rem;margin-top:.25rem">${esc(d)}</div></div>`).join('')}
      </div>
    </div>
  </div>
</div></section>

<section class="section"><div class="wrap">
  ${sectionHead('Security', 'Isolation is enforced where it matters — the backend.', 'Tenant identity is resolved from the session and membership, then every query is scoped by business ID. Roles are checked server-side on each route. The interface hides what you cannot use; the server refuses it regardless.')}
  <div class="grid g4">
    ${[
      ['Session security', 'Scrypt password hashing, HTTP-only sessions, rotation on password change, login throttling.'],
      ['Tenant isolation', 'Membership checks plus business-scoped queries and audit records for denied access.'],
      ['Secrets', 'Provider credentials encrypted at rest with AES-256-GCM; never rendered to the browser.'],
      ['Webhook integrity', 'Stripe, Meta and Twilio signatures verified before any state change.'],
    ].map(([t, d]) => `<div class="card tight"><h3 style="font-size:.95rem">${esc(t)}</h3><p class="muted" style="font-size:.8rem;margin:.4rem 0 0">${esc(d)}</p></div>`).join('')}
  </div>
  <div class="mt3"><a class="btn" href="/security">Security model ${icon('arrow')}</a></div>
</div></section>

<section class="section" id="pricing"><div class="wrap">
  ${sectionHead('Pricing', 'Transparent plans, enforced entitlements.', 'Plan limits are validated on the backend. A trial starts without a card; activation happens only after a provider confirms payment.')}
  <div class="pricing-grid">
    ${plans.map((p) => {
      const features = (p.features || []).map((f) => `<li>${esc(f.replace(/_/g, ' '))}</li>`).join('');
      return `<div class="card ${p.id === 'professional' ? 'glass' : ''}">
        ${p.id === 'professional' ? '<span class="badge badge-gold" style="margin-bottom:.6rem">Most adopted</span>' : ''}
        <h3>${esc(p.name)}</h3>
        <div class="price">${esc(money(p.price_cents, p.currency))}<small>/${esc(p.interval || 'month')}</small></div>
        <ul class="feature-list">${features}</ul>
        <a class="btn ${p.id === 'professional' ? 'btn-primary' : ''} btn-block" href="/signup?plan=${attr(p.id)}">Start trial</a>
      </div>`;
    }).join('')}
  </div>
  <p class="hint mt2">Prices are shown in Kenyan Shillings. Card and mobile-money collection requires the platform payment provider to be configured; until then, plans can be trialled and invoices are recorded as unpaid.</p>
</div></section>

<section class="section" id="partnerships"><div class="wrap">
  <div class="card" style="padding:clamp(1.4rem,4vw,2.6rem)">
    <div class="split">
      <div>
        <span class="eyebrow">Partnerships</span>
        <h2 style="margin:.7rem 0 .8rem">Build on MAVYRON.</h2>
        <p class="lede">Implementation partners, payment providers, telephony providers and vertical specialists can integrate through versioned APIs, signed webhooks and scoped API keys.</p>
        <a class="btn btn-primary" href="/partners">Partnership programme ${icon('arrow')}</a>
      </div>
      <div class="grid">
        <div class="panel"><strong>API-first</strong><div class="muted" style="font-size:.84rem">Versioned REST endpoints, scoped keys and usage tracking.</div></div>
        <div class="panel"><strong>Event webhooks</strong><div class="muted" style="font-size:.84rem">HMAC-signed deliveries with retry history.</div></div>
        <div class="panel"><strong>Vertical extension</strong><div class="muted" style="font-size:.84rem">Industry packs without forking the platform.</div></div>
      </div>
    </div>
  </div>
</div></section>

<section class="section"><div class="wrap center">
  <span class="eyebrow">Start</span>
  <h2 style="margin:.7rem auto .8rem;max-width:24ch">Bring your business into one intelligent operating system.</h2>
  <p class="lede" style="margin-inline:auto">Create an account, complete the 14-step onboarding and take a real booking today. No card required for the trial.</p>
  <div class="btn-row" style="justify-content:center;margin-top:1.4rem">
    <a class="btn btn-primary" href="/signup">Create your workspace</a>
    <a class="btn" href="/contact">Talk to the team</a>
  </div>
  <p class="mono muted" style="margin-top:1.4rem;font-size:.7rem">${esc(BRAND.founder)} · Founder & CEO · ${esc(BRAND.location)}</p>
</div></section>`;
  return publicPage({
    title: null,
    description: 'MAVYRON is a multi-tenant AI business operating system for bookings, CRM, payments, marketing, automation, analytics and healthcare administration.',
    body,
    user,
    active: 'platform',
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'MAVYRON',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      description: 'Multi-tenant AI business operating system for service businesses and healthcare organisations.',
      offers: plans.map((p) => ({ '@type': 'Offer', name: p.name, price: (p.price_cents / 100).toFixed(2), priceCurrency: p.currency })),
    },
  });
}

export function pricingPage({ user, plans }) {
  return publicPage({
    title: 'Pricing',
    description: 'MAVYRON plans for single-location businesses, multi-branch operations and healthcare organisations.',
    user,
    active: 'pricing',
    body: `<section class="section"><div class="wrap">
      ${sectionHead('Pricing', 'Plans that scale with the operation.', 'Entitlements are validated on the backend: feature access and usage limits follow the active subscription, not a hidden frontend flag.')}
      <div class="pricing-grid">
        ${plans.map((p) => `<div class="card ${p.id === 'professional' ? 'glass' : ''}">
          <h3>${esc(p.name)}</h3>
          <div class="price">${esc(money(p.price_cents, p.currency))}<small>/${esc(p.interval)}</small></div>
          <p class="muted" style="font-size:.84rem">${esc(p.description || '')}</p>
          <ul class="feature-list">${(p.features || []).map((f) => `<li>${esc(f.replace(/_/g, ' '))}</li>`).join('')}</ul>
          <div class="mono muted" style="font-size:.7rem;margin-bottom:.8rem">${Object.entries(p.limits || {}).map(([k, v]) => `${esc(k.replace(/_/g, ' '))}: ${v === null ? 'unlimited' : esc(v)}`).join(' · ')}</div>
          <a class="btn ${p.id === 'professional' ? 'btn-primary' : ''} btn-block" href="/signup?plan=${attr(p.id)}">Start trial</a>
        </div>`).join('')}
      </div>
      <div class="grid g2 mt4">
        <div class="card"><h3>What a trial includes</h3><ul class="feature-list">
          <li>Full workspace with onboarding and booking engine</li>
          <li>One business, up to the Starter limits</li>
          <li>AI receptionist in test mode until a provider key is added</li>
          <li>No card required; activation requires provider-confirmed payment</li>
        </ul></div>
        <div class="card"><h3>Payment reality</h3><p class="muted" style="font-size:.88rem">MAVYRON records subscription invoices and provider events. Card collection through Stripe or PayPal, and mobile money through Kenyan providers, become available only after the platform’s provider credentials and webhooks are configured. Nothing is marked paid without a verified provider event.</p></div>
      </div>
    </div></section>`,
  });
}

export function industriesPage({ user }) {
  return publicPage({
    title: 'Industries',
    description: 'MAVYRON industry architecture for salons, spas, clinics, hospitals, restaurants, hotels, gyms, retail and professional services.',
    user,
    active: 'industries',
    body: `<section class="section"><div class="wrap">
      ${sectionHead('Industries', 'One platform. Industry-specific operations.', 'An industry pack changes terminology, defaults and enabled modules. It never forks the platform, so every vertical benefits from the same booking, CRM, AI and analytics core.')}
      <div class="grid g2">
        ${INDUSTRIES.map(([t, d]) => `<div class="card"><h3>${esc(t)}</h3><p class="muted" style="font-size:.9rem;margin:.5rem 0 0">${esc(d)}</p></div>`).join('')}
      </div>
      <div class="card mt4"><h3>Adding a new vertical</h3><p class="muted" style="font-size:.9rem">Industries are configuration records: label, service terminology, default booking rules, enabled modules and optional clinical controls. A new vertical is added by extending the catalogue — not by duplicating the application.</p><a class="btn mt2" href="/signup">Start with your industry ${icon('arrow')}</a></div>
    </div></section>`,
  });
}

export function healthcarePage({ user }) {
  return publicPage({
    title: 'Healthcare',
    description: 'MAVYRON Health: patient administration, encounters, queues, admissions, billing and patient portal with strict clinical access control.',
    user,
    active: 'healthcare',
    body: `<section class="section"><div class="wrap">
      ${sectionHead('MAVYRON Health', 'Healthcare operations, governed properly.', 'Healthcare is a vertical inside MAVYRON — not a separate product with a separate database. The hierarchy is organisation, facility, branch, department, provider, patient and encounter.')}
      <div class="grid g3">
        ${[
          ['Patient administration', 'Registration, patient numbers, demographics, consent and duplicate detection.'],
          ['Clinical workflow', 'Encounters, vitals, clinical notes entered by authorised clinicians, diagnoses, prescriptions, laboratory and imaging requests.'],
          ['Operations', 'Queues, triage, admissions, beds, wards, discharge and referral tracking.'],
          ['Billing & insurance', 'Invoices, payer records, insurance details, payments and outstanding balances.'],
          ['Patient portal', 'Patients see only their own appointments, documents, prescriptions, results and invoices.'],
          ['Audit trail', 'Clinical record access and changes are recorded with actor, action, context and result.'],
        ].map(([t, d]) => `<div class="card tight"><h3 style="font-size:.98rem">${esc(t)}</h3><p class="muted" style="font-size:.84rem;margin:.4rem 0 0">${esc(d)}</p></div>`).join('')}
      </div>
      <div class="card mt4" style="border-color:rgba(201,169,110,.35)">
        <h3>Clinical AI boundaries</h3>
        <p class="muted" style="font-size:.9rem">AI in MAVYRON Health assists with administration, navigation, scheduling and documentation drafts. It does not independently diagnose, prescribe or make high-risk clinical decisions. Clinical decision support is treated as a high-risk capability that requires clinical governance, validation and regulatory review before it can be enabled.</p>
        <p class="mono muted" style="font-size:.72rem;margin:0">MAVYRON does not claim HIPAA, GDPR, Kenya Data Protection Act or any other certification unless it has been independently achieved and verified.</p>
      </div>
      <div class="mt3"><a class="btn btn-primary" href="/signup?industry=clinic">Create a healthcare workspace</a></div>
    </div></section>`,
  });
}

export function securityPage({ user }) {
  return publicPage({
    title: 'Security',
    description: 'How MAVYRON enforces authentication, tenant isolation, authorization, secret handling and webhook verification.',
    user,
    active: 'security',
    body: `<section class="section"><div class="wrap">
      ${sectionHead('Security model', 'Claims you can verify in the code.', 'This page describes implemented controls, not aspirational certification. Where a control depends on infrastructure configuration, it is stated.')}
      <div class="grid g2">
        ${[
          ['Authentication', 'Passwords are hashed with scrypt and a per-user salt. Sessions are HTTP-only cookies with server-side revocation, expiry and rotation after password reset. Failed logins are counted and locked temporarily.'],
          ['Authorization', 'Roles are checked on the server for every workspace route and action. Owner, manager, receptionist, staff and AI roles have explicit permission sets. Denials are audited.'],
          ['Tenant isolation', 'The business is resolved from the URL slug plus the authenticated user’s active membership. Queries are scoped by business_id; the interface is never the enforcement point.'],
          ['Secrets', 'Integration credentials are encrypted with AES-256-GCM before storage and are never returned to the browser. API keys are stored as hashes with a visible prefix only.'],
          ['Input handling', 'Every write validates required fields, numeric ranges, ownership of referenced records and state transitions. Output is HTML-escaped by default.'],
          ['Webhooks', 'Stripe signatures, Meta X-Hub-Signature-256 and Twilio signatures are verified against configured secrets before any state change. Invalid signatures are rejected and logged.'],
          ['Audit log', 'Sensitive actions record who, what, when, context and result: sign-in, permission denial, booking changes, customer access, integration changes, AI actions, admin actions and exports.'],
          ['Deployment notes', 'Production should terminate TLS at the proxy, set COOKIE_SECURE=1, use a persistent data volume and configure provider credentials through environment variables. The application does not claim backups unless a backup process is actually configured.'],
        ].map(([t, d]) => `<div class="card"><h3>${esc(t)}</h3><p class="muted" style="font-size:.9rem;margin-top:.5rem">${esc(d)}</p></div>`).join('')}
      </div>
      <div class="card mt4"><h3>Data protection commitments</h3><p class="muted" style="font-size:.9rem">No card numbers or CVV are stored. Payment state comes from provider events. Personal data exports and deletion workflows are scoped to a tenant and recorded. Secrets are supplied through environment variables or the encrypted integration store — never committed to source control.</p><a class="btn mt2" href="/contact?topic=security">Report a security concern</a></div>
    </div></section>`,
  });
}

export function partnersPage({ user }) {
  return publicPage({
    title: 'Partnerships',
    description: 'Partner with MAVYRON as an implementation partner, payment provider, telephony provider or vertical specialist.',
    user,
    active: 'partners',
    body: `<section class="section"><div class="wrap">
      ${sectionHead('Partnerships', 'Extend the operating system.', 'MAVYRON exposes versioned APIs, scoped API keys and signed webhooks so partners can build on the platform without access to another tenant’s data.')}
      <div class="grid g3">
        ${[
          ['Implementation partners', 'Deploy MAVYRON for service businesses and healthcare facilities, with branch-level configuration.'],
          ['Payment providers', 'Integrate hosted checkout and verified settlement events for card and mobile money.'],
          ['Telephony & voice', 'Connect approved voice providers for AI reception and call routing.'],
          ['Vertical specialists', 'Contribute industry packs: terminology, defaults and workflow templates.'],
          ['Agencies', 'Manage client workspaces with explicit membership and role boundaries.'],
          ['Developers', 'Build on the REST API with scoped keys, event subscriptions and delivery logs.'],
        ].map(([t, d]) => `<div class="card tight"><h3 style="font-size:.98rem">${esc(t)}</h3><p class="muted" style="font-size:.84rem;margin:.4rem 0 0">${esc(d)}</p></div>`).join('')}
      </div>
      <div class="card mt4"><h3>Start a conversation</h3><p class="muted" style="font-size:.9rem">Tell us what you operate and how you would integrate. We respond from the MAVYRON team — no automated partnership approval.</p><a class="btn btn-primary mt2" href="/contact?topic=partnership">Contact partnerships</a></div>
    </div></section>`,
  });
}

export function contactPage({ user, sent = false, error = '' }) {
  return publicPage({
    title: 'Contact',
    description: 'Contact MAVYRON in Nairobi: WhatsApp, phone and email, or send a message to the team.',
    user,
    active: 'contact',
    body: `<section class="section"><div class="wrap split">
      <div>
        <span class="eyebrow">Contact</span>
        <h1 style="font-size:clamp(2rem,4vw,2.9rem);margin:.7rem 0 1rem">Talk to the team behind the platform.</h1>
        <p class="lede">Product questions, walkthroughs, partnerships and support. Messages are stored in the platform and routed to the team — not discarded into a fake success screen.</p>
        <div class="card mt3">
          <dl class="kv">
            <dt>WhatsApp</dt><dd><a href="https://wa.me/254702597951" rel="noopener">${esc(BRAND.whatsapp)}</a></dd>
            <dt>Enquiries</dt><dd><a href="tel:+254748734197">${esc(BRAND.enquiries)}</a></dd>
            <dt>Email</dt><dd><a href="mailto:${attr(BRAND.email)}">${esc(BRAND.email)}</a></dd>
            <dt>Office</dt><dd>${esc(BRAND.location)}</dd>
            <dt>Founder</dt><dd>${esc(BRAND.founder)}</dd>
          </dl>
        </div>
      </div>
      <div class="card">
        <h3>Send a message</h3>
        ${sent ? `<div class="flash flash-ok">${icon('check')}<div>Your message was recorded. Reference <strong>${esc(sent)}</strong>. The team will respond through the contact details you provided.</div></div>` : ''}
        ${error ? `<div class="flash flash-err">${esc(error)}</div>` : ''}
        <form method="post" action="/contact">
          <input type="hidden" name="_csrf" value="${attr(user?.csrf || '')}">
          <div class="field-row">
            <div class="field"><label for="cname">Full name</label><input id="cname" name="name" required></div>
            <div class="field"><label for="cemail">Email</label><input id="cemail" name="email" type="email" required></div>
          </div>
          <div class="field-row">
            <div class="field"><label for="cphone">Phone / WhatsApp</label><input id="cphone" name="phone" placeholder="07…"></div>
            <div class="field"><label for="cbiz">Business</label><input id="cbiz" name="business" placeholder="Business name"></div>
          </div>
          <div class="field"><label for="ctopic">Topic</label>
            <select id="ctopic" name="topic">
              <option value="demo">Product walkthrough</option>
              <option value="pricing">Pricing & plans</option>
              <option value="partnership">Partnership</option>
              <option value="healthcare">Healthcare deployment</option>
              <option value="support">Support</option>
              <option value="security">Security</option>
              <option value="other">Something else</option>
            </select>
          </div>
          <div class="field"><label for="cmsg">Message</label><textarea id="cmsg" name="message" required placeholder="What would you like to achieve?"></textarea></div>
          <button class="btn btn-primary btn-block" type="submit">Send message ${icon('arrow')}</button>
          <p class="hint">By sending, you agree that MAVYRON may contact you about this enquiry. We do not add you to marketing lists without consent.</p>
        </form>
      </div>
    </div></section>`,
  });
}

export function legalPage({ user, kind }) {
  const isPrivacy = kind === 'privacy';
  const title = isPrivacy ? 'Privacy notice' : 'Terms of service';
  return publicPage({
    title,
    description: isPrivacy ? 'How MAVYRON handles personal data.' : 'Terms governing use of the MAVYRON platform.',
    user,
    body: `<section class="section"><div class="wrap-sm">
      <span class="eyebrow">Legal</span>
      <h1 style="font-size:2rem;margin:.6rem 0 1rem">${esc(title)}</h1>
      <div class="card">
        <p class="muted" style="font-size:.86rem">Last updated ${esc(prettyDate(new Date().toISOString().slice(0, 10)))}. This is the operational notice for the MAVYRON platform. It is not a substitute for legal advice and does not claim certification under any data-protection framework.</p>
        ${isPrivacy ? `
        <h3 class="mt2">Data we process</h3>
        <p class="muted" style="font-size:.9rem">Account identity (name, email, phone), business configuration, customer records created by a tenant, booking and payment metadata, conversation content, integration credentials (encrypted) and audit records.</p>
        <h3 class="mt2">Tenant responsibility</h3>
        <p class="muted" style="font-size:.9rem">Each business is the controller of its customer data. MAVYRON processes that data to operate the workspace. Businesses must obtain consent for marketing messages and comply with applicable law in their jurisdiction.</p>
        <h3 class="mt2">Retention and deletion</h3>
        <p class="muted" style="font-size:.9rem">Tenant data is retained while the workspace is active. Deletion requests are recorded, authorised and executed with an audit trail. Some records may be retained where law requires it.</p>
        <h3 class="mt2">Sub-processors</h3>
        <p class="muted" style="font-size:.9rem">Email, SMS, WhatsApp, payment, AI and voice providers are used only when a business or the platform configures them. Provider names and connection states are visible in the integration centre.</p>` : `
        <h3 class="mt2">Use of the platform</h3>
        <p class="muted" style="font-size:.9rem">You may use MAVYRON to operate your business. You may not use it to send unlawful messages, store data you have no right to process, attempt to access another tenant’s data, or misrepresent AI-generated content as verified clinical advice.</p>
        <h3 class="mt2">Subscriptions</h3>
        <p class="muted" style="font-size:.9rem">Plans are billed per the selected interval. A subscription becomes active only after a payment provider confirms payment. Trials convert only with an authorised activation.</p>
        <h3 class="mt2">Availability</h3>
        <p class="muted" style="font-size:.9rem">The platform is provided on a best-effort basis for development and commercial use. No uptime guarantee is offered unless a separate written agreement exists.</p>
        <h3 class="mt2">Clinical boundary</h3>
        <p class="muted" style="font-size:.9rem">MAVYRON Health is administrative software. It does not provide diagnosis, prescriptions or clinical decisions, and it does not claim regulatory certification.</p>`}
      </div>
    </div></section>`,
  });
}

export function statusPage({ user, health }) {
  const rows = [
    ['Web application', health.app ? 'operational' : 'degraded', health.app ? 'Serving requests' : 'Not responding'],
    ['Database', health.db ? 'operational' : 'degraded', health.db ? `${health.counts.businesses} businesses · ${health.counts.bookings} bookings` : 'Unavailable'],
    ['AI providers', health.ai.configured ? 'operational' : 'configuration_required', health.ai.configured ? `${health.ai.provider} configured` : 'No provider key configured'],
    ['Email delivery', health.channels.email ? 'operational' : 'configuration_required', health.channels.email ? 'Provider configured' : 'RESEND_API_KEY not set'],
    ['SMS delivery', health.channels.sms ? 'operational' : 'configuration_required', health.channels.sms ? 'Provider configured' : 'Twilio credentials not set'],
    ['WhatsApp Business', health.channels.whatsapp ? 'operational' : 'configuration_required', health.channels.whatsapp ? 'Tenant integration connected' : 'No tenant integration connected'],
  ];
  return publicPage({
    title: 'System status',
    description: 'Live MAVYRON platform status derived from configuration and database checks.',
    user,
    body: `<section class="section"><div class="wrap-sm">
      <span class="eyebrow">Status</span>
      <h1 style="font-size:2rem;margin:.6rem 0 1rem">System status</h1>
      <p class="lede">Derived from live configuration checks, not a static page. “Configuration required” means the capability exists but needs credentials.</p>
      <div class="card mt2">
        ${rows.map(([name, state, detail]) => `<div class="flex between" style="padding:.7rem 0;border-bottom:1px solid rgba(174,184,200,.08)">
          <div><strong style="font-size:.92rem">${esc(name)}</strong><div class="muted" style="font-size:.8rem">${esc(detail)}</div></div>
          ${state === 'operational' ? badge('Operational', 'ok') : state === 'degraded' ? badge('Degraded', 'bad') : badge('Configuration required', 'warn')}
        </div>`).join('')}
      </div>
      <p class="mono muted mt2" style="font-size:.7rem">Checked ${esc(new Date().toISOString())}</p>
    </div></section>`,
  });
}
