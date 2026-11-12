import express from 'express';
import QRCode from 'qrcode';
import { all, get, insert, run, update, tenantRow } from '../lib/db.js';
import {
  id, nowIso, isoDate, addDays, prettyDate, parseJson, isEmail,
  normalisePhone, money, esc, attr,
} from '../lib/util.js';
import { createBooking, cancelBooking, dayAvailability, bookingRules } from '../lib/booking.js';
import { hashPassword, verifyPassword, sha256, PATIENT_COOKIE, cookieOptions } from '../lib/security.js';
import { startPatientSession, requirePatient } from '../lib/auth.js';
import { publicPage, csrfField, badge, emptyState } from '../views/layout.js';
import {
  businessSitePage, bookingPage, bookingConfirmPage, businessNotFoundPage,
} from '../views/site.js';
import { notFound, validation } from '../lib/errors.js';
import { recordAudit } from '../lib/audit.js';

const router = express.Router();
export const portalRouter = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ───────────────────────── tenant resolution ───────────────────────── */

function loadSite(req, res, next) {
  const business = get('SELECT * FROM businesses WHERE slug = ?', [req.params.slug]);
  if (!business) return res.status(404).type('html').send(businessNotFoundPage());
  if (business.status === 'suspended') {
    return res.status(403).type('html').send(publicPage({
      title: 'Booking unavailable',
      description: 'This business page is temporarily unavailable.',
      body: `<div class="wrap site-body narrow"><div class="card">${emptyState('Booking unavailable', 'This business page is not accepting bookings right now.')}</div></div>`,
    }));
  }
  req.siteBusiness = business;
  next();
}

function nextDates(count = 21) {
  const today = isoDate();
  return Array.from({ length: count }, (_, index) => {
    const value = addDays(today, index);
    const label = index === 0 ? `Today · ${prettyDate(value, 'UTC')}` : prettyDate(value, 'UTC');
    return { value, label };
  });
}

/* ───────────────────────── public business page ───────────────────────── */

router.get('/:slug', wrap(async (req, res) => {
  const business = req.siteBusiness;
  const branches = all(
    'SELECT * FROM branches WHERE business_id = ? AND is_active = 1 ORDER BY is_primary DESC, name',
    [business.id],
  );
  const primary = branches[0] || null;
  const hours = primary ? all('SELECT * FROM branch_hours WHERE branch_id = ? ORDER BY weekday', [primary.id]) : [];
  const services = all(
    'SELECT * FROM services WHERE business_id = ? AND is_active = 1 ORDER BY name',
    [business.id],
  );
  const staff = all('SELECT * FROM staff WHERE business_id = ? AND is_active = 1 ORDER BY name', [business.id]);
  const gallery = parseJson(business.gallery_json, []);
  const social = parseJson(business.social_json, {});
  const canonical = `${req.protocol}://${req.get('host')}/business/${business.slug}`;
  let qr = null;
  try {
    qr = await QRCode.toDataURL(canonical, {
      margin: 1, width: 360, color: { dark: '#0a1220', light: '#ffffff' },
    });
  } catch {
    qr = null;
  }

  res.type('html').send(businessSitePage({
    business, branches, services, staff, hours, gallery, social, qr,
    showStaff: true, reviewsEnabled: false, csrf: res.locals.csrf,
  }));
}));

/* ───────────────────────── booking flow ───────────────────────── */

