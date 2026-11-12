import express from 'express';
import { all, get, scalar, insert, run } from '../lib/db.js';
import { id, nowIso, esc } from '../lib/util.js';
import { rateLimit } from '../lib/security.js';
import { listPlans } from '../lib/entitlements.js';
import { BRAND } from '../views/layout.js';
import {
  landing, pricingPage, industriesPage, healthcarePage, securityPage,
  partnersPage, contactPage, legalPage, statusPage,
} from '../views/public.js';
import { AppError } from '../lib/errors.js';

const router = express.Router();

const send = (res, html, status = 200) => res.status(status).type('html').send(html);

router.get('/', (req, res) => {
  const plans = listPlans();
  const stats = {
    businesses: scalar('SELECT COUNT(*) FROM businesses WHERE status = ?', ['active']) || 0,
    industries: scalar('SELECT COUNT(DISTINCT industry) FROM businesses WHERE status = ?', ['active']) || 0,
  };
  send(res, landing({ user: req.user, plans, stats }));
});

router.get('/pricing', (req, res) => send(res, pricingPage({ user: req.user, plans: listPlans() })));
router.get('/industries', (req, res) => send(res, industriesPage({ user: req.user })));
router.get('/healthcare', (req, res) => send(res, healthcarePage({ user: req.user })));
/* Hosting ingress reserves top-level /health* paths for health probes, so the public
   healthcare page is also served from /solutions/healthcare and links use that path. */
router.get('/solutions/healthcare', (req, res) => send(res, healthcarePage({ user: req.user })));
router.get('/security', (req, res) => send(res, securityPage({ user: req.user })));
router.get('/partners', (req, res) => send(res, partnersPage({ user: req.user })));

router.get('/contact', (req, res) => {
  send(res, contactPage({ user: req.user, sent: req.query.sent === '1', error: String(req.query.err || '') }));
});

router.post('/contact', (req, res, next) => {
  try {
    const gate = rateLimit('contact', req.ip || 'anon', 5, 10 * 60_000);
    if (!gate.allowed) throw new AppError(429, 'Too many enquiries from this connection. Please try again later.', 'rate_limited');
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const phone = String(req.body.phone || '').trim();
    const businessName = String(req.body.business_name || '').trim();
    const message = String(req.body.message || '').trim();
    if (name.length < 2) throw new AppError(422, 'Enter your name.', 'validation_error');
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) throw new AppError(422, 'Enter a valid email address.', 'validation_error');
    if (message.length < 10) throw new AppError(422, 'Tell us a little more about what you need.', 'validation_error');

    insert('leads', {
      id: id('lead'),
      name: name.slice(0, 120),
      email: email.slice(0, 180),
      phone: phone.slice(0, 40) || null,
      business_name: businessName.slice(0, 160) || null,
      message: message.slice(0, 4000),
      source: 'website_contact',
      status: 'new',
      created_at: nowIso(),
    });
    res.redirect(303, '/contact?sent=1');
  } catch (err) {
    if (err instanceof AppError) {
      return send(res, contactPage({ user: req.user, sent: false, error: err.message }), err.status);
    }
    next(err);
  }
});

router.get('/legal/:kind', (req, res) => {
  const kind = String(req.params.kind || 'terms');
  send(res, legalPage({ user: req.user, kind }));
});

router.get('/status', (req, res) => {
  const dbOk = (() => {
    try { return scalar('SELECT 1') === 1; } catch { return false; }
  })();
  const health = {
    database: dbOk,
    businesses: scalar('SELECT COUNT(*) FROM businesses') || 0,
    bookings: scalar('SELECT COUNT(*) FROM bookings') || 0,
    aiRuns: scalar('SELECT COUNT(*) FROM ai_runs') || 0,
    lastBookingAt: scalar('SELECT MAX(created_at) FROM bookings'),
    checkedAt: nowIso(),
    integrations: all('SELECT provider, status FROM integrations'),
  };
  send(res, statusPage({ user: req.user, health }));
});

router.get('/robots.txt', (req, res) => {
  const host = `${req.protocol}://${req.get('host')}`;
  res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /app/\nDisallow: /admin\nDisallow: /api/\nDisallow: /portal/\nSitemap: ${host}/sitemap.xml\n`);
});

router.get('/sitemap.xml', (req, res) => {
  const host = `${req.protocol}://${req.get('host')}`;
  const staticPaths = ['/', '/pricing', '/industries', '/solutions/healthcare', '/security', '/partners', '/contact', '/legal/terms', '/legal/privacy', '/legal/dpa'];
  const businesses = all("SELECT slug, updated_at FROM businesses WHERE status = 'active' ORDER BY updated_at DESC LIMIT 5000");
  const urls = [
    ...staticPaths.map((p) => `<url><loc>${host}${p}</loc></url>`),
    ...businesses.map((b) => `<url><loc>${host}/business/${encodeURIComponent(b.slug)}</loc><lastmod>${String(b.updated_at || '').slice(0, 10)}</lastmod></url>`),
  ].join('');
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
});

router.get('/health', (req, res) => {
  try {
    const ok = scalar('SELECT 1') === 1;
    res.status(ok ? 200 : 503).json({ status: ok ? 'ok' : 'degraded', time: nowIso() });
  } catch (err) {
    res.status(503).json({ status: 'unavailable', error: 'database_unreachable' });
  }
});

router.get('/manifest.webmanifest', (req, res) => {
  res.type('application/manifest+json').json({
    name: 'MAVYRON',
    short_name: 'MAVYRON',
    description: BRAND.tagline,
    start_url: '/app',
    display: 'standalone',
    background_color: '#07090d',
    theme_color: '#07090d',
    icons: [{ src: '/assets/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  });
});

export default router;
