// IN PLAIN ENGLISH: handles explicit profile updates ("make me strict", "I'm BAPS") and
// 1/2/3 replies when the bot asked "which strictness level fits you?".
// ============================================
// rebuild-profile-update.js — profile_update journey
// ============================================
// classify() routes explicit strictness and community statements here
// (journey: 'profile_update', params.strictness_level or params.community).
// Also handles resume when pending_action.need === 'strictness' and the user
// replies with "1", "2", "3", "strict", "moderate", or "flexible".
// No Claude call — deterministic save + confirm.
// ============================================

import { readPending } from './pending.js';
import { sendMessage } from './whatsapp.js';
import { updateUser } from './database.js';

function parseStrictnessInput(text) {
  const t = (text || '').trim();
  if (t === '1' || /^strict$/i.test(t)) return 'strict';
  if (t === '2' || /^moderate$/i.test(t)) return 'moderate';
  if (t === '3' || /^flexible$/i.test(t)) return 'flexible';
  return null;
}

// Does this journey own the current turn?
// Claims when:
//   a) intent is a fresh profile_update (explicit statement classified)
//   b) pending.need === 'strictness' AND text is a valid strictness reply
export function profileUpdateClaims(user, intent, text) {
  if (intent.journey === 'profile_update') return true;

  // Only bare replies (not real food/question messages) resume a pending ask.
  if (intent.journey !== 'food') return false;
  const pending = readPending(user.pending_action);
  if (!pending || pending.need !== 'strictness') return false;
  return parseStrictnessInput(text) !== null;
}

export async function handleProfileUpdate(phone, text, user, intent, env) {
  const pending = readPending(user.pending_action);

  // Resume: pending strictness ask with a valid reply.
  if (pending && pending.need === 'strictness') {
    const strictness = parseStrictnessInput(text);
    if (strictness) {
      await updateUser(phone, { strictness, pending_action: null }, env);
      await sendMessage(phone, `Got it 🙏 set you to ${strictness}. Ask me anything!`, env);
      return true;
    }
    // parseStrictnessInput returned null — claims guard should have prevented
    // this, but fail safe: don't consume the turn.
    return false;
  }

  // Fresh: explicit strictness declaration from classify().
  const strictness = intent.params.strictness_level;
  if (strictness) {
    await updateUser(phone, { strictness, pending_action: null }, env);
    await sendMessage(phone, `Got it 🙏 set you to ${strictness}. Ask me anything!`, env);
    return true;
  }

  // Fresh: explicit community declaration from classify().
  const community = intent.params.community;
  if (community) {
    await updateUser(phone, { community, pending_action: null }, env);
    const label = community === 'baps' ? 'BAPS' : 'Jain';
    await sendMessage(phone, `Got it 🙏 set your community to ${label}. Ask me anything!`, env);
    return true;
  }

  return false;
}
