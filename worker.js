// Samta v2.4
// ============================================
// worker.js — Main Cloudflare Worker handler
// ============================================
// v2.4 changes from v2.3:
//   - Bug 1 fix: city disambiguation across all write paths
//     (tithi ask, sunset query, Claude [CITY_UPDATE] tag)
//   - Bug 2 fix: gate calendar block on onboarding completion, plus a
//     post-response guard that strips tithi *claims* (not mere mentions)
//     when the calendar block did not assert TODAY_IS_TITHI: true
//   - Message-replay design: after a city is resolved, replay the user's
//     ORIGINAL question verbatim through the worker — no synthesis
//   - _justResolvedCity transient flag prevents re-extraction loop
//   - Empty-message guard via whatsapp.js (also applied here defensively)
// ============================================

import { getUser, createUser, updateUser, deleteUser, setFlagKV } from './src/database.js';
import { sendMessage, sendReaction, sendImage, getImageAsBase64 } from './src/whatsapp.js';
import { callClaude } from './src/claude.js';
import { searchRestaurants, detectLocation } from './src/location.js';
import { parseProfileUpdate, stripTags, buildSystemPrompt, classifyQuery } from './src/utils.js';
import {
  DEFAULT_DIET,
  getWelcomeMessage,
  getStrictnessQuestion,
  applyStrictnessReply,
} from './src/onboarding.js';
import { getCalendarCached, getTodayAndUpcomingEvents, formatEventsForClaude } from './src/calendar.js';
import {
  geocodeCity,
  getSunForPlace,
  getSunriseSunset,
  formatSunDataForClaude,
  detectSunsetQuery,
  extractCityFromSunQuery
} from './src/sunset.js';

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

const VIN_FAMILY_URL = 'https://raw.githubusercontent.com/shah434/whatsapp-religious-friend/ad4ff7ebb697e22a7ba7abac1e0c94e4c7af3987/vin%20family.png';
const VIN_GOODBYE_URL = 'https://raw.githubusercontent.com/shah434/whatsapp-religious-friend/ad4ff7ebb697e22a7ba7abac1e0c94e4c7af3987/vin%20goodbye.png';
const VIN_STAY_URL = 'https://raw.githubusercontent.com/shah434/whatsapp-religious-friend/403944f9447d7975e07322f8cdaca25030dc50b0/vin%20stay.png';

const KV_PENDING_DELETE_PREFIX = 'pending_delete:';
const PENDING_DELETE_TTL = 600; // 10 minutes

const SILENT_DROP_TYPES = new Set([
  'reaction', 'system', 'interactive', 'button', 'unsupported', 'unknown'
]);

const STRICTNESS_SENSITIVE = new Set([
  'general', 'label_scan', 'restaurant', 'substitution', 'medicine'
]);

