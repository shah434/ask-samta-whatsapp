// Handles tithi / calendar questions.
// Needs city for timezone — uses shared city journey core (same as sunset/restaurant).
// If city is saved, uses it directly. If not, asks first.

import { cityJourneyClaims, handleCityJourney } from './rebuild-city-journey.js';
import { getCalendarCached, formatEventsForClaude } from './calendar.js';
import { callClaude } from './claude.js';
import { sendMessage } from './whatsapp.js';
import { buildSystemPrompt, buildHistoryMessages, buildHistoryUpdate } from './utils.js';
import { serializePending } from './pending.js';
import { updateUser } from './database.js';
import { LOCATION_SHARE_INVITE } from './prompts.js';
import { computeTithiReminderOffer } from './reminder-schedule.js';
import { offerText } from './reminders.js';

const TITHI_CLAIM_PATTERNS = [
  /\btoday\s+is\s+(a\s+)?(?:beej|bij|chaturdashi|chaumasi|paryushan(?:a)?|ekadashi|atthai|attham|chhath|punam|ashtami|nom|amavasya|purnima|fast day|tithi)\b/i,
  /\b(?:it\s+is|it'?s)\s+(?:beej|bij|chaturdashi|chaumasi|paryushan(?:a)?|ekadashi|atthai|attham|chhath|punam|ashtami|nom|amavasya|purnima)\b/i,
  /\bno food (?:should be eaten )?until tomorrow\b/i,
  /\btoday\s+is\s+a\s+fast(?:ing)?\s+day\b/i,
];

export function tithiClaims(user, intent, text) {
  return cityJourneyClaims(user, intent, 'tithi', text);
}

async function answerTithi(phone, user, place, intent, env) {
  const calendarEvents = await getCalendarCached(env); // KV hit, ~5ms
  const needsFull = /paryushana|coming|upcoming|next|when|week|wk/i.test(intent.params?.original_text || '');
  const calendarData = user.community === 'jain'
    ? formatEventsForClaude(calendarEvents, place.timezone, needsFull ? 10 : 3)
    : '';

  const todayIsTithi = /TODAY_IS_TITHI:\s*true/i.test(calendarData);

  // Use the shared buildSystemPrompt so tithi queries share the main Jain
  // cache bucket with food queries instead of having their own smaller bucket.
  const system = buildSystemPrompt(user, calendarData, '', null);

  // Use the original user question stored in intent params
  const question = intent.params?.original_text || 'What tithi is today?';
  let response = await callClaude([...buildHistoryMessages(user), { role: 'user', content: question }], system, env, 200);

  // Strip calendar markers
  response = response
    .replace(/TODAY_IS_TITHI:\s*(true|false)/gi, '')
    .replace(/TODAY_TITHI_NAME:.*$/gim, '')
    .replace(/TOMORROW_IS_TITHI:\s*(true|false)/gi, '')
    .replace(/TOMORROW_TITHI_NAME:.*$/gim, '')
    .trim();

  // Guard: prevent hallucinated tithi claims
  const claimsTithiToday = TITHI_CLAIM_PATTERNS.some(p => p.test(response));
  if (!todayIsTithi && claimsTithiToday) {
    const sentences = response.split(/(?<=[.!?])\s+/);
    response = sentences.filter(s => !TITHI_CLAIM_PATTERNS.some(p => p.test(s))).join(' ').trim()
      || "Let me know what you'd like to check 🙏🏾";
  }

  // Prepend "Today is X" fact only when the user asked about TODAY.
  // For "tomorrow" questions this would be misleading — skip it.
  const askingAboutTomorrow = /\btomorrow\b/i.test(question);
  const m = calendarData.match(/TODAY_IS_TITHI:\s*true[\s\S]*?TODAY_TITHI_NAME:\s*(.+)/i);
  const tithiFact = (!askingAboutTomorrow && m) ? `Today is ${m[1].trim()} 🙏🏾\n\n` : '';

  // Tithi reminder offer: tomorrow is a tithi + before 7:30 PM → offer 8:30 PM tonight
  const tithiOffer = computeTithiReminderOffer({ calendarEvents, timezone: place.timezone });
  if (tithiOffer) tithiOffer.city = user.city || place.name || '';

  const fullReply = tithiOffer
    ? `${tithiFact + response}\n\n${offerText(tithiOffer)}`
    : tithiFact + response;

  await sendMessage(phone, fullReply, env);

  const historyUpdate = buildHistoryUpdate(user, question, fullReply);

  if (tithiOffer) {
    // Reminder offer takes priority over food followup — "yes" commits the reminder.
    // If user asks about food instead, the pending clears and classify routes normally.
    const rec = serializePending({ need: 'reminder_confirm', intent: { journey: 'tithi', params: {} }, reminder: tithiOffer });
    if (rec) await updateUser(phone, { ...historyUpdate, pending_action: rec }, env);
    else await updateUser(phone, historyUpdate, env);
  } else if (response.trimEnd().endsWith('?') || needsFull) {
    const rec = serializePending({ need: 'tithi_food_followup', intent: { journey: 'tithi', params: {} } });
    if (rec) await updateUser(phone, { ...historyUpdate, pending_action: rec }, env);
    else await updateUser(phone, historyUpdate, env);
  } else {
    await updateUser(phone, historyUpdate, env);
  }
}

export async function handleRebuildTithi(phone, text, user, intent, env) {
  // Stash the original question in intent params so answerTithi can use it
  // after the city resolution (which may happen on a later turn).
  if (!intent.params) intent.params = {};
  if (!intent.params.original_text) intent.params.original_text = text;

  return handleCityJourney(phone, text, user, intent, env, {
    name: 'tithi',
    askCityPrompt: `Which city and state are you in? (e.g. *San Diego, CA*) — I need it to get the right timezone 🙏🏾${LOCATION_SHARE_INVITE}`,
    answer: answerTithi,
    fallbackToSaved: true, // if city saved, use it without re-asking
  });
}
