// IN PLAIN ENGLISH: the sunset-specific bit. Says what question to ask
// ("which city?") and what to do once we have a city (look up sun times).
// Hands the actual flow to rebuild-city-journey.js. Imported by worker.js.
// ============================================
// rebuild-sunset.js — v3.1 sunset journey (thin; uses shared city core)
// ============================================
// The resolve/pending/resume machinery lives in rebuild-city-journey.js.
// This file supplies ONLY what's unique to sunset: the prompt to ask for a
// city, and how to answer once we have a resolved place.
// ============================================

import { cityJourneyClaims, handleCityJourney } from './rebuild-city-journey.js';
import { getSunForPlace, formatSunDataForClaude } from './sunset.js';
import { sendMessage } from './whatsapp.js';
import { callClaude } from './claude.js';
import { buildSystemPrompt, buildHistoryMessages, buildHistoryUpdate } from './utils.js';
import { serializePending } from './pending.js';
import { updateUser } from './database.js';
import { LOCATION_SHARE_INVITE } from './prompts.js';
import { computeSunReminderOffer } from './reminder-schedule.js';
import { offerText } from './reminders.js';

export function rebuildSunsetClaims(user, intent, text) {
  return cityJourneyClaims(user, intent, 'sunset', text);
}

async function answerSunset(phone, user, place, intent, env) {
  const askedDay = intent.params?.sun_date === 'tomorrow' ? 'tomorrow' : 'today';
  const sunInfo = await getSunForPlace(place, askedDay === 'tomorrow' ? 'tomorrow' : null, env);
  if (!sunInfo) {
    await sendMessage(phone, `Sorry — I couldn't look up that city right now. Please try again in a moment 🙏🏾`, env);
    return;
  }

  // The reminder offer needs BOTH days' sun data. Fetch the day we don't already
  // have IN PARALLEL with the Claude call so it adds ~no latency (both cached
  // after the first lookup of the day).
  const otherDayPromise = askedDay === 'tomorrow'
    ? getSunForPlace(place, null, env)
    : getSunForPlace(place, 'tomorrow', env);

  const sunData = formatSunDataForClaude(sunInfo);
  const system = buildSystemPrompt(user, '', sunData);
  const kind = intent.params?.sun_kind || 'sunset';
  const when = askedDay === 'tomorrow' ? ' tomorrow' : '';
  const reply = await callClaude([...buildHistoryMessages(user), { role: 'user', content: `${kind}${when}` }], system, env, 150);

  // -- Reminder offer (opt-in) -----------------------------------------------
  const otherSun = await otherDayPromise;
  const todaySun = askedDay === 'tomorrow' ? otherSun : sunInfo;
  const tomorrowSun = askedDay === 'tomorrow' ? sunInfo : otherSun;
  const tz = user.timezone || place.timezone;
  const offer = computeSunReminderOffer({ sunKind: kind, askedDay, todaySun, tomorrowSun, timezone: tz });
  const pendingRec = offer
    ? serializePending({ need: 'reminder_confirm', intent: { journey: 'sunset', params: {} }, reminder: offer })
    : null;
  console.log(`[reminder] offer=${offer ? `${offer.fire}@${offer.send_at}` : 'null'} pend=${!!pendingRec} tz=${tz} askedDay=${askedDay} kind=${kind}`);

  const outgoing = offer && pendingRec ? `${reply}\n\n${offerText(offer)}` : reply;
  await sendMessage(phone, outgoing, env);

  // Save history (+ pending offer) in ONE write to avoid a KV read-modify-write
  // race with a second updateUser.
  const question = intent.params?.original_text || `${kind}${when}`;
  const historyUpdate = buildHistoryUpdate(user, question, outgoing);
  await updateUser(phone, pendingRec ? { ...historyUpdate, pending_action: pendingRec } : historyUpdate, env);
}

export async function handleRebuildSunset(phone, text, user, intent, env) {
  return handleCityJourney(phone, text, user, intent, env, {
    name: 'sunset',
    askCityPrompt: `Which city should I check sunset for? (e.g. *San Diego, CA*) 🙏🏾${LOCATION_SHARE_INVITE}`,
    answer: answerSunset,
  });
}
