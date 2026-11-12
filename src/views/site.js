import { esc, attr, money, minutesToLabel, prettyDate } from '../lib/util.js';
import { publicPage, badge, csrfField, emptyState } from './layout.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function hoursTable(hours, timezone) {
  if (!hours || !hours.length) return '<p class="muted" style="font-size:.86rem">Opening hours have not been published yet.</p>';
  const byDay = new Map(hours.map((h) => [Number(h.weekday), h]));
  return `<table class="hours-table"><tbody>${DAYS.map((label, wd) => {
    const h = byDay.get(wd);
    return `<tr><td>${esc(label)}</td><td class="right">${!h || h.is_closed ? '<span class="muted">Closed</span>' : `${esc(minutesToLabel(h.open_min))} – ${esc(minutesToLabel(h.close_min))}`}</td></tr>`;
  }).join('')}</tbody></table>`;
}

/* ───────────────────────── public business page ───────────────────────── */

export function businessSitePage(ctx) {
  const { business, branches, services, staff, hours, gallery, social, qr, showStaff, reviewsEnabled } = ctx;
  const branch = branches[0];
  const socialLinks = Object.entries(social || {}).filter(([, v]) => v);
  const body = `
  <section class="site-hero">
    <div class="wrap site-hero-inner">
      <div class="site-brand">
        ${business.logo_url ? `<img src="${attr(business.logo_url)}" alt="${attr(business.name)} logo" class="site-logo">` : `<div class="site-logo-fallback">${esc(business.name.slice(0, 2).toUpperCase())}</div>`}
        <div>
          <h1>${esc(business.name)}</h1>
          <p class="muted">${esc(business.description || '')}</p>
          <div class="chips">
            ${business.city ? `<span class="chip">${esc(business.city)}</span>` : ''}
            ${business.industry ? `<span class="chip">${esc(String(business.industry).replace(/_/g, ' '))}</span>` : ''}
            ${business.phone ? `<span class="chip">${esc(business.phone)}</span>` : ''}
          </div>
        </div>
      </div>
      <div class="site-cta">
        <a class="btn btn-primary" href="/business/${attr(business.slug)}/book">Book an appointment</a>
        ${business.whatsapp ? `<a class="btn btn-ghost" href="https://wa.me/${attr(String(business.whatsapp).replace(/[^0-9]/g, ''))}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
      </div>
    </div>
  </section>

  <div class="wrap site-body">
    <div class="site-main">
      <section class="card">
        <h2>Services</h2>
        ${services.length ? `<div class="service-list">${services.map((s) => `<div class="service-row">
          <div><strong>${esc(s.name)}</strong>${s.description ? `<div class="muted" style="font-size:.82rem">${esc(s.description)}</div>` : ''}
            <div class="muted" style="font-size:.76rem">${esc(minutesToLabel(s.duration_min))}</div></div>
          <div class="right"><span class="price-tag">${money(s.price_cents, s.currency || business.currency)}</span>
            <div><a class="btn btn-sm" href="/business/${attr(business.slug)}/book?service=${attr(s.id)}">Book</a></div></div>
        </div>`).join('')}</div>` : emptyState('No services published', 'This business has not added services yet.')}
      </section>

      ${showStaff && staff.length ? `<section class="card">
        <h2>Team</h2>
        <div class="team-grid">${staff.map((m) => `<div class="team-card">
          <div class="avatar" style="background:${attr(m.color || '#6366f1')}">${esc(m.name.slice(0, 1).toUpperCase())}</div>
          <div><strong>${esc(m.name)}</strong><div class="muted" style="font-size:.78rem">${esc(m.title || '')}</div></div>
        </div>`).join('')}</div>
      </section>` : ''}

      ${gallery && gallery.length ? `<section class="card">
        <h2>Gallery</h2>
        <div class="gallery">${gallery.map((src) => `<img src="${attr(src)}" alt="Gallery image" loading="lazy">`).join('')}</div>
      </section>` : ''}

      ${reviewsEnabled ? '' : ''}
    </div>

    <aside class="site-side">
      <section class="card">
        <h2>Opening hours</h2>
        ${hoursTable(hours)}
      </section>
      <section class="card">
        <h2>Visit us</h2>
        ${branch ? `<p style="font-size:.88rem">${esc([branch.address, branch.city].filter(Boolean).join(', ') || 'Address not published')}</p>
          ${branch.phone ? `<p class="mono" style="font-size:.8rem">${esc(branch.phone)}</p>` : ''}` : '<p class="muted" style="font-size:.86rem">No branch published.</p>'}
        ${socialLinks.length ? `<div class="chips mt1">${socialLinks.map(([k, v]) => `<a class="chip" href="${attr(v)}" target="_blank" rel="noopener">${esc(k)}</a>`).join('')}</div>` : ''}
      </section>
      <section class="card qr-card">
        <h2>Scan to book</h2>
        ${qr ? `<img src="${attr(qr)}" alt="QR code linking to this booking page" width="180" height="180">` : '<p class="muted" style="font-size:.82rem">QR code unavailable.</p>'}
        <p class="muted" style="font-size:.74rem">Opens this page on a phone.</p>
      </section>
    </aside>
  </div>`;

  return publicPage({
    title: `${business.name}${business.city ? ` · ${business.city}` : ''}`,
    description: business.description || `Book an appointment at ${business.name}.`,
    canonical: `/business/${business.slug}`,
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'LocalBusiness',
      name: business.name,
      description: business.description || undefined,
      telephone: business.phone || undefined,
      address: business.address ? { '@type': 'PostalAddress', streetAddress: business.address, addressLocality: business.city || undefined } : undefined,
      url: `/business/${business.slug}`,
    },
    body,
  });
}

/* ───────────────────────── booking flow ───────────────────────── */

export function bookingPage(ctx) {
  const { business, services, staff, branches, dates, selected, slots, reason, step } = ctx;
  const branch = branches[0];
  const serviceOptions = services.map((s) => `<option value="${attr(s.id)}" ${selected.serviceId === s.id ? 'selected' : ''}>${esc(s.name)} · ${money(s.price_cents, s.currency || business.currency)} · ${esc(minutesToLabel(s.duration_min))}</option>`).join('');
  const staffOptions = `<option value="">Any available team member</option>` + staff.map((m) => `<option value="${attr(m.id)}" ${selected.staffId === m.id ? 'selected' : ''}>${esc(m.name)}${m.title ? ` · ${esc(m.title)}` : ''}</option>`).join('');

  const slotHtml = !selected.serviceId
    ? '<p class="muted" style="font-size:.86rem">Choose a service to see available times.</p>'
    : !selected.date
      ? '<p class="muted" style="font-size:.86rem">Choose a date to see available times.</p>'
      : slots.length
        ? `<div class="slots">${slots.map((s) => `<form method="post" action="/business/${attr(business.slug)}/book">
            ${csrfField(ctx.csrf)}
            <input type="hidden" name="service_id" value="${attr(selected.serviceId)}">
            <input type="hidden" name="staff_id" value="${attr(s.staff[0]?.id || '')}">
            <input type="hidden" name="branch_id" value="${attr(branch?.id || '')}">
            <input type="hidden" name="date" value="${attr(selected.date)}">
            <input type="hidden" name="time" value="${attr(s.label)}">
            <button class="slot" type="submit">${esc(s.label)}</button>
          </form>`).join('')}</div>`
        : `<p class="muted" style="font-size:.86rem">${esc(reason || 'No times available for this date. Try another day.')}</p>`;

  const body = `<div class="wrap site-body narrow">
    <div class="card">
      <div class="flex between wrap">
        <div><h1 style="font-size:1.5rem">Book at ${esc(business.name)}</h1>
          <p class="muted" style="font-size:.86rem">${esc(branch ? [branch.address, branch.city].filter(Boolean).join(', ') : '')}</p></div>
        <a class="btn btn-sm btn-ghost" href="/business/${attr(business.slug)}">← Back</a>
      </div>
      <div class="hr"></div>
      <form method="get" action="/business/${attr(business.slug)}/book" class="book-filters">
        <div class="field"><label for="b-service">Service</label><select id="b-service" name="service" required>${serviceOptions}</select></div>
        <div class="field"><label for="b-staff">Team member</label><select id="b-staff" name="staff">${staffOptions}</select></div>
        <div class="field"><label for="b-date">Date</label>
          <select id="b-date" name="date">${dates.map((d) => `<option value="${attr(d.value)}" ${selected.date === d.value ? 'selected' : ''}>${esc(d.label)}</option>`).join('')}</select></div>
        <button class="btn btn-primary" type="submit">Show times</button>
      </form>
      <div class="hr"></div>
      <h3>Available times</h3>
      ${slotHtml}
    </div>
  </div>`;

  return publicPage({
    title: `Book · ${business.name}`,
    description: `Book an appointment at ${business.name}.`,
    canonical: `/business/${business.slug}/book`,
    body,
  });
}

export function bookingConfirmPage(ctx) {
  const { business, booking, service, staff, branch } = ctx;
  const body = `<div class="wrap site-body narrow">
    <div class="card confirm-card">
      <div class="confirm-mark">✓</div>
      <h1 style="font-size:1.5rem">Booking confirmed</h1>
      <p class="muted" style="font-size:.88rem">This booking is stored in ${esc(business.name)}'s calendar.</p>
      <dl class="kv mt2">
        <dt>Reference</dt><dd class="mono">${esc(booking.reference)}</dd>
        <dt>Service</dt><dd>${esc(service?.name || '')}</dd>
        <dt>When</dt><dd>${esc(prettyDate(booking.start_at, business.timezone))} · ${esc(String(booking.start_at))}</dd>
        <dt>Team member</dt><dd>${esc(staff?.name || 'Assigned on arrival')}</dd>
        <dt>Location</dt><dd>${esc(branch ? [branch.name, branch.city].filter(Boolean).join(' · ') : '')}</dd>
        <dt>Status</dt><dd>${badge(booking.status, 'ok')}</dd>
      </dl>
      ${ctx.contactRequired ? `<div class="banner warn mt2"><div><strong>Contact details</strong><span>Add your phone number to receive reminders.</span></div></div>` : ''}
      <div class="btn-row mt3">
        <a class="btn btn-primary" href="/business/${attr(business.slug)}">Done</a>
        <form method="post" action="/business/${attr(business.slug)}/booking/${attr(booking.reference)}/cancel" onsubmit="return confirm('Cancel this booking?')">
          ${csrfField(ctx.csrf)}
          <button class="btn btn-ghost" type="submit">Cancel booking</button>
        </form>
      </div>
      ${ctx.cancelled ? '<div class="banner mt2"><div><strong>Booking cancelled</strong><span>This appointment has been released in the calendar.</span></div></div>' : ''}
    </div>
  </div>`;
  return publicPage({ title: `Booking ${booking.reference} · ${business.name}`, description: 'Booking confirmation', body });
}

export function businessNotFoundPage() {
  return publicPage({
    title: 'Business not found',
    description: 'This business page does not exist.',
    body: `<div class="wrap site-body narrow"><div class="card">${emptyState('Business not found', 'This booking page does not exist or is not published.', '<a class="btn btn-sm" href="/">Return home</a>')}</div></div>`,
  });
}
