// IN PLAIN ENGLISH: the dangerous time-math, in one tested box.
// Two hard calculations live here and NOWHERE else:
//   1. "what UTC instant is 8:30 PM in the user's city today?" (daylight-saving)
//   2. "is this reminder time within the next 24 hours?" (the gate)
// Every reminder type — sunset today, tithi tomorrow — composes these two
// primitives instead of re-deriving the danger. Claude never runs this code;
// the cron sends the result verbatim.
// ============================================
// reminder-schedule.js — pure-logic reminder scheduler (no I/O, no network)
// ============================================
// Tested per the CLAUDE.md "pure-logic only" convention. The compute functions
// return Reminder[] (an array, even when there is only one) so the schedule
// write and cron loop are identical for every reminder type — a future tithi
// computer returns two slots through the exact same shape.
//
// Reminder shape:
//   { type, send_at, sun_time, display, city }
//     type     'sunset' | 'sunrise'   (future: 'tithi')
//     send_at  ISO UTC — when the cron should fire it
//     sun_time ISO UTC — the actual event instant (sunset/sunrise)
//     display  human string the ORIGINAL answer showed ("7:14 PM") — reused
//              verbatim so the reminder never disagrees with the answer
//     city     display city at schedule time
// ============================================

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MIN_MS = 60 * 1000;

// ── PRIMITIVE 1: timezone offset at a given instant ──────────────────────────
// Returns ms to ADD to a UTC instant to get wall-clock time in `timeZone`
// (local = utc + offset). DST-aware because Intl resolves the offset for that
// specific instant, not a fixed rule.
function tzOffsetMs(timeZone, date) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const map = {};
  for (const p of dtf.formatToParts(date)) map[p.type] = p.value;
  // Hour can come back as "24" at midnight in some engines — normalize.
  const hour = map.hour === '24' ? 0 : +map.hour;
  const asUTC = Date.UTC(+map.year, +map.month - 1, +map.day, hour, +map.minute, +map.second);
  return asUTC - date.getTime();
}

// ── PRIMITIVE 1 (public): wall-clock time in a tz → UTC Date ─────────────────
// "8:30 PM today in America/New_York" → the correct UTC instant, DST included.
// `base` picks WHICH day (defaults to now); we take that day's calendar date in
// the target tz, then pin hh:mm to it. Two-pass to settle DST transition days.
export function localTimeToUtc(timeZone, hh, mm, base = new Date()) {
  const df = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const map = {};
  for (const p of df.formatToParts(base)) map[p.type] = p.value;
  const y = +map.year, mo = +map.month, d = +map.day;

  // First guess: treat the wall time as if it were UTC, then back out the
  // offset at that guess. One correction settles all but the rare case where
  // the guess and the result straddle a DST boundary — a second pass fixes it.
  const guess = Date.UTC(y, mo - 1, d, hh, mm, 0);
  const off1 = tzOffsetMs(timeZone, new Date(guess));
  let utc = guess - off1;
  const off2 = tzOffsetMs(timeZone, new Date(utc));
  if (off2 !== off1) utc = guess - off2;
  return new Date(utc);
}

// ── PRIMITIVE 2: the 24h session gate ────────────────────────────────────────
// A reminder is schedulable only if it fires in the future AND inside the
// WhatsApp 24h session window (so we never need a paid template to send it).
export function applyGate(sendAt, now = new Date()) {
  const t = sendAt instanceof Date ? sendAt.getTime() : Date.parse(sendAt);
  if (Number.isNaN(t)) return false;
  const n = now.getTime();
  return t > n && t < n + DAY_MS;
}

// Threshold (hours) below which we skip the evening "8:30 PM" nudge (sunrise)
// or today's reminder (sunset) and react to how close the event is.
const SUNRISE_SOON_H = 3;
const SUNSET_LEAD_H = 3;

// ── COMPOSER: what reminder to OFFER ─────────────────────────────────────────
// This is opt-in: the bot answers the sun question, then offers a reminder.
// This function computes WHAT to offer (it does not send or persist). On the
// user's "yes" the precomputed result is committed verbatim — no recompute, so
// no drift between what was offered and what fires.
//
// Returns a single offer object or null (nothing schedulable — bad data, or
// the computed time won't fit the 24h WhatsApp session gate, so we don't
// offer at all). Shape:
//   { type, day, send_at, sun_time, display, city }
//     day  'today' | 'tomorrow' | 'next'  (which event the reminder is about)
//
// CONTRACT: caller supplies `todaySun` and (when needed) `tomorrowSun`, each a
// getSunForPlace() result. The day-selection lives here; the fetching lives in
// the caller (that's where the network/KV cache is).
export function computeSunReminderOffer({ sunKind, askedDay, todaySun, tomorrowSun, timezone, now = new Date() }) {
  if (!timezone) return null;
  if (sunKind === 'sunset') return sunsetOffer({ askedDay, todaySun, tomorrowSun, timezone, now });
  if (sunKind === 'sunrise') return sunriseOffer({ todaySun, tomorrowSun, timezone, now });
  return null;
}

