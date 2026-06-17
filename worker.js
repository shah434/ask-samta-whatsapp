// Samta v2.5
// ============================================
// worker.js — Main Cloudflare Worker handler
// location.js now used only by rebuild-restaurant.js
// ============================================
import { classify } from './src/classify.js';
import { readPending, serializePending } from './src/pending.js';
import { rulesFor, rulesForNumber, FAST_MENU, UPVAS_MENU } from './src/fasting-rules.js';
import { handleRebuildSunset, rebuildSunsetClaims } from './src/rebuild-sunset.js';
import { handleRebuildRestaurant, rebuildRestaurantClaims } from './src/rebuild-restaurant.js';
import { handleCityUpdate, cityUpdateClaims } from './src/rebuild-city-update.js';
import { handleProfileUpdate, profileUpdateClaims } from './src/rebuild-profile-update.js';
import { handleRebuildTithi, tithiClaims } from './src/rebuild-tithi.js';
import { getUser, createUser, updateUser, deleteUser, fetchPendingAction, fetchProfile } from './src/database.js';
import { routeFallback } from './src/route-fallback.js';
import { sendMessage, sendReaction, sendImage, getImageAsBase64 } from './src/whatsapp.js';
import { handleRebuildFood } from './src/rebuild-food.js';
import { commitReminder, clearReminders, activeReminders, cancelSummary, confirmText, dispatchDueReminders, listRemindersText } from './src/reminders.js';
import { DEFAULT_DIET, getWelcomeMessage, getStrictnessDetails, getStrictnessQuestion } from './src/onboarding.js';
import { getCalendarCached, getTodayAndUpcomingEvents } from './src/calendar.js';
// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

const VIN_FAMILY_URL = 'https://raw.githubusercontent.com/shah434/whatsapp-religious-friend/ad4ff7ebb697e22a7ba7abac1e0c94e4c7af3987/vin%20family.png';
const VIN_GOODBYE_URL = 'https://raw.githubusercontent.com/shah434/whatsapp-religious-friend/ad4ff7ebb697e22a7ba7abac1e0c94e4c7af3987/vin%20goodbye.png';
const VIN_STAY_URL = 'https://raw.githubusercontent.com/shah434/whatsapp-religious-friend/403944f9447d7975e07322f8cdaca25030dc50b0/vin%20stay.png';

const SILENT_DROP_TYPES = new Set([
  'reaction', 'system', 'interactive', 'button', 'unsupported', 'unknown'
]);

const CITY_JOURNEY_NAMES = new Set(['sunset', 'restaurant', 'city_update', 'tithi']);

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────
async function hashPhone(phone) {
  const data = new TextEncoder().encode(phone || '');
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 8);
}

