import { esc, attr } from '../lib/util.js';
import { authPage } from './layout.js';

export function loginPage({ csrf, error = '', email = '', next = '' }) {
  return authPage({
    title: 'Sign in',
    subtitle: 'Access your MAVYRON workspace.',
    csrf,
    error,
    body: `<form method="post" action="/login" class="mt2">
      <input type="hidden" name="_csrf" value="${attr(csrf)}">
      <input type="hidden" name="next" value="${attr(next)}">
      <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" required value="${attr(email)}"></div>
      <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required></div>
      <button class="btn btn-primary btn-block" type="submit">Sign in</button>
    </form>
    <div class="flex between mt2" style="font-size:.82rem">
      <a href="/forgot" class="muted">Forgot password?</a>
      <a href="/signup">Create an account</a>
    </div>`,
    footer: 'Protected by session authentication and login throttling.',
  });
}

export function signupPage({ csrf, error = '', values = {} }) {
  return authPage({
    title: 'Create your workspace',
    subtitle: 'Start a 14-day trial. No card required.',
    csrf,
    error,
    body: `<form method="post" action="/signup" class="mt2">
      <input type="hidden" name="_csrf" value="${attr(csrf)}">
      <div class="field"><label for="name">Your name</label><input id="name" name="name" autocomplete="name" required value="${attr(values.name || '')}"></div>
      <div class="field-row">
        <div class="field"><label for="email">Work email</label><input id="email" name="email" type="email" autocomplete="email" required value="${attr(values.email || '')}"></div>
        <div class="field"><label for="phone">Phone / WhatsApp</label><input id="phone" name="phone" autocomplete="tel" value="${attr(values.phone || '')}" placeholder="07…"></div>
      </div>
      <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="new-password" minlength="10" required><div class="hint">At least 10 characters. Stored as a scrypt hash.</div></div>
      <div class="hr"></div>
      <div class="field"><label for="business">Business name</label><input id="business" name="business" required value="${attr(values.business || '')}" placeholder="e.g. Serena Studio"></div>
      <div class="field-row">
        <div class="field"><label for="industry">Business type</label>
          <select id="industry" name="industry">
            ${['salon', 'barbershop', 'spa', 'clinic', 'dental', 'medical_centre', 'hospital', 'restaurant', 'hotel', 'gym', 'retail', 'professional_services', 'rentals', 'other']
              .map((i) => `<option value="${i}" ${values.industry === i ? 'selected' : ''}>${i.replace(/_/g, ' ')}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label for="city">City</label><input id="city" name="city" value="${attr(values.city || 'Nairobi')}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label for="country">Country</label>
          <select id="country" name="country">
            <option value="KE" ${values.country === 'KE' ? 'selected' : ''}>Kenya</option>
            <option value="UG">Uganda</option><option value="TZ">Tanzania</option><option value="RW">Rwanda</option>
            <option value="NG">Nigeria</option><option value="ZA">South Africa</option><option value="GB">United Kingdom</option>
            <option value="US">United States</option><option value="AE">United Arab Emirates</option>
          </select>
        </div>
        <div class="field"><label for="timezone">Time zone</label>
          <select id="timezone" name="timezone">
            ${['Africa/Nairobi', 'Africa/Kampala', 'Africa/Dar_es_Salaam', 'Africa/Kigali', 'Africa/Lagos', 'Africa/Johannesburg', 'Europe/London', 'America/New_York', 'Asia/Dubai']
              .map((t) => `<option value="${t}" ${values.timezone === t ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
        </div>
      </div>
      <label class="check" style="margin:.4rem 0 1rem"><input type="checkbox" name="terms" value="1" required> I agree to the <a href="/legal/terms">terms</a> and <a href="/legal/privacy">privacy notice</a>.</label>
      <button class="btn btn-primary btn-block" type="submit">Create workspace ${'→'}</button>
      <p class="hint">You become the owner of this business. Your trial starts immediately; paid activation requires a provider-confirmed payment.</p>
    </form>`,
    footer: 'Already have an account? <a href="/login">Sign in</a>',
  });
}

export function forgotPage({ csrf, error = '', sent = null, resetUrl = null }) {
  return authPage({
    title: 'Reset your password',
    subtitle: 'We issue a single-use, time-limited reset link.',
    csrf,
    error,
    body: sent
      ? `<div class="flash flash-ok mt2">${esc(sent)}</div>
         ${resetUrl ? `<div class="panel mt2"><div class="mono muted" style="font-size:.7rem">Email delivery is not configured, so the single-use link is shown here for this account only:</div><a href="${attr(resetUrl)}" style="word-break:break-all;font-size:.85rem">${esc(resetUrl)}</a></div>` : ''}
         <a class="btn btn-block mt2" href="/login">Back to sign in</a>`
      : `<form method="post" action="/forgot" class="mt2">
          <input type="hidden" name="_csrf" value="${attr(csrf)}">
          <div class="field"><label for="email">Account email</label><input id="email" name="email" type="email" required></div>
          <button class="btn btn-primary btn-block" type="submit">Send reset link</button>
        </form>`,
    footer: '<a href="/login">Back to sign in</a>',
  });
}

export function resetPage({ csrf, token, error = '', invalid = false }) {
  if (invalid) {
    return authPage({
      title: 'Reset link unavailable',
      subtitle: 'This link has expired or has already been used.',
      csrf,
      error,
      body: `<a class="btn btn-block mt2" href="/forgot">Request a new link</a>`,
      footer: '<a href="/login">Back to sign in</a>',
    });
  }
  return authPage({
    title: 'Choose a new password',
    subtitle: 'All existing sessions will be signed out.',
    csrf,
    error,
    body: `<form method="post" action="/reset" class="mt2">
      <input type="hidden" name="_csrf" value="${attr(csrf)}">
      <input type="hidden" name="token" value="${attr(token)}">
      <div class="field"><label for="password">New password</label><input id="password" name="password" type="password" minlength="10" required></div>
      <div class="field"><label for="confirm">Confirm password</label><input id="confirm" name="confirm" type="password" minlength="10" required></div>
      <button class="btn btn-primary btn-block" type="submit">Update password</button>
    </form>`,
    footer: '<a href="/login">Back to sign in</a>',
  });
}

export function verifyPage({ csrf, state, email = '' }) {
  return authPage({
    title: state === 'verified' ? 'Email verified' : 'Verify your email',
    subtitle: state === 'verified'
      ? 'Your address is confirmed on this account.'
      : 'Email verification requires a configured delivery provider.',
    csrf,
    body: `<div class="panel mt2">
      <p class="muted" style="font-size:.88rem;margin:0">${state === 'verified'
        ? 'The verification token was valid and has been consumed.'
        : state === 'invalid'
          ? 'This verification link is invalid, expired or already used.'
          : `A verification token was issued for ${esc(email)}. Configure RESEND_API_KEY and NOTIFICATION_FROM_EMAIL to deliver verification email automatically, or use the account settings to resend once delivery is configured.`}</p>
    </div>
    <a class="btn btn-block mt2" href="/app">Continue to workspace</a>`,
    footer: '<a href="/login">Sign in</a>',
  });
}
