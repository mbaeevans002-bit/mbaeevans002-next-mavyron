import { all, get, insert, run, tx } from './db.js';
import { AppError, assert } from './errors.js';
import {
  id, reference, nowIso, int, parseJson, bookingClamp, weekdayOf, isoDate, addDays,
  zonedToUtc, utcToLocalParts, minutesToLabel, prettyDate, prettyTime, normalisePhone, isEmail,
} from './util.js';
import { publish } from './events.js';
import { recordAudit } from './audit.js';
import { queueNotification, flushQueue } from './notify.js';

export const DEFAULT_RULES = {
  slot_step_min: 15,
  min_notice_min: 60,
  max_advance_days: 60,
  allow_staff_choice: true,
  auto_confirm: true,
  cancellation_notice_hours: 2,
  buffer_min: 0,
};

export function bookingRules(business) {
  return { ...DEFAULT_RULES, ...parseJson(business?.booking_rules_json, {}) };
}

export function staffCandidates({ businessId, serviceId, branchId = null }) {
  return all(
    `SELECT s.* FROM staff s
     WHERE s.business_id = ? AND s.is_active = 1
       AND (? IS NULL OR s.branch_id IS NULL OR s.branch_id = ?)
       AND (
         NOT EXISTS (SELECT 1 FROM staff_services ss WHERE ss.staff_id = s.id)
         OR EXISTS (SELECT 1 FROM staff_services ss WHERE ss.staff_id = s.id AND ss.service_id = ?)
       )
     ORDER BY s.name ASC`,
    [businessId, branchId, branchId, serviceId]
  );
}

/** Available slots for one service on one local date. */
export function dayAvailability({ business, branchId, service, staffId = null, date }) {
  const rules = bookingRules(business);
  const tz = business.timezone || 'Africa/Nairobi';
  const weekday = weekdayOf(date);
  const hours = get('SELECT * FROM branch_hours WHERE branch_id = ? AND weekday = ?', [branchId, weekday]);
  if (!hours || hours.is_closed) {
    return { slots: [], reason: 'The business is closed on that day.', rules };
  }
  const duration = Math.max(5, int(service.duration_min, 30) + int(service.buffer_min, 0));
  const maxDate = addDays(isoDate(new Date(), tz), int(rules.max_advance_days, DEFAULT_RULES.max_advance_days));
  if (date > maxDate) {
    return { slots: [], reason: `Bookings are open up to ${rules.max_advance_days} days ahead.`, rules };
  }
  const candidates = staffCandidates({ businessId: business.id, serviceId: service.id, branchId })
    .filter((s) => !staffId || s.id === staffId);
  if (!candidates.length) {
    return { slots: [], reason: 'No team member is available for this service yet.', rules };
  }
  const step = Math.max(5, int(rules.slot_step_min, DEFAULT_RULES.slot_step_min));
  const noticeMs = int(rules.min_notice_min, DEFAULT_RULES.min_notice_min) * 60_000;
  const now = Date.now();
  const dayStart = zonedToUtc(date, 0, tz).toISOString();
  const dayEnd = zonedToUtc(addDays(date, 1), 0, tz).toISOString();
  const merged = new Map();

  for (const staff of candidates) {
    const schedule = get('SELECT * FROM staff_schedules WHERE staff_id = ? AND weekday = ?', [staff.id, weekday]);
    if (!schedule) continue;
    const windowStart = Math.max(hours.open_min, schedule.start_min);
    const windowEnd = Math.min(hours.close_min, schedule.end_min);
    if (windowEnd - windowStart < duration) continue;
    const breaks = all('SELECT * FROM staff_breaks WHERE staff_id = ? AND weekday = ?', [staff.id, weekday]);
    const offs = all(
      `SELECT * FROM time_off WHERE business_id = ? AND (staff_id = ? OR staff_id IS NULL)
       AND start_at < ? AND end_at > ?`,
      [business.id, staff.id, dayEnd, dayStart]
    );
    const existing = all(
      `SELECT start_at, end_at FROM bookings WHERE staff_id = ?
       AND status IN ('pending','confirmed') AND start_at < ? AND end_at > ?`,
      [staff.id, dayEnd, dayStart]
    );

    for (let minute = windowStart; minute + duration <= windowEnd; minute += step) {
      const startDate = zonedToUtc(date, minute, tz);
      const endDate = new Date(startDate.getTime() + duration * 60_000);
      if (startDate.getTime() < now + noticeMs) continue;
      const overlapsBreak = breaks.some((b) => minute < b.end_min && minute + duration > b.start_min);
      if (overlapsBreak) continue;
      const overlapsOff = offs.some((o) => startDate < new Date(o.end_at) && endDate > new Date(o.start_at));
      if (overlapsOff) continue;
      const overlapsBooking = existing.some((b) => startDate < new Date(b.end_at) && endDate > new Date(b.start_at));
      if (overlapsBooking) continue;
      const key = startDate.toISOString();
      if (!merged.has(key)) {
        merged.set(key, {
          start: key,
          end: endDate.toISOString(),
          label: minutesToLabel(minute),
          staff: [],
        });
      }
      merged.get(key).staff.push({ id: staff.id, name: staff.name, title: staff.title || null });
    }
  }

  return {
    slots: [...merged.values()].sort((a, b) => a.start.localeCompare(b.start)),
    reason: null,
    rules,
  };
}

