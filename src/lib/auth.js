import { get, run, insert } from './db.js';
import {
  hashPassword, verifyPassword, randomToken, sha256, safeEqual,
  SESSION_COOKIE, PATIENT_COOKIE, cookieOptions,
} from './security.js';
import { AppError, forbidden } from './errors.js';
import { id, nowIso } from './util.js';
import { recordAudit } from './audit.js';

export const ROLES = ['owner', 'manager', 'receptionist', 'staff', 'ai'];

export const ROLE_PERMISSIONS = {
  owner: ['*'],
  manager: [
    'dashboard.view', 'bookings.view', 'bookings.manage', 'calendar.view',
    'customers.view', 'customers.manage', 'catalog.view', 'catalog.manage',
    'staff.view', 'staff.manage', 'branches.view', 'branches.manage',
    'analytics.view', 'ai.view', 'ai.manage', 'marketing.view', 'marketing.manage',
    'content.view', 'content.manage', 'integrations.view', 'integrations.manage',
    'settings.view', 'support.view', 'support.manage', 'healthcare.view',
    'healthcare.manage', 'api.manage', 'audit.view', 'notifications.view',
  ],
  receptionist: [
    'dashboard.view', 'bookings.view', 'bookings.manage', 'calendar.view',
    'customers.view', 'customers.manage', 'catalog.view', 'staff.view',
    'healthcare.view', 'healthcare.manage', 'support.view', 'analytics.view',
    'notifications.view',
  ],
  staff: ['dashboard.view', 'bookings.view', 'calendar.view', 'customers.view', 'healthcare.view', 'notifications.view'],
  ai: ['bookings.view', 'bookings.manage', 'customers.view', 'knowledge.read'],
};

export function can(role, permission) {
  const list = ROLE_PERMISSIONS[role];
  if (!list) return false;
  if (list.includes('*')) return true;
  return list.includes(permission);
}

export function permissionsFor(role) {
  return ROLE_PERMISSIONS[role] || [];
}

/* ───────────────────────── users & sessions ───────────────────────── */

export function registerUser({ email, name, password, phone = null }) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanName = String(name || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(cleanEmail)) {
    throw new AppError(422, 'Enter a valid email address.', 'validation_error');
  }
  if (cleanName.length < 2) throw new AppError(422, 'Enter your full name.', 'validation_error');
  if (String(password || '').length < 10) {
    throw new AppError(422, 'Password must be at least 10 characters.', 'validation_error');
  }
  if (get('SELECT id FROM users WHERE email = ?', [cleanEmail])) {
    throw new AppError(409, 'An account with that email already exists. Try signing in.', 'email_taken');
  }
  const now = nowIso();
  const user = {
    id: id('usr'),
    email: cleanEmail,
    password_hash: hashPassword(password),
    name: cleanName,
    phone,
    email_verified_at: null,
    is_platform_admin: 0,
    failed_attempts: 0,
    locked_until: null,
    last_login_at: null,
    created_at: now,
    updated_at: now,
  };
  insert('users', user);
  recordAudit({ actor: { id: user.id, email: user.email }, action: 'user.signup', entityType: 'user', entityId: user.id });
  return user;
}

export function authenticate({ email, password, ip, userAgent }) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const user = get('SELECT * FROM users WHERE email = ?', [cleanEmail]);
  if (!user) throw new AppError(401, 'Email or password is incorrect.', 'invalid_credentials');
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    throw new AppError(423, 'Too many failed attempts. Try again later or reset your password.', 'locked');
  }
  if (!verifyPassword(password, user.password_hash)) {
    const attempts = user.failed_attempts + 1;
    const lockUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60_000).toISOString() : null;
    run('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?', [attempts, lockUntil, user.id]);
    recordAudit({
      actor: { id: user.id, email: user.email },
      action: 'user.login',
      entityType: 'user',
      entityId: user.id,
      result: 'failed',
      ip,
      userAgent,
    });
    throw new AppError(401, 'Email or password is incorrect.', 'invalid_credentials');
  }
  run('UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = ? WHERE id = ?', [nowIso(), user.id]);
  recordAudit({ actor: { id: user.id, email: user.email }, action: 'user.login', entityType: 'user', entityId: user.id, ip, userAgent });
  return user;
}

export function startSession(user, req, res) {
  const token = randomToken(32);
  const expires = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  insert('sessions', {
    id: id('ses'),
    user_id: user.id,
    token_hash: sha256(token),
    ip: req.ip || null,
    user_agent: req.get('user-agent')?.slice(0, 300) || null,
    created_at: nowIso(),
    expires_at: expires,
    revoked_at: null,
  });
  res.cookie(SESSION_COOKIE, token, cookieOptions(7 * 24 * 3600 * 1000));
  return token;
}

export function destroySession(req, res) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) {
    run('UPDATE sessions SET revoked_at = ? WHERE token_hash = ?', [nowIso(), sha256(token)]);
  }
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function attachUser(req, _res, next) {
  req.user = null;
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) {
    const row = get(
      `SELECT s.id AS session_id, s.expires_at, u.* FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.revoked_at IS NULL`,
      [sha256(token)]
    );
    if (row && new Date(row.expires_at) > new Date()) {
      req.user = row;
      req.sessionId = row.session_id;
    }
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) {
    const target = encodeURIComponent(req.originalUrl || '/app');
    return res.redirect(`/login?next=${target}`);
  }
  next();
}

