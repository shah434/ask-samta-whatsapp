// ============================================
// reminder-schedule.test.js — pure-logic scheduler tests
// Run: npx vitest run tests/reminder-schedule.test.js
// ============================================
// No network. Covers the two risky primitives (DST conversion, 24h gate) and
// the sunset/sunrise composer including the 'tomorrow'-query guard. These are
// the calculations that, if wrong, silently fire reminders at the wrong time.
// ============================================

import { describe, it, expect } from 'vitest';
import { localTimeToUtc, applyGate, computeSunReminderOffer } from '../src/reminder-schedule.js';

// Helper: what wall-clock hour:minute does this UTC instant show in a tz?
function wallClock(date, timeZone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

// ── PRIMITIVE 1: localTimeToUtc (DST-aware) ─────────────────────────────────
describe('localTimeToUtc', () => {
  it('maps 8:30 PM New York in winter (EST, UTC-5)', () => {
    const base = new Date('2026-01-15T12:00:00Z'); // mid-January
    const utc = localTimeToUtc('America/New_York', 20, 30, base);
    // 20:30 EST == 01:30 UTC next day
    expect(utc.toISOString()).toBe('2026-01-16T01:30:00.000Z');
    expect(wallClock(utc, 'America/New_York')).toBe('20:30');
  });

  it('maps 8:30 PM New York in summer (EDT, UTC-4)', () => {
    const base = new Date('2026-07-15T12:00:00Z'); // mid-July
    const utc = localTimeToUtc('America/New_York', 20, 30, base);
    // 20:30 EDT == 00:30 UTC next day
    expect(utc.toISOString()).toBe('2026-07-16T00:30:00.000Z');
    expect(wallClock(utc, 'America/New_York')).toBe('20:30');
  });

  it('produces the right wall-clock on a spring-forward day', () => {
    // US DST began 2026-03-08. 8:30 PM is well clear of the 2 AM jump, so it
    // must still render as 20:30 local and use the new (EDT) offset.
    const base = new Date('2026-03-08T18:00:00Z');
    const utc = localTimeToUtc('America/New_York', 20, 30, base);
    expect(wallClock(utc, 'America/New_York')).toBe('20:30');
  });

  it('handles a positive-offset tz (Asia/Kolkata, UTC+5:30)', () => {
    const base = new Date('2026-06-16T03:00:00Z'); // ~08:30 IST same day
    const utc = localTimeToUtc('Asia/Kolkata', 20, 30, base);
    // 20:30 IST == 15:00 UTC same day
    expect(utc.toISOString()).toBe('2026-06-16T15:00:00.000Z');
    expect(wallClock(utc, 'Asia/Kolkata')).toBe('20:30');
  });
});

// ── PRIMITIVE 2: applyGate ──────────────────────────────────────────────────
describe('applyGate', () => {
  const now = new Date('2026-06-16T12:00:00Z');

  it('passes a time 2 hours out', () => {
    expect(applyGate(new Date('2026-06-16T14:00:00Z'), now)).toBe(true);
  });

  it('rejects a time in the past', () => {
    expect(applyGate(new Date('2026-06-16T11:59:00Z'), now)).toBe(false);
  });

  it('rejects a time exactly 24h out (boundary is exclusive)', () => {
    expect(applyGate(new Date('2026-06-17T12:00:00Z'), now)).toBe(false);
  });

  it('passes a time just inside 24h', () => {
    expect(applyGate(new Date('2026-06-17T11:59:00Z'), now)).toBe(true);
  });

  it('rejects garbage input', () => {
    expect(applyGate('not-a-date', now)).toBe(false);
  });
});

// ── COMPOSER: computeSunReminderOffer ────────────────────────────────────────
const TZ = 'America/New_York';

// Winter NYC day (EST, UTC-5): early sunset keeps the math out of the
// summer degenerate case where sunset ≈ 8:30 PM.
const todayWinter = {
  city: 'New York, NY, USA',
  sunrise: '07:15 AM', sunset: '04:45 PM',
  sunriseISO: '2026-01-15T12:15:00+00:00', // 7:15 AM EST
  sunsetISO: '2026-01-15T21:45:00+00:00',  // 4:45 PM EST
  timezoneId: TZ, date: '2026-01-15', isToday: true,
};
const tomorrowWinter = {
  city: 'New York, NY, USA',
  sunrise: '07:14 AM', sunset: '04:46 PM',
  sunriseISO: '2026-01-16T12:14:00+00:00',
  sunsetISO: '2026-01-16T21:46:00+00:00',
  timezoneId: TZ, date: '2026-01-16', isToday: false,
};

describe('computeSunReminderOffer — sunset', () => {
  it('asked today, ≥3h before sunset → 1h before TODAY sunset', () => {
    const now = new Date('2026-01-15T18:00:00Z'); // 1 PM EST, sunset 4:45 PM → 3h45 ahead
    const out = computeSunReminderOffer({ sunKind: 'sunset', askedDay: 'today', todaySun: todayWinter, tomorrowSun: tomorrowWinter, timezone: TZ, now });
    expect(out.type).toBe('sunset');
    expect(out.day).toBe('today');
    expect(out.send_at).toBe('2026-01-15T20:45:00.000Z'); // 21:45Z - 1h
    expect(out.display).toBe('04:45 PM');
  });

  it('asked today, <3h before sunset → 8:30 AM heads-up TOMORROW', () => {
    // 4 PM EST: today's sunset 4:45 PM is 45 min away (<3h) → defer to tomorrow.
    // Reminder is the 8:30 AM morning heads-up on the 16th (13:30Z), ~16.5h out.
    const now = new Date('2026-01-15T21:00:00Z');
    const out = computeSunReminderOffer({ sunKind: 'sunset', askedDay: 'today', todaySun: todayWinter, tomorrowSun: tomorrowWinter, timezone: TZ, now });
    expect(out.day).toBe('tomorrow');
    expect(out.send_at).toBe('2026-01-16T13:30:00.000Z'); // 8:30 AM EST on the 16th
    expect(wallClock(new Date(out.send_at), TZ)).toBe('08:30');
    expect(out.display).toBe('04:46 PM'); // tomorrow's sunset time, shown in the AM nudge
  });

  it('asked tomorrow → 8:30 AM heads-up TOMORROW', () => {
    const now = new Date('2026-01-15T21:00:00Z'); // 4 PM EST
    const out = computeSunReminderOffer({ sunKind: 'sunset', askedDay: 'tomorrow', todaySun: todayWinter, tomorrowSun: tomorrowWinter, timezone: TZ, now });
    expect(out.day).toBe('tomorrow');
    expect(out.send_at).toBe('2026-01-16T13:30:00.000Z');
    expect(out.display).toBe('04:46 PM');
  });

  it('returns null when even the 8:30 AM heads-up exceeds 24h (very early ask)', () => {
    // 6 AM EST ask about tomorrow's sunset: 8:30 AM tomorrow (13:30Z 16th) is
    // ~26.5h away → outside the gate. Rare, but must decline rather than misfire.
    const now = new Date('2026-01-15T11:00:00Z');
    const out = computeSunReminderOffer({ sunKind: 'sunset', askedDay: 'tomorrow', todaySun: todayWinter, tomorrowSun: tomorrowWinter, timezone: TZ, now });
    expect(out).toBeNull();
  });
});

describe('computeSunReminderOffer — sunrise', () => {
  it('before 8:30 PM and sunrise far → reminder at 8:30 PM today', () => {
    const now = new Date('2026-01-15T18:00:00Z'); // 1 PM EST; next sunrise tomorrow 7:14 AM
    const out = computeSunReminderOffer({ sunKind: 'sunrise', todaySun: todayWinter, tomorrowSun: tomorrowWinter, timezone: TZ, now });
    expect(out.type).toBe('sunrise');
    expect(wallClock(new Date(out.send_at), TZ)).toBe('20:30');
    expect(out.send_at).toBe('2026-01-16T01:30:00.000Z'); // 8:30 PM EST on the 15th
    expect(out.display).toBe('07:14 AM'); // tomorrow's sunrise (today's already passed)
  });

  it('past 8:30 PM → 1h before next sunrise (morning-of)', () => {
    const now = new Date('2026-01-16T02:30:00Z'); // 9:30 PM EST on the 15th
    const out = computeSunReminderOffer({ sunKind: 'sunrise', todaySun: todayWinter, tomorrowSun: tomorrowWinter, timezone: TZ, now });
    expect(out.send_at).toBe('2026-01-16T11:14:00.000Z'); // tomorrow sunrise 12:14Z - 1h
    expect(out.display).toBe('07:14 AM');
  });

  it('next sunrise <3h away → 1h before it even though before 8:30 PM', () => {
    // 5:00 AM EST: today's sunrise (7:15 AM = 12:15Z) is 2h15 away (<3h).
    const now = new Date('2026-01-15T10:00:00Z');
    const out = computeSunReminderOffer({ sunKind: 'sunrise', todaySun: todayWinter, tomorrowSun: tomorrowWinter, timezone: TZ, now });
    expect(out.send_at).toBe('2026-01-15T11:15:00.000Z'); // today sunrise 12:15Z - 1h
    expect(out.display).toBe('07:15 AM'); // today's, since it's still ahead
  });
});

describe('computeSunReminderOffer — guards', () => {
  it('returns null on unknown sunKind', () => {
    expect(computeSunReminderOffer({ sunKind: 'noon', todaySun: todayWinter, timezone: TZ })).toBeNull();
  });
  it('returns null with no timezone', () => {
    expect(computeSunReminderOffer({ sunKind: 'sunset', askedDay: 'today', todaySun: todayWinter, timezone: null })).toBeNull();
  });
  it('returns null when tomorrow data is needed but missing', () => {
    const now = new Date('2026-01-15T20:00:00Z'); // <3h before sunset → needs tomorrow
    expect(computeSunReminderOffer({ sunKind: 'sunset', askedDay: 'today', todaySun: todayWinter, tomorrowSun: null, timezone: TZ, now })).toBeNull();
  });
});