export function upsertCustomer(businessId, { name, phone = null, email = null, birthday = null, consent = false }) {
  const cleanPhone = normalisePhone(phone);
  const cleanEmail = isEmail(email) ? String(email).trim().toLowerCase() : null;
  if (!name || String(name).trim().length < 2) {
    throw new AppError(422, 'Enter the customer name.', 'validation_error');
  }
  if (!cleanPhone && !cleanEmail) {
    throw new AppError(422, 'Enter a phone number or email address for the customer.', 'validation_error');
  }
  let existing = null;
  if (cleanPhone) existing = get('SELECT * FROM customers WHERE business_id = ? AND phone = ?', [businessId, cleanPhone]);
  if (!existing && cleanEmail) {
    existing = get('SELECT * FROM customers WHERE business_id = ? AND lower(email) = ?', [businessId, cleanEmail]);
  }
  const now = nowIso();
  if (existing) {
    run(
      `UPDATE customers SET name = COALESCE(NULLIF(?,''), name), email = COALESCE(?, email),
        phone = COALESCE(?, phone), marketing_consent = ?, consent_at = ?, updated_at = ?
       WHERE id = ? AND business_id = ?`,
      [
        String(name).trim(), cleanEmail, cleanPhone,
        consent ? 1 : existing.marketing_consent,
        consent ? now : existing.consent_at,
        now, existing.id, businessId,
      ]
    );
    return get('SELECT * FROM customers WHERE id = ? AND business_id = ?', [existing.id, businessId]);
  }
  const customer = {
    id: id('cus'),
    business_id: businessId,
    name: String(name).trim(),
    phone: cleanPhone,
    email: cleanEmail,
    birthday: birthday || null,
    notes: null,
    tags_json: '[]',
    preferences: null,
    marketing_consent: consent ? 1 : 0,
    consent_at: consent ? now : null,
    last_visit_at: null,
    total_bookings: 0,
    total_spend_cents: 0,
    created_at: now,
    updated_at: now,
  };
  insert('customers', customer);
  return customer;
}

function notificationPayload({ business, customer, service, booking }) {
  return {
    customer_name: customer.name,
    business_name: business.name,
    service_name: service.name,
    when: `${prettyDate(booking.start_at, business.timezone)} at ${prettyTime(booking.start_at, business.timezone)}`,
    reference: booking.reference,
    to_email: customer.email || null,
    to_phone: customer.phone || null,
  };
}

export function queueBookingNotification({ business, customer, service, booking, template }) {
  const payload = notificationPayload({ business, customer, service, booking });
  const channels = [];
  if (customer.email) channels.push('email');
  if (customer.phone) channels.push('whatsapp');
  channels.push('in_app');
  return channels.map((channel) =>
    queueNotification({ businessId: business.id, channel, template, payload })
  );
}

/**
 * Creates a booking inside a transaction. The unique partial index on
 * (staff_id, start_at) plus the overlap query make double booking impossible.
 */
/**
 * Interpret an appointment time. Values without a timezone offset are treated as
 * local time in the business timezone, so a booking made for 15:00 means 15:00
 * where the business actually operates.
 */
