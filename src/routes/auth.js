import express from 'express';
import { get, run } from '../lib/db.js';
import { rateLimit } from '../lib/security.js';
import { nowIso } from '../lib/util.js';
import {
  registerUser, authenticate, startSession, destroySession, requireAuth,
  issueToken, consumeToken, setPassword, businessesForUser,
} from '../lib/auth.js';
import { AppError } from '../lib/errors.js';
import { recordAudit } from '../lib/audit.js';
import { loginPage, signupPage, forgotPage, resetPage, verifyPage } from '../views/auth.js';

const router = express.Router();

function safeNext(value) {
  const next = String(value || '');
  return next.startsWith('/') && !next.startsWith('//') ? next : '/app';
}

function landingTarget(user) {
  const list = businessesForUser(user.id);
  if (!list.length) return '/app';
  return `/app/${list[0].slug}`;
}

/* ── sign up ───────────────────────────────────────────────────────── */
router.get('/signup', (req, res) => {
  if (req.user) return res.redirect(landingTarget(req.user));
  res.type('html').send(signupPage({ csrf: res.locals.csrf, values: {} }));
});

router.post('/signup', (req, res, next) => {
  try {
    const gate = rateLimit('signup', req.ip || 'anon', 6, 60 * 60_000);
    if (!gate.allowed) throw new AppError(429, 'Too many sign-up attempts. Please try again later.', 'rate_limited');
    const values = {
      name: String(req.body.name || '').trim(),
      email: String(req.body.email || '').trim().toLowerCase(),
      phone: String(req.body.phone || '').trim(),
      business: String(req.body.business || '').trim(),
    };
    const password = String(req.body.password || '');
    const confirm = String(req.body.confirm || '');
    if (password !== confirm) throw new AppError(422, 'The two passwords do not match.', 'validation_error');
    if (!req.body.terms) throw new AppError(422, 'Please accept the terms to create an account.', 'validation_error');

    const user = registerUser({
      email: values.email,
      name: values.name,
      password,
      phone: values.phone || null,
    });
    startSession(user, req, res);
    recordAudit({ actor: user, action: 'user.signup', entityType: 'user', entityId: user.id, ip: req.ip });
    req.session.businessName = values.business || null;
    res.redirect(303, '/app/new');
  } catch (err) {
    if (err instanceof AppError) {
      return res.status(err.status).type('html').send(signupPage({
        csrf: res.locals.csrf,
        error: err.message,
        values: {
          name: String(req.body.name || ''),
          email: String(req.body.email || ''),
          phone: String(req.body.phone || ''),
          business: String(req.body.business || ''),
        },
      }));
    }
    next(err);
  }
});

/* ── sign in / out ─────────────────────────────────────────────────── */
router.get('/login', (req, res) => {
  if (req.user) return res.redirect(safeNext(req.query.next));
  res.type('html').send(loginPage({
    csrf: res.locals.csrf,
    email: String(req.query.email || ''),
    next: String(req.query.next || ''),
    error: String(req.query.err || ''),
  }));
});

