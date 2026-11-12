import crypto from 'node:crypto';

export const nowIso = () => new Date().toISOString();

export function id(prefix = 'id') {
  return `${prefix}_${crypto.randomBytes(10).toString('hex')}`;
}

export function reference(prefix = 'MV') {
  const stamp = Date.now().toString(36).toUpperCase().slice(-4);
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${prefix}-${stamp}${rand}`;
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

export function attr(value) {
  return esc(value).replace(/`/g, '&#96;');
}

export function slugify(input) {
  return String(input || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60);
}

export function money(cents, currency = 'KES') {
  const amount = (Number(cents) || 0) / 100;
  const zeroDecimal = ['KES', 'USD', 'EUR', 'GBP'].includes(currency);
  return `${currency} ${amount.toLocaleString('en-KE', {
    minimumFractionDigits: zeroDecimal ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

export function parseMoneyToCents(input) {
  if (input === null || input === undefined || input === '') return 0;
  const cleaned = String(input).replace(/[^0-9.]/g, '');
  if (!cleaned) return 0;
  const value = Number.parseFloat(cleaned);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value * 100);
}

export function int(value, fallback = 0) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function isEmail(value) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(value.trim());
}

export function normalisePhone(value, defaultCountry = '254') {
  if (!value) return null;
  let digits = String(value).replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (digits.startsWith('0') && digits.length >= 9) digits = defaultCountry + digits.slice(1);
  if (digits.length === 9 && !digits.startsWith(defaultCountry)) digits = defaultCountry + digits;
  if (digits.length < 8 || digits.length > 15) return null;
  return `+${digits}`;
}

export function parseJson(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function toJson(value) {
  return JSON.stringify(value ?? null);
}

/** yyyy-mm-dd in a given timezone */
export function isoDate(date = new Date(), timeZone = 'Africa/Nairobi') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

export function minutesToLabel(minutes) {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function labelToMinutes(label) {
  const [h, m] = String(label || '00:00').split(':').map((n) => int(n, 0));
  return clamp(h, 0, 23) * 60 + clamp(m, 0, 59);
}

export function tzOffsetMinutes(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, (+p.hour) % 24, +p.minute, +p.second);
  return (asUtc - date.getTime()) / 60000;
}

/** Local wall-clock date + minutes in a timezone → UTC Date. */
export function zonedToUtc(dateStr, minutes, timeZone) {
  const [y, m, d] = String(dateStr).split('-').map((n) => int(n, 0));
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0) + minutes * 60000;
  let offset = tzOffsetMinutes(new Date(guess), timeZone);
  let ts = guess - offset * 60000;
  offset = tzOffsetMinutes(new Date(ts), timeZone);
  ts = guess - offset * 60000;
  return new Date(ts);
}

export function utcToLocalParts(dateIso, timeZone) {
  const date = new Date(dateIso);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    minutes: (+p.hour % 24) * 60 + +p.minute,
    label: `${p.hour}:${p.minute}`,
  };
}

export function weekdayOf(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map((n) => int(n, 0));
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(dateStr, days) {
  const [y, m, d] = String(dateStr).split('-').map((n) => int(n, 0));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function prettyDate(dateStr, timeZone = 'Africa/Nairobi') {
  if (!dateStr) return '—';
  const date = dateStr.length === 10 ? new Date(`${dateStr}T12:00:00Z`) : new Date(dateStr);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: dateStr.length === 10 ? 'UTC' : timeZone,
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  }).format(date);
}

export function prettyTime(dateIso, timeZone = 'Africa/Nairobi') {
  if (!dateIso) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(dateIso));
}

export function relativeTime(dateIso) {
  if (!dateIso) return '—';
  const diff = Date.now() - new Date(dateIso).getTime();
  const mins = Math.round(diff / 60000);
  if (Math.abs(mins) < 1) return 'just now';
  if (Math.abs(mins) < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (Math.abs(hours) < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return `${days}d ago`;
  return prettyDate(dateIso);
}

export function pct(numerator, denominator) {
  if (!denominator) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

export function splitList(value) {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  return String(value || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

export function flash(req) {
  const ok = req.query?.ok ? String(req.query.ok) : null;
  const err = req.query?.err ? String(req.query.err) : null;
  return { ok, err };
}

export function take(list, n) {
  return list.slice(0, n);
}
