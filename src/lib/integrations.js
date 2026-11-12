import { all, get, insert, run } from './db.js';
import { id, nowIso, parseJson, toJson } from './util.js';
import { encryptSecret, decryptSecret } from './security.js';
import { AppError } from './errors.js';
import { recordAudit } from './audit.js';

export const STATUS = {
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  CONFIGURATION_REQUIRED: 'configuration_required',
  ERROR: 'error',
  RECONNECT_REQUIRED: 'reconnect_required',
};

export const STATUS_LABEL = {
  connected: 'Connected',
  disconnected: 'Disconnected',
  configuration_required: 'Configuration Required',
  error: 'Error',
  reconnect_required: 'Reconnect Required',
};

async function httpJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(12_000) });
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body };
}

function fail(message, status = STATUS.ERROR) {
  return { ok: false, status, message };
}

export const PROVIDER_CATALOG = {
  whatsapp: {
    name: 'WhatsApp Business Cloud API', category: 'Messaging',
    description: 'Official Meta WhatsApp Business Platform. Sends booking confirmations and powers the AI receptionist on WhatsApp.',
    docs: 'https://developers.facebook.com/docs/whatsapp/cloud-api',
    capabilities: ['inbound messages', 'outbound messages', 'delivery status', 'AI receptionist'],
    fields: [
      { key: 'phone_number_id', label: 'Phone number ID', required: true },
      { key: 'waba_id', label: 'WhatsApp Business Account ID', required: false },
      { key: 'access_token', label: 'Permanent access token', required: true, secret: true },
      { key: 'verify_token', label: 'Webhook verify token', required: true, secret: true },
      { key: 'app_secret', label: 'Meta app secret', required: true, secret: true },
    ],
    async verify(config) {
      if (!config.phone_number_id || !config.access_token) return fail('Phone number ID and access token are required.', STATUS.CONFIGURATION_REQUIRED);
      const res = await httpJson(
        `https://graph.facebook.com/v21.0/${encodeURIComponent(config.phone_number_id)}?fields=verified_name,display_phone_number,quality_rating`,
        { headers: { authorization: `Bearer ${config.access_token}` } }
      );
      if (!res.ok) {
        const message = res.body?.error?.message || `Meta responded ${res.status}`;
        return fail(message, res.status === 401 || res.status === 403 ? STATUS.RECONNECT_REQUIRED : STATUS.ERROR);
      }
      return { ok: true, status: STATUS.CONNECTED, accountLabel: res.body?.verified_name || res.body?.display_phone_number || 'WhatsApp Business', detail: res.body };
    },
  },
  email: {
    name: 'Transactional Email (Resend)', category: 'Messaging',
    description: 'Sends booking confirmations, reminders and password recovery email.',
    docs: 'https://resend.com/docs',
    capabilities: ['transactional email', 'delivery status'],
    fields: [
      { key: 'api_key', label: 'API key', required: true, secret: true },
      { key: 'from_email', label: 'Verified sender email', required: true },
    ],
    async verify(config) {
      if (!config.api_key) return fail('API key is required.', STATUS.CONFIGURATION_REQUIRED);
      const res = await httpJson('https://api.resend.com/domains', { headers: { authorization: `Bearer ${config.api_key}` } });
      if (!res.ok) return fail(res.body?.message || `Email provider responded ${res.status}`, res.status === 401 ? STATUS.RECONNECT_REQUIRED : STATUS.ERROR);
      const domain = (res.body?.data || [])[0]?.name;
      return { ok: true, status: STATUS.CONNECTED, accountLabel: config.from_email || domain || 'Email provider', detail: res.body };
    },
  },
  sms: {
    name: 'SMS (Twilio)', category: 'Messaging',
    description: 'Sends SMS reminders and alerts through Twilio.',
    docs: 'https://www.twilio.com/docs/messaging',
    capabilities: ['outbound SMS', 'delivery status'],
    fields: [
      { key: 'account_sid', label: 'Account SID', required: true },
      { key: 'auth_token', label: 'Auth token', required: true, secret: true },
      { key: 'from_number', label: 'Sender number', required: true },
    ],
    async verify(config) {
      if (!config.account_sid || !config.auth_token) return fail('Account SID and auth token are required.', STATUS.CONFIGURATION_REQUIRED);
      const auth = Buffer.from(`${config.account_sid}:${config.auth_token}`).toString('base64');
      const res = await httpJson(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.account_sid)}.json`, { headers: { authorization: `Basic ${auth}` } });
      if (!res.ok) return fail(res.body?.message || `Twilio responded ${res.status}`, res.status === 401 ? STATUS.RECONNECT_REQUIRED : STATUS.ERROR);
      return { ok: true, status: STATUS.CONNECTED, accountLabel: res.body?.friendly_name || config.from_number, detail: res.body };
    },
  },
  voice: {
    name: 'Voice Reception (Twilio Programmable Voice)', category: 'Voice',
    description: 'Inbound AI voice reception with human transfer. Requires a voice-capable number and webhook.',
    docs: 'https://www.twilio.com/docs/voice',
    capabilities: ['inbound calls', 'call transcript', 'human transfer'],
    fields: [
      { key: 'account_sid', label: 'Account SID', required: true },
      { key: 'auth_token', label: 'Auth token', required: true, secret: true },
      { key: 'phone_number', label: 'Voice phone number', required: true },
      { key: 'escalation_number', label: 'Human transfer number', required: true },
    ],
    async verify(config) {
      if (!config.account_sid || !config.auth_token) return fail('Account SID and auth token are required.', STATUS.CONFIGURATION_REQUIRED);
      const auth = Buffer.from(`${config.account_sid}:${config.auth_token}`).toString('base64');
      const res = await httpJson(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.account_sid)}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(config.phone_number || '')}`, { headers: { authorization: `Basic ${auth}` } });
      if (!res.ok) return fail(res.body?.message || `Twilio responded ${res.status}`, res.status === 401 ? STATUS.RECONNECT_REQUIRED : STATUS.ERROR);
      const numbers = res.body?.incoming_phone_numbers || [];
      if (!numbers.length) return fail('That phone number is not provisioned on this Twilio account.', STATUS.ERROR);
      return { ok: true, status: STATUS.CONNECTED, accountLabel: numbers[0].phone_number || config.phone_number, detail: { capability: numbers[0].capabilities } };
    },
  },
  stripe: {
    name: 'Stripe', category: 'Payments',
    description: 'Subscription billing and hosted checkout. Card data never touches MAVYRON.',
    docs: 'https://stripe.com/docs',
    capabilities: ['hosted checkout', 'subscriptions', 'verified webhooks'],
    fields: [
      { key: 'secret_key', label: 'Secret key', required: true, secret: true },
      { key: 'webhook_secret', label: 'Webhook signing secret', required: true, secret: true },
      { key: 'starter_price_id', label: 'Starter price ID', required: false },
      { key: 'professional_price_id', label: 'Professional price ID', required: false },
      { key: 'business_price_id', label: 'Business price ID', required: false },
    ],
    async verify(config) {
      if (!config.secret_key) return fail('Secret key is required.', STATUS.CONFIGURATION_REQUIRED);
      const res = await httpJson('https://api.stripe.com/v1/balance', { headers: { authorization: `Bearer ${config.secret_key}` } });
      if (!res.ok) return fail(res.body?.error?.message || `Stripe responded ${res.status}`, res.status === 401 ? STATUS.RECONNECT_REQUIRED : STATUS.ERROR);
      return { ok: true, status: STATUS.CONNECTED, accountLabel: `Stripe ${res.body?.livemode ? 'live' : 'test'} account`, detail: { livemode: res.body?.livemode } };
    },
  },
  paypal: {
    name: 'PayPal', category: 'Payments',
    description: 'Alternative hosted checkout for international subscriptions.',
    docs: 'https://developer.paypal.com/api/rest/',
    capabilities: ['hosted checkout', 'verified webhooks'],
    fields: [
      { key: 'client_id', label: 'Client ID', required: true },
      { key: 'client_secret', label: 'Client secret', required: true, secret: true },
      { key: 'webhook_id', label: 'Webhook ID', required: true },
      { key: 'mode', label: 'Mode (sandbox or live)', required: true },
    ],
    async verify(config) {
      if (!config.client_id || !config.client_secret) return fail('Client ID and secret are required.', STATUS.CONFIGURATION_REQUIRED);
      const base = config.mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
      const auth = Buffer.from(`${config.client_id}:${config.client_secret}`).toString('base64');
      const res = await httpJson(`${base}/v1/oauth2/token`, {
        method: 'POST',
        headers: { authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials',
      });
      if (!res.ok) return fail(res.body?.error_description || `PayPal responded ${res.status}`, res.status === 401 ? STATUS.RECONNECT_REQUIRED : STATUS.ERROR);
      return { ok: true, status: STATUS.CONNECTED, accountLabel: `PayPal ${config.mode || 'sandbox'}`, detail: { scope: res.body?.scope } };
    },
  },
  mpesa: {
    name: 'M-Pesa (Safaricom Daraja)', category: 'Payments',
    description: 'Kenyan mobile money STK push and C2B confirmations.',
    docs: 'https://developer.safaricom.co.ke',
    capabilities: ['STK push', 'C2B confirmation callbacks'],
    fields: [
      { key: 'consumer_key', label: 'Consumer key', required: true },
      { key: 'consumer_secret', label: 'Consumer secret', required: true, secret: true },
      { key: 'shortcode', label: 'Business shortcode', required: true },
      { key: 'passkey', label: 'Lipa na M-Pesa passkey', required: true, secret: true },
      { key: 'environment', label: 'Environment (sandbox or production)', required: true },
    ],
    async verify(config) {
      if (!config.consumer_key || !config.consumer_secret) return fail('Consumer key and secret are required.', STATUS.CONFIGURATION_REQUIRED);
      const base = config.environment === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';
      const auth = Buffer.from(`${config.consumer_key}:${config.consumer_secret}`).toString('base64');
      const res = await httpJson(`${base}/oauth/v1/generate?grant_type=client_credentials`, { headers: { authorization: `Basic ${auth}` } });
      if (!res.ok || !res.body?.access_token) return fail(res.body?.errorMessage || `Daraja responded ${res.status}`, res.status === 401 ? STATUS.RECONNECT_REQUIRED : STATUS.ERROR);
      return { ok: true, status: STATUS.CONNECTED, accountLabel: `M-Pesa shortcode ${config.shortcode}`, detail: { environment: config.environment } };
    },
  },
  google_calendar: {
    name: 'Google Calendar', category: 'Productivity',
    description: 'Two-way appointment sync using OAuth refresh tokens.',
    docs: 'https://developers.google.com/calendar/api',
    capabilities: ['event creation', 'free/busy lookup'],
    fields: [
      { key: 'client_id', label: 'OAuth client ID', required: true },
      { key: 'client_secret', label: 'OAuth client secret', required: true, secret: true },
      { key: 'refresh_token', label: 'Refresh token', required: true, secret: true },
      { key: 'calendar_id', label: 'Calendar ID', required: true },
    ],
    async verify(config) {
      if (!config.client_id || !config.client_secret || !config.refresh_token) return fail('OAuth credentials and refresh token are required.', STATUS.CONFIGURATION_REQUIRED);
      const res = await httpJson('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: config.client_id, client_secret: config.client_secret, refresh_token: config.refresh_token, grant_type: 'refresh_token' }).toString(),
      });
      if (!res.ok) return fail(res.body?.error_description || 'Google rejected the refresh token.', STATUS.RECONNECT_REQUIRED);
      return { ok: true, status: STATUS.CONNECTED, accountLabel: config.calendar_id, detail: { scope: res.body?.scope } };
    },
  },
  facebook: {
    name: 'Facebook Page', category: 'Social',
    description: 'Publish approved content to a Facebook Page.',
    docs: 'https://developers.facebook.com/docs/pages-api',
    capabilities: ['publish posts', 'post status'],
    fields: [
      { key: 'page_id', label: 'Page ID', required: true },
      { key: 'page_access_token', label: 'Page access token', required: true, secret: true },
    ],
    async verify(config) {
      if (!config.page_id || !config.page_access_token) return fail('Page ID and page access token are required.', STATUS.CONFIGURATION_REQUIRED);
      const res = await httpJson(`https://graph.facebook.com/v21.0/${encodeURIComponent(config.page_id)}?fields=name,fan_count`, { headers: { authorization: `Bearer ${config.page_access_token}` } });
      if (!res.ok) return fail(res.body?.error?.message || `Meta responded ${res.status}`, res.status === 401 ? STATUS.RECONNECT_REQUIRED : STATUS.ERROR);
      return { ok: true, status: STATUS.CONNECTED, accountLabel: res.body?.name, detail: res.body };
    },
  },
  instagram: {
    name: 'Instagram Business', category: 'Social',
    description: 'Publish approved media to an Instagram Business account.',
    docs: 'https://developers.facebook.com/docs/instagram-api',
    capabilities: ['publish media', 'post status'],
    fields: [
      { key: 'ig_user_id', label: 'Instagram user ID', required: true },
      { key: 'access_token', label: 'Access token', required: true, secret: true },
    ],
    async verify(config) {
      if (!config.ig_user_id || !config.access_token) return fail('Instagram user ID and access token are required.', STATUS.CONFIGURATION_REQUIRED);
      const res = await httpJson(`https://graph.facebook.com/v21.0/${encodeURIComponent(config.ig_user_id)}?fields=username`, { headers: { authorization: `Bearer ${config.access_token}` } });
      if (!res.ok) return fail(res.body?.error?.message || `Meta responded ${res.status}`, res.status === 401 ? STATUS.RECONNECT_REQUIRED : STATUS.ERROR);
      return { ok: true, status: STATUS.CONNECTED, accountLabel: `@${res.body?.username || config.ig_user_id}`, detail: res.body };
    },
  },
  tiktok: {
    name: 'TikTok', category: 'Social',
    description: 'Publish approved video content where the TikTok content posting API is approved for the app.',
    docs: 'https://developers.tiktok.com/doc/content-posting-api-get-started',
    capabilities: ['publish video', 'post status'],
    fields: [
      { key: 'access_token', label: 'Access token', required: true, secret: true },
    ],
    async verify(config) {
      if (!config.access_token) return fail('Access token is required.', STATUS.CONFIGURATION_REQUIRED);
      const res = await httpJson('https://open.tiktokapis.com/v2/user/info/?fields=display_name', { headers: { authorization: `Bearer ${config.access_token}` } });
      if (!res.ok || res.body?.error?.code) return fail(res.body?.error?.message || `TikTok responded ${res.status}`, res.status === 401 ? STATUS.RECONNECT_REQUIRED : STATUS.ERROR);
      return { ok: true, status: STATUS.CONNECTED, accountLabel: res.body?.data?.user?.display_name || 'TikTok account', detail: res.body?.data };
    },
  },
  x: {
    name: 'X (Twitter)', category: 'Social',
    description: 'Publish approved posts through the X API v2.',
    docs: 'https://developer.x.com/en/docs',
    capabilities: ['publish posts'],
    fields: [
      { key: 'access_token', label: 'OAuth 2.0 user access token', required: true, secret: true },
    ],
    async verify(config) {
      if (!config.access_token) return fail('Access token is required.', STATUS.CONFIGURATION_REQUIRED);
      const res = await httpJson('https://api.twitter.com/2/users/me', { headers: { authorization: `Bearer ${config.access_token}` } });
      if (!res.ok) return fail(res.body?.detail || `X responded ${res.status}`, res.status === 401 ? STATUS.RECONNECT_REQUIRED : STATUS.ERROR);
      return { ok: true, status: STATUS.CONNECTED, accountLabel: `@${res.body?.data?.username || 'account'}`, detail: res.body?.data };
    },
  },
  accounting: {
    name: 'Accounting System', category: 'Finance',
    description: 'Export verified invoices and payments to an external accounting platform.',
    docs: '',
    capabilities: ['invoice export', 'payment export'],
    fields: [
      { key: 'base_url', label: 'API base URL', required: true },
      { key: 'api_token', label: 'API token', required: true, secret: true },
    ],
    async verify(config) {
      if (!config.base_url || !config.api_token) return fail('Base URL and API token are required.', STATUS.CONFIGURATION_REQUIRED);
      const res = await httpJson(`${String(config.base_url).replace(/\/$/, '')}/api/v1/company`, { headers: { authorization: `Bearer ${config.api_token}` } });
      if (!res.ok) return fail(`Accounting endpoint responded ${res.status}`, res.status === 401 ? STATUS.RECONNECT_REQUIRED : STATUS.ERROR);
      return { ok: true, status: STATUS.CONNECTED, accountLabel: res.body?.name || config.base_url, detail: res.body };
    },
  },
  fhir: {
    name: 'Healthcare Interoperability (FHIR)', category: 'Healthcare',
    description: 'Connect a FHIR R4 endpoint for patient and encounter interoperability.',
    docs: 'https://hl7.org/fhir/R4/',
    capabilities: ['patient export', 'encounter export'],
    fields: [
      { key: 'base_url', label: 'FHIR base URL', required: true },
      { key: 'token', label: 'Bearer token', required: false, secret: true },
    ],
    async verify(config) {
      if (!config.base_url) return fail('FHIR base URL is required.', STATUS.CONFIGURATION_REQUIRED);
      const res = await httpJson(`${String(config.base_url).replace(/\/$/, '')}/metadata`, {
        headers: { accept: 'application/fhir+json', ...(config.token ? { authorization: `Bearer ${config.token}` } : {}) },
      });
      if (!res.ok) return fail(`FHIR endpoint responded ${res.status}`, res.status === 401 ? STATUS.RECONNECT_REQUIRED : STATUS.ERROR);
      return { ok: true, status: STATUS.CONNECTED, accountLabel: res.body?.software?.name || config.base_url, detail: { fhirVersion: res.body?.fhirVersion } };
    },
  },
};