router.get('/:slug/book', (req, res) => {
  const business = req.siteBusiness;
  const branches = all(
    'SELECT * FROM branches WHERE business_id = ? AND is_active = 1 ORDER BY is_primary DESC, name',
    [business.id],
  );
  const services = all('SELECT * FROM services WHERE business_id = ? AND is_active = 1 ORDER BY name', [business.id]);
  const staff = all('SELECT * FROM staff WHERE business_id = ? AND is_active = 1 ORDER BY name', [business.id]);
  const dates = nextDates(21);
  const selected = {
    serviceId: String(req.query.service || ''),
    staffId: String(req.query.staff || ''),
    date: dates.some((d) => d.value === req.query.date) ? String(req.query.date) : dates[0].value,
  };

  let slots = [];
  let reason = '';
  if (selected.serviceId) {
    const service = tenantRow('services', selected.serviceId, business.id);
    if (!service || !service.is_active) {
      reason = 'That service is not available for online booking.';
    } else {
      const availability = dayAvailability({
        business, branchId: branches[0]?.id || null, service,
        staffId: selected.staffId || null, date: selected.date,
      });
      slots = availability.slots || [];
      reason = availability.reason || '';
    }
  }

  res.type('html').send(bookingPage({
    business, services, staff, branches, dates, selected, slots, reason, csrf: res.locals.csrf,
  }));
});

router.post('/:slug/book', wrap(async (req, res) => {
  const business = req.siteBusiness;
  const service = tenantRow('services', String(req.body.service_id || ''), business.id);
  if (!service) throw validation('Choose a service before selecting a time.');
  const date = String(req.body.date || '');
  const time = String(req.body.time || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}:\d{2}$/.test(time)) {
    throw validation('Choose an available time.');
  }
  const branchId = req.body.branch_id || null;
  const staffId = req.body.staff_id || null;
  const branch = branchId ? tenantRow('branches', branchId, business.id) : null;
  const staff = staffId ? tenantRow('staff', staffId, business.id) : null;

  const body = `<div class="wrap site-body narrow">
    <div class="card">
      <h1 style="font-size:1.4rem">Confirm your details</h1>
      <p class="muted" style="font-size:.86rem">${esc(service.name)} · ${esc(date)} at ${esc(time)}${staff ? ` · ${esc(staff.name)}` : ''}</p>
      <form method="post" action="/business/${attr(business.slug)}/book/confirm" class="mt2">
        ${csrfField(res.locals.csrf)}
        <input type="hidden" name="service_id" value="${attr(service.id)}">
        <input type="hidden" name="staff_id" value="${attr(staffId || '')}">
        <input type="hidden" name="branch_id" value="${attr(branchId || '')}">
        <input type="hidden" name="date" value="${attr(date)}">
        <input type="hidden" name="time" value="${attr(time)}">
        <div class="field-row">
          <div class="field"><label for="c-name">Full name</label><input id="c-name" name="name" required maxlength="120"></div>
          <div class="field"><label for="c-phone">Phone</label><input id="c-phone" name="phone" required maxlength="30" inputmode="tel"></div>
        </div>
        <div class="field"><label for="c-email">Email (optional)</label><input id="c-email" type="email" name="email" maxlength="160"></div>
        <div class="field"><label for="c-notes">Anything we should know?</label><textarea id="c-notes" name="notes" rows="2" maxlength="500"></textarea></div>
        <div class="btn-row mt2">
          <button class="btn btn-primary" type="submit">Confirm booking</button>
          <a class="btn btn-ghost" href="/business/${attr(business.slug)}/book?service=${attr(service.id)}&date=${attr(date)}">Change time</a>
        </div>
        <p class="hint">Your booking is stored in ${esc(business.name)}'s calendar as soon as you confirm.</p>
      </form>
    </div>
  </div>`;

  res.type('html').send(publicPage({
    title: `Confirm booking · ${business.name}`,
    description: `Confirm your appointment at ${business.name}.`,
    body,
  }));
}));

