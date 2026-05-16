// ============================================
// utils.js — Utility and helper functions v1
// ============================================

import { CORE_IDENTITY, RULES_JAIN, RULES_BAPS, USE_CASES, NEUTRAL_JAIN_INSTRUCTIONS } from './prompts.js';

export function parseProfileUpdate(text) {
  const strictnessMatch = text.match(/\[STRICTNESS_UPDATE:\s*(strict|moderate|flexible)\]/i);
  const communityMatch = text.match(/\[COMMUNITY_UPDATE:\s*(jain|baps)\]/i);
  const cityMatch = text.match(/\[CITY_UPDATE:\s*([^\]]+)\]/i);
  return {
    strictness: strictnessMatch ? strictnessMatch[1] : null,
    community: communityMatch ? communityMatch[1] : null,
    city: cityMatch ? cityMatch[1].trim() : null
  };
}

export function stripTags(text) {
  return text
    .replace(/\[STRICTNESS_UPDATE:.*?\]/gi, '')
    .replace(/\[COMMUNITY_UPDATE:.*?\]/gi, '')
    .replace(/\[CITY_UPDATE:.*?\]/gi, '')
    .trim();
}

export function buildSystemPrompt(user, googleResults, calendarData, sunData) {
  const rules = user.community === 'baps' ? RULES_BAPS : RULES_JAIN;
  const today = new Date().toDateString();
  const sun = sunData ? `\n${sunData}` : '';


  // STATIC — cached by Anthropic (same for all users of same community)
  const staticContent = CORE_IDENTITY + rules + USE_CASES;

  // DYNAMIC — changes every message, not cached
   const profile = `
  CURRENT USER PROFILE:
  Community: ${user.community}
  Strictness: ${user.strictness}
  Language: ${user.language || 'en'}
  Observance: ${user.observance || 'none'}
  City: ${user.city || 'not set'}
  Today's date: ${today}`;

  const history = `
CONVERSATION HISTORY (most recent last):
Q1: ${user.history_3_q || ''} A1: ${user.history_3_a || ''}
Q2: ${user.history_2_q || ''} A2: ${user.history_2_a || ''}
Q3: ${user.history_1_q || ''} A3: ${user.history_1_a || ''}`;

  const restaurantData = googleResults && googleResults.length > 0
    ? `\nNEARBY RESTAURANT RESULTS: ${JSON.stringify(googleResults)}
FORMATTING RULE: For each restaurant include name, address,
phone number (nationalPhoneNumber field — always include if present in data),
rating, and whether currently open.
Ask staff: "Do you avoid onion and garlic in any form including powder?"
End with: "Call ahead to confirm dietary requirements"`
    : '';

  const calendar = calendarData
    ? `\nJAIN CALENDAR — NEXT 30 DAYS:\n${calendarData}`
    : '';

const dynamicContent = profile + history + restaurantData + calendar + sun;
  // Return as array — static part gets cached, dynamic part does not
  return [
    {
      type: 'text',
      text: staticContent,
      cache_control: { type: 'ephemeral' }
    },
    {
      type: 'text',
      text: d