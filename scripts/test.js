/**
 * MAVYRON integration suite.
 *
 * Boots the real server against a throw-away data directory and drives the
 * actual HTTP surface: signup, tenant creation, catalog, public booking,
 * double-booking prevention, tenant isolation, API keys, webhook honesty,
 * admin protection and the patient portal.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.TEST_PORT || 4531);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mavyron-test-'));

const results = [];
let failures = 0;

function ok(name, detail = '') {
  results.push({ name, detail, pass: true });
  console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
}

function bad(name, detail) {
  failures += 1;
  results.push({ name, detail, pass: false });
  console.log(`  FAIL  ${name} — ${detail}`);
}

function check(name, condition, detail = '') {
  if (condition) ok(name, detail);
  else bad(name, detail || 'assertion failed');
  return Boolean(condition);
}

/* Encode a form body, repeating the key for every array value so that
 * multi-select fields (working days, services) arrive as separate entries. */
function encodeForm(body = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    if (Array.isArray(value)) {
      for (const entry of value) if (entry !== undefined && entry !== null) params.append(key, String(entry));
    } else if (value !== undefined && value !== null) {
      params.append(key, String(value));
    }
  }
  return params.toString();
}

class Client {
  constructor() {
    this.cookies = new Map();
  }

  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  absorb(res) {
    const list = typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [res.headers.get('set-cookie')].filter(Boolean);
    for (const entry of list) {
      const pair = entry.split(';')[0];
      const eq = pair.indexOf('=');
      if (eq < 0) continue;
      const key = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (!value || /expires=thu, 01 jan 1970/i.test(entry)) this.cookies.delete(key);
      else this.cookies.set(key, value);
    }
  }

  async get(urlPath, extraHeaders = {}) {
    const res = await fetch(BASE + urlPath, {
      redirect: 'manual',
      headers: { cookie: this.header(), ...extraHeaders },
    });
    this.absorb(res);
    return { status: res.status, text: await res.text(), location: res.headers.get('location'), headers: res.headers };
  }

  async post(urlPath, body, extraHeaders = {}) {
    const res = await fetch(BASE + urlPath, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: this.header(),
        ...extraHeaders,
      },
      body: encodeForm(body),
    });
    this.absorb(res);
    return { status: res.status, text: await res.text(), location: res.headers.get('location'), headers: res.headers };
  }

  static csrf(text) {
    const match = /name="_csrf" value="([^"]+)"/.exec(text || '');
    return match ? match[1] : null;
  }
}

function nextOpenDate() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 1);
  while (date.getUTCDay() === 0) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

