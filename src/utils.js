// ============================================
// utils.js — Utility and helper functions v2.3
// ============================================
// Changes in v2.3:
//   - All USE_CASE blocks always included in static (cached) layer.
//     Two cache buckets total: one for Jain, one for BAPS.
//     Cache hits shared across all users of the same community.
//   - classifyQuery removed (dead code — classify.js + prompt_blocks replaced it)
//   - queryTypes parameter removed from buildSystemPrompt
// ============================================

import {
  CORE_IDENTITY,
  RULES_JAIN,
  RULES_BAPS,
  USE_CASE_GENERAL,
  USE_CASE_LABEL_SCAN,
  USE_CASE_RESTAURANT,
  USE_CASE_SUBSTITUTION,
  USE_CASE_MEDICINE,
  USE_CASE_FASTING,
  USE_CASE_CALENDAR,
} from './prompts.js';
import { labelFor } from './strictness.js';

// All use cases joined once — this is the constant static block per community.
const ALL_USE_CASES =
  USE_CASE_GENERAL +
  USE_CASE_LABEL_SCAN +
  USE_CASE_RESTAURANT +
  USE_CASE_SUBSTITUTION +
  USE_CASE_MEDICINE +
  USE_CASE_FASTING +
  USE_CASE_CALENDAR;

// Returns history as real conversation turns (oldest first) for the messages
// array. The caller appends the current user message at the end.
// Using real turns gives Claude proper multi-turn context vs flat text in the
// system prompt.
export function buildHistoryMessages(user) {
  const messages = [];
  const pairs = [
    [user.history_3_q, user.history_3_a],
    [user.history_2_q, user.history_2_a],
    [user.history_1_q, user.history_1_a],
  ];
  for (const [q, a] of pairs) {
    if (q && a) {
      messages.push({ role: 'user', content: q });
      messages.push({ role: 'assistant', content: a });
    }
  }
  return messages;
}

// Builds the fields object to pass to updateUser for history rotation.
// Call after every Claude response so all journeys save history.
export function buildHistoryUpdate(user, question, answer) {
  const q = (question || '').slice(0, 500);
  const a = (answer || '').slice(0, 500);
  return {
    history_1_q: q,
    history_1_a: a,
    history_2_q: user.history_1_q || '',
    history_2_a: user.history_1_a || '',
    history_3_q: user.history_2_q || '',
    history_3_a: user.history_2_a || '',
    message_count: (user.message_count || 0) + 1,
  };
}

export function stripTags(text) {
  return (text || '').replace(/<[^>]*>/g, '').trim();
}

// For unset users: Claude sometimes opens with ✋ NOT SAFE (a Step 1 verdict)
// for a level-dependent food like alcohol, then self-corrects to the proper
// threshold line ("✅ SAFE if you're Flexible..."). The opening NOT SAFE
// paragraph is wrong — strip it and keep only the threshold line.
export function stripLeadingFalseVerdict(text) {
  if (!/^✋\s*NOT SAFE/i.test((text || '').trimStart())) return text || '';
  const thresholdMatch = text.match(/((?:✅|✋)[^\n]*if you'?re\b[\s\S]+)/i);
  if (!thresholdMatch) return text;
  return thresholdMatch[1].trim();
}

// Remove any strictness/level menu Claude generated on its own. The prompt tells
// it the system appends that question automatically, but it sometimes tacks on
// "Which level fits you best?\n1 — Very Strict … 5 — Relaxed". We own the ask
// (capped per-user), so this strips Claude's version unconditionally — leaving
// the verdict intact. Our own question, when appended, comes AFTER this runs.
export function stripLevelMenu(text) {
  return (text || '')
    // A "pick your level" question line.
    .replace(/^[^\n]*\b(?:which|what'?s|pick your|choose your)\b[^\n]*\b(?:level|strict\w*)\b[^\n]*\?\s*$/gim, '')
    .replace(/^[^\n]*\blevel fits you\b[^\n]*$/gim, '')
    // Bare numbered level-menu lines: "1 — Very Strict", "5 — Relaxed", etc.
    .replace(/^\s*[1-5]\s*[—–-]\s*(?:very strict|strict|moderate|flex(?:ible)?|relaxed)\b.*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Wraps fetch with an AbortController timeout. Throws AbortError if exceeded.
export function fetchWithTimeout(url, options, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

export function buildSystemPrompt(user, calendarData, sunData, searchSnippets = null) {
  const rules = user.community === 'baps' ? RULES_BAPS : RULES_JAIN;

  // STATIC content — cached by Anthropic.
  // Always identical for the same community → reliable cache hits.
  const staticContent = CORE_IDENTITY + rules + ALL_USE_CASES;

  // DYNAMIC content — changes per message, never cached.
  const userTz = user.timezone || 'America/New_York';
  const today = new Date().toLocaleDateString('en-US', {
    timeZone: userTz,
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });

  const profile = `
CURRENT USER PROFILE:
Community: ${user.community || 'jain'}
Strictness: ${labelFor(user.strictness)}
Language: ${user.language || 'en'}
Observance: ${user.observance || 'none'}
City: ${user.city || 'not set'}
Today's date: ${today}`;

  const calendar = calendarData
    ? `\nJAIN CALENDAR — NEXT 30 DAYS:\n${calendarData}
TITHI RULE: Never state the tithi name or that today is/isn't a tithi — that line is added separately. If today is a tithi, give ONLY a 2-line explanation of its dietary practice. Do not name it. Do NOT open with any greeting (no "Jai Jinendra", "🙏🏾", etc.) — a greeting is already added separately.
HISTORY WARNING: Conversation history may reference tithis from previous days. TODAY_IS_TITHI above is the only authoritative source for today's fasting status — do NOT infer it from anything mentioned in history.`
    : '';

  const sun    = sunData        ? `\n${sunData}`        : '';
  const search = searchSnippets ? `\n${searchSnippets}` : '';

  const strictnessReminder = !user.strictness
    ? `\nSTRICTNESS OVERRIDE: This user has NO strictness set. Do NOT assume a level. For any strictness-sensitive verdict (food or label scan), give the single threshold answer ("safe at <Level> and more relaxed; not permitted at stricter levels") instead of one flat verdict, and end the message with the hidden marker MULTILEVEL:true on its own line. If every ingredient is safe at all five levels, or something is never permitted at any level, give one clean verdict and do NOT emit the marker.
CRITICAL: Do NOT write any numbered level menu, "Which level fits you best?", or list of strictness options. The system appends that automatically after your response. Any such list you write will be deleted before sending and wastes tokens.`
    : '';

  const dynamicContent = profile + calendar + sun + search + strictnessReminder;

  return [
    {
      type: 'text',
      text: staticContent,
      // 5-min TTL (the default — no ttl key). Write premium is 1.25x vs 2x for
      // '1h'. Traffic is bursty (a few messages, then quiet for hours), so the
      // 1h window rarely amortised its higher write cost. If you ever raise this
      // back to '1h', also bump the cache_creation multiplier in claude.js to 2.
      cache_control: { type: 'ephemeral' },
    },
    {
      type: 'text',
      text: dynamicContent,
    },
  ];
}
