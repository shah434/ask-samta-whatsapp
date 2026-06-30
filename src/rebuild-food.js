// Handles food questions (text) and label/product image scans.
// This is the default journey — everything that isn't claimed by another handler.

import { formatEventsForClaude } from './calendar.js';
import { callClaude } from './claude.js';
import { sendMessage } from './whatsapp.js';
import { updateUser } from './database.js';
import { buildSystemPrompt, buildHistoryMessages, buildHistoryUpdate, stripTags, stripLevelMenu, stripLeadingFalseVerdict } from './utils.js';
import { searchProductIngredients } from './search.js';
import { serializePending, readPending } from './pending.js';
import { getStrictnessQuestion } from './onboarding.js';
import { labelFor, ORDINAL, LEVELS, shouldAskStrictness } from './strictness.js';

const TITHI_CLAIM_PATTERNS = [
  /\btoday\s+is\s+(a\s+)?(?:beej|bij|chaturdashi|chaumasi|paryushan(?:a)?|ekadashi|atthai|attham|chhath|punam|ashtami|nom|amavasya|purnima|fast day|tithi)\b/i,
  /\b(?:it\s+is|it'?s)\s+(?:beej|bij|chaturdashi|chaumasi|paryushan(?:a)?|ekadashi|atthai|attham|chhath|punam|ashtami|nom|amavasya|purnima)\b/i,
  /\bno food (?:should be eaten )?until tomorrow\b/i,
  /\btoday\s+is\s+a\s+fast(?:ing)?\s+day\b/i,
];

function isLikelyGreeting(text) {
  return /^(hi|hello|hey|jai jinendra|namaste|hola)\b/i.test((text || '').trim());
}

// context = { messageType, imagePromise, calendarEvents, t0, ctx }
export async function handleRebuildFood(phone, text, user, intent, env, context) {
  const { messageType, imagePromise, calendarEvents, t0, ctx } = context;

  // -- Calendar data ---------------------------------------------------------
  // Only Jain users need it, and only when the query touches fasting/tithi/today.
  // Pure ingredient or label checks don't need upcoming events — skipping saves
  // tokens in the dynamic prompt block (the only block that isn't prompt-cached).
  // Always include calendar for Jain users — even plain food questions need
  // today's tithi status so Claude doesn't hallucinate yesterday's fast from history.
  const needsCalendar = user.community === 'jain';
  const calendarData = needsCalendar
    ? formatEventsForClaude(calendarEvents, user.timezone, 3)
    : '';

  const m = calendarData.match(/TODAY_IS_TITHI:\s*true[\s\S]*?TODAY_TITHI_NAME:\s*(.+)/i);
  const tithiFact = m ? `Today is ${m[1].trim()} 🙏🏾\n\n` : '';

  // -- Build Claude messages --------------------------------------------------
  let claudeMessages = [];
  let searchSnippets = null;
  let scanBranch = null;
  let productName = null;
  let response; // set here for image branch A; set after the block for B and text

  // Built once and reused across all paths. Branch B reassigns after search
  // results are available; text path uses this directly.
  let system = buildSystemPrompt(user, calendarData, '', null);

  if (messageType === 'image') {
    try {
      const { base64, mimeType } = await imagePromise;
      console.log(`[perf] image_ready=${Date.now() - t0}ms`);

      // Single Claude call: identify whether the ingredient list is visible AND
      // analyse it if so. Branch A (label visible) returns the full verdict here,
      // eliminating the separate identification round-trip. Branch B (product
      // front) returns "PRODUCT: <name>" and we fall through to a Brave search
      // followed by a second Claude call with the text-only search snippets.
      const identifyPrompt = text
        ? `${text}\n\nIMPORTANT: If the full ingredient list is NOT visible in this image, your ENTIRE reply must be exactly this format and nothing else:\nPRODUCT: [full product name and brand]\nDo NOT explain. Do NOT ask questions. Do NOT say anything else.`
        : `If the full ingredient list is visible in this image, scan it and assess each ingredient for my diet.\n\nIMPORTANT: If only the product front is visible (no ingredient list), your ENTIRE reply must be exactly:\nPRODUCT: [full product name and brand]\nNothing else — no explanation, no questions, just that one line.`;

      console.log(`[perf] claude_start=${Date.now() - t0}ms`);
      const firstReply = await callClaude([{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
          { type: 'text', text: identifyPrompt }
        ]
      }], system, env, 600, ctx);
      console.log(`[perf] claude_done=${Date.now() - t0}ms`);

      // Fallback: Claude sometimes ignores the PRODUCT: format and writes a
      // conversational response instead. If it mentions it can't read the ingredient
      // list but named the product, extract the name and continue as Branch B.
      let resolvedFirstReply = firstReply;
      const cantReadIngredients = /back (panel|label|photo)|ingredient[^.]*not.*(?:visible|readable|clear)|can'?t (?:see|read).*ingredient|send.*(?:back|clearer)|clearer (?:image|photo)/i.test(firstReply);
      if (cantReadIngredients && !firstReply.trim().toUpperCase().startsWith('PRODUCT:')) {
        const nameMatch = firstReply.match(/(?:this is (?:a )?|it'?s (?:a )?|see (?:this is (?:a )?)?|recognize[^a-z]*(?:as (?:a )?)?)([A-Z][A-Za-z0-9®™\s'-]{4,80})/);
        if (nameMatch) {
          resolvedFirstReply = `PRODUCT: ${nameMatch[1].trim()}`;
          console.log(`[image] format_fallback extracted="${nameMatch[1].trim()}"`);
        } else {
          // Regex couldn't extract the name from the conversational response.
          // Make a focused second call — just identify the product, nothing else.
          console.log(`[image] name_extract_retry latency=${Date.now() - t0}ms`);
          const retryReply = await callClaude([{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
              { type: 'text', text: 'What product is shown in this image? Reply in exactly this format and nothing else:\nPRODUCT: [full product name and brand]' }
            ]
          }], system, env, 30, ctx);
          if (retryReply.trim().toUpperCase().startsWith('PRODUCT:')) {
            resolvedFirstReply = retryReply.trim();
            console.log(`[image] name_extract_retry success="${retryReply.trim()}"`);
          } else {
            console.log(`[image] name_extract_retry failed response="${retryReply.trim()}" latency=${Date.now() - t0}ms`);
            await sendMessage(phone, `I can see the front of the package but not the ingredient list. Can you send a photo of the back label? 🙏🏾`, env);
            return true;
          }
        }
      }

      if (resolvedFirstReply.trim().toUpperCase().startsWith('PRODUCT:')) {
        // Branch B: product front — search for ingredients then call Claude again
        scanBranch = 'B';
        // Only the first line — Claude sometimes appends an explanation paragraph
        // after the "PRODUCT: <name>" line, which would pollute the search query.
        productName = resolvedFirstReply.trim().slice(8).split('\n')[0].trim() || null;
        console.log(`[image] branch=B product="${productName}" latency=${Date.now() - t0}ms`);

        const snippets = productName ? await searchProductIngredients(productName, env) : null;
        if (!snippets) {
          await sendMessage(phone,
            `I couldn't find ingredient info for ${productName || 'this product'} online. Can you send a photo of the back label or ingredients panel? 🙏🏾`,
            env);
          return true;
        }
        searchSnippets =
          `PRODUCT SEARCH RESULTS — ${productName}\n` +
          `User sent a photo of the product front (no ingredient list visible).\n` +
          `Web snippets retrieved to identify ingredients:\n\n${snippets}\n\n` +
          `Use these to identify likely ingredients. If no clear ingredient list, ask for the back label. Do not invent ingredients.`;
        system = buildSystemPrompt(user, calendarData, '', searchSnippets);
        claudeMessages = [{
          role: 'user',
          content: text || `Please check if ${productName} is safe for my diet based on the search results provided.`
        }];
        // response will be set by the main callClaude below
      } else {
        // Branch A: ingredient list visible — first reply IS the full analysis
        scanBranch = 'A';
        console.log(`[image] branch=A latency=${Date.now() - t0}ms`);
        response = firstReply;
      }
    } catch (err) {
      console.log('Image processing error:', err.message);
      await sendMessage(phone, 'I could not process that image. Please try a clearer photo or type out the ingredients list.', env);
      return true;
    }
  } else {
    claudeMessages = [...buildHistoryMessages(user), { role: 'user', content: text }];
  }

  // -- Second Claude call for branch B and all text messages -----------------
  if (!response) {
    console.log(`[perf] claude_start=${Date.now() - t0}ms`);
    response = await callClaude(claudeMessages, system, env, scanBranch === 'B' ? 400 : 250, ctx);
    console.log(`[perf] claude_done=${Date.now() - t0}ms`);
  }

  // MULTILEVEL marker: the prompt emits this for an unset user when the verdict
  // is level-dependent. Detect before stripping — it drives the reactive ask.
  const multiLevelVerdict = /MULTILEVEL:\s*true/i.test(response);

  let cleanResponse = stripTags(response)
    .replace(/TODAY_IS_TITHI:\s*(true|false)/gi, '')
    .replace(/TODAY_TITHI_NAME:.*$/gim, '')
    .replace(/^.*MULTILEVEL:\s*true.*$/gim, '')
    .trim();

  // For unset users: Claude sometimes leads with ✋ NOT SAFE (wrong — treating
  // a level-dependent food like alcohol as always-banned) then self-corrects to
  // the proper threshold line. Strip the false opening, keep the threshold.
  if (!user.strictness) {
    // Leading false NOT SAFE followed by a threshold line (e.g. alcohol bug).
    cleanResponse = stripLeadingFalseVerdict(cleanResponse);
    // Transition phrases Claude adds when it knows strictness is unset:
    // "Since your strictness isn't set yet, here's where this falls: ✅ SAFE…"
    // Strip just the preamble clause, leave the threshold line intact.
    cleanResponse = cleanResponse
      .replace(/^[^\n]*\bstrictness(?:\s+isn?'?t?\s+set|'?s\s+not\s+set|\s+is(?:n'?t)?\s+set)\b[^:—]*[:—]\s*/im, '')
      .trim();
  }

  // Suppress any level menu Claude generated itself — the prompt tells it the
  // system appends that question, but it sometimes adds its own. We own the ask
  // (capped below), so strip Claude's unconditionally, or a menu would keep
  // appearing even after the cap. Our question is appended later, untouched.
  cleanResponse = stripLevelMenu(cleanResponse);

  // Guard: ⚠️ UNCERTAIN header but a ✗ line exists → always-banned ingredient
  // present. Claude sometimes picks UNCERTAIN when an uncertain ingredient
  // (natural flavors) co-exists with an always-banned one (gelatin), letting the
  // uncertain item "win" the header. Always-banned beats uncertain — upgrade.
  if (/^⚠️\s*UNCERTAIN/i.test(cleanResponse.trimStart()) && /^✗/m.test(cleanResponse)) {
    cleanResponse = cleanResponse.replace(/^⚠️\s*UNCERTAIN/, '✋ NOT SAFE');
    console.log('[verdict] upgraded UNCERTAIN→NOT SAFE: always-banned ✗ ingredient present');
  }

  // Gap 1: ✅ SAFE header + ✗ ingredient line (unset user) → must be NOT SAFE.
  // The hasSafeVerdict block below covers set users; unset users were unguarded.
  // ✗ at line-start is exclusively a label-scan ingredient marker — no false-positive risk.
  //
  // Gap 2: ✅ SAFE header + ⚠️ ingredient line (unset user) → must be UNCERTAIN.
  // ⚠️ appears in general responses too (warnings, notes), so this guard requires the
  // *Ingredients:* header to confirm we're actually in a label scan format.
  if (!user.strictness && /^✅\s*SAFE/i.test(cleanResponse.trimStart())) {
    if (/^✗/m.test(cleanResponse)) {
      cleanResponse = cleanResponse.replace(/^✅\s*SAFE/, '✋ NOT SAFE');
      console.log('[verdict] upgraded SAFE→NOT SAFE (unset): ✗ ingredient present');
    } else if (/^\*Ingredients:\*\s*$/m.test(cleanResponse) && /^⚠️/m.test(cleanResponse)) {
      cleanResponse = cleanResponse.replace(/^✅\s*SAFE/, '⚠️ UNCERTAIN');
      console.log('[verdict] upgraded SAFE→UNCERTAIN (unset): ⚠️ ingredient in label scan');
    }
  }

  // -- Verdict correction -------------------------------------------------------
  // Runs only when strictness is set (we know the user's actual level).
  if (user.strictness) {
    const lvl = user.strictness; // canonical key, e.g. 'flex' | 'very_strict'
    // The prompt refers to levels by their label ("Flex", "Very Strict"). Match
    // either the label or the raw key so corrections fire regardless of phrasing.
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const lvlAlt = `(?:${esc(labelFor(lvl))}|${esc(lvl)})`;

    // Case 1: Claude self-corrected — wrote ✋ NOT SAFE but closing line confirms it's safe.
    // Flip verdict, fix all ✗ ingredient lines, strip the correction paragraph.
    const hasNotSafeVerdict = /^✋\s*NOT SAFE/i.test(cleanResponse.trimStart());
    const selfCorrectionLine = /\n[^\n]*\b(?:safe for you overall|this is safe for you|are allowed[^.]*safe)\b[^\n]*$/i;
    if (hasNotSafeVerdict && selfCorrectionLine.test(cleanResponse)) {
      cleanResponse = cleanResponse
        .replace(/✋\s*NOT SAFE/, '✅ SAFE')
        .replace(/^✗([^\n]*)/gm, '✓$1')
        .replace(selfCorrectionLine, '')
        .trim();
      cleanResponse += '\nAll good 🙏🏾';
      console.log(`[verdict] self_correction detected, corrected not_safe→safe strictness=${lvl}`);
    }

    // Fix contradictory lines: ✓ symbol but body says "not permitted at [level]".
    cleanResponse = cleanResponse.replace(
      /^✓([^\n]*\bnot permitted at\b[^\n]*)$/gm, '✗$1'
    );

    // Case 2: Claude pre-decided ✅ SAFE but correctly flagged an ingredient below.
    const hasSafeVerdict = /^✅\s*SAFE/i.test(cleanResponse.trimStart());

    // Bug fix: allow optional words between "at" and the level name
    // e.g. "not permitted at your Moderate level" would previously not match.
    const notPermittedHere =
      new RegExp(`not permitted at (?:\\w+ )?${lvlAlt}`, 'i').test(cleanResponse) ||
      new RegExp(`not (?:safe|allowed) at (?:\\w+ )?${lvlAlt}`, 'i').test(cleanResponse);

    // Bug fix: detect when Claude names a threshold more relaxed than the user's level,
    // meaning the food is NOT permitted at the user's current level.
    // e.g. "Eggs are permitted at Relaxed" for a Flex user → eggs are NOT safe at Flex.
    const moreRelaxedLabels = LEVELS
      .filter(k => ORDINAL[k] > ORDINAL[lvl])
      .map(k => labelFor(k).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const permittedAtMoreRelaxed = moreRelaxedLabels.length > 0 && (() => {
      const lbls = moreRelaxedLabels.join('|');
      return (
        new RegExp(`\\bonly(?:\\s+(?:permitted|allowed))?\\s+at\\s+(?:${lbls})\\b`, 'i').test(cleanResponse) ||
        new RegExp(`\\b(?:permitted|allowed)\\s+only\\s+at\\s+(?:${lbls})\\b`, 'i').test(cleanResponse) ||
        new RegExp(`\\bpermitted at\\s+(?:${lbls})\\b`, 'i').test(cleanResponse)
      );
    })();

    const hasFlaggedIngredient =
      /^✗/m.test(cleanResponse) ||
      notPermittedHere ||
      new RegExp(`at ${lvlAlt}[^.]*not be permitted`, 'i').test(cleanResponse) ||
      new RegExp(`at ${lvlAlt}[^.]*not safe`, 'i').test(cleanResponse) ||
      new RegExp(`at ${lvlAlt}[^.]*would not`, 'i').test(cleanResponse) ||
      /i.?d skip this/i.test(cleanResponse) ||
      permittedAtMoreRelaxed;
    if (hasSafeVerdict && hasFlaggedIngredient) {
      cleanResponse = cleanResponse.replace(/✅\s*SAFE/, '✋ NOT SAFE');
      console.log(`[verdict] corrected safe→not_safe strictness=${lvl} permittedAtMoreRelaxed=${permittedAtMoreRelaxed}`);
    }
  }

  // Strip self-correction blocks: Claude writes "Wait — [reason]\n\n[full corrected response]".
  // Keep only the corrected version after the "Wait" paragraph.
  const waitMatch = cleanResponse.match(/\nWait[—–\-][^\n]*\n\n((?:✋|✅|⚠️)[\s\S]+)/i);
  if (waitMatch) {
    cleanResponse = waitMatch[1].trim();
    console.log('[response] stripped self-correction block');
  }


  // -- Scan log (image only) --------------------------------------------------
  if (messageType === 'image' && scanBranch) {
    try {
      await env.KV.put(
        `log:image:${new Date().toISOString()}:${Math.random().toString(36).slice(2, 8)}`,
        JSON.stringify({ productName, branch: scanBranch, snippetsFound: !!searchSnippets, response: cleanResponse, latencyMs: Date.now() - t0 }),
        { expirationTtl: 2592000 }
      );
    } catch {}
  }

  // -- Tithi-claim guard: prevent hallucinated tithi claims -------------------
  const calendarHadToday = /TODAY_IS_TITHI:\s*true/i.test(calendarData);
  if (!calendarHadToday && TITHI_CLAIM_PATTERNS.some(p => p.test(cleanResponse))) {
    const sentences = cleanResponse.split(/(?<=[.!?])\s+/);
    cleanResponse = sentences.filter(s => !TITHI_CLAIM_PATTERNS.some(p => p.test(s))).join(' ').trim()
      || "Let me know what you'd like to check 🙏🏾";
  }

  // -- Strictness ask --------------------------------------------------------
  // Ask the unset user their level ONLY when this answer was level-dependent —
  // Claude signals that with the MULTILEVEL marker (a food/label/medicine
  // verdict that changes with level). Safe-at-all-levels and never-permitted
  // answers carry no marker, so casual chatter ("thanks", "who are you") that
  // falls through classify's default `general` bucket never triggers an ask.
  //
  // A persistent per-user counter (strictness_ask_count) caps total asks at
  // STRICTNESS_ASK_MAX, so we stop nagging even across many sessions. The
  // transient strictness pending only blocks a double-ask while one is open.
  // Gap 3: if the final verdict is ✋ NOT SAFE (always-banned), suppress the
  // strictness ask even if Claude wrongly emitted MULTILEVEL:true. Asking
  // "what's your level?" after a definitive NOT SAFE is confusing — gelatin
  // fails at every level, so the level is irrelevant.
  const responseIsAlwaysBanned = /^✋\s*NOT SAFE/i.test(cleanResponse.trimStart());

  const askCount = user.strictness_ask_count || 0;
  const needsStrictnessAsk = shouldAskStrictness({
    strictnessSet: !!user.strictness,
    multiLevelVerdict: multiLevelVerdict && !responseIsAlwaysBanned,
    askCount,
    alreadyAsked: readPending(user.pending_action)?.need === 'strictness',
    isFasting: intent.prompt_blocks.includes('fasting'),
    isGreeting: isLikelyGreeting(text),
  });

  const setPendingThisTurn = needsStrictnessAsk;
  if (setPendingThisTurn) {
    cleanResponse += '\n\n' + getStrictnessQuestion(user.community);
    const fields = { strictness_ask_count: askCount + 1 };
    const rec = serializePending({ need: 'strictness', intent });
    if (rec) fields.pending_action = rec;
    await updateUser(phone, fields, env);
  }

  // -- Send ------------------------------------------------------------------
  if (!cleanResponse) cleanResponse = "Let me know what you'd like to check 🙏🏾";
  await sendMessage(phone, tithiFact + cleanResponse, env);

  // -- Food follow-up pending ------------------------------------------------
  // Set when Claude ended with a question OR generated a numbered menu.
  // Numbered menus (e.g. "1 — X\n2 — Y") need the same pending so the user's
  // "2" reply falls through to Claude (which sees the menu in history) instead
  // of hitting the orphaned-bare-number trap.
  const hasNumberedMenu = /^[1-9]\s*[—–-]/m.test(cleanResponse);
  if (!setPendingThisTurn && (cleanResponse.trimEnd().endsWith('?') || hasNumberedMenu)) {
    const rec = serializePending({ need: 'food_followup', intent });
    if (rec) await updateUser(phone, { pending_action: rec }, env);
  }
  console.log(`[perf] sent=${Date.now() - t0}ms TOTAL`);

  // -- History (deferred) ----------------------------------------------------
  ctx.waitUntil(updateUser(phone, buildHistoryUpdate(user, text, cleanResponse), env));

  return true;
}
