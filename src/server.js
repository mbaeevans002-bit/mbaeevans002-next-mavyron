import express from 'express';
import path from 'node:path';
import { ROOT, persist, all } from './lib/db.js';
import { parseCookies, ensureCsrf, verifyCsrf, rateLimit } from './lib/security.js';
import { attachUser, attachPatient } from './lib/auth.js';
import { seedPlans } from './lib/entitlements.js';
import { runScheduledAutomations } from './lib/automation.js';
import { flushQueue } from './lib/notify.js';
import { AppError } from './lib/errors.js';

import publicRoutes from './routes/public.js';
import authRoutes from './routes/auth.js';
import workspaceRoutes from './routes/workspace.js';
import siteRoutes from './routes/site.js';
import apiRoutes from './routes/api.js';
import adminRoutes from './routes/admin.js';
import webhookRoutes from './routes/webhooks.js';

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.set('trust proxy', 1);
app.disable('x-powered-by');

/* ── security headers ───────────────────────────────────────────────── */
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "img-src 'self' data: https:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ')
  );
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
});

/* ── webhooks first: they need the raw body for signature checks ────── */
app.use('/webhooks', express.raw({ type: '*/*', limit: '2mb' }), webhookRoutes);

/* ── body parsing and cookies ───────────────────────────────────────── */
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(express.json({ limit: '12mb' }));
app.use((req, _res, next) => {
  req.cookies = parseCookies(req.headers.cookie);
  next();
});

/* ── static assets ─────────────────────────────────────────────────── */
app.use('/assets', express.static(path.join(ROOT, 'src', 'public'), { maxAge: '7d', etag: true }));
app.use('/favicon.ico', (req, res) => res.redirect(301, '/assets/favicon.svg'));

/* ── identity + CSRF ───────────────────────────────────────────────── */
app.use(attachUser);
app.use(attachPatient);
app.use((req, res, next) => {
  res.locals.csrf = ensureCsrf(req, res);
  res.locals.user = req.user;
  res.locals.path = req.path;
  next();
});

/* Accept the shorter header used by the document uploader. */
app.use((req, _res, next) => {
  const short = req.get('x-csrf');
  if (short && !req.get('x-csrf-token')) req.headers['x-csrf-token'] = short;
  next();
});

app.use((req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  if (req.get('authorization') || req.get('x-api-key')) return next();
  if (verifyCsrf(req)) return next();
  return res
    .status(403)
    .type('html')
    .send('<h1>Request blocked</h1><p>Your session token was missing or expired. Reload the page and try again.</p>');
});

/* ── coarse platform-wide abuse limits ─────────────────────────────── */
app.use((req, res, next) => {
  const key = req.ip || 'anon';
  const limit = req.path.startsWith('/api/') ? 300 : 600;
  const gate = rateLimit('http', key, limit, 60_000);
  if (!gate.allowed) {
    res.setHeader('Retry-After', String(Math.ceil((gate.retryAfter || 1000) / 1000)));
    return res.status(429).type('html').send('<h1>Too many requests</h1><p>Please slow down and try again shortly.</p>');
  }
  next();
});

/* ── routes ────────────────────────────────────────────────────────── */
app.use('/api/v1', apiRoutes);
app.use('/admin', adminRoutes);
app.use('/business', siteRoutes);
app.use('/app', workspaceRoutes);
app.use('/', authRoutes);
app.use('/', publicRoutes);

/* ── 404 and error handling ────────────────────────────────────────── */
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Endpoint not found.', code: 'not_found' });
  }
  res.status(404).type('html').send(
    `<h1>Page not found</h1><p>${req.path} does not exist. <a href="/">Return to MAVYRON</a>.</p>`
  );
});

app.use((err, req, res, _next) => {
  const status = err instanceof AppError ? err.status : Number(err.status) || 500;
  const message = status >= 500 && !(err instanceof AppError)
    ? 'Something went wrong on our side. The action was not completed.'
    : err.message;
  if (status >= 500) {
    console.error('[mavyron] request failed', {
      path: req.originalUrl,
      method: req.method,
      error: err.message,
      stack: err.stack?.split('\n').slice(0, 4).join(' | '),
    });
  }
  if (req.path.startsWith('/api/')) {
    return res.status(status).json({ error: message, code: err.code || 'error' });
  }
  const safe = String(message).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  res.status(status).type('html').send(
    `<div style="font-family:system-ui;padding:2rem;max-width:40rem;margin:0 auto;color:#e2e6ed;background:#07090d;min-height:100vh">
      <h1 style="font-size:1.2rem">Action not completed</h1>
      <p style="color:#aeb8c8">${safe}</p>
      <p><a style="color:#6366f1" href="${req.get('referer') || '/'}">Go back</a> · <a style="color:#6366f1" href="/app">Workspace</a></p>
    </div>`
  );
});

/* ── boot tasks ────────────────────────────────────────────────────── */
seedPlans();

let ticking = false;
const tick = async () => {
  if (ticking) return;
  ticking = true;
  try {
    await runScheduledAutomations();
    for (const business of all("SELECT id FROM businesses WHERE status = 'active'")) {
      try {
        await flushQueue(business.id, 5);
      } catch (err) {
        console.error('[mavyron] notification flush failed', business.id, err.message);
      }
    }
  } catch (err) {
    console.error('[mavyron] scheduler error', err.message);
  } finally {
    ticking = false;
  }
};
const scheduler = setInterval(tick, 60_000);
scheduler.unref?.();
setTimeout(tick, 4_000).unref?.();

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`MAVYRON listening on 0.0.0.0:${PORT}`);
});

const shutdown = (signal) => {
  console.log(`[mavyron] ${signal} received, shutting down`);
  try { persist(); } catch { /* best effort */ }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;
