// IN PLAIN ENGLISH: handles "my city is X" / "I live in X" messages.
// Resolves the city, saves it, and confirms. No Claude call — just a save + ack.
// ============================================
// rebuild-city-update.js — city_update journey (thin; uses shared city core)
// ============================================
// Same shape as rebuild-sunset.js and rebuild-restaurant.js.
// classify() routes explicit city statements here (journey: 'city_update').
// The shared core in rebuild-city-journey.js handles resolve / ambiguous picker
// / pending resume — this file only supplies the confirm message.
// Uses pending_action (need: 'city' / 'city_pick') — never the legacy flags.
// ============================================

import { cityJourneyClaims, handleCityJourney } from './rebuild-city-journey.js';
import { sendMessage } from './whatsapp.js';
import { LOCATION_SHARE_INVITE } from './prompts.js';

export function cityUpdateClaims(user, intent, text) {
  return cityJourneyClaims(user, intent, 'city_update', text);
}

// Called by handleCityJourney after saveCity() has already written to DB + KV
// and updated user.city to the display string (e.g. "Brooklyn, New York, US").
async function answerCityUpdate(phone, user, place, intent, env) {
  await sendMessage(phone, `Got it — saved your city as ${user.city} 🙏🏾`, env);
}

export async function handleCityUpdate(phone, text, user, intent, env) {
  return handleCityJourney(phone, text, user, intent, env, {
    name: 'city_update',
    askCityPrompt: `Which city are you in? 🙏🏾${LOCATION_SHARE_INVITE}`,
    answer: answerCityUpdate,
    fallbackToSaved: false, // if city_raw fails to resolve, ask — don't confirm the old city
  });
}
