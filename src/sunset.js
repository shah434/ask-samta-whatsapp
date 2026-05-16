// ============================================
// sunset.js — Sunrise and sunset lookup
// Uses Open-Meteo (free) + sunrise-sunset.org (free)
// No API keys needed
// v2
// ============================================

export async function getSunriseSunset(city) {
  try {
    // Clean city name — remove state abbreviations and extra punctuation
    const cleanCity = city
      .replace(/,\s*[A-Z]{2}$/i, '')  // Remove ", NY" style state codes
      .replace(/,/g, ' ')              // Replace remaining commas with spaces
      .trim();

    console.log('Looking up city:', cleanCity);

    const geocodeUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cleanCity)}&count=1&language=en&format=json`;    
    const geocodeRes = await fetch(geocodeUrl);
    const geocodeData = await geocodeRes.json();

    if (!geocodeData.results || geocodeData.results.length === 0) {
      return null;
    }

    const result = geocodeData.results[0];
    const lat = result.latitude;
    const lng = result.longitude;
    const timezoneId = result.timezone;
    const formattedCity = `${result.name}, ${result.country}`;

    // Step 2: Fetch sunrise/sunset (free, no key)
    const today = new Date().toISOString().split('T')[0];
    const sunUrl = `https://api.sunrise-sunset.org/json?lat=${lat}&lng=${lng}&date=${today}&formatted=0`;
    const sunRes = await fetch(sunUrl);
    const sunData = await sunRes.json();

    if (sunData.status !== 'OK') {
      return null;
    }

    // Step 3: Format times in local timezone
    const sunrise = formatTime(sunData.results.sunrise, timezoneId);
    const sunset = formatTime(sunData.results.sunset, timezoneId);

    return { city: formattedCity, sunrise, sunset, timezoneId };

  } catch (err) {
    console.log('getSunriseSunset error:', err.message);
    return null;
  }
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
SUNRISE/SUNSET FOR ${sunData.city.toUpperCase()}:
Sunrise: ${sunData.sunrise}
Sunset: ${sunData.sunset}
Timezone: ${sunData.timezoneId}
Note: For religious precision always verify 
with timeanddate.com or your local panchang`;
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

  // Must reference sunset or sunrise directly before location
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