router.post('/:slug/book/confirm', wrap(async (req, res) => {
  const business = req.siteBusiness;
  const service = tenantRow('services', String(req.body.service_id || ''), business.id);
  if (!service) throw validation('That service is no longer available.');
  const name = String(req.body.name || '').trim();
  const phone = String(req.body.phone || '').trim();
  if (name.length < 2) throw validation('Enter your full name.');
  if (phone.replace(/\D/g, '').length < 9) throw validation('Enter a phone number we can reach you on.');

  const date = String(req.body.date || '');
  const time = String(req.body.time || '').padStart(5, '0');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}:\d{2}$/.test(time)) {
    throw validation('That time slot is no longer valid. Please choose another.');
  }

  const booking = await createBooking({
    business,
    serviceId: service.id,
    staffId: req.body.staff_id || null,
    branchId: req.body.branch_id || null,
    startAt: `${date}T${time}`,
    customer: {
      name,
      phone: normalisePhone(phone),
      email: isEmail(String(req.body.email || '')) ? String(req.body.email).trim() : null,
    },
    notes: String(req.body.notes || '').trim() || null,
    source: 'public_booking_page',
  });

  const staff = booking.staff_id ? tenantRow('staff', booking.staff_id, business.id) : null;
  const branch = booking.branch_id ? tenantRow('branches', booking.branch_id, business.id) : null;

  res.type('html').send(bookingConfirmPage({
    business, booking, service, staff, branch,
    cancelled: false, contactRequired: false, csrf: res.locals.csrf,
  }));
}));

router.post('/:slug/booking/:reference/cancel', wrap(async (req, res) => {
  const business = req.siteBusiness;
  const booking = get('SELECT * FROM bookings WHERE reference = ? AND business_id = ?', [
    String(req.params.reference || ''), business.id,
  ]);
  if (!booking) throw notFound('That booking reference was not found for this business.');
  const service = booking.service_id ? tenantRow('services', booking.service_id, business.id) : null;

  if (booking.status === 'cancelled') {
    return res.type('html').send(bookingConfirmPage({
      business, booking, service, staff: null, branch: null,
      cancelled: true, contactRequired: false, csrf: res.locals.csrf,
    }));
  }

  const rules = bookingRules(business);
  const hoursUntil = (new Date(booking.start_at).getTime() - Date.now()) / 3_600_000;
  if (hoursUntil < rules.cancelNoticeHours) {
    throw validation(
      `This appointment starts in less than ${rules.cancelNoticeHours} hour(s). Please contact ${business.name} directly to cancel.`,
    );
  }

  cancelBooking({ business, bookingId: booking.id, reason: 'Cancelled by customer', actor: null });
  const refreshed = get('SELECT * FROM bookings WHERE id = ?', [booking.id]);
  res.type('html').send(bookingConfirmPage({
    business, booking: refreshed, service, staff: null, branch: null,
    cancelled: true, contactRequired: false, csrf: res.locals.csrf,
  }));
}));

/* ═════════════════════════ patient portal ═════════════════════════ */

function portalShell(req, res, title, body) {
  const account = req.patientAccount;
  const name = account ? `${account.first_name} ${account.last_name}` : '';
  return publicPage({
    title,
    description: 'Secure patient portal',
    canonical: '/portal',
    body: `<div class="wrap site-body narrow">
      ${account ? `<div class="flex between wrap mt2" style="align-items:center">
        <div><strong>${esc(name)}</strong><div class="muted" style="font-size:.78rem">${esc(account.patient_no)} · ${esc(account.business_name)}</div></div>
        <form method="post" action="/portal/logout">${csrfField(res.locals.csrf)}<button class="btn btn-sm btn-ghost" type="submit">Sign out</button></form>
      </div>` : ''}
      ${body}
    </div>`,
  });
}

portalRouter.get('/login', (req, res) => {
  res.type('html').send(portalShell(req, res, 'Patient portal sign in', `
    <div class="card mt2">
      <h1 style="font-size:1.3rem">Patient portal</h1>
      <p class="muted" style="font-size:.86rem">Sign in with the email your clinic registered for you. If you have not activated access yet, use the activation link your clinic gave you.</p>
      <form method="post" action="/portal/login" class="mt2">
        ${csrfField(res.locals.csrf)}
        <div class="field"><label for="p-email">Email</label><input id="p-email" type="email" name="email" required maxlength="160" autocomplete="username"></div>
        <div class="field"><label for="p-pass">Password</label><input id="p-pass" type="password" name="password" required autocomplete="current-password"></div>
        <button class="btn btn-primary" type="submit">Sign in</button>
      </form>
      <p class="hint">Only your own records are ever shown. Every access is written to the facility audit log.</p>
    </div>`));
});