export const PROVIDER_KEYS = Object.keys(PROVIDER_CATALOG);

export function ensureIntegrationRows(businessId) {
  for (const provider of PROVIDER_KEYS) {
    const existing = get('SELECT id FROM integrations WHERE business_id = ? AND provider = ?', [businessId, provider]);
    if (existing) continue;
    insert('integrations', {
      id: id('int'),
      business_id: businessId,
      provider,
      category: PROVIDER_CATALOG[provider].category,
      status: STATUS.CONFIGURATION_REQUIRED,
      config_enc: null,
      config_hint: null,
      account_label: null,
      verified_at: null,
      last_error: null,
      created_at: nowIso(),
      updated_at: nowIso(),
    });
  }
}

export function listIntegrations(businessId) {
  ensureIntegrationRows(businessId);
  return all('SELECT * FROM integrations WHERE business_id = ?', [businessId]).map((row) => {
    const meta = PROVIDER_CATALOG[row.provider] || { name: row.provider, category: row.category, fields: [], capabilities: [] };
    return {
      ...row,
      name: meta.name,
      description: meta.description,
      docs: meta.docs,
      fields: meta.fields,
      capabilities: meta.capabilities,
      status_label: STATUS_LABEL[row.status] || row.status,
      configured: Boolean(row.config_enc),
    };
  });
}

