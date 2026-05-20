// ============================================
// sunset.js — Sunrise and sunset lookup
// Uses Open-Meteo (free) + sunrise-sunset.org (free)
// No API keys needed
// v3 — geocoding split out so the worker can disambiguate
//      when multiple cities share a name (e.g. "San Jose")
// ============================================

/**
 * Geocode a city name and return one of three states:
 *   { status: 'unique',     place: <placeObj> }
 *   { status: 'ambiguous',  candidates: [<placeObj>, ...] }
 *   { status: 'not_found' }
 *
 * placeObj has: name, latitude, longitude, timezone, admin1, country
 */
export async function geocodeCity(city) {
  try {
    const cleanCity = city
      .replace(/,\s*[A-Z]{2}$/i, '')   // strip ", NY" style state codes
      .replace(/,/g, ' ')
      .trim();

    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cleanCity)}&count=5&language=en&format=json`;
    const res = await fetch(url);
    const data = await res.json();
    const results = data.results || [];

    if (results.length === 0) return { status: 'not_found' };

    // Prefer exact name matches so "San Jose" doesn't surface
    // "San Jose del Cabo" or "San Joseph" alongside the real options.
    const exact = results.filter(
      r => r.name.toLowerCase() === cleanCity.toLowerCase()
    );
    const candidates = exact.length > 0 ? exact : results;

    if (candidates.length === 1) {
      return { status: 'unique', place: candidates[0] };
    }
    return { status: 'ambiguous', candidates: candidates.slice(0, 4) };

  } catch (err) {
    console.log('geocodeCity error:', err.message);
    return { status: 'not_found' };
  }
}

/**
 * Fetch sunrise/sunset for an already-resolved place object.
 * Returns { city, sunrise, sunset, timezoneId } or null on failure.
 */
export async function getSunForPlace(place) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const sunUrl = `https://api.sunrise-sunset.org/json?lat=${place.latitude}&lng=${place.longitude}&date=${today}&formatted=0`;
    const sunRes = await fetch(sunUrl);
    const sunData = await sunRes.json();

    if (sunData.status !== 'OK') return null;

    const displayCity = `${place.name}${place.admin1 ? ', ' + place.admin1 : ''}, ${place.country}`;

    return {
      city: displayCity,
      sunrise: formatTime(sunData.results.sunrise, place.timezone),
      sunset: formatTime(sunData.results.sunset, place.timezone),
      timezoneId: place.timezone
    };

  } catch (err) {
    console.log('getSunForPlace error:', err.message);
    return null;
  }
}

/**
 * Convenience wrapper used by the sunset path when the city is unambiguous.
 * Returns null when the city is ambiguous or not found — callers that need
 * disambiguation should use geocodeCity + getSunForPlace directly.
 */
export async function getSunriseSunset(city) {
  const geo = await geocodeCity(city);
  if (geo.status !== 'unique') return null;
  return getSunForPlace(geo.place);
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
  return `
========================================
EXACT SUNRISE/SUNSET DATA FOR THIS REPLY:
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

export function detectSunsetQuery(text) {
  const lower = text.toLowerCase();
  const keywords = [
    'sunset', 'sunrise', 'sun set', 'sun rise',
    'what time is sunset', 'what time is sunrise',
    'when is sunset', 'when is sunrise',
    'what time does the sun'
  ];
  return keywords.some(k => lower.includes(k));
}

export function extractCityFromSunQuery(text) {
  const cleaned = text
    .replace(/\btoday\b/gi, '')
    .replace(/\btonight\b/gi, '')
    .replace(/\bnow\b/gi, '')
    .replace(/\bcurrently\b/gi, '')
    .trim();

  const patterns = [
    /(?:sunset|sunrise)\s+(?:in|for|at)\s+([a-zA-Z\s,]+?)(?:\?|$)/i,
    /(?:sunset|sunrise)\s+(?:in|for|at)\s+(\d{5})/i,
    /\b(\d{5})\b/i,
    /\b([A-Z]{1,2}\d{1,2}\s?\d[A-Z]{2})\b/i
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (match && match[1]) {
      const location = match[1].trim();
      if (['me', 'here', 'my area', 'nearby', 'near me'].includes(location.toLowerCase())) {
        return null;
      }
      return location;
    }
  }

  return null;
}