portalRouter.post('/login', wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const account = get('SELECT * FROM patient_accounts WHERE email = ?', [email]);
  const generic = 'Email or password is incorrect.';
  if (!account) throw validation(generic);
  if (!account.activated_at) throw validation('This account has not been activated yet. Use the activation link from your clinic.');
  if (!verifyPassword(password, account.password_hash)) throw validation(generic);

  startPatientSession(account, res);
  recordAudit({
    action: 'patient.login', entityType: 'patient', entityId: account.patient_id,
    businessId: account.business_id, actor: null, actorLabel: email, ip: req.ip,
  });
  res.redirect(303, '/portal');
}));

portalRouter.post('/logout', (req, res) => {
  const token = req.cookies?.[PATIENT_COOKIE];
  if (token) run('UPDATE patient_sessions SET revoked_at = ? WHERE token_hash = ?', [nowIso(), sha256(token)]);
  res.clearCookie(PATIENT_COOKIE, cookieOptions(0));
  res.redirect(303, '/portal/login');
});

portalRouter.get('/activate/:token', (req, res) => {
  const hash = sha256(String(req.params.token || ''));
  const account = get('SELECT * FROM patient_accounts WHERE activation_token_hash = ?', [hash]);
  if (!account || account.activated_at) throw notFound('This activation link is invalid or has already been used.');
  if (account.activation_expires_at && new Date(account.activation_expires_at) < new Date()) {
    throw validation('This activation link has expired. Ask your clinic to issue a new one.');
  }
  res.type('html').send(portalShell(req, res, 'Activate portal access', `
    <div class="card mt2">
      <h1 style="font-size:1.3rem">Create your password</h1>
      <p class="muted" style="font-size:.86rem">Set a password for ${esc(account.email)}. Minimum 10 characters.</p>
      <form method="post" action="/portal/activate/${attr(String(req.params.token))}" class="mt2">
        ${csrfField(res.locals.csrf)}
        <div class="field"><label for="p-new">New password</label><input id="p-new" type="password" name="password" required minlength="10" autocomplete="new-password"></div>
        <div class="field"><label for="p-confirm">Confirm password</label><input id="p-confirm" type="password" name="confirm" required minlength="10" autocomplete="new-password"></div>
        <button class="btn btn-primary" type="submit">Activate access</button>
      </form>
    </div>`));
});

portalRouter.post('/activate/:token', wrap(async (req, res) => {
  const hash = sha256(String(req.params.token || ''));
  const account = get('SELECT * FROM patient_accounts WHERE activation_token_hash = ?', [hash]);
  if (!account || account.activated_at) throw notFound('This activation link is invalid or has already been used.');
  const password = String(req.body.password || '');
  if (password.length < 10) throw validation('Use a password of at least 10 characters.');
  if (password !== String(req.body.confirm || '')) throw validation('The two passwords do not match.');

  update('patient_accounts', account.id, {
    password_hash: hashPassword(password),
    activation_token_hash: null,
    activation_expires_at: null,
    activated_at: nowIso(),
  });
  const activated = get('SELECT * FROM patient_accounts WHERE id = ?', [account.id]);
  startPatientSession(activated, res);
  recordAudit({
    action: 'patient.activated', entityType: 'patient', entityId: account.patient_id,
    businessId: account.business_id, actor: null, actorLabel: account.email, ip: req.ip,
  });
  res.redirect(303, '/portal');
}));