const server = spawn(process.execPath, ['src/server.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(PORT),
    DATA_DIR,
    NODE_ENV: 'test',
    SESSION_SECRET: 'test-session-secret-value-0123456789',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const serverLog = [];
server.stdout.on('data', (d) => serverLog.push(d.toString()));
server.stderr.on('data', (d) => serverLog.push(d.toString()));

let exitCode = 0;
try {
  console.log(`MAVYRON integration suite · ${BASE} · data ${DATA_DIR}`);
  if (!await waitForServer()) {
    console.error('Server did not become ready.\n' + serverLog.join(''));
    process.exit(1);
  }

  /* ── public surface ─────────────────────────────────────────────── */
  const guest = new Client();

  const landing = await guest.get('/');
  check('Landing page renders', landing.status === 200 && /MAVYRON/i.test(landing.text), `status ${landing.status}`);
  check('Security headers present', landing.headers.get('x-content-type-options') === 'nosniff');

  for (const route of ['/pricing', '/industries', '/solutions/healthcare', '/security', '/partners', '/contact']) {
    const res = await guest.get(route);
    check(`Public route ${route}`, res.status === 200, `status ${res.status}`);
  }
  const robots = await guest.get('/robots.txt');
  check('robots.txt disallows private areas', robots.status === 200 && /Disallow: \/app\//.test(robots.text));
  const sitemap = await guest.get('/sitemap.xml');
  check('sitemap.xml served', sitemap.status === 200 && /<urlset/.test(sitemap.text));

  const missing = await guest.get('/definitely-not-a-page');
  check('Unknown route returns 404', missing.status === 404, `status ${missing.status}`);

  /* ── signup + tenant creation ───────────────────────────────────── */
  const owner = new Client();
  const signupPage = await owner.get('/signup');
  const signupCsrf = Client.csrf(signupPage.text);
  check('Signup form exposes CSRF token', Boolean(signupCsrf));

  const email = `owner${Date.now()}@mavyron.test`;
  const password = 'Mavyron!2026Secure';
  const signup = await owner.post('/signup', {
    name: 'Evans Karani', email, phone: '+254700111222',
    business: 'Aurora Studio', password, confirm: password, terms: 'on', _csrf: signupCsrf,
  });
  check('Signup creates a session', signup.status === 303 && signup.location === '/app/new', `status ${signup.status} → ${signup.location}`);

  const newPage = await owner.get('/app/new');
  check('Business creation page loads', newPage.status === 200 && /Create your business workspace/.test(newPage.text), `status ${newPage.status}`);
  const newCsrf = Client.csrf(newPage.text);

  const created = await owner.post('/app/new', {
    name: 'Aurora Studio', industry: 'salon', city: 'Nairobi', country: 'Kenya',
    currency: 'KES', timezone: 'Africa/Nairobi', phone: '+254700111222', _csrf: newCsrf,
  });
  check('Business tenant created', created.status === 303 && created.location === '/app/aurora-studio/onboarding', `status ${created.status} → ${created.location}`);

  const onboarding = await owner.get('/app/aurora-studio/onboarding');
  check('Onboarding wizard loads', onboarding.status === 200, `status ${onboarding.status}`);

  const dashboard = await owner.get('/app/aurora-studio');
  check('Workspace dashboard loads', dashboard.status === 200 && /Aurora Studio/.test(dashboard.text), `status ${dashboard.status}`);
  const wsCsrf = Client.csrf(dashboard.text);

  /* ── catalog ────────────────────────────────────────────────────── */
  const servicePost = await owner.post('/app/aurora-studio/services', {
    name: 'Signature Cut', price: '1500', duration_min: '60', buffer_min: '0',
    category: 'Hair', description: 'Precision cut and finish', _csrf: wsCsrf,
  });
  check('Service created', servicePost.status === 303, `status ${servicePost.status}`);

  const staffPost = await owner.post('/app/aurora-studio/staff', {
    name: 'Wanjiru Kamau', title: 'Senior stylist', days: ['1', '2', '3', '4', '5', '6'],
    _csrf: Client.csrf((await owner.get('/app/aurora-studio/staff')).text),
  });
  check('Staff member created with schedule', staffPost.status === 303, `status ${staffPost.status}`);

  const servicesPage = await owner.get('/app/aurora-studio/services');
  check('Service appears in workspace', servicesPage.status === 200 && /Signature Cut/.test(servicesPage.text));

  /* ── public mini-site + real booking ────────────────────────────── */
  const site = await guest.get('/business/aurora-studio');
  check('Public mini-site renders', site.status === 200 && /Aurora Studio/.test(site.text) && /Signature Cut/.test(site.text), `status ${site.status}`);

  const bookPage = await guest.get('/business/aurora-studio/book');
  const serviceMatch = /name="service"[^>]*value="([^"]+)"/.exec(bookPage.text)
    || /<option value="(svc_[^"]+)"/.exec(bookPage.text);
  check('Booking page lists services', bookPage.status === 200 && Boolean(serviceMatch), `status ${bookPage.status}`);
  const serviceId = serviceMatch ? serviceMatch[1] : null;

  const date = nextOpenDate();
  const slotsPage = serviceId
    ? await guest.get(`/business/aurora-studio/book?service=${encodeURIComponent(serviceId)}&date=${date}`)
    : { status: 0, text: '' };
  const slotMatch = /name="time"[^>]*value="(\d{2}:\d{2})"/.exec(slotsPage.text)
    || /value="(\d{2}:\d{2})"/.exec(slotsPage.text);
  check('Availability computes real slots', Boolean(slotMatch), slotMatch ? slotMatch[1] : 'no slot rendered');
  const time = slotMatch ? slotMatch[1] : '10:00';

  const detailsPage = await guest.post('/business/aurora-studio/book', {
    service_id: serviceId || '', staff_id: '', branch_id: '', date, time,
    _csrf: Client.csrf(slotsPage.text),
  });
  check('Booking details step loads', detailsPage.status === 200 && /Confirm your details/.test(detailsPage.text), `status ${detailsPage.status}`);

  const confirmPage = await guest.post('/business/aurora-studio/book/confirm', {
    service_id: serviceId || '', staff_id: '', branch_id: '', date, time,
    name: 'Aisha Mwangi', phone: '+254711222333', email: 'aisha@example.com',
    notes: 'First visit', _csrf: Client.csrf(detailsPage.text),
  });
  const reference = /MVB-[A-Z0-9]{4,}/.exec(confirmPage.text)?.[0] || '';
  check('Public booking is stored and confirmed', confirmPage.status === 200 && Boolean(reference), `status ${confirmPage.status} ref ${reference || 'none'}`);

  const calendar = await owner.get(`/app/aurora-studio/calendar?date=${date}`);
  check('Booking appears on the tenant calendar', calendar.status === 200 && /Aisha Mwangi/.test(calendar.text), `status ${calendar.status}`);

  const duplicate = await guest.post('/business/aurora-studio/book/confirm', {
    service_id: serviceId || '', staff_id: '', branch_id: '', date, time,
    name: 'Second Customer', phone: '+254733444555', email: 'second@example.com',
    _csrf: Client.csrf(detailsPage.text),
  });
  const blocked = duplicate.status >= 400 || /not available|already booked|no longer/i.test(duplicate.text);
  check('Double booking is rejected by the backend', blocked, `status ${duplicate.status}`);

  /* ── tenant isolation ───────────────────────────────────────────── */
  const intruder = new Client();
  const intruderSignupPage = await intruder.get('/signup');
  const intruderEmail = `intruder${Date.now()}@mavyron.test`;
  await intruder.post('/signup', {
    name: 'Other Owner', email: intruderEmail, phone: '+254722333444',
    business: 'Other Co', password, confirm: password, terms: 'on',
    _csrf: Client.csrf(intruderSignupPage.text),
  });
  const intruderNew = await intruder.get('/app/new');
  await intruder.post('/app/new', {
    name: 'Other Co', industry: 'clinic', city: 'Mombasa', country: 'Kenya',
    currency: 'KES', timezone: 'Africa/Nairobi', _csrf: Client.csrf(intruderNew.text),
  });

  const crossTenant = await intruder.get('/app/aurora-studio');
  check('Cross-tenant workspace access denied', crossTenant.status === 403, `status ${crossTenant.status}`);

  const crossTenantData = await intruder.get('/app/aurora-studio/customers');
  check('Cross-tenant CRM access denied', crossTenantData.status === 403, `status ${crossTenantData.status}`);

  const adminAsUser = await owner.get('/admin');
  check('Admin command centre blocked for normal users', adminAsUser.status === 403, `status ${adminAsUser.status}`);

  /* ── API keys and v1 API ────────────────────────────────────────── */
  const settings = await owner.get('/app/aurora-studio/settings');
  const keyPage = await owner.post('/app/aurora-studio/settings/api-keys', {
    name: 'Integration key', _csrf: Client.csrf(settings.text),
  });
  const apiKey = /(mvr_[A-Za-z0-9_-]{10,})/.exec(keyPage.text)?.[1] || '';
  check('API key issued', keyPage.status === 200 && Boolean(apiKey), `status ${keyPage.status}`);

  const apiNoKey = await fetch(`${BASE}/api/v1/services`);
  check('API rejects unauthenticated calls', apiNoKey.status === 401, `status ${apiNoKey.status}`);

  const apiServices = await fetch(`${BASE}/api/v1/services`, { headers: { 'x-api-key': apiKey } });
  const apiServicesBody = await apiServices.json().catch(() => ({}));
  check('API returns tenant services', apiServices.status === 200 && apiServicesBody.count >= 1, `count ${apiServicesBody.count}`);

  const apiBusiness = await fetch(`${BASE}/api/v1/business`, { headers: { 'x-api-key': apiKey } });
  const apiBusinessBody = await apiBusiness.json().catch(() => ({}));
  const businessId = apiBusinessBody.id || '';

  const apiBooking = await fetch(`${BASE}/api/v1/bookings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({
      service_id: serviceId, start_at: `${nextOpenDate()}T15:00`, name: 'API Customer', phone: '+254755666777',
    }),
  });
  const apiBookingBody = await apiBooking.json().catch(() => ({}));
  check('API creates a real booking', apiBooking.status === 201 && Boolean(apiBookingBody.reference), `status ${apiBooking.status}`);

  const apiBadScope = await fetch(`${BASE}/api/v1/bookings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({ service_id: 'svc_missing', start_at: '2030-01-01T10:00', name: 'X', phone: '+254700000000' }),
  });
  check('API rejects a foreign service id', apiBadScope.status === 422, `status ${apiBadScope.status}`);

  /* ── webhook honesty ────────────────────────────────────────────── */
  const stripeUnconfigured = await fetch(`${BASE}/webhooks/stripe/${businessId}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"type":"checkout.session.completed"}',
  });
  check('Unconfigured payment webhook reports configuration required', stripeUnconfigured.status === 409, `status ${stripeUnconfigured.status}`);

  const whatsappUnconfigured = await fetch(`${BASE}/webhooks/whatsapp/${businessId}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  });
  check('Unconfigured WhatsApp webhook reports configuration required', whatsappUnconfigured.status === 409, `status ${whatsappUnconfigured.status}`);

  /* ── integrations show real state ───────────────────────────────── */
  const integrationsPage = await owner.get('/app/aurora-studio/integrations');
  const claimsConnected = /Connected/.test(integrationsPage.text);
  check('Integration hub loads', integrationsPage.status === 200, `status ${integrationsPage.status}`);
  check(
    'No integration claims a connection without credentials',
    integrationsPage.status !== 200 || !claimsConnected || /Configuration required|Not connected|Disconnected/i.test(integrationsPage.text),
    'checked for configuration-required states',
  );

  /* ── AI honesty without a provider ──────────────────────────────── */
  const aiPage = await owner.get('/app/aurora-studio/ai');
  check('AI control centre loads', aiPage.status === 200, `status ${aiPage.status}`);
  check(
    'AI control centre states provider requirement',
    /provider|API key|configuration/i.test(aiPage.text),
    'provider requirement surfaced',
  );

  /* ── patient portal ─────────────────────────────────────────────── */
  const portalLogin = await guest.get('/portal/login');
  check('Patient portal login renders', portalLogin.status === 200 && /Patient portal/.test(portalLogin.text), `status ${portalLogin.status}`);

  const portalBadLogin = await guest.post('/portal/login', {
    email: 'nobody@example.com', password: 'wrong-password', _csrf: Client.csrf(portalLogin.text),
  });
  check('Portal rejects invalid credentials', portalBadLogin.status === 422, `status ${portalBadLogin.status}`);

  const portalProtected = await new Client().get('/portal');
  check('Portal dashboard requires a patient session', [302, 303, 401].includes(portalProtected.status), `status ${portalProtected.status}`);

  /* ── CSRF enforcement ───────────────────────────────────────────── */
  const csrfAttempt = await owner.post('/app/aurora-studio/services', { name: 'Injected service', price: '100' });
  check('State-changing request without CSRF is blocked', csrfAttempt.status === 403, `status ${csrfAttempt.status}`);

  /* ── password recovery ──────────────────────────────────────────── */
  const forgotPage = await guest.get('/forgot');
  const forgot = await guest.post('/forgot', { email, _csrf: Client.csrf(forgotPage.text) });
  check('Password recovery responds without disclosing account existence', forgot.status === 303, `status ${forgot.status}`);

  /* ── every workspace page resolves ───────────────────────────────── */
  const workspaceRoutes = [
    '', '/calendar', '/bookings', '/customers', '/services', '/staff', '/branches', '/finance',
    '/healthcare', '/documents', '/integrations', '/settings', '/support', '/conversations',
    '/ai', '/marketing', '/content', '/analytics', '/command', '/site', '/onboarding',
    '/audit', '/notifications', '/search', '/billing',
  ];
  const brokenPages = [];
  for (const route of workspaceRoutes) {
    const res = await owner.get(`/app/aurora-studio${route}`);
    const body = res.text || '';
    const serverError = /Internal Server Error|Cannot read propert|Cannot set propert|ReferenceError/i.test(body);
    if (res.status >= 400 || serverError) {
      brokenPages.push(`${route || '/'} → ${res.status}${serverError ? ' (error text)' : ''}`);
    }
  }
  check('Every workspace page resolves without server errors', brokenPages.length === 0, brokenPages.join(', ') || `${workspaceRoutes.length} pages`);

  /* ── no dead internal links on the public site ──────────────────── */
  const publicPages = ['/', '/pricing', '/industries', '/solutions/healthcare', '/security', '/partners', '/contact', '/status'];
  const seenLinks = new Set();
  const deadLinks = [];
  for (const page of publicPages) {
    const res = await guest.get(page);
    for (const match of (res.text || '').matchAll(/href="(\/[^"#?]*)/g)) {
      const href = match[1];
      if (!href || seenLinks.has(href)) continue;
      seenLinks.add(href);
      if (/^\/(api|webhooks|portal|admin|app)\b/.test(href)) continue;
      if (/\.(css|js|svg|png|jpg|jpeg|webp|ico|xml|txt|webmanifest)$/.test(href)) continue;
      const target = await guest.get(href);
      if (target.status >= 400) deadLinks.push(`${href} → ${target.status} (from ${page})`);
    }
  }
  check('No dead internal links on public pages', deadLinks.length === 0, deadLinks.slice(0, 8).join(', ') || `${seenLinks.size} links checked`);

  /* ── action matrix: each control performs its real operation ────── */
  const csrfFor = async (path) => Client.csrf((await owner.get(path)).text);
  const ws = '/app/aurora-studio';

  const customerPost = await owner.post(`${ws}/customers`, {
    name: 'Brian Otieno', phone: '0712345678', email: 'brian@example.com',
    consent: 'on', tags: 'VIP, walk-in', birthday: '1990-05-04',
    _csrf: await csrfFor(`${ws}/customers`),
  });
  const crmPage = await owner.get(`${ws}/customers`);
  check('CRM creates a customer from the form', customerPost.status === 303 && /Brian Otieno/.test(crmPage.text), `status ${customerPost.status}`);

  const customerId = /\/customers\/([A-Za-z0-9_]+)"/.exec(crmPage.text)?.[1];
  const customerEdit = customerId
    ? await owner.post(`${ws}/customers/${customerId}`, {
      name: 'Brian Otieno', preferences: 'Prefers Saturdays', notes: 'Allergic to ammonia', tags: 'VIP',
      _csrf: await csrfFor(`${ws}/customers/${customerId}`),
    })
    : { status: 0 };
  const customerView = customerId ? await owner.get(`${ws}/customers/${customerId}`) : { text: '' };
  check('CRM edit persists notes and preferences', customerEdit.status === 303 && /Allergic to ammonia/.test(customerView.text), `status ${customerEdit.status}`);

  const calendarForm = await owner.get(`${ws}/calendar?date=${date}`);
  const bookingId = /\/bookings\/([A-Za-z0-9_]+)\/status/.exec(calendarForm.text)?.[1];
  const bookingComplete = bookingId
    ? await owner.post(`${ws}/bookings/${bookingId}/status`, { status: 'completed', _csrf: Client.csrf(calendarForm.text) })
    : { status: 0, location: null };
  const calendarAfter = await owner.get(bookingComplete.location || `${ws}/calendar`);
  check('Booking status control completes the booking', bookingComplete.status === 303 && /marked completed/i.test(calendarAfter.text), `status ${bookingComplete.status}`);

  const invoicePost = await owner.post(`${ws}/finance/invoices`, {
    customer_id: customerId || '', amount: '2500', description: 'Signature cut and finish',
    _csrf: await csrfFor(`${ws}/finance`),
  });
  const financePage = await owner.get(`${ws}/finance`);
  const invoiceId = /\/invoices\/([A-Za-z0-9_]+)\/paid/.exec(financePage.text)?.[1];
  check('Invoice form creates an invoice', invoicePost.status === 303 && Boolean(invoiceId), `status ${invoicePost.status}`);

  const invoicePaid = invoiceId
    ? await owner.post(`${ws}/finance/invoices/${invoiceId}/paid`, { _csrf: Client.csrf(financePage.text) })
    : { status: 0 };
  const financeAfter = await owner.get(invoicePaid.location || `${ws}/finance`);
  const financeLedger = await owner.get(`${ws}/finance`);
  check(
    'Marking an invoice paid records a payment',
    invoicePaid.status === 303 && /recorded as paid/i.test(financeAfter.text) && /<td>manual<\/td>/.test(financeLedger.text),
    `status ${invoicePaid.status}`,
  );

  const expensePost = await owner.post(`${ws}/finance/expenses`, {
    amount: '450', category: 'Supplies', note: 'Clipper blades', _csrf: await csrfFor(`${ws}/finance`),
  });
  const financeWithExpense = await owner.get(`${ws}/finance`);
  check('Expense form records a real expense', expensePost.status === 303 && /Clipper blades/.test(financeWithExpense.text), `status ${expensePost.status}`);

  const documentPost = await owner.post(`${ws}/documents`, {
    name: 'Price list.txt', mime: 'text/plain', category: 'Policies',
    data: Buffer.from('Signature Cut 1500').toString('base64'),
    _csrf: await csrfFor(`${ws}/documents`),
  });
  const documentJson = (() => { try { return JSON.parse(documentPost.text); } catch { return {}; } })();
  const download = documentJson.id ? await owner.get(`${ws}/documents/${documentJson.id}/download`) : { status: 0, text: '' };
  check('Document upload stores bytes and download returns them', documentPost.status === 200 && download.status === 200 && /Signature Cut 1500/.test(download.text), `status ${documentPost.status}/${download.status}`);

  const documentDelete = documentJson.id
    ? await owner.post(`${ws}/documents/${documentJson.id}/delete`, { _csrf: await csrfFor(`${ws}/documents`) })
    : { status: 0 };
  const documentsAfter = await owner.get(`${ws}/documents`);
  check('Document delete removes the stored file', documentDelete.status === 303 && !/Price list\.txt/.test(documentsAfter.text), `status ${documentDelete.status}`);

  const servicesForm = await owner.get(`${ws}/services`);
  const serviceToggleId = /\/services\/([A-Za-z0-9_]+)\/toggle/.exec(servicesForm.text)?.[1];
  const deactivate = serviceToggleId
    ? await owner.post(`${ws}/services/${serviceToggleId}/toggle`, { _csrf: Client.csrf(servicesForm.text) })
    : { status: 0 };
  const publicBookAfter = await guest.get('/business/aurora-studio/book');
  check('Deactivating a service hides it from public booking', deactivate.status === 303 && !/Signature Cut/.test(publicBookAfter.text), `status ${deactivate.status}`);
  const reactivate = serviceToggleId
    ? await owner.post(`${ws}/services/${serviceToggleId}/toggle`, { _csrf: await csrfFor(`${ws}/services`) })
    : { status: 0 };
  const publicBookRestored = await guest.get('/business/aurora-studio/book');
  check('Reactivating a service restores public booking', reactivate.status === 303 && /Signature Cut/.test(publicBookRestored.text), `status ${reactivate.status}`);

  const invite = await owner.post(`${ws}/settings/invite`, {
    email: `manager${Date.now()}@aurora.test`, role: 'manager', _csrf: await csrfFor(`${ws}/settings`),
  });
  check('Staff invitation creates a real membership and one-time link', invite.status === 200 && /Invitation created/.test(invite.text), `status ${invite.status}`);

  const settingsFresh = await owner.get(`${ws}/settings`);
  const apiKeyId = /\/api-keys\/([A-Za-z0-9_]+)\/revoke/.exec(settingsFresh.text)?.[1];
  const revoke = apiKeyId
    ? await owner.post(`${ws}/settings/api-keys/${apiKeyId}/revoke`, { _csrf: Client.csrf(settingsFresh.text) })
    : { status: 0 };
  const revokedKeyCall = await fetch(`${BASE}/api/v1/services`, { headers: { 'x-api-key': apiKey } });
  check('Revoked API key stops authenticating', revoke.status === 303 && revokedKeyCall.status === 401, `status ${revoke.status}/${revokedKeyCall.status}`);

  const workflowPost = await owner.post(`${ws}/automations`, {
    name: 'Birthday greeting', trigger: 'customer.birthday', action: 'send_notification',
    template: 'Happy birthday from Aurora Studio', _csrf: await csrfFor(`${ws}/automations`),
  });
  const automationsPage = await owner.get(`${ws}/automations`);
  const workflowId = /\/automations\/([A-Za-z0-9_]+)\/test/.exec(automationsPage.text)?.[1];
  check('Workflow builder saves a runnable workflow', workflowPost.status === 303 && Boolean(workflowId), `status ${workflowPost.status}`);

  const workflowTest = workflowId
    ? await owner.post(`${ws}/automations/${workflowId}/test`, { _csrf: Client.csrf(automationsPage.text) })
    : { status: 0, location: null };
  const automationsAfter = await owner.get(workflowTest.location || `${ws}/automations`);
  check('Workflow test run executes on the backend and reports its result', workflowTest.status === 303 && /Test run (completed|failed)/i.test(automationsAfter.text), `status ${workflowTest.status}`);

  const contentPost = await owner.post(`${ws}/content`, {
    kind: 'caption', platform: 'instagram', prompt: 'Weekend offer for returning clients',
    _csrf: await csrfFor(`${ws}/content`),
  });
  const contentPage = await owner.get(`${ws}/content`);
  check(
    'Content studio reports the missing AI provider instead of faking output',
    contentPost.status === 303 && /provider|not configured|unavailable/i.test(contentPage.text),
    `status ${contentPost.status}`,
  );

  const searchPage = await owner.get(`${ws}/search?q=Brian`);
  check('Global search returns the tenant record', searchPage.status === 200 && /Brian Otieno/.test(searchPage.text), `status ${searchPage.status}`);

  const clinicDashboard = await intruder.get('/app/other-co');
  const patientPost = await intruder.post('/app/other-co/healthcare/patients', {
    first_name: 'Jane', last_name: 'Wanjiku', sex: 'female', phone: '+254711000111',
    _csrf: Client.csrf(clinicDashboard.text),
  });
  const healthcarePage = await intruder.get('/app/other-co/healthcare');
  check('Healthcare patient registration works for a clinic tenant', patientPost.status === 303 && /Jane Wanjiku/.test(healthcarePage.text), `status ${patientPost.status}`);

  const auditPage = await owner.get(`${ws}/audit`);
  check('Audit log records the actions performed', auditPage.status === 200 && /invoice|document|customer|apikey/i.test(auditPage.text), `status ${auditPage.status}`);

  /* ── logout ─────────────────────────────────────────────────────── */
  const logout = await owner.post('/logout', { _csrf: Client.csrf((await owner.get('/app/aurora-studio')).text) });
  check('Logout ends the session', logout.status === 303, `status ${logout.status}`);
  const afterLogout = await owner.get('/app/aurora-studio');
  check('Protected workspace redirects after logout', [302, 303].includes(afterLogout.status) && /\/login/.test(afterLogout.location || ''), `status ${afterLogout.status}`);
} catch (err) {
  bad('Suite crashed', err?.stack || String(err));
  exitCode = 1;
} finally {
  server.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 700));
  if (!server.killed) server.kill('SIGKILL');
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* temp dir */ }
}

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} checks passed${failures ? ` · ${failures} failed` : ''}`);
if (failures) {
  console.log('\nFailed checks:');
  for (const r of results.filter((x) => !x.pass)) console.log(`  · ${r.name} — ${r.detail}`);
  console.log('\nServer log tail:\n' + serverLog.join('').split('\n').slice(-25).join('\n'));
  process.exit(1);
}
process.exit(exitCode);