function isBareGreeting(text) {
  return /^(hi|hello|hey|hola|namaste|jai jinendra)\b\s*[!.?]?$/i.test((text || '').trim());
}

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
  async scheduled(event, env, ctx) {
    // Midnight UTC — pre-warm the Jain calendar cache for the day.
    if (event.cron === '0 0 * * *') {
      try {
        const events = await getTodayAndUpcomingEvents();
        await env.KV.put('jain_calendar_events', JSON.stringify(events), { expirationTtl: 86400 });
        console.log('Calendar cache pre-warmed:', events.length, 'events');
      } catch (err) {
        console.log('Scheduled calendar refresh error:', err.message);
      }
      return;
    }

    // Every 15 min — dispatch due reminders. A short-lived KV lock ensures two
    // overlapping cron runs never double-process the same queue (the only true
    // concurrency hazard for the sent-flag read-modify-write).
    const lock = await env.KV.get('reminder:lock');
    if (lock) {
      console.log('[reminder] dispatch skipped — lock held');
      return;
    }
    await env.KV.put('reminder:lock', '1', { expirationTtl: 300 });
    try {
      await dispatchDueReminders(env);
    } catch (err) {
      console.log('[reminder] dispatch error:', err.message);
    } finally {
      try { await env.KV.delete('reminder:lock'); } catch {}
    }
  },

  async fetch(req, env, ctx) {

    if (req.method === 'GET') {
      const url = new URL(req.url);
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge');
      if (mode === 'subscribe' && token === env.VERIFY_TOKEN) {
        return new Response(challenge, { status: 200 });
      }

      // TEMPORARY debug trigger — seed a due reminder for `phone` and run the
      // cron immediately. Guarded by VERIFY_TOKEN. REMOVE after testing.
      // GET /?test_reminders=<VERIFY_TOKEN>&phone=<e164>
      if (url.searchParams.get('test_reminders') === env.VERIFY_TOKEN) {
        const phone = url.searchParams.get('phone');
        if (!phone) return new Response('missing phone', { status: 400 });
        const u = await getUser(phone, env);
        if (!u) return new Response('no such user', { status: 404 });
        const seed = {
          type: 'sunset', day: 'today', fire: 'before_sunset',
          send_at: new Date(Date.now() - 60000).toISOString(), // 1 min ago = due
          sun_time: new Date().toISOString(),
          display: 'TEST 8:31 PM', city: u.city || 'your city', sent: false,
        };
        const cur = Array.isArray(u.scheduled_reminders) ? u.scheduled_reminders : [];
        await updateUser(phone, {
          scheduled_reminders: [...cur, seed],
          last_message_at: new Date().toISOString(), // ensure session is open
        }, env);
        await dispatchDueReminders(env);
        return new Response('dispatched — check WhatsApp + tail', { status: 200 });
      }

      return new Response('Forbidden', { status: 403 });
    }

    if (req.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    let body;
    try { body = await req.json(); } catch { return new Response('OK', { status: 200 }); }
    // Extract phone early so the catch block can notify the user on any downstream error.
    const debugPhone = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from;

    try {

      const statuses = body?.entry?.[0]?.changes?.[0]?.value?.statuses;
      if (statuses) return new Response('OK', { status: 200 });

      const message = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
      if (!message) return new Response('OK', { status: 200 });

      
      const phone = message.from;
      const messageId = message.id;
      const messageType = message.type;
      const u = await hashPhone(phone);


      if (SILENT_DROP_TYPES.has(messageType)) {
        return new Response('OK', { status: 200 });
      }

      // Dedup: Meta retries delivery if it doesn't get a 200 within ~20s.
      // A KV read here drops the duplicate before any DB or Claude work.
      // Write is deferred so it doesn't add latency to the critical path.
      const dedupKey = `seen:${messageId}`;
      if (await env.KV.get(dedupKey)) {
        console.log(`[dedup] dropping duplicate mid=${u}`);
        return new Response('OK', { status: 200 });
      }
      ctx.waitUntil(env.KV.put(dedupKey, '1', { expirationTtl: 86400 }));

      if (!['text', 'image', 'location'].includes(messageType)) {
        await sendMessage(
          phone,
          'I can only read text messages and food label photos. Please send a text question or a photo of a label.',
          env
        );
        return new Response('OK', { status: 200 });
      }

      // -- Scale brakes: parallel KV reads ----------------------------------
      // All three checks read independent keys — fire together to save ~2 RTTs.
      const today = new Date().toISOString().slice(0, 10);
      const [throttled, rlRaw, spendRaw] = await Promise.all([
        env.KV.get('mode:throttled'),                      // manual kill switch
        env.KV.get(`ratelimit:${phone}:${today}`),         // per-user daily cap
        env.KV.get(`spend:${today}`),                      // global spend ceiling
      ]);

      // Flip with: KV put mode:throttled = "1". Existing users keep working;
      // new users get a hold message. Clears instantly on KV delete, no deploy.
      if (throttled) {
        const existing = await getUser(phone, env);
        if (!existing) {
          await sendMessage(phone, `We're experiencing high demand right now 🙏🏾 Please try again tomorrow.`, env);
          return new Response('OK', { status: 200 });
        }
      }

      // -- Per-user daily rate limit -----------------------------------------
      const count = parseInt(rlRaw || '0', 10);
      if (count >= 200) {
        await sendMessage(phone, `You've hit today's limit 🙏🏾 Back tomorrow.`, env);
        return new Response('OK', { status: 200 });
      }
      await env.KV.put(`ratelimit:${phone}:${today}`, String(count + 1), { expirationTtl: 86400 });

      // -- Global daily spend ceiling (soft) ---------------------------------
      // KV has no atomic increment, so concurrent requests can undercount.
      // Thresholds are set conservatively; Anthropic billing alert is the real backstop.
      const spend = parseFloat(spendRaw || '0');
      if (spend >= 8) {
        if (messageType === 'image') {
          await sendMessage(phone, `We're at capacity for image scans today 🙏🏾 Text questions still work.`, env);
          return new Response('OK', { status: 200 });
        }
        if (spend >= 10) {
          await sendMessage(phone, `We're at capacity today 🙏🏾 Please try again tomorrow.`, env);
          return new Response('OK', { status: 200 });
        }
      }
      
      let text = message.text?.body || message.image?.caption || '';
      const t0 = Date.now();

      if (messageType === 'image') {
        // Fire-and-forget: we want this to send before awaiting Phase 1 I/O,
        // so it's intentionally not awaited. ctx.waitUntil not needed — the
        // Worker stays alive for the main await chain that follows.
        void sendMessage(phone, 'Reviewing your request... 🔍', env);
      }

      // -- Classify early (sync) so Phase 1 can skip fetchPendingAction ------
      // Fresh journeys (sunset, restaurant, tithi, etc.) always win over any
      // pending — no need to pay for a Supabase read to confirm it. Only
      // food-classified messages (potential bare replies) need fresh pending.
      // Location pins always need fresh pending (may be resuming a city ask).
      const isLocationMessage = messageType === 'location';
      const rbIntent = isLocationMessage
        ? { journey: 'city_update', params: {}, prompt_blocks: [] }
        : classify(text, messageType === 'image');
      const needsFreshPending = isLocationMessage || rbIntent.journey === 'food';

      // -- Phase 1: Parallel I/O ---------------------------------------------
      const imagePromise = messageType === 'image'
        ? getImageAsBase64(message.image.id, message.image.mime_type, env)
        : null;

      // Reaction is fire-and-forget — result is never used. Registered with
      // ctx.waitUntil so it survives any fast-exit path added in future.
      ctx.waitUntil(sendReaction(phone, messageId, env));

      let user, calendarEvents;
      let freshPending, freshProfile;
      [user, calendarEvents, freshPending, freshProfile] = await Promise.all([
        getUser(phone, env),
        getCalendarCached(env),
        needsFreshPending
          ? fetchPendingAction(phone, env)
          : Promise.resolve(null),  // null = skipped; undefined = fetch error
        fetchProfile(phone, env),
      ]);

      // Reconcile Supabase vs KV:
      //   undefined         → fetch error; keep KV value as-is
      //   null              → fetch was skipped (fresh journey); clear stale KV pending
      //   { exists: false } → ghost user: Supabase row was deleted but KV still has stale data
      //   { exists: true }  → normal: override KV pending_action with always-fresh Supabase value
      if (freshPending === undefined) {
        // fetch errored — keep whatever KV has
      } else if (freshPending === null) {
        // Fresh journey — fetchPendingAction was skipped. Clear any stale pending
        // so it can't intercept a future bare reply on a different turn.
        // MUST be await (not ctx.waitUntil): the journey handler may write new
        // pending synchronously right after this; an async clear would race and
        // wipe the freshly-stored pending on the Supabase side.
        if (user?.pending_action) {
          await updateUser(phone, { pending_action: null }, env);
          user.pending_action = null;
        }
      } else if (freshPending && !freshPending.exists) {
        if (user) {
          // Ghost user: KV had stale data but Supabase row is gone — evict and re-create
          console.log(`[db] ghost_user phone detected — clearing KV and re-creating`);
          try { await env.KV.delete(`user:${phone}`); } catch {}
          user = null; // falls into new-user creation below
        }
        // else: genuinely new user — user is already null, nothing to evict
      } else if (freshPending && freshPending.exists && user) {
        user.pending_action = freshPending.pending_action;
      }

      // Always overwrite KV profile fields with fresh Supabase values.
      // KV eventual consistency means profile changes (strictness, city, etc.)
      // can take up to 60s to propagate across edge PoPs — this guarantees freshness.
      if (freshProfile && freshProfile.exists && user) {
        const { strictness, community, city, language } = freshProfile;
        if (strictness  !== undefined) user.strictness  = strictness;
        if (community   !== undefined) user.community   = community;
        if (city        !== undefined) user.city        = city;
        if (language    !== undefined) user.language    = language;
      }

      console.log(`[perf] phase1_parallel=${Date.now() - t0}ms type=${messageType}`);

      // -- DB error: distinguish "Supabase failed" from "genuinely new user" --
      // getUser returns undefined on an HTTP error (not just missing row).
      // Treating that as a new user would send a welcome message to an active user.
      if (user === undefined) {
        console.log(`[db] getUser returned undefined (fetch error) — aborting`);
        await sendMessage(phone, 'Something went wrong on my end — please try again in a moment 🙏🏾', env);
        return new Response('OK', { status: 200 });
      }

      // Stamp the last inbound time for every existing user. The reminder cron
      // uses this to gate sends to the open 24h WhatsApp session window — a
      // reminder must never fire into a closed session (paid template territory).
      // Deferred + field-scoped PATCH, so it can't clobber concurrent
      // history/pending writes. New users get stamped on their next message.
      if (user) {
        ctx.waitUntil(updateUser(phone, { last_message_at: new Date().toISOString() }, env));
      }

      // -- New user creation + welcome ---------------------------------------
      if (!user) {
        user = await createUser(phone, {
          community: DEFAULT_DIET,
          timezone: defaultTimezoneFromPhone(phone)
        }, env);
        await sendMessage(phone, getWelcomeMessage(), env);

        const isJustGreeting = messageType === 'text' && (
          isBareGreeting(text) || text.trim().toLowerCase() === 'help'
        );
        if (isJustGreeting) {
          return new Response('OK', { status: 200 });
        }
        // createUser failed (DB error) — welcome was sent, stop here.
        // Don't fall through with user=undefined or everything crashes.
        if (!user) {
          console.log(`[db] createUser returned falsy — aborting request after welcome`);
          return new Response('OK', { status: 200 });
        }
        // Fall through — answer the question too
      }

      // -- Pending delete confirmation ---------------------------------------
      // Stored in pending_action (Supabase-backed) so it survives KV eventual
      // consistency lag. Previously used a separate KV key which could be
      // invisible to the next request if it landed on a different edge node.
      const pendingDeleteRecord = readPending(user.pending_action);
      console.log(`[delete] check pending_action=${JSON.stringify(user.pending_action)?.slice(0,80)} need=${pendingDeleteRecord?.need}`);
      if (pendingDeleteRecord?.need === 'delete_confirm') {
        // Any message type cancels unless it's the exact text "YES".
        // Images and location pins arriving mid-flow are treated as a cancel —
        // they should never silently leave delete_confirm active to fire later.
        await updateUser(phone, { pending_action: null }, env);
        if (messageType === 'text' && text.trim().toUpperCase() === 'YES') {
          await deleteUser(phone, env);
          await sendImage(phone, VIN_GOODBYE_URL, "You've been removed from the family. Take care. 🙏🏾", env);
        } else {
          await sendImage(phone, VIN_STAY_URL, "Deletion cancelled — you're still family. 🙏🏾", env);
        }
        return new Response('OK', { status: 200 });
      }

      // -- bare "delete" — disambiguate reminders vs account deletion ----------
      if (messageType === 'text' && text.trim().toLowerCase() === 'delete') {
        await sendMessage(phone, `Did you mean to cancel your reminders, or delete your account?\n\n• Reply *cancel* to remove your reminders\n• Reply *delete me* to delete your account 🙏🏾`, env);
        return new Response('OK', { status: 200 });
      }

      // -- "delete me" keyword -----------------------------------------------
      if (messageType === 'text' && text.trim().toLowerCase() === 'delete me') {
        const rec = serializePending({ need: 'delete_confirm', intent: { journey: 'food', params: {} } });
        console.log(`[delete] setting delete_confirm rec=${rec?.slice(0,60)}`);
        await updateUser(phone, { pending_action: rec }, env);
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

      // -- "cancel" keyword — clear all scheduled reminders ------------------
      // Catches "cancel", "cancel reminders", "cancel my reminders".
      // Reads fresh from Supabase so it reliably sees a just-set reminder.
      const cancelNorm = text.trim().toLowerCase();
      if (messageType === 'text' && (cancelNorm === 'cancel' || /^cancel (my |all |all my )?reminders?$/.test(cancelNorm))) {
        const active = await activeReminders(phone, env);
        await clearReminders(phone, user, env);
        // Also clear any pending reminder_confirm so a stray "yes" can't
        // re-add the just-cancelled reminder on the next message.
        const pendingForCancel = readPending(user.pending_action);
        if (pendingForCancel?.need === 'reminder_confirm') {
          await updateUser(phone, { pending_action: null }, env);
          user.pending_action = null;
        }
        await sendMessage(phone, active.length
          ? `✅ Done — I've cancelled your ${cancelSummary(active)}.`
          : `You don't have any reminders set right now 🙏🏾`, env);
        return new Response('OK', { status: 200 });
      }

      // -- "my reminders" keyword — list all active reminders ----------------
      if (messageType === 'text' && /^(my reminders?|reminders?|(list|show|check)( all| my| all my)? reminders?|(give|tell) me( all| my| all my)? reminders?|what( are)? (all )?my reminders?)\??$/i.test(text.trim())) {
        const active = await activeReminders(phone, env);
        await sendMessage(phone, listRemindersText(active), env);
        return new Response('OK', { status: 200 });
      }

      // -- "details" keyword — strictness level explainer --------------------
      // Only fires when the strictness question is currently pending.
      // Any other context falls through to normal routing.
      if (messageType === 'text' && text.trim().toLowerCase() === 'details') {
        const detailsPending = readPending(user.pending_action);
        if (detailsPending?.need === 'strictness') {
          await sendMessage(phone, getStrictnessDetails(user.community) + '\n\n' + getStrictnessQuestion(), env);
          const rec = serializePending({ need: 'strictness', intent: { journey: 'food', params: {} } });
          if (rec) await updateUser(phone, { pending_action: rec }, env);
          return new Response('OK', { status: 200 });
        }
      }

      // -- Bare greeting → show welcome --------------------------------------
      if (messageType === 'text' && isBareGreeting(text)) {
        await sendMessage(phone, getWelcomeMessage(), env);
        return new Response('OK', { status: 200 });
      }

      // -- Location pin ----------------------------------------------------------
      // Routed before text dispatch. Picks up any in-flight city ask (pending)
      // and resumes it; cold pins save location as a city_update.
      if (isLocationMessage) {
        const lat = message.location?.latitude;
        const lng = message.location?.longitude;
        if (lat != null && lng != null) {
          const locPending = readPending(user.pending_action);
          const pendingJourney = locPending?.intent?.journey;
          const isCityPending = locPending && (locPending.need === 'city' || locPending.need === 'city_pick');
          const journeyName = (isCityPending && CITY_JOURNEY_NAMES.has(pendingJourney))
            ? pendingJourney
            : 'city_update';
          const locIntent = {
            journey: journeyName,
            params: { locationPin: { lat, lng }, original_text: 'Shared location' },
            prompt_blocks: journeyName === 'restaurant' ? ['restaurant']
              : (journeyName === 'sunset' || journeyName === 'tithi') ? ['calendar']
              : [],
          };
          if (journeyName === 'sunset') {
            await handleRebuildSunset(phone, '', user, locIntent, env);
          } else if (journeyName === 'restaurant') {
            await handleRebuildRestaurant(phone, '', user, locIntent, env);
          } else if (journeyName === 'tithi') {
            await handleRebuildTithi(phone, '', user, locIntent, env);
          } else {
            await handleCityUpdate(phone, '', user, locIntent, env);
          }
        }
        return new Response('OK', { status: 200 });
      }

      // -- REBUILD: classify → journey handlers ----------------------------------
      if (messageType === 'text') {
        if (rebuildSunsetClaims(user, rbIntent, text)) {
          const handled = await handleRebuildSunset(phone, text, user, rbIntent, env);
          if (handled) return new Response('OK', { status: 200 });
        }

        if (rebuildRestaurantClaims(user, rbIntent, text)) {
          const handled = await handleRebuildRestaurant(phone, text, user, rbIntent, env);
          if (handled) return new Response('OK', { status: 200 });
        }

        // -- City update: "my city is X", "I live in X" etc. ----------------
        if (cityUpdateClaims(user, rbIntent, text)) {
          const handled = await handleCityUpdate(phone, text, user, rbIntent, env);
          if (handled) return new Response('OK', { status: 200 });
        }

        // -- Profile update: "make me strict", "I'm BAPS", 1/2/3 reply ------
        if (profileUpdateClaims(user, rbIntent, text)) {
          const handled = await handleProfileUpdate(phone, text, user, rbIntent, env);
          if (handled) return new Response('OK', { status: 200 });
        }

        // -- Account deletion: "delete my account", "remove me", "opt out" etc.
        // Classify sets journey='account' for these phrases. Handle here so
        // they never reach handleRebuildFood (which would append strictness ask).
        if (rbIntent.journey === 'account') {
          const rec = serializePending({ need: 'delete_confirm', intent: { journey: 'food', params: {} } });
          await updateUser(phone, { pending_action: rec }, env);
          await sendMessage(phone, `I need you to confirm. Reply with exactly:\n\n*delete me*\n\n(all lowercase, just those two words)\n\nThis will permanently remove your account and all saved data. 🙏🏾`, env);
          return new Response('OK', { status: 200 });
        }

        // Parse pending once — used by all followup handlers below.
        // Handlers that clear pending also set user.pending_action = null so
        // subsequent checks in this same request see the updated value.
        const pending = readPending(user.pending_action);
        const trimmed = text.trim();
        const isShortAffirmative = (maxLen) =>
          /^(yes|yea|yeah|yep|sure|ok|okay|please|sounds good)\b/i.test(trimmed) &&
          trimmed.length < maxLen;

        // -- Food followup: Claude ended with a question or numbered menu --------
        // Clear pending and fall through — Claude sees its own question/menu in
        // history and responds naturally. Track that we cleared it so the
        // orphaned-bare-number guard below doesn't intercept a numbered menu reply.
        let hadFoodFollowup = false;
        if (pending?.need === 'food_followup') {
          await updateUser(phone, { pending_action: null }, env);
          user.pending_action = null;
          hadFoodFollowup = true;
        }

        // -- Tithi food followup: user replied after a tithi response ended with a question --
        if (pending?.need === 'tithi_food_followup') {
          await updateUser(phone, { pending_action: null }, env);
          user.pending_action = null;
          hadFoodFollowup = true;
        }

        // -- Tithi followup: user said "yes" after sunset offered a fast check --
        if (pending?.need === 'tithi_followup' && (isShortAffirmative(20) || trimmed === '1')) {
          await updateUser(phone, { pending_action: null }, env);
          user.pending_action = null;
          const tithiIntent = {
            journey: 'tithi',
            params: { original_text: 'Is today a fast day?' },
            prompt_blocks: ['calendar'],
          };
          const handled = await handleRebuildTithi(phone, text, user, tithiIntent, env);
          if (handled) return new Response('OK', { status: 200 });
        }

        // -- Reminder confirm: user replied after a sunset/sunrise offer ------
        // "yes" → commit the precomputed reminder to the queue. Anything else →
        // drop the offer and let the message route normally (fall through).
        if (pending?.need === 'reminder_confirm') {
          if (isShortAffirmative(20)) {
            await commitReminder(phone, user, pending.reminder, env);
            await sendMessage(phone, confirmText(pending.reminder), env);
            return new Response('OK', { status: 200 });
          }
          await updateUser(phone, { pending_action: null }, env);
          user.pending_action = null;
        }

        // -- Tithi / calendar -------------------------------------------------
        if (tithiClaims(user, rbIntent, text)) {
          const handled = await handleRebuildTithi(phone, text, user, rbIntent, env);
          if (handled) return new Response('OK', { status: 200 });
        }

        // Fallback router: classify defaulted to food with no real food signal
        // → ambiguous message. Ask Haiku for the journey + city, then re-route.
        // Guard: skip if a city-need is pending — the reply is almost certainly
        // a city answer; sending to Haiku would hijack it.
        const currentPending = readPending(user.pending_action);
        const pendingNeedsCity = currentPending?.need === 'city' || currentPending?.need === 'city_pick';
        const ambiguous = rbIntent.journey === 'food'
          && !rbIntent.params.food_text
          && !rbIntent.params.has_image
          && text.trim().length >= 10
          && !isShortAffirmative(40)
          && !pendingNeedsCity;
        if (ambiguous) {
          const r = await routeFallback(text, env);
          if (r && (r.journey === 'restaurant' || r.journey === 'sunset')) {
            const routed = {
              journey: r.journey,
              params: r.city ? { city_raw: r.city } : {},
              prompt_blocks: r.journey === 'sunset' ? ['calendar'] : ['restaurant'],
            };
            const handled = r.journey === 'sunset'
              ? await handleRebuildSunset(phone, text, user, routed, env)
              : await handleRebuildRestaurant(phone, text, user, routed, env);
            if (handled) return new Response('OK', { status: 200 });
          }
        }

        // -- Code-driven fasting (flat menu; option 9+ → prompt) -----------
        const fastPending = readPending(user.pending_action);
        const reply = text.trim();

        // Upvas type pick: user was asked Chovihar or Tivihar and replied.
        // Anchored at ^ so "can I have dal during tivihar?" doesn't match.
        if (fastPending && fastPending.need === 'upvas_pick') {
          const norm = reply.toLowerCase().trim();
          const isChovihar = /^(1|chovihar|chauvihar)\b/i.test(norm);
          const isTivihar  = /^(2|tivihar)\b/i.test(norm);
          if (isChovihar || isTivihar) {
            await updateUser(phone, { pending_action: null }, env);
            await sendMessage(phone, rulesFor(isChovihar ? 'upvas_chovihar' : 'upvas_tivihar'), env);
            return new Response('OK', { status: 200 });
          }
          // Unrecognised reply — clear pending and fall through to normal routing
          await updateUser(phone, { pending_action: null }, env);
          user.pending_action = null;
        }

        if (fastPending && fastPending.need === 'fast_pick') {
          if (/^[1-8]$/.test(reply)) {
            const rules = rulesForNumber(parseInt(reply, 10));
            if (rules) {
              await updateUser(phone, { pending_action: null }, env);
              await sendMessage(phone, rules, env);
              return new Response('OK', { status: 200 });
            }
          }
          if (rbIntent.params.fast_term && rbIntent.params.fast_term !== 'pachkhan_general') {
            const ft = rbIntent.params.fast_term;
            // If the user also mentioned a specific food (food_text), this is a
            // verdict question ("can I eat rice during ekasan?") not a rules request.
            // Clear fast_pick and fall through to Claude for a proper verdict.
            if (rbIntent.params.food_text) {
              await updateUser(phone, { pending_action: null }, env);
              user.pending_action = null;
              // fall through to handleRebuildFood
            } else if (ft === 'upvas') {
              // Bare upvas from inside the fast menu → ask sub-type
              const rec = serializePending({ need: 'upvas_pick', intent: rbIntent });
              await updateUser(phone, { pending_action: rec }, env);
              await sendMessage(phone, UPVAS_MENU, env);
              return new Response('OK', { status: 200 });
            } else {
              const rules = rulesFor(ft);
              if (rules) {
                await updateUser(phone, { pending_action: null }, env);
                await sendMessage(phone, rules, env);
                return new Response('OK', { status: 200 });
              }
            }
          }
        }

        if (rbIntent.params.fast_term) {
          const ft = rbIntent.params.fast_term;
          // If a specific food was named ("can I have potatoes during ekasan?"),
          // the user wants a Claude verdict — skip all code-driven rule shortcuts
          // and fall through to handleRebuildFood.
          const wantsVerdict = !!rbIntent.params.food_text;
          if (!wantsVerdict) {
            if (ft === 'pachkhan_general') {
              const rec = serializePending({ need: 'fast_pick', intent: rbIntent });
              await updateUser(phone, { pending_action: rec }, env);
              await sendMessage(phone, FAST_MENU, env);
              return new Response('OK', { status: 200 });
            }
            // Bare "upvas" with no specific food → ask sub-type
            if (ft === 'upvas') {
              const rec = serializePending({ need: 'upvas_pick', intent: rbIntent });
              await updateUser(phone, { pending_action: rec }, env);
              await sendMessage(phone, UPVAS_MENU, env);
              return new Response('OK', { status: 200 });
            }
            const rules = rulesFor(ft);
            if (rules) {
              // If the user asked an open-ended food question ("what can I eat
              // during X?"), teach them how to get a per-food verdict too —
              // saves a confused follow-up message.
              const openEndedFood = /\b(what (can|should|am i allowed to) (i )?(eat|have|drink)|what'?s allowed|what foods?|which foods?|what to eat)\b/i;
              const prefix = openEndedFood.test(text)
                ? `Here are the ${ft} rules. To check a specific food, just ask — e.g. *"can I have dal during ${ft}?"* 🙏🏾\n\n`
                : '';
              await sendMessage(phone, prefix + rules, env);
              return new Response('OK', { status: 200 });
            }
          }
        }

        // -- Clear stale pending ----------------------------------------------
        // Reaching here means no journey claimed this turn → user moved on.
        const stalePending = readPending(user.pending_action);
        if (stalePending) {
          await updateUser(phone, { pending_action: null }, env);
          user.pending_action = null;
        }

        // -- Orphaned bare affirmative ----------------------------------------
        // "yes", "ok", etc. with no pending context would reach Claude, which
        // can hallucinate a confirmation for whatever was last in history (e.g.
        // re-confirming a reminder that was just cancelled). Short affirmatives
        // have no meaning without pending context — intercept here.
        // Exception: hadFoodFollowup = true means Claude asked a question last
        // turn; the "yes" is a valid reply to that question.
        if (isShortAffirmative(20) && !hadFoodFollowup && messageType === 'text') {
          await sendMessage(phone, `What can I help you with? 🙏🏾`, env);
          return new Response('OK', { status: 200 });
        }

        // -- Orphaned bare number ---------------------------------------------
        // User typed "1", "2", etc. but no pending matched (e.g. picker expired
        // after a long gap). Sending to Claude gives a confusing generic reply.
        // Exception: skip if food_followup was just cleared — the number is a
        // valid reply to a numbered menu Claude generated last turn.
        if (/^[1-9]$/.test(text.trim()) && messageType === 'text' && !hadFoodFollowup) {
          await sendMessage(phone, `What would you like help with? 🙏🏾`, env);
          return new Response('OK', { status: 200 });
        }
      }

      // -- Food / image catch-all --------------------------------------------
      await handleRebuildFood(phone, text, user, rbIntent, env, {
        messageType, imagePromise, calendarEvents, t0, ctx,
      });
      return new Response('OK', { status: 200 });

    } catch (err) {
      console.log('Main handler error:', err.message, err.stack);
      if (debugPhone) {
        const msg = env.DEBUG === 'true'
          ? `⚠️ Error: ${err.message}\n${(err.stack || '').slice(0, 500)}`
          : 'Something went wrong on my end — please try again in a moment 🙏🏾';
        try { await sendMessage(debugPhone, msg, env); } catch {}
      }
      return new Response('OK', { status: 200 });
    }
  }
};