function parseBookingStart(startAt, tz) {
  const raw = String(startAt || '').trim();
  const naive = /^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}):(\d{2})(?::\d{2})?$/.exec(raw);
  if (naive) return zonedToUtc(naive[1], int(naive[2], 0) * 60 + int(naive[3], 0), tz);
  return new Date(raw);
}

export function createBooking({
  business, serviceId, staffId = null, branchId = null, startAt,
  customer = null, customerId = null, notes = null, source = 'workspace',
  actor = null, patientId = null,
}) {
  assert(business, 500, 'Business context missing.', 'no_business');
  const service = get('SELECT * FROM services WHERE id = ? AND business_id = ? AND is_active = 1', [serviceId, business.id]);
  assert(service, 422, 'Select an active service that belongs to this business.', 'invalid_service');
  const branch = branchId
    ? get('SELECT * FROM branches WHERE id = ? AND business_id = ?', [branchId, business.id])
    : get('SELECT * FROM branches WHERE business_id = ? ORDER BY is_primary DESC LIMIT 1', [business.id]);
  assert(branch, 422, 'Add a branch before taking bookings.', 'invalid_branch');

  const tz = business.timezone || 'Africa/Nairobi';
  const startDate = parseBookingStart(startAt, tz);
  assert(startDate && !Number.isNaN(startDate.getTime()), 422, 'Choose a valid appointment time.', 'invalid_time');
  const localDate = utcToLocalParts(startDate.toISOString(), tz).date;

  const availability = dayAvailability({ business, branchId: branch.id, service, staffId, date: localDate });
  const slot = availability.slots.find((s) => s.start === startDate.toISOString());
  if (!slot) {
    throw new AppError(409, availability.reason || 'That time is no longer available. Pick another slot.', 'slot_unavailable');
  }
  const staff = get('SELECT * FROM staff WHERE id = ? AND business_id = ?', [staffId || slot.staff[0].id, business.id]);
  assert(staff, 422, 'Select a team member who belongs to this business.', 'invalid_staff');
  const endAt = new Date(startDate.getTime() + (int(service.duration_min, 30) + int(service.buffer_min, 0)) * 60_000).toISOString();

  return tx(() => {
    let customerRow = null;
    if (customerId) {
      customerRow = get('SELECT * FROM customers WHERE id = ? AND business_id = ?', [customerId, business.id]);
      if (!customerRow) throw new AppError(404, 'Customer not found for this business.', 'not_found');
    } else {
      customerRow = upsertCustomer(business.id, customer || {});
    }

    const conflict = get(
      `SELECT id FROM bookings WHERE staff_id = ? AND status IN ('pending','confirmed')
       AND start_at < ? AND end_at > ?`,
      [staff.id, endAt, startDate.toISOString()]
    );
    if (conflict) {
      throw new AppError(409, 'That time was just taken. Choose another slot.', 'slot_taken');
    }

    const now = nowIso();
    const booking = {
      id: id('bkg'),
      reference: reference('MVB'),
      business_id: business.id,
      branch_id: branch.id,
      service_id: service.id,
      staff_id: staff.id,
      customer_id: customerRow.id,
      patient_id: patientId,
      start_at: startDate.toISOString(),
      end_at: endAt,
      status: 'confirmed',
      price_cents: int(service.price_cents, 0),
      currency: service.currency || business.currency,
      source,
      notes,
      cancel_reason: null,
      rescheduled_from: null,
      created_by_user_id: actor?.id || null,
      created_at: now,
      updated_at: now,
    };
    try {
      insert('bookings', booking);
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) {
        throw new AppError(409, 'That time was just taken. Choose another slot.', 'slot_taken');
      }
      throw err;
    }

    queueBookingNotification({ business, customer: customerRow, service, booking, template: 'booking_confirmed' });
    recordAudit({
      businessId: business.id, actor, role: actor?.role || 'system', action: 'booking.created',
      entityType: 'booking', entityId: booking.id, context: source,
      meta: { service: service.name, staff: staff.name, start_at: booking.start_at },
    });
    publish(business.id, 'booking.created', {
      booking_id: booking.id, reference: booking.reference, start_at: booking.start_at,
      service: service.name, staff: staff.name, status: booking.status,
    });
    return { booking, customer: customerRow, service, staff, branch };
  });
}