export function getIntegration(businessId, provider) {
  ensureIntegrationRows(businessId);
  return get('SELECT * FROM integrations WHERE business_id = ? AND provider = ?', [businessId, provider]);
}

export function getConfig(businessId, provider) {
  const row = getIntegration(businessId, provider);
  if (!row?.config_enc) return null;
  return parseJson(decryptSecret(row.config_enc), null);
}

function hintFor(provider, config) {
  const meta = PROVIDER_CATALOG[provider];
  if (!meta) return null;
  const secretField = meta.fields.find((f) => f.secret && config[f.key]);
  if (secretField) {
    const value = String(config[secretField.key]);
    return `${secretField.label}: ••••${value.slice(-4)}`;
  }
  const named = meta.fields.find((f) => config[f.key]);
  return named ? String(config[named.key]).slice(0, 60) : null;
}

export function saveCredentials({ businessId, provider, config, actor = null }) {
  const meta = PROVIDER_CATALOG[provider];
  if (!meta) throw new AppError(404, 'Unknown integration provider.', 'not_found');
  const clean = {};
  for (const field of meta.fields) {
    const value = config?.[field.key];
    if (value !== undefined && value !== null && String(value).trim() !== '') clean[field.key] = String(value).trim();
  }
  const missing = meta.fields.filter((f) => f.required && !clean[f.key]).map((f) => f.label);
  if (missing.length) throw new AppError(422, `Missing required fields: ${missing.join(', ')}.`, 'validation_error');
  const row = getIntegration(businessId, provider);
  run(
    `UPDATE integrations SET config_enc = ?, config_hint = ?, status = ?, last_error = NULL, updated_at = ?
     WHERE business_id = ? AND provider = ?`,
    [encryptSecret(toJson(clean)), hintFor(provider, clean), STATUS.CONFIGURATION_REQUIRED, nowIso(), businessId, provider]
  );
  recordAudit({
    businessId, actor, role: actor?.role || 'system', action: 'integration.credentials_saved',
    entityType: 'integration', entityId: row.id, meta: { provider },
  });
  return getIntegration(businessId, provider);
}

