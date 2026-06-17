// ============================================
// sunset.js — Sunrise and sunset lookup
// Uses Open-Meteo (free) + sunrise-sunset.org (free)
// No API keys needed
// ============================================

import { fetchWithTimeout } from './utils.js';

/**
 * Fetch sunrise/sunset for an already-resolved place object.
 * Returns { city, sunrise, sunset, timezoneId } or null on failure.
 */
export async function getSunForPlace(place, date = null, env = null) {
  try {
    // Date must be the USER'S LOCAL date, not UTC. Using UTC shifts "today"/
    // "tomorrow" forward a day in the evening (e.g. after ~8 PM ET the UTC clock
    // has already rolled over) — which both mislabels the answer and breaks
    // reminder gating. Resolve the local calendar date in the place's timezone.
    const dateStr = localDateStr(place.timezone, date === 'tomorrow' ? 1 : 0);

    // KV cache — sun times are deterministic per location+date, cache for 24h.
    // The "v2" version tag invalidates pre-existing entries that were cached
    // before sunriseISO/sunsetISO were added — old entries lack those fields,
    // which would silently break reminder scheduling until they expired.
    const cacheKey = `sun:v2:${Number(place.latitude).toFixed(4)}:${Number(place.longitude).toFixed(4)}:${dateStr}`;
    if (env?.KV) {
      const cached = await env.KV.get(cacheKey, 'json');
      if (cached) {
        console.log(`[sun] kv_hit name=${place.name} date=${dateStr}`);
        return cached;
      }
    }

    const sunUrl = `https://api.sunrise-sunset.org/json?lat=${place.latitude}&lng=${place.longitude}&date=${dateStr}&formatted=0`;
    console.log(`[sun] lookup name=${place.name} lat=${place.latitude} lng=${place.longitude} tz=${place.timezone} date=${dateStr}`);

    let sunRes = await fetchWithTimeout(sunUrl, {}, 3000);
    if (sunRes.status === 429) {
      console.log(`[sun] rate_limited, retrying`);
      await new Promise(r => setTimeout(r, 1000));
      sunRes = await fetchWithTimeout(sunUrl, {}, 3000);
    }
    if (!sunRes.ok) {
      console.log(`[sun] http_error status=${sunRes.status}`);
      return null;
    }
    const sunData = await sunRes.json();

    if (sunData.status !== 'OK') {
      console.log(`[sun] api_status_not_ok status=${sunData.status}`);
      return null;
    }

    const sunrise = formatTime(sunData.results.sunrise, place.timezone);
    const sunset = formatTime(sunData.results.sunset, place.timezone);
    if (!sunrise || !sunset) {
      console.log(`[sun] format_failed sunrise=${sunrise} sunset=${sunset} tz=${place.timezone}`);
      return null;
    }

    // If admin1/country are missing (e.g. reconstructed from placeFromUser),
    // assume the name already includes them (display string was saved).
    const displayCity = place.admin1 || place.country
      ? `${place.name}${place.admin1 ? ', ' + place.admin1 : ''}${place.country ? ', ' + place.country : ''}`
      : place.name;

    const result = {
      city: displayCity,
      sunrise,
      sunset,
      // Raw UTC ISO timestamps from the API (formatted=0). The display strings
      // above are for humans/Claude; these are for scheduling math, which must
      // never parse a localized display string back into a Date. Additive —
      // existing consumers (formatSunDataForClaude) ignore these fields.
      sunriseISO: sunData.results.sunrise,
      sunsetISO: sunData.results.sunset,
      timezoneId: place.timezone,
      date: dateStr,
      isToday: date !== 'tomorrow',
    };

    if (env?.KV) {
      await env.KV.put(cacheKey, JSON.stringify(result), { expirationTtl: 86400 });
      console.log(`[sun] kv_set key=${cacheKey}`);
    }

    return result;

  } catch (err) {
    console.log(`[sun] exception: ${err.message}`);
    return null;
  }
}

/**
 * Build a place object from saved user fields. Use when we resolved the
 * city in a previous turn and just need to look up sun times again.
 * Returns null if the user has no saved coordinates.
 */
export function placeFromUser(user) {
  if (!user || user.latitude == null || user.longitude == null || !user.timezone) {
    return null;
  }
  return {
    name: user.city,
    latitude: user.latitude,
    longitude: user.longitude,
    timezone: user.timezone,
    admin1: null,
    country: null
  };
}

// The calendar date (YYYY-MM-DD) in `timezone`, offset by `offsetDays`.
// en-CA formats as ISO YYYY-MM-DD. Adding whole days in ms is safe at date
// granularity (a DST hour never changes which calendar day it lands on here).
function localDateStr(timezone, offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return d.toLocaleDateString('en-CA', { timeZone: timezone || 'UTC' });
}

function formatTime(utcString, timezoneId) {
  try {
    const date = new Date(utcString);
    return date.toLocaleTimeString('en-US', {
      timeZone: timezoneId,
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  } catch {
    return null;
  }
}

export function formatSunDataForClaude(sunData) {
  if (!sunData) return '';
  const dayLabel = sunData.isToday ? 'TODAY' : 'TOMORROW';
  return `
========================================
EXACT SUNRISE/SUNSET DATA FOR THIS REPLY:
Date: ${dayLabel} (${sunData.date})
City: ${sunData.city}
Sunrise: ${sunData.sunrise}
Sunset: ${sunData.sunset}
Timezone: ${sunData.timezoneId}
========================================
You MUST use these exact times verbatim.
Do NOT round, estimate, recalculate, or change them.
If you write any time other than "${sunData.sunset}" for sunset
or "${sunData.sunrise}" for sunrise, you are wrong.`;
}
