// Converts GPS coordinates from a WhatsApp location pin into a place object.
// Two parallel free API calls: Nominatim for city name, Open-Meteo for timezone.
// Returns null on any failure — callers should fall back to asking for city by text.

import { fetchWithTimeout } from './utils.js';

export async function reverseGeocode(lat, lng) {
  try {
    const [nominatimRes, openMeteoRes] = await Promise.all([
      fetchWithTimeout(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`,
        { headers: { 'User-Agent': 'SamtaAgent/1.0' } },
        4000
      ),
      fetchWithTimeout(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&timezone=auto&forecast_days=0`,
        {},
        3000
      ),
    ]);

    if (!nominatimRes.ok || !openMeteoRes.ok) return null;

    const [nominatim, openMeteo] = await Promise.all([
      nominatimRes.json(),
      openMeteoRes.json(),
    ]);

    const addr = nominatim?.address || {};
    // Priority: city > town > village > county. Never use suburb or neighbourhood.
    const name = addr.city ?? addr.town ?? addr.village ?? addr.county ?? null;
    if (!name) return null;

    const timezone = openMeteo?.timezone;
    if (!timezone) return null;

    return {
      name,
      admin1: addr.state ?? null,
      country: addr.country ?? null,
      latitude: lat,
      longitude: lng,
      timezone,
    };
  } catch {
    return null;
  }
}
