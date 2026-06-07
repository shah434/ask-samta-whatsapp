// Handles food questions (text) and label/product image scans.
// This is the default journey — everything that isn't claimed by another handler.

import { formatEventsForClaude } from './calendar.js';
import { callClaude } from './claude.js';
import { sendMessage } from './whatsapp.js';
import { updateUser } from './database.js';
import { buildSystemPrompt, buildHistoryMessages, buildHistoryUpdate, stripTags } from './utils.js';
import { searchProductIngredients } from './search.js';
import { serializePending, readPending } from './pending.js';
import { getStrictnessQuestion } from './onboarding.js';

const TITHI_CLAIM_PATTERNS = [
  /\btoday\s+is\s+(a\s+)?(?:beej|bij|chaturdashi|chaumasi|paryushan(?:a)?|ekadashi|atthai|attham|chhath|punam|ashtami|nom|amavasya|purnima|fast day|tithi)\b/i,
  /\b(?:it\s+is|it'?s)\s+(?:beej|bij|chaturdashi|chaumasi|paryushan(?:a)?|ekadashi|atthai|attham|chhath|punam|ashtami|nom|amavasya|purnima)\b/i,
  /\bno food (?:should be eaten )?until tomorrow\b/i,
  /\btoday\s+is\s+a\s+fast(?:ing)?\s+day\b/i,
];

const STRICTNESS_SENSITIVE = new Set([
  'general', 'label_scan', 'restaurant', 'substitution', 'medicine'
]);

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
  const needsCalendar = user.community === 'jain' && (
    intent.prompt_blocks.includes('fasting') ||
    intent.prompt_blocks.includes('calendar') ||
    /tithi|fast|upvas|ayambil|ekasan|biyasan|chauvihar|tivihar|navkarsi|paryushan|today/i.test(text)
  );
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
        ? `${text}\n\nIf the full ingredient list is NOT visible in this image, reply with: PRODUCT: [full product name and brand]`
        : 'If the full ingredient list is visible in this image, scan it and assess each ingredient for my diet. If only the product front is visible (no ingredient list), reply with: PRODUCT: [full product name and brand]';

      const systemA = buildSystemPrompt(user, calendarData, '', null);
      console.log(`[perf] claude_start=${Date.now() - t0}ms`);
      const firstReply = await callClaude([{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
          { type: 'text', text: identifyPrompt }
        ]
      }], systemA, env, 400);
      console.log(`[perf] claude_done=${Date.now() - t0}ms`);

      if (firstReply.trim().toUpperCase().startsWith('PRODUCT:')) {
        // Branch B: product front — search for ingredients then call Claude again
        scanBranch = 'B';
        productName = firstReply.trim().slice(8).trim() || null;
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
    const system = buildSystemPrompt(user, calendarData, '', searchSnippets);
    console.log(`[perf] claude_start=${Date.now() - t0}ms`);
    response = await callClaude(claudeMessages, system, env, 250);
    console.log(`[perf] claude_done=${Date.now() - t0}ms`);
  }

  let cleanResponse = stripTags(response)
    .replace(/TODAY_IS_TITHI:\s*(true|false)/gi, '')
    .replace(/TODAY_TITHI_NAME:.*$/gim, '')
    .trim();

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
  // Two triggers, same action. Only one fires per message.
  //
  // Trigger A (reactive): Claude gave a dual-verdict (strict vs moderate vs
  // flexible levels visible in the reply) — ask right after that response.
  //
  // Trigger B (proactive): User has sent ≥ 2 food messages (proxy for ~10 min
  // of use) and still has no strictness set — append the question once so we
  // learn their level before the session goes on too long.
  const isStrictnessSensitive = intent.prompt_blocks.some(b => STRICTNESS_SENSITIVE.has(b));
  const levelsShown = [/\bif strict\b/i, /\bif moderate\b/i, /\bif flexible\b/i]
    .filter(re => re.test(cleanResponse)).length;
  const alreadyAskedStrictness = readPending(user.pending_action)?.need === 'strictness';
  const baseGuard = !user.strictness
    && !alreadyAskedStrictness
    && !intent.prompt_blocks.includes('fasting')
    && !isLikelyGreeting(text);

  const needsStrictnessAsk =
    baseGuard && isStrictnessSensitive && levelsShown > 1;          // Trigger A
  const proactiveStrictnessAsk =
    baseGuard && (user.message_count || 0) >= 3 && !needsStrictnessAsk; // Trigger B

  const setPendingThisTurn = needsStrictnessAsk || proactiveStrictnessAsk;
  if (setPendingThisTurn) {
    cleanResponse += '\n\n' + getStrictnessQuestion();
    cleanResponse += '\n\n💡 Type *help* anytime to see what else I can do.';
    const rec = serializePending({ need: 'strictness', intent });
    if (rec) await updateUser(phone, { pending_action: rec }, env);
  }

  // -- Send ------------------------------------------------------------------
  if (!cleanResponse) cleanResponse = "Let me know what you'd like to check 🙏🏾";
  await sendMessage(phone, tithiFact + cleanResponse, env);

  // -- Food follow-up pending ------------------------------------------------
  // If Claude ended with a question and no other pending was set this turn,
  // store a food_followup so a short reply ("sure", "yes") doesn't fall into
  // a dead-end food classify with no context.
  if (!setPendingThisTurn && cleanResponse.trimEnd().endsWith('?')) {
    const rec = serializePending({ need: 'food_followup', intent });
    if (rec) await updateUser(phone, { pending_action: rec }, env);
  }
  console.log(`[perf] sent=${Date.now() - t0}ms TOTAL`);

  // -- History (deferred) ----------------------------------------------------
  ctx.waitUntil(updateUser(phone, buildHistoryUpdate(user, text, cleanResponse), env));

  return true;
}