export async function testConnection({ businessId, provider, actor = null }) {
  const meta = PROVIDER_CATALOG[provider];
  if (!meta) throw new AppError(404, 'Unknown integration provider.', 'not_found');
  const config = getConfig(businessId, provider);
  const row = getIntegration(businessId, provider);
  if (!config) {
    run('UPDATE integrations SET status = ?, last_error = ?, updated_at = ? WHERE id = ?', [
      STATUS.CONFIGURATION_REQUIRED, 'No credentials saved yet.', nowIso(), row.id,
    ]);
    return { ok: false, status: STATUS.CONFIGURATION_REQUIRED, message: 'Add the provider credentials first.' };
  }
  let result;
  try {
    result = await meta.verify(config);
  } catch (err) {
    result = fail(`Verification request failed: ${err.message}`);
  }
  run(
    `UPDATE integrations SET status = ?, account_label = ?, verified_at = ?, last_error = ?, updated_at = ?
     WHERE id = ?`,
    [
      result.status,
      result.ok ? result.accountLabel || null : row.account_label,
      result.ok ? nowIso() : null,
      result.ok ? null : result.message || 'Verification failed',
      nowIso(),
      row.id,
    ]
  );
  recordAudit({
    businessId, actor, role: actor?.role || 'system',
    action: result.ok ? 'integration.verified' : 'integration.verification_failed',
    entityType: 'integration', entityId: row.id, result: result.ok ? 'success' : 'failed',
    meta: { provider, message: result.message || null },
  });
  return { ...result, status_label: STATUS_LABEL[result.status] };
}