export function rescheduleBooking({ business, bookingId, startAt, staffId = null, actor = null }) {
  const booking = get('SELECT * FROM bookings WHERE id = ? AND business_id = ?', [bookingId, business.id]);
  if (!booking) throw new AppError(404, 'Booking not found.', 'not_found');
  if (!['pending', 'confirmed'].includes(booking.status)) {
    throw new AppError(409, 'Only pending or confirmed bookings can be moved.', 'invalid_state');
  }
  const service = get('SELECT * FROM services WHERE id = ? AND business_id = ?', [booking.service_id, business.id]);
  const targetStaff = staffId || booking.staff_id;
  const tz = business.timezone || 'Africa/Nairobi';
  const startDate = parseBookingStart(startAt, tz);
  assert(startDate && !Number.isNaN(startDate.getTime()), 422, 'Choose a valid new time.', 'invalid_time');
  const localDate = utcToLocalParts(startDate.toISOString(), tz).date;
  const availability = dayAvailability({ business, branchId: booking.branch_id, service, staffId: targetStaff, date: localDate });
  const slot = availability.slots.find((s) => s.start === startDate.toISOString());
  if (!slot) throw new AppError(409, availability.reason || 'That time is not available.', 'slot_unavailable');
  const endAt = new Date(startDate.getTime() + (int(service.duration_min, 30) + int(service.buffer_min, 0)) * 60_000).toISOString();

  return tx(() => {
    const conflict = get(
      `SELECT id FROM bookings WHERE staff_id = ? AND id <> ? AND status IN ('pending','confirmed')
       AND start_at < ? AND end_at > ?`,
      [targetStaff, bookingId, endAt, startDate.toISOString()]
    );
    if (conflict) throw new AppError(409, 'That slot is already booked.', 'slot_taken');
    run(
      `UPDATE bookings SET start_at = ?, end_at = ?, staff_id = ?, rescheduled_from = ?, status = 'confirmed', updated_at = ?
       WHERE id = ? AND business_id = ?`,
      [startDate.toISOString(), endAt, targetStaff, booking.start_at, nowIso(), bookingId, business.id]
    );
    const updated = get('SELECT * FROM bookings WHERE id = ?', [bookingId]);
    const customer = get('SELECT * FROM customers WHERE id = ?', [updated.customer_id]);
    queueBookingNotification({ business, customer, service, booking: updated, template: 'booking_rescheduled' });
    recordAudit({
      businessId: business.id, actor, role: actor?.role || 'system', action: 'booking.rescheduled',
      entityType: 'booking', entityId: bookingId, meta: { from: booking.start_at, to: updated.start_at },
    });
    publish(business.id, 'booking.rescheduled', {
      booking_id: bookingId, reference: updated.reference, start_at: updated.start_at, status: updated.status,
    });
    return updated;
  });
}

export function cancelBooking({ business, bookingId, reason = null, actor = null }) {
  const booking = get('SELECT * FROM bookings WHERE id = ? AND business_id = ?', [bookingId, business.id]);
  if (!booking) throw new AppError(404, 'Booking not found.', 'not_found');
  if (booking.status === 'cancelled') throw new AppError(409, 'This booking is already cancelled.', 'invalid_state');
  const service = get('SELECT * FROM services WHERE id = ?', [booking.service_id]);
  return tx(() => {
    run('UPDATE bookings SET status = ?, cancel_reason = ?, updated_at = ? WHERE id = ? AND business_id = ?', [
      'cancelled', reason, nowIso(), bookingId, business.id,
    ]);
    const updated = get('SELECT * FROM bookings WHERE id = ?', [bookingId]);
    const customer = get('SELECT * FROM customers WHERE id = ?', [booking.customer_id]);
    queueBookingNotification({ business, customer, service, booking: updated, template: 'booking_cancelled' });
    recordAudit({
      businessId: business.id, actor, role: actor?.role || 'system', action: 'booking.cancelled',
      entityType: 'booking', entityId: bookingId, meta: { reason },
    });
    publish(business.id, 'booking.cancelled', {
      booking_id: bookingId, reference: updated.reference, start_at: updated.start_at, status: 'cancelled',
    });
    return updated;
  });
}