portalRouter.get('/', requirePatient, (req, res) => {
  const account = req.patientAccount;
  const patient = get('SELECT * FROM patients WHERE id = ? AND business_id = ?', [account.patient_id, account.business_id]);
  const appointments = all(
    `SELECT b.*, s.name AS service_name, st.name AS staff_name
       FROM bookings b LEFT JOIN services s ON s.id = b.service_id
       LEFT JOIN staff st ON st.id = b.staff_id
      WHERE b.business_id = ? AND b.patient_id = ? ORDER BY b.start_at DESC LIMIT 50`,
    [account.business_id, account.patient_id],
  );
  const invoices = all(
    'SELECT * FROM invoices WHERE business_id = ? AND patient_id = ? ORDER BY created_at DESC LIMIT 50',
    [account.business_id, account.patient_id],
  );
  const encounters = all(
    'SELECT id, encounter_type, status, reason, started_at, closed_at FROM encounters WHERE business_id = ? AND patient_id = ? ORDER BY started_at DESC LIMIT 25',
    [account.business_id, account.patient_id],
  );

  const body = `
    <div class="card mt2">
      <h2>Your appointments</h2>
      ${appointments.length ? `<div class="table-wrap mt2"><table><thead><tr><th>When</th><th>Service</th><th>Team</th><th>Status</th></tr></thead><tbody>
        ${appointments.map((a) => `<tr><td style="font-size:.8rem">${esc(prettyDate(a.start_at, 'UTC'))}</td>
          <td>${esc(a.service_name || '—')}</td><td>${esc(a.staff_name || '—')}</td><td>${badge(a.status, a.status === 'cancelled' ? 'bad' : 'ok')}</td></tr>`).join('')}
      </tbody></table></div>` : emptyState('No appointments yet', 'Appointments booked with this facility will appear here.')}
    </div>

    <div class="card mt3">
      <h2>Invoices</h2>
      ${invoices.length ? `<div class="table-wrap mt2"><table><thead><tr><th>Invoice</th><th>Amount</th><th>Status</th></tr></thead><tbody>
        ${invoices.map((i) => `<tr><td class="mono" style="font-size:.78rem">${esc(i.number)}</td>
          <td>${money(i.amount_cents, i.currency)}</td><td>${badge(i.status, i.status === 'paid' ? 'ok' : 'warn')}</td></tr>`).join('')}
      </tbody></table></div>` : emptyState('No invoices', 'Billing documents issued to you will appear here.')}
    </div>

    <div class="card mt3">
      <h2>Care record</h2>
      ${encounters.length ? `<div class="table-wrap mt2"><table><thead><tr><th>Date</th><th>Type</th><th>Reason</th><th>Status</th></tr></thead><tbody>
        ${encounters.map((e) => `<tr><td style="font-size:.8rem">${esc(prettyDate(e.started_at, 'UTC'))}</td>
          <td style="font-size:.8rem">${esc(String(e.encounter_type).replace(/_/g, ' '))}</td><td style="font-size:.8rem">${esc(e.reason || '—')}</td>
          <td>${badge(e.status, e.status === 'open' ? 'warn' : 'plain')}</td></tr>`).join('')}
      </tbody></table></div>` : emptyState('No encounters recorded', 'Visits recorded by your clinician will appear here.')}
      <p class="hint">Clinical notes, prescriptions and results are released by your clinician. Contact the facility if something is missing.</p>
    </div>

    <div class="card mt3">
      <h2>Your details</h2>
      <dl class="kv mt2">
        <dt>Patient number</dt><dd class="mono">${esc(account.patient_no)}</dd>
        <dt>Name</dt><dd>${esc(`${account.first_name} ${account.last_name}`)}</dd>
        <dt>Phone</dt><dd>${esc(patient?.phone || '—')}</dd>
        <dt>Email</dt><dd>${esc(account.email)}</dd>
      </dl>
      <p class="hint">To correct your details, contact ${esc(account.business_name)}. Changes are made by facility staff and audited.</p>
    </div>`;

  res.type('html').send(portalShell(req, res, 'Patient portal', body));
});

export default router;