router.post('/login', (req, res, next) => {
  try {
    const gate = rateLimit('login', `${req.ip}:${String(req.body.email || '').toLowerCase()}`, 8, 15 * 60_000);
    if (!gate.allowed) throw new AppError(429, 'Too many attempts. Please wait a few minutes before trying again.', 'rate_limited');
    const user = authenticate({
      email: req.body.email,
      password: req.body.password,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
    startSession(user, req, res);
    res.redirect(303, safeNext(req.body.next));
  } catch (err) {
    if (err instanceof AppError) {
      return res.status(err.status).type('html').send(loginPage({
        csrf: res.locals.csrf,
        error: err.message,
        email: String(req.body.email || ''),
        next: String(req.body.next || ''),
      }));
    }
    next(err);
  }
});

router.post('/logout', (req, res) => {
  if (req.user) {
    recordAudit({ actor: req.user, action: 'user.logout', entityType: 'user', entityId: req.user.id, ip: req.ip });
  }
  destroySession(req, res);
  res.redirect(303, '/');
});

/* ── password recovery ─────────────────────────────────────────────── */
router.get('/forgot', (req, res) => {
  res.type('html').send(forgotPage({
    csrf: res.locals.csrf,
    sent: req.query.sent === '1',
    resetUrl: req.query.link ? String(req.query.link) : null,
    error: String(req.query.err || ''),
  }));
});

router.post('/forgot', (req, res, next) => {
  try {
    const gate = rateLimit('forgot', req.ip || 'anon', 5, 30 * 60_000);
    if (!gate.allowed) throw new AppError(429, 'Too many reset requests. Please try again later.', 'rate_limited');
    const email = String(req.body.email || '').trim().toLowerCase();
    const user = get('SELECT * FROM users WHERE email = ?', [email]);
    // Always report success: never disclose whether an account exists.
    if (!user) return res.redirect(303, '/forgot?sent=1');
    const token = issueToken(user.id, 'password_reset', 60 * 60_000);
    const link = `${req.protocol}://${req.get('host')}/reset/${token}`;
    recordAudit({ actor: { id: user.id, email: user.email }, action: 'user.password_reset_requested', entityType: 'user', entityId: user.id, ip: req.ip });
    // Email delivery depends on a configured provider; until then the link is
    // shown to the requester instead of pretending a message was sent.
    res.redirect(303, `/forgot?sent=1&link=${encodeURIComponent(link)}`);
  } catch (err) {
    next(err);
  }
});

router.get('/reset/:token', (req, res) => {
  const token = String(req.params.token || '');
  const row = get(
    `SELECT t.* FROM auth_tokens t WHERE t.token_hash = (
       SELECT token_hash FROM auth_tokens WHERE purpose = 'password_reset' AND used_at IS NULL
     ) AND t.purpose = 'password_reset' AND t.used_at IS NULL`
  );
  const valid = Boolean(token) && Boolean(row);
  res.type('html').send(resetPage({
    csrf: res.locals.csrf,
    token,
    invalid: !valid,
    error: String(req.query.err || ''),
  }));
});

router.post('/reset/:token', (req, res, next) => {
  try {
    const token = String(req.params.token || '');
    const password = String(req.body.password || '');
    const confirm = String(req.body.confirm || '');
    if (password !== confirm) {
      return res.status(422).type('html').send(resetPage({
        csrf: res.locals.csrf, token, error: 'The two passwords do not match.',
      }));
    }
    const user = consumeToken(token, 'password_reset');
    if (!user) {
      return res.status(400).type('html').send(resetPage({
        csrf: res.locals.csrf, token, invalid: true,
        error: 'This reset link has expired or was already used. Request a new one.',
      }));
    }
    setPassword(user.id, password);
    recordAudit({ actor: user, action: 'user.password_reset', entityType: 'user', entityId: user.id, ip: req.ip });
    res.redirect(303, '/login?email=' + encodeURIComponent(user.email) + '&err=' + encodeURIComponent('Password updated. Sign in with your new password.'));
  } catch (err) {
    if (err instanceof AppError) {
      return res.status(err.status).type('html').send(resetPage({
        csrf: res.locals.csrf, token: String(req.params.token || ''), error: err.message,
      }));
    }
    next(err);
  }
});

/* ── email verification ────────────────────────────────────────────── */
router.get('/verify/:token', (req, res) => {
  const user = consumeToken(String(req.params.token || ''), 'email_verify');
  if (!user) {
    return res.status(400).type('html').send(verifyPage({
      csrf: res.locals.csrf, state: 'invalid', email: '',
    }));
  }
  run('UPDATE users SET email_verified_at = ?, updated_at = ? WHERE id = ?', [nowIso(), nowIso(), user.id]);
  recordAudit({ actor: user, action: 'user.email_verified', entityType: 'user', entityId: user.id, ip: req.ip });
  res.type('html').send(verifyPage({ csrf: res.locals.csrf, state: 'verified', email: user.email }));
});

router.get('/verify', (req, res) => {
  if (!req.user) return res.redirect('/login');
  if (req.user.email_verified_at) {
    return res.type('html').send(verifyPage({ csrf: res.locals.csrf, state: 'verified', email: req.user.email }));
  }
  const token = issueToken(req.user.id, 'email_verify', 24 * 3600_000);
  const link = `${req.protocol}://${req.get('host')}/verify/${token}`;
  res.type('html').send(verifyPage({
    csrf: res.locals.csrf,
    state: 'pending',
    email: req.user.email,
    link,
  }));
});

router.get('/account', requireAuth, (req, res) => {
  res.redirect(`/app/${businessesForUser(req.user.id)[0]?.slug || ''}/settings`.replace('//', '/'));
});

export default router;
