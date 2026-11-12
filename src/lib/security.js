import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './db.js';

const SCRYPT_KEYLEN = 64;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const candidate = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function encryptionKey() {
  const envKey = process.env.APP_ENCRYPTION_KEY;
  if (envKey && envKey.length >= 16) {
    return crypto.scryptSync(envKey, 'mavyron-config-v1', 32);
  }
  const keyFile = path.join(DATA_DIR, 'secret.key');
  if (!fs.existsSync(keyFile)) {
    fs.writeFileSync(keyFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  }
  return crypto.scryptSync(fs.readFileSync(keyFile, 'utf8').trim(), 'mavyron-config-v1', 32);
}

export function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}

export function decryptSecret(payload) {
  if (!payload) return null;
  try {
    const raw = Buffer.from(payload, 'base64');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const data = raw.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/* ── in-process rate limiting (single node deployment) ── */
const buckets = new Map();

export function rateLimit(scope, key, limit, windowMs) {
  const bucketKey = `${scope}:${key}`;
  const now = Date.now();
  const entry = buckets.get(bucketKey);
  if (!entry || now > entry.reset) {
    buckets.set(bucketKey, { count: 1, reset: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfter: 0 };
  }
  entry.count += 1;
  if (entry.count > limit) {
    return { allowed: false, remaining: 0, retryAfter: Math.ceil((entry.reset - now) / 1000) };
  }
  return { allowed: true, remaining: limit - entry.count, retryAfter: 0 };
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of buckets) if (now > entry.reset) buckets.delete(key);
}, 60_000).unref?.();

export const SESSION_COOKIE = 'mvy_session';
export const CSRF_COOKIE = 'mvy_csrf';
export const PATIENT_COOKIE = 'mvy_patient';

export function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    if (!name) continue;
    out[name] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function cookieOptions(maxAgeMs) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === '1',
    path: '/',
    maxAge: maxAgeMs,
  };
}

export function ensureCsrf(req, res) {
  let token = req.cookies?.[CSRF_COOKIE];
  if (!token || token.length < 20) {
    token = randomToken(24);
    res.cookie(CSRF_COOKIE, token, { ...cookieOptions(7 * 24 * 3600 * 1000), httpOnly: false });
    if (req.cookies) req.cookies[CSRF_COOKIE] = token;
  }
  return token;
}

export function verifyCsrf(req) {
  const header = req.get('x-csrf-token');
  const bodyToken = req.body?._csrf;
  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const supplied = header || bodyToken;
  if (!supplied || !cookieToken) return false;
  return safeEqual(supplied, cookieToken);
}

/** Webhook signature check for Stripe-style HMAC (`t=...,v1=...`). */
export function verifyStripeSignature(payload, header, secret, toleranceSeconds = 300) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(
    String(header).split(',').map((p) => {
      const [k, v] = p.split('=');
      return [k, v];
    })
  );
  if (!parts.t || !parts.v1) return false;
  const age = Math.abs(Date.now() / 1000 - Number(parts.t));
  if (Number.isFinite(age) && age > toleranceSeconds) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${parts.t}.${payload}`)
    .digest('hex');
  return safeEqual(expected, parts.v1);
}

export function verifyMetaSignature(payload, header, secret) {
  if (!header || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const supplied = String(header).replace(/^sha256=/, '');
  return safeEqual(expected, supplied);
}

export function verifyTwilioSignature(url, params, signature, authToken) {
  if (!signature || !authToken) return false;
  const sorted = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url);
  const expected = crypto.createHmac('sha1', authToken).update(Buffer.from(sorted, 'utf8')).digest('base64');
  return safeEqual(expected, signature);
}

export function signWebhookPayload(secret, timestamp, body) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}