// Sunset: honor the literal day asked.
//  - asked today, ≥3h before today's sunset → remind 1h before TODAY's sunset
//  - asked today, <3h before (or past)       → TOMORROW (morning heads-up)
//  - asked tomorrow                           → TOMORROW (morning heads-up)
//
// Why tomorrow's reminder fires at 8:30 AM (not 1h before): 1h-before-tomorrow's
// -sunset is ~25h from an afternoon ask → outside the 24h WhatsApp session gate,
// so it could never send for free. An 8:30 AM heads-up on the day-of is ~15h
// out → fits, and it's a useful "today's sunset is at X" morning nudge.
function sunsetOffer({ askedDay, todaySun, tomorrowSun, timezone, now }) {
  let pick;
  if (askedDay === 'tomorrow') {
    pick = tomorrowSun && { iso: tomorrowSun.sunsetISO, display: tomorrowSun.sunset, city: tomorrowSun.city, day: 'tomorrow' };
  } else {
    const todayMs = Date.parse(todaySun?.sunsetISO);
    if (Number.isNaN(todayMs)) return null;
    if (now.getTime() <= todayMs - SUNSET_LEAD_H * HOUR_MS) {
      pick = { iso: todaySun.sunsetISO, display: todaySun.sunset, city: todaySun.city, day: 'today' };
    } else {
      pick = tomorrowSun && { iso: tomorrowSun.sunsetISO, display: tomorrowSun.sunset, city: tomorrowSun.city, day: 'tomorrow' };
    }
  }
  if (!pick || Number.isNaN(Date.parse(pick.iso))) return null;

  // Compute send_at and fire type:
  //   today  → always 1h before sunset
  //   tomorrow, sunset <24h away (late-night ask) → 1h before sunset
  //   tomorrow, sunset ≥24h away (morning ask)    → 8:30 AM heads-up on sunset day
  //   tomorrow, 8:30 AM also >24h away (very early ask) → now + 23h50m fallback
  const today = pick.day === 'today';
  let sendAt, fire;

  if (today) {
    sendAt = new Date(Date.parse(pick.iso) - HOUR_MS);
    fire = 'before_sunset';
  } else {
    const beforeSunset = new Date(Date.parse(pick.iso) - HOUR_MS);
    if (applyGate(beforeSunset, now)) {
      sendAt = beforeSunset;
      fire = 'before_sunset';
    } else {
      sendAt = localTimeToUtc(timezone, 8, 30, new Date(Date.parse(pick.iso)));
      fire = 'morning';
      if (!applyGate(sendAt, now)) {
        sendAt = new Date(now.getTime() + 23 * HOUR_MS + 50 * 60 * 1000);
        if (!applyGate(sendAt, now)) return null;
      }
    }
  }

  if (!applyGate(sendAt, now)) return null;
  return { type: 'sunset', day: pick.day, fire, send_at: sendAt.toISOString(), sun_time: pick.iso, display: pick.display, city: pick.city };
}

// ── Tithi reminder offer ──────────────────────────────────────────────────────
// Offer only when tomorrow IS a tithi AND current local time < 7:30 PM.
// Fires at 8:30 PM tonight — the user gets an evening heads-up to prepare.
// `calendarEvents` is the raw array from getCalendarCached (dates as Date objects).
export function computeTithiReminderOffer({ calendarEvents, timezone, now = new Date() }) {
  if (!timezone || !Array.isArray(calendarEvents)) return null;

  // Resolve tomorrow's calendar date in the user's timezone using the same
  // local-midnight construction as parseICSDate in calendar.js, so the
  // .getTime() comparison works without UTC offset issues.
  const df = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const map = {};
  for (const p of df.formatToParts(now)) map[p.type] = p.value;
  const tomorrow = new Date(+map.year, +map.month - 1, +map.day + 1);

  const tomorrowEvent = calendarEvents.find(e => e.date.getTime() === tomorrow.getTime());
  if (!tomorrowEvent) return null;

  // Gate: only offer before 7:30 PM local (reminder at 8:30 PM tonight must be
  // far enough in the future to be useful).
  const cutoff = localTimeToUtc(timezone, 19, 30, now);
  if (now.getTime() >= cutoff.getTime()) return null;

  const sendAt = localTimeToUtc(timezone, 20, 30, now);
  if (!applyGate(sendAt, now)) return null;

  return {
    type: 'tithi',
    fire: 'tithi_evening',
    send_at: sendAt.toISOString(),
    sun_time: null,
    display: tomorrowEvent.summary,
    city: null, // caller sets this
    day: 'tomorrow',
  };
}

// Sunrise: the reminder is always for the NEXT sunrise (today's if still ahead,
// else tomorrow's).
//  - now past 8:30 PM OR next sunrise <3h away → remind 1h before that sunrise
//  - otherwise                                  → remind at 8:30 PM today
// Precedence: morning-of is checked first (an 8:30 PM slot that's already
// passed would never fire — see tests).
function sunriseOffer({ todaySun, tomorrowSun, timezone, now }) {
  const todayMs = Date.parse(todaySun?.sunriseISO);
  let next;
  if (!Number.isNaN(todayMs) && todayMs > now.getTime()) {
    next = { iso: todaySun.sunriseISO, display: todaySun.sunrise, city: todaySun.city };
  } else if (tomorrowSun) {
    next = { iso: tomorrowSun.sunriseISO, display: tomorrowSun.sunrise, city: tomorrowSun.city };
  } else {
    return null;
  }
  const nextMs = Date.parse(next.iso);
  if (Number.isNaN(nextMs)) return null;

  const slot830 = localTimeToUtc(timezone, 20, 45, now);
  const past830 = slot830.getTime() <= now.getTime();
  const soon = (nextMs - now.getTime()) < SUNRISE_SOON_H * HOUR_MS;

  const morningOf = past830 || soon;
  const sendAt = morningOf ? new Date(nextMs - HOUR_MS) : slot830;
  if (!applyGate(sendAt, now)) return null;
  // fire: 'before_sunrise' (1h before) vs 'evening' (8:30 PM tonight).
  return { type: 'sunrise', day: 'next', fire: morningOf ? 'before_sunrise' : 'evening', send_at: sendAt.toISOString(), sun_time: next.iso, display: next.display, city: next.city };
}