export function requirePlatformAdmin(req, res, next) {
  if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  if (!req.user.is_platform_admin) {
    return res.status(403).send('Platform administrator access required.');
  }
  next();
}

/** Resolves :slug into a tenant, enforcing membership. */
export function loadBusiness(req, res, next) {
  if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  const slug = req.params.slug;
  const business = get('SELECT * FROM businesses WHERE slug = ?', [slug]);
  if (!business) return res.status(404).send('Business workspace not found.');
  const membership = get(
    'SELECT * FROM memberships WHERE business_id = ? AND user_id = ? AND status = ?',
    [business.id, req.user.id, 'active']
  );
  const isPlatformAdmin = Boolean(req.user.is_platform_admin);
  if (!membership && !isPlatformAdmin) {
    recordAudit({
      businessId: business.id, actor: req.user, action: 'tenant.access_denied',
      entityType: 'business', entityId: business.id, result: 'denied', ip: req.ip,
    });
    return res.status(403).send('You do not have access to this business.');
  }
  req.business = business;
  req.membership = membership;
  req.role = membership?.role || 'owner';
  req.branchScope = membership?.branch_id || null;
  req.can = (permission) => can(req.role, permission);
  res.locals.business = business;
  res.locals.role = req.role;
  res.locals.can = req.can;
  next();
}

export function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    if (!req.can || !req.can(permission)) {
      recordAudit({
        businessId: req.business?.id, actor: req.user, role: req.role, action: 'permission.denied',
        entityType: 'permission', entityId: permission, result: 'denied', ip: req.ip,
      });
      return res.status(403).send(`Your role (${req.role}) does not include the "${permission}" permission.`);
    }
    next();
  };
}

export function businessesForUser(userId) {
  return get('SELECT 1 FROM memberships WHERE user_id = ?', [userId])
    ? require_all(userId)
    : [];
}

function require_all(userId) {
  // eslint-disable-next-line no-use-before-define
  return listBusinesses(userId);
}

export function listBusinesses(userId) {
  return get(
    `SELECT b.*, m.role FROM businesses b
     JOIN memberships m ON m.business_id = b.id
     WHERE m.user_id = ? AND m.status = 'active'
     ORDER BY b.created_at ASC`,
    [userId]
  )
    ? allBusinesses(userId)
    : [];
}

function allBusinesses(userId) {
  // eslint-disable-next-line no-use-before-define
  return queryBusinesses(userId);
}

function queryBusinesses(userId) {
  // eslint-disable-next-line no-use-before-define
  return listAll(userId);
}

function listAll(userId) {
  return requireDb().all(
    `SELECT b.*, m.role FROM businesses b
     JOIN memberships m ON m.business_id = b.id
     WHERE m.user_id = ? AND m.status = 'active'
     ORDER BY b.created_at ASC`,
    [userId]
  );
}

/* ───────────────────────── tokens ───────────────────────── */

export function issueToken(userId, purpose, ttlMs) {
  const token = randomToken(32);
  insert('auth_tokens', {
    id: id('tok'),
    user_id: userId,
    purpose,
    token_hash: sha256(token),
    expires_at: new Date(Date.now() + ttlMs).toISOString(),
    used_at: null,
    created_at: nowIso(),
  });
  return token;
}

export function consumeToken(token, purpose) {
  if (!token) return null;
  const row = get(
    'SELECT * FROM auth_tokens WHERE token_hash = ? AND purpose = ? AND used_at IS NULL',
    [sha256(token), purpose]
  );
  if (!row || new Date(row.expires_at) < new Date()) return null;
  run('UPDATE auth_tokens SET used_at = ? WHERE id = ?', [nowIso(), row.id]);
  return get('SELECT * FROM users WHERE id = ?', [row.user_id]);
}

export function setPassword(userId, password) {
  if (String(password || '').length < 10) {
    throw new AppError(422, 'Password must be at least 10 characters.', 'validation_error');
  }
  run('UPDATE users SET password_hash = ?, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?', [
    hashPassword(password), nowIso(), userId,
  ]);
  run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [nowIso(), userId]);
}

/* ───────────────────────── patient portal auth ───────────────────────── */

export function startPatientSession(account, res) {
  const token = randomToken(32);
  insert('patient_sessions', {
    id: id('pses'),
    account_id: account.id,
    token_hash: sha256(token),
    created_at: nowIso(),
    expires_at: new Date(Date.now() + 4 * 3600 * 1000).toISOString(),
    revoked_at: null,
  });
  res.cookie(PATIENT_COOKIE, token, cookieOptions(4 * 3600 * 1000));
}

export function attachPatient(req, _res, next) {
  req.patientAccount = null;
  const token = req.cookies?.[PATIENT_COOKIE];
  if (token) {
    const row = get(
      `SELECT ps.id AS session_id, ps.expires_at, pa.*, p.first_name, p.last_name, p.patient_no, b.name AS business_name, b.slug AS business_slug
       FROM patient_sessions ps
       JOIN patient_accounts pa ON pa.id = ps.account_id
       JOIN patients p ON p.id = pa.patient_id
       JOIN businesses b ON b.id = pa.business_id
       WHERE ps.token_hash = ? AND ps.revoked_at IS NULL`,
      [sha256(token)]
    );
    if (row && new Date(row.expires_at) > new Date()) req.patientAccount = row;
  }
  next();
}

export function requirePatient(req, res, next) {
  if (!req.patientAccount) return res.redirect('/portal/login');
  next();
}

export function safeCompare(a, b) {
  return safeEqual(a, b);
}

export { forbidden };