export function disconnectIntegration({ businessId, provider, actor = null }) {
  const row = getIntegration(businessId, provider);
  if (!row) throw new AppError(404, 'Unknown integration provider.', 'not_found');
  run(
    `UPDATE integrations SET status = ?, config_enc = NULL, config_hint = NULL, account_label = NULL,
       verified_at = NULL, last_error = NULL, updated_at = ? WHERE id = ?`,
    [STATUS.DISCONNECTED, nowIso(), row.id]
  );
  recordAudit({ businessId, actor, role: actor?.role || 'system', action: 'integration.disconnected', entityType: 'integration', entityId: row.id, meta: { provider } });
  return getIntegration(businessId, provider);
}

export function integrationSummary(businessId) {
  const rows = listIntegrations(businessId);
  return {
    total: rows.length,
    connected: rows.filter((r) => r.status === STATUS.CONNECTED).length,
    configuration_required: rows.filter((r) => r.status === STATUS.CONFIGURATION_REQUIRED || r.status === STATUS.DISCONNECTED).length,
    errors: rows.filter((r) => r.status === STATUS.ERROR || r.status === STATUS.RECONNECT_REQUIRED).length,
    rows,
  };
}

export function whatsappSecrets(businessId) {
  const config = getConfig(businessId, 'whatsapp');
  if (!config) return null;
  return { verifyToken: config.verify_token, appSecret: config.app_secret, phoneNumberId: config.phone_number_id, accessToken: config.access_token };
}
