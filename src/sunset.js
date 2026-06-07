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
export async function getSunForPlace(place, date = null) {
  try {
    let dateStr;
    if (date === 'tomorrow') {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      dateStr = d.toISOString().split('T')[0];
    } else {
      dateStr = new Date().toISOString().split('T')[0];
    }
    const sunUrl = `https://api.sunrise-sunset.org/json?lat=${place.latitude}&lng=${place.longitude}&date=${dateStr}&formatted=0`;
    console.log(`[sun] lookup name=${place.name} lat=${place.latitude} lng=${place.longitude} tz=${place.timezone} date=${dateStr}`);

    const sunRes = await fetchWithTimeout(sunUrl, {}, 3000);
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

    return {
      city: displayCity,
      sunrise,
      sunset,
      timezoneId: place.timezone,
      date: dateStr,
      isToday: date !== 'tomorrow',
    };

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