// Tithi CLAIM patterns — only fire the guard on assertive statements
// about today, not on the mere mention of the word "tithi".
// "today is Beej" → claim. "want to check today's tithi?" → not a claim.
const TITHI_CLAIM_PATTERNS = [
  /\btoday\s+is\s+(a\s+)?(?:beej|bij|chaturdashi|chaumasi|paryushan(?:a)?|ekadashi|atthai|attham|chhath|punam|ashtami|nom|amavasya|purnima|fast day|tithi)\b/i,
  /\b(?:it\s+is|it'?s)\s+(?:beej|bij|chaturdashi|chaumasi|paryushan(?:a)?|ekadashi|atthai|attham|chhath|punam|ashtami|nom|amavasya|purnima)\b/i,
  /\bno food (?:should be eaten )?until tomorrow\b/i,
  /\btoday\s+is\s+a\s+fast(?:ing)?\s+day\b/i,
  /\(\s*(?:beej|bij|chaturdashi|chaumasi|paryushan(?:a)?|a fasting day)\s*\)/i,
];

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

// Detects tithi/calendar queries. Tightened in v2.3 — no longer matches
// generic "I want to fast today" since that's a fasting setup query, not
// a tithi lookup.
function isTithiQuery(text) {
  const lower = (text || '').toLowerCase();
  return /\btithi\b/.test(lower)
    || /\bfast day\b/.test(lower)
    || /\b(is today|today.*(special|tithi)|what.*tithi)\b/.test(lower);
}

function isLikelyGreeting(text) {
  return /^(hi|hello|hey|jai jinendra|namaste|hola)\b/i.test((text || '').trim());
}

function isBareGreeting(text) {
  return /^(hi|hello|hey|hola|namaste|jai jinendra)\b\s*[!.?]?$/i.test((text || '').trim());
}

// Rough timezone guess from WhatsApp phone country code.
function defaultTimezoneFromPhone(phone) {
  if (phone.startsWith('91')) return 'Asia/Kolkata';
  if (phone.startsWith('44')) return 'Europe/London';
  if (phone.startsWith('971')) return 'Asia/Dubai';
  if (phone.startsWith('65')) return 'Asia/Singapore';
  if (phone.startsWith('61')) return 'Australia/Sydney';
  if (phone.startsWith('254')) return 'Africa/Nairobi';
  if (phone.startsWith('27')) return 'Africa/Johannesburg';
  return 'America/New_York';
}

// ────────────────────────────────────────────────────────────────────────────
// Worker
// ────────────────────────────────────────────────────────────────────────────

export default {
  // Cron trigger: pre-warms calendar cache daily at midnight UTC
  async scheduled(event, env, ctx) {
    try {
      const events = await getTodayAndUpcomingEvents();
      await env.KV.put('jain_calendar_events', JSON.stringify(events), { expirationTtl: 86400 });
      console.log('Calendar cache pre-warmed:', events.length, 'events');
    } catch (err) {
      console.log('Scheduled calendar refresh error:', err.message);
    }
  },

  async fetch(req, env, ctx) {

    // -- Meta webhook verification --------------------------------------------
    if (req.method === 'GET') {
      const url = new URL(req.url);
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge');
      if (mode === 'subscribe' && token === env.VERIFY_TOKEN) {
        return new Response(challenge, { status: 200 });
      }
      return new Response('Forbidden', { status: 403 });
    }

    if (req.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    try {
      const body = await req.json();

      const statuses = body?.entry?.[0]?.changes?.[0]?.value?.statuses;
      if (statuses) return new Response('OK', { status: 200 });

      const message = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
      if (!message) return new Response('OK', { status: 200 });

      const phone = message.from;
      const messageId = message.id;
      const messageType = message.type;

      if (SILENT_DROP_TYPES.has(messageType)) {
        return new Response('OK', { status: 200 });
      }

      if (!['text', 'image'].includes(messageType)) {
        await sendMessage(
          phone,
          'I can only read text messages and food label photos. Please send a text question or a photo of a label.',
          env
        );
        return new Response('OK', { status: 200 });
      }

      let text = message.text?.body || message.image?.caption || '';
      const t0 = Date.now();

      if (messageType === 'image') {
        sendMessage(phone, 'Reviewing your request... 🔍', env);
      }

      // -- Phase 1: Parallel I/O ---------------------------------------------
      const imagePromise = messageType === 'image'
        ? getImageAsBase64(message.image.id, message.image.mime_type, env)
        : null;

      let user, calendarEvents;
      [, user, calendarEvents] = await Promise.all([
        sendReaction(phone, messageId, env),
        getUser(phone, env),
        getCalendarCached(env),
      ]);
      console.log(`[perf] phase1_parallel=${Date.now() - t0}ms type=${messageType}`);

 // -- New user creation + welcome ---------------------------------------
      // Send welcome immediately so it lands first in the chat, then fall
      // through so the user's actual question still gets answered. Two
      // exceptions: a bare greeting or "help" — those ARE the welcome
      // request, so don't answer them twice.
      if (!user) {
        user = await createUser(phone, {
          community: DEFAULT_DIET,
          timezone: defaultTimezoneFromPhone(phone)
        }, env);
        await sendMessage(phone, getWelcomeMessage(), env);

        const isJustGreeting = messageType === 'text' && (
          isBareGreeting(text) || text.trim().toLowerCase() === 'help'
        );
        if (isJustGreeting || messageType === 'image') {
          // Greeting → welcome IS the answer. Image from a brand-new user
          // → we don't know enough about them to scan accurately, so the
          // welcome is also the right first response. Subsequent messages
          // will flow normally now that the user row exists.
          return new Response('OK', { status: 200 });
        }
        // Fall through — they asked a real question, answer it too
      }

      // -- Pending delete confirmation ---------------------------------------
      const pendingDeleteKey = `${KV_PENDING_DELETE_PREFIX}${phone}`;
      const pendingDelete = await env.KV.get(pendingDeleteKey);
      if (pendingDelete && messageType === 'text') {
        await env.KV.delete(pendingDeleteKey);
        if (text.trim().toUpperCase() === 'YES') {
          await deleteUser(phone, env);
          await sendImage(phone, VIN_GOODBYE_URL, "You've been removed from the family. Take care. 🙏", env);
        } else {
          await sendImage(phone, VIN_STAY_URL, "Deletion cancelled — you're still family. 🙏", env);
        }
        return new Response('OK', { status: 200 });
      }

      // -- "delete me" keyword -----------------------------------------------
      if (messageType === 'text' && text.trim().toLowerCase() === 'delete me') {
        await env.KV.put(pendingDeleteKey, '1', { expirationTtl: PENDING_DELETE_TTL });
        await sendImage(
          phone,
          VIN_FAMILY_URL,
          'Are you sure you want to leave the family? Reply YES to confirm, or anything else to cancel.',
          env
        );
        return new Response('OK', { status: 200 });
      }

      // -- "help" keyword ----------------------------------------------------
      if (messageType === 'text' && text.trim().toLowerCase() === 'help') {
        await sendMessage(phone, getWelcomeMessage(), env);
        return new Response('OK', { status: 200 });
      }

      // -- Bare greeting → show welcome --------------------------------------
      if (messageType === 'text' && isBareGreeting(text)) {
        await sendMessage(phone, getWelcomeMessage(), env);
        return new Response('OK', { status: 200 });
      }

      // -- Pending strictness reply check ------------------------------------
      if (user.pending_strictness_ask && messageType === 'text') {
        const handled = await applyStrictnessReply(phone, text, env);
        if (handled) return new Response('OK', { status: 200 });
        user = await getUser(phone, env);
      }

      // -- Pending city reply check ------------------------------------------
      // The previous turn asked the user for a city (for tithi, sunset, or
      // any other path needing one). Their reply is either a number picking
      // from a disambiguation list, or a fresh city name to geocode.
      //
      // Once the city is resolved and saved, we REPLAY their original
      // question (history_1_q) verbatim through the worker so it answers
      // exactly what they asked. The _justResolvedCity transient flag
      // prevents downstream branches from re-extracting the (now-stale)
      // city name from the replayed message and looping forever.
      if (user.pending_tithi_city_ask && messageType === 'text') {
        const replyCity = text.trim();

        // Path 1: numeric pick from a previous disambiguation list
        const numericPick = /^[1-4]$/.test(replyCity) ? parseInt(replyCity) : null;
        if (numericPick && user.pending_city_choices) {
          let choices = null;
          try { choices = JSON.parse(user.pending_city_choices); } catch {}
          const picked = choices && choices[numericPick - 1];
          if (picked) {
            const sunInfo = await getSunForPlace(picked);
            if (sunInfo) {
              await updateUser(phone, {
                city: sunInfo.city,
                timezone: sunInfo.timezoneId,
                pending_tithi_city_ask: false,
                pending_city_choices: null
              }, env);
              user.city = sunInfo.city;
              user.timezone = sunInfo.timezoneId;
              user._justResolvedCity = true;
              text = user.history_1_q || '';
              // fall through with replayed text
            } else {
              await sendMessage(phone, `Sorry — I couldn't look up that city right now. Please try again in a moment.`, env);
              return new Response('OK', { status: 200 });
            }
          } else {
            await updateUser(phone, { pending_city_choices: null, pending_tithi_city_ask: false }, env);
            await sendMessage(phone, `That number didn't match the list I sent. Please type your city name again 🙏`, env);
            return new Response('OK', { status: 200 });
          }
        }
        // Path 2: user typed a city name
        else if (replyCity.length >= 2 && replyCity.length <= 50) {
          const geo = await geocodeCity(replyCity);

          if (geo.status === 'not_found') {
            await sendMessage(phone, `I couldn't find that city. Please type the full city name with state or country, or your zip code.`, env);
            return new Response('OK', { status: 200 });
          }

          if (geo.status === 'ambiguous') {
            const lines = geo.candidates.map((c, i) =>
              `${i + 1} — ${c.name}${c.admin1 ? ', ' + c.admin1 : ''}, ${c.country}`
            ).join('\n');
            await updateUser(phone, { pending_city_choices: JSON.stringify(geo.candidates) }, env);
            await sendMessage(phone, `I found a few places called "${replyCity}". Which one?\n\n${lines}\n\nReply with the number.`, env);
            return new Response('OK', { status: 200 });
          }

          // status === 'unique'
          const sunInfo = await getSunForPlace(geo.place);
          if (!sunInfo) {
            await sendMessage(phone, `Sorry — I couldn't look up that city right now. Please try again in a moment.`, env);
            return new Response('OK', { status: 200 });
          }
          await updateUser(phone, {
            city: sunInfo.city,
            timezone: sunInfo.timezoneId,
            pending_tithi_city_ask: false,
            pending_city_choices: null
          }, env);
          user.city = sunInfo.city;
          user.timezone = sunInfo.timezoneId;
          user._justResolvedCity = true;
          text = user.history_1_q || '';
          // fall through with replayed text
        }
        // Path 3: junk input — clear and continue
        else {
          await setFlagKV(phone, { pending_tithi_city_ask: false }, env);
          user.pending_tithi_city_ask = false;
        }

        // After replay, guard against empty history_1_q (first-turn users
        // somehow landed here). Better to acknowledge than to send Claude
        // an empty input.
        if (user._justResolvedCity && (!text || !text.trim())) {
          await sendMessage(phone, `Got it — saved your city as ${user.city}. What would you like to check? 🙏`, env);
          return new Response('OK', { status: 200 });
        }
      }

      // -- Tithi-city ask ----------------------------------------------------
      if (isTithiQuery(text) && !user.city && messageType === 'text' && !user.pending_tithi_city_ask) {
        await setFlagKV(phone, { pending_tithi_city_ask: true }, env);
        await sendMessage(
          phone,
          `Which city are you in? Tithis depend on the lunar cycle and shift slightly by location, so I want to give you the right answer 🙏`,
          env
        );
        return new Response('OK', { status: 200 });
      }

      // -- Enrichment: restaurant --------------------------------------------
      // If we just resolved a city via disambiguation, the replayed message
      // may still contain the ambiguous city name — ignore it and use the
      // saved user.city instead.
      let googleResults = [];
      const location = user._justResolvedCity ? user.city : detectLocation(text);

      if (location && location !== 'unknown') {
        const communityQuery = user.community === 'baps'
          ? 'BAPS Swaminarayan friendly'
          : 'Jain friendly';
        googleResults = await searchRestaurants(communityQuery, location, env);
        // Only persist a freshly-detected (non-replayed) location
        if (!user._justResolvedCity) {
          await updateUser(phone, { city: location }, env);
          user.city = location;
        }
      }

      // -- Sunset / sunrise --------------------------------------------------
      // Three cases:
      //   A. New city in this message — geocode, maybe disambiguate, save, lookup
      //   B. No city in message — use the stored one
      //   C. No city anywhere — ask
      // After a replay, ignore any city name in the (now-stale) message text.
      let sunData = '';
      if (detectSunsetQuery(text)) {
        const cityFromMessage = user._justResolvedCity ? null : extractCityFromSunQuery(text);

        // Case A: new city in message
        if (cityFromMessage && cityFromMessage.length > 2 && !cityFromMessage.toLowerCase().includes('time')) {
          const geo = await geocodeCity(cityFromMessage);

          if (geo.status === 'not_found') {
            await sendMessage(
              phone,
              `I couldn't find "${cityFromMessage}". Please type the city name with state or country, or your zip code.`,
              env
            );
            return new Response('OK', { status: 200 });
          }

          if (geo.status === 'ambiguous') {
            const lines = geo.candidates.map((c, i) =>
              `${i + 1} — ${c.name}${c.admin1 ? ', ' + c.admin1 : ''}, ${c.country}`
            ).join('\n');
            // Save original sunset question so the disambiguation reply
            // can replay it after the user picks
            await updateUser(phone, {
              pending_city_choices: JSON.stringify(geo.candidates),
              pending_tithi_city_ask: true,  // reuse same pending flag
              history_1_q: text  // ensure replay has the right question
            }, env);
            await sendMessage(
              phone,
              `I found a few places called "${cityFromMessage}". Which one?\n\n${lines}\n\nReply with the number.`,
              env
            );
            return new Response('OK', { status: 200 });
          }

          // status === 'unique' — save resolved city/tz, then continue
          const sunInfo = await getSunForPlace(geo.place);
          if (sunInfo) {
            await updateUser(phone, {
              city: sunInfo.city,
              timezone: sunInfo.timezoneId
            }, env);
            user.city = sunInfo.city;
            user.timezone = sunInfo.timezoneId;
            sunData = formatSunDataForClaude(sunInfo);
          } else {
            sunData = 'SUNSET QUERY: lookup failed. Apologize briefly and ask the user to try again.';
          }
        }
        // Case B: no city in message → use stored
        else if (user.city) {
          const sunInfo = await getSunriseSunset(user.city);
          if (sunInfo) {
            sunData = formatSunDataForClaude(sunInfo);
            if (sunInfo.timezoneId && sunInfo.timezoneId !== user.timezone) {
              await updateUser(phone, { timezone: sunInfo.timezoneId }, env);
              user.timezone = sunInfo.timezoneId;
            }
          } else {
            sunData = 'SUNSET QUERY: lookup failed for stored city. Apologize briefly and ask the user to retry.';
          }
        }
        // Case C: no city anywhere
        else {
          sunData = 'SUNSET QUERY: User asked about sunset but no city in message and none stored. Ask which city.';
        }
      }

      // -- Classify query (must come before calendar formatting) -------------
      const queryTypes = classifyQuery(text, messageType === 'image');

      // Log short messages that classified as 'general' only — candidates
      // for new fasting/pachkhan variants we missed. Review weekly to grow
      // the wordlist in src/fasting-match.js.
      if (queryTypes.length === 1 && queryTypes[0] === 'general' && text && text.length < 30) {
        console.log(`[unmatched-short] phone=${phone} text="${text}"`);
      }

      // Short replies inherit fasting context from the previous bot question.
      // Without this, "1" / "ayambil" / similar short replies get classified
      // as 'general' and trigger the strictness ask incorrectly.
      const lastBotReply = (user.history_1_a || '').toLowerCase();
      const isShortReply = text.trim().length < 20;
      const isReplyToFastMenu = isShortReply && /fast|upvas|ekasan|ayambil|chauvihar|tivihar|atthai|porsi|biyasan|navkarsi/i.test(lastBotReply);
      if (isReplyToFastMenu && !queryTypes.includes('fasting')) {
        queryTypes.push('fasting');
      }

      // -- Calendar — Jain only, gated on onboarding completion --------------
      // Defense in depth for Bug 2: never include tithi/calendar context for
      // un-onboarded users. They have no resolved location, so a tithi calc
      // would be wrong by region anyway, and Claude would risk inventing
      // fasting context they can't act on.
      let calendarData = '';
      const isOnboarded = !!user.strictness;
      if (user.community === 'jain' && isOnboarded) {
        const needsFullCalendar = queryTypes.includes('fasting')
          || queryTypes.includes('calendar')
          || /paryushana|coming|upcoming|next/i.test(text);
        const calendarLimit = needsFullCalendar ? 10 : 3;
        calendarData = formatEventsForClaude(calendarEvents, user.timezone, calendarLimit);
      }

      // -- Build Claude messages ---------------------------------------------
      let claudeMessages = [];

      if (messageType === 'image') {
        try {
          const { base64, mimeType } = await imagePromise;
          console.log(`[perf] image_ready=${Date.now() - t0}ms`);
          claudeMessages = [{
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: mimeType, data: base64 }
              },
              {
                type: 'text',
                text: text || 'Please scan this food label or product and check if it is safe for my diet.'
              }
            ]
          }];
        } catch (err) {
          console.log('Image processing error:', err.message);
          await sendMessage(
            phone,
            'I could not process that image. Please try a clearer photo or type out the ingredients list.',
            env
          );
          return new Response('OK', { status: 200 });
        }
      } else {
        claudeMessages = [{ role: 'user', content: text }];
      }

      // -- System prompt + Claude call ---------------------------------------
      const system = buildSystemPrompt(user, googleResults, calendarData, sunData, queryTypes);
      console.log(`[perf] claude_start=${Date.now() - t0}ms`);
      const response = await callClaude(claudeMessages, system, env);
      console.log(`[perf] claude_done=${Date.now() - t0}ms`);

      const updates = parseProfileUpdate(response);
      let cleanResponse = stripTags(response);

      // -- Tithi-claim guard (Bug 2) -----------------------------------------
      // If Claude asserted today is a fast/tithi without the calendar block
      // saying TODAY_IS_TITHI: true, strip those sentences. Sentence-level
      // (not line-level) so the food verdict survives. Falls back to a safe
      // placeholder if the guard ate the whole response.
      const calendarHadToday = /TODAY_IS_TITHI:\s*true/i.test(calendarData);
      const claimsTithiToday = TITHI_CLAIM_PATTERNS.some(p => p.test(cleanResponse));
      if (!calendarHadToday && claimsTithiToday) {
        console.log(`[guard] stripped_tithi_claim phone=${phone} response="${cleanResponse.slice(0, 200)}"`);
        const sentences = cleanResponse.split(/(?<=[.!?])\s+/);
        cleanResponse = sentences
          .filter(s => !TITHI_CLAIM_PATTERNS.some(p => p.test(s)))
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (!cleanResponse) {
          cleanResponse = "Let me know what you'd like to check 🙏";
        }
      }

      // -- Profile updates from Claude ---------------------------------------
      // Strictness and community update directly. City updates go through
      // geocoding + disambiguation — never trust a bare city string from
      // the model.
      if (updates.strictness || updates.community) {
        await updateUser(phone, {
          ...(updates.strictness && { strictness: updates.strictness }),
          ...(updates.community && { community: updates.community })
        }, env);
      }

      if (updates.city) {
        const geo = await geocodeCity(updates.city);

        if (geo.status === 'unique') {
          const sunInfo = await getSunForPlace(geo.place);
          if (sunInfo) {
            await updateUser(phone, {
              city: sunInfo.city,
              timezone: sunInfo.timezoneId
            }, env);
          }
        } else if (geo.status === 'ambiguous') {
          // Ask the user which one. Save the original message as the
          // history_1_q so the disambiguation reply replays it correctly.
          const lines = geo.candidates.map((c, i) =>
            `${i + 1} — ${c.name}${c.admin1 ? ', ' + c.admin1 : ''}, ${c.country}`
          ).join('\n');
          await updateUser(phone, {
            pending_city_choices: JSON.stringify(geo.candidates),
            pending_tithi_city_ask: true,
            history_1_q: text
          }, env);
          await sendMessage(
            phone,
            `Before I save that — I found a few places called "${updates.city}". Which one?\n\n${lines}\n\nReply with the number.`,
            env
          );
          return new Response('OK', { status: 200 });
        }
        // status === 'not_found' — silently skip the save; Claude's reply
        // still goes out and the user can re-state their city.
      }

      // -- Strictness ask append ---------------------------------------------
      // Only append if:
      //   - User has no strictness set, AND
      //   - The query is strictness-sensitive (not fasting, not greeting), AND
      //   - Claude actually gave a dual-verdict response. If both Strict and
      //     Flexible would give the same answer, the question wasn't really
      //     strictness-sensitive for this particular food — skip the ask.
      cleanResponse = cleanResponse.replace(/\[ASK_STRICTNESS\]/gi, '').trim();

      const isFasting = queryTypes.includes('fasting');
      const isStrictnessSensitive = queryTypes.some(t => STRICTNESS_SENSITIVE.has(t));
      const hasDualVerdict = /\bif strict\b/i.test(cleanResponse) && /\bif flexible\b/i.test(cleanResponse);
      const needsStrictnessAsk = !user.strictness
        && !updates.strictness
        && isStrictnessSensitive
        && !isFasting
        && !isLikelyGreeting(text)
        && hasDualVerdict;

      if (needsStrictnessAsk) {
        cleanResponse += '\n\n' + getStrictnessQuestion();
        cleanResponse += '\n\n💡 Type *help* anytime to see what else I can do.';
        await setFlagKV(phone, { pending_strictness_ask: true }, env);
      }

      // -- Send response -----------------------------------------------------
      // Defensive empty-check. sendMessage in whatsapp.js also guards, but
      // bailing here lets us log the context that produced the empty reply.
      if (!cleanResponse || !cleanResponse.trim()) {
        console.log(`[empty_response] phone=${phone} queryTypes=${queryTypes.join(',')} text="${text.slice(0, 80)}"`);
        cleanResponse = "Let me know what you'd like to check 🙏";
      }
      await sendMessage(phone, cleanResponse, env);
      console.log(`[perf] sent=${Date.now() - t0}ms TOTAL`);

      // -- Deferred Supabase write -------------------------------------------
      ctx.waitUntil((async () => {
        await updateUser(phone, {
          history_1_q: text,
          history_1_a: cleanResponse,
          history_2_q: user.history_1_q || '',
          history_2_a: user.history_1_a || '',
          history_3_q: user.history_2_q || '',
          history_3_a: user.history_2_a || '',
          message_count: (user.message_count || 0) + 1,
          ...(needsStrictnessAsk && { pending_strictness_ask: true }),
        }, env);
      })());

      return new Response('OK', { status: 200 });

    } catch (err) {
      console.log('Main handler error:', err.message, err.stack);
      try {
        const debugBody = await req.clone().json();
        const debugPhone = debugBody?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from;
        if (debugPhone) {
          await sendMessage(
            debugPhone,
            `⚠️ Error: ${err.message}\n${(err.stack || '').slice(0, 500)}`,
            env
          );
        }
      } catch {}
      return new Response('OK', { status: 200 });
    }
  }
};
