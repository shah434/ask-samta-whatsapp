// ============================================
// rebuild-city-journey.js — shared core for city-needing journeys (v3.1)
// ============================================
// Sunset and restaurant are the same shape: they need ONE city, and once
// they have a resolved place they produce an answer. The ONLY difference is
// the answer step. Rather than copy the resolve/pending/resume machinery into
// two files that will drift apart, that machinery lives here ONCE, and each
// journey supplies:
//   - its journey name ('sunset' | 'restaurant')
//   - an askCityPrompt string ("Which city should I check sunset for?")
//   - an answer(phone, user, place, intent, env) function
//
// This is the same isolation contract as before: reads/writes ONLY
// users.pending_action, always returns true when it owns the turn, never
// touches the old flags, never replays raw text.
// ============================================

import { resolveLocation, formatCandidatePicker } from './resolveLocation.js';
import { serializePending, readPending } from './pending.js';
import { sendMessage } from './whatsapp.js';
import { updateUser } from './database.js';

// Does the new path own this turn for the given journey name?
//   true if a pending record for THIS journey is waiting, or it's a fresh
//   request for this journey.
//
// PENDING ALWAYS WINS: if a pending record exists for ANY city-journey, the
// turn belongs to that journey — a fresh, different-journey intent must NOT
// hijack it. Without this, "ask for restaurants -> bot asks city -> user types
// 'sunset in Paris'" would let the sunset gate steal the turn and silently
// abandon the pending restaurant flow. That is the colliding-state bug class
// this rebuild exists to kill. So:
//   - pending record for THIS journey  -> claim (we're resuming it)
//   - pending record for ANOTHER city-journey -> do NOT claim (it owns the turn)
//   - no pending record + fresh intent for THIS journey -> claim
const CITY_JOURNEYS = new Set(['sunset', 'restaurant']);

export function cityJourneyClaims(user, intent, journeyName) {
  const pending = readPending(user.pending_action);
  if (pending && CITY_JOURNEYS.has(pending.intent.journey)) {
    // A city-journey is mid-flow. Only its owning journey may claim the turn.
    return pending.intent.journey === journeyName;
  }
  // No city-journey pending → a fresh request for this journey claims it.
  return intent.journey === journeyName;
}

// Persist a resolved place onto the user (DB + in-memory), clearing pending.
async function saveCity(phone, user, place, env) {
  const display = `${place.name}${place.admin1 ? ', ' + place.admin1 : ''}${place.country ? ', ' + place.country : ''}`;
  await updateUser(phone, {
    city: display,
    timezone: place.timezone,
    latitude: place.latitude,
    longitude: place.longitude,
    pending_action: null,
  }, env);
  user.city = display;
  user.timezone = place.timezone;
  user.latitude = place.latitude;
  user.longitude = place.longitude;
  user.pending_action = null;
}

// Reconstruct a place from the user's saved coords (no re-geocode).
// Returns null if we don't have full saved coordinates.
function placeFromSaved(user) {
  if (!user.city || user.latitude == null || user.longitude == null || !user.timezone) {
    return null;
  }
  return {
    name: user.city, latitude: user.latitude, longitude: user.longitude,
    timezone: user.timezone, admin1: null, country: null,
  };
}

// The shared handler. `journey` is { name, askCityPrompt, answer }.
// Returns true if it handled the turn (caller must then return).
export async function handleCityJourney(phone, text, user, intent, env, journey) {
  const pending = readPending(user.pending_action);

  // ---- RESUME: we previously asked this user for a city ----------------------
  if (pending && pending.intent.journey === journey.name) {
    const reply = (text || '').trim();

    // Resume A: numbered pick from a city_pick list.
    if (pending.need === 'city_pick') {
      const n = /^[1-9][0-9]?$/.test(reply) ? parseInt(reply, 10) : null;
      const picked = n && pending.choices[n - 1];
      if (!picked) {
        await sendMessage(phone, `That number didn't match the list. Please type your city name again 🙏`, env);
        return true; // keep pending so they can retry
      }
      await saveCity(phone, user, picked, env);
      await journey.answer(phone, user, picked, pending.intent, env);
      return true;
    }

    // Resume B: they typed a city name in answer to "which city?".
    const res = await resolveLocation(reply);
    if (res.status === 'resolved') {
      await saveCity(phone, user, res.place, env);
      await journey.answer(phone, user, res.place, pending.intent, env);
      return true;
    }
    if (res.status === 'ambiguous') {
      const rec = serializePending({ need: 'city_pick', intent: pending.intent, choices: res.candidates });
      await updateUser(phone, { pending_action: rec }, env);
      user.pending_action = rec;
      await sendMessage(phone, formatCandidatePicker(reply, res.candidates), env);
      return true;
    }
    if (res.status === 'error') {
      await sendMessage(phone, `Sorry — I couldn't look that up right now. Please try again in a moment 🙏`, env);
      return true; // keep pending; retry
    }
    // missing
    await sendMessage(phone, `I couldn't find that city. Please type the full city name with state or country 🙏`, env);
    return true;
  }

  // ---- FRESH request ---------------------------------------------------------
  const cityRaw = intent.params.city_raw || null;

  if (cityRaw) {
    const res = await resolveLocation(cityRaw);
    if (res.status === 'resolved') {
      await saveCity(phone, user, res.place, env);
      await journey.answer(phone, user, res.place, intent, env);
      return true;
    }
    if (res.status === 'ambiguous') {
      const rec = serializePending({ need: 'city_pick', intent, choices: res.candidates });
      await updateUser(phone, { pending_action: rec }, env);
      user.pending_action = rec;
      await sendMessage(phone, formatCandidatePicker(cityRaw, res.candidates), env);
      return true;
    }
    // missing/error → fall through to saved-city / ask
  }

  // Saved city? Use it without re-geocoding.
  const saved = placeFromSaved(user);
  if (saved) {
    await journey.answer(phone, user, saved, intent, env);
    return true;
  }

  // Nothing usable → store pending(need:city, intent) and ask.
  const rec = serializePending({ need: 'city', intent });
  await updateUser(phone, { pending_action: rec }, env);
  user.pending_action = rec;
  await sendMessage(phone, journey.askCityPrompt, env);
  return true;
}