export function completeBooking({ business, bookingId, actor = null }) {
  const booking = get('SELECT * FROM bookings WHERE id = ? AND business_id = ?', [bookingId, business.id]);
  if (!booking) throw new AppError(404, 'Booking not found.', 'not_found');
  const service = get('SELECT * FROM services WHERE id = ?', [booking.service_id]);
  return tx(() => {
    run('UPDATE bookings SET status = ?, updated_at = ? WHERE id = ? AND business_id = ?', [
      'completed', nowIso(), bookingId, business.id,
    ]);
    run(
      `UPDATE customers SET total_bookings = total_bookings + 1,
        total_spend_cents = total_spend_cents + ?, last_visit_at = ?, updated_at = ?
       WHERE id = ? AND business_id = ?`,
      [int(booking.price_cents, 0), booking.start_at, nowIso(), booking.customer_id, business.id]
    );
    const updated = get('SELECT * FROM bookings WHERE id = ?', [bookingId]);
    const customer = get('SELECT * FROM customers WHERE id = ?', [booking.customer_id]);
    queueBookingNotification({ business, customer, service, booking: updated, template: 'feedback_request' });
    recordAudit({
      businessId: business.id, actor, role: actor?.role || 'system', action: 'booking.completed',
      entityType: 'booking', entityId: bookingId,
    });
    publish(business.id, 'booking.completed', { booking_id: bookingId, status: 'completed' });
    return updated;
  });
}

export function markNoShow({ business, bookingId, actor = null }) {
  const booking = get('SELECT * FROM bookings WHERE id = ? AND business_id = ?', [bookingId, business.id]);
  if (!booking) throw new AppError(404, 'Booking not found.', 'not_found');
  run('UPDATE bookings SET status = ?, updated_at = ? WHERE id = ? AND business_id = ?', [
    'no_show', nowIso(), bookingId, business.id,
  ]);
  recordAudit({
    businessId: business.id, actor, role: actor?.role || 'system', action: 'booking.no_show',
    entityType: 'booking', entityId: bookingId,
  });
  publish(business.id, 'booking.no_show', { booking_id: bookingId, status: 'no_show' });
  return get('SELECT * FROM bookings WHERE id = ?', [bookingId]);
}

export function addToWaitlist({ business, branchId, serviceId, staffId = null, customerId, desiredDate }) {
  const row = {
    id: id('wat'),
    business_id: business.id,
    branch_id: branchId,
    service_id: serviceId,
    staff_id: staffId,
    customer_id: customerId,
    desired_date: desiredDate,
    status: 'waiting',
    created_at: nowIso(),
  };
  insert('waitlist', row);
  publish(business.id, 'waitlist.added', { waitlist_id: row.id, desired_date: desiredDate });
  return row;
}

export function bookingsForDate(businessId, date, timeZone, branchId = null) {
  const start = zonedToUtc(date, 0, timeZone).toISOString();
  const end = zonedToUtc(addDays(date, 1), 0, timeZone).toISOString();
  return all(
    `SELECT bk.*, s.name AS service_name, s.duration_min, st.name AS staff_name,
            c.name AS customer_name, c.phone AS customer_phone
     FROM bookings bk
     JOIN services s ON s.id = bk.service_id
     JOIN staff st ON st.id = bk.staff_id
     JOIN customers c ON c.id = bk.customer_id
     WHERE bk.business_id = ? AND bk.start_at >= ? AND bk.start_at < ?
       AND (? IS NULL OR bk.branch_id = ?)
     ORDER BY bk.start_at ASC`,
    [businessId, start, end, branchId, branchId]
  );
}

export function upcomingBookings(businessId, { limit = 10, branchId = null, from = nowIso() } = {}) {
  return all(
    `SELECT bk.*, s.name AS service_name, st.name AS staff_name, c.name AS customer_name, c.phone AS customer_phone
     FROM bookings bk
     JOIN services s ON s.id = bk.service_id
     JOIN staff st ON st.id = bk.staff_id
     JOIN customers c ON c.id = bk.customer_id
     WHERE bk.business_id = ? AND bk.start_at >= ? AND bk.status IN ('pending','confirmed')
       AND (? IS NULL OR bk.branch_id = ?)
     ORDER BY bk.start_at ASC LIMIT ?`,
    [businessId, from, branchId, branchId, limit]
  );
}

export function flushBookingNotifications(businessId) {
  return flushQueue(businessId).catch(() => []);
}

export { bookingClamp };
