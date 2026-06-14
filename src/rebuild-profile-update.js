// Handles "make me strict", "I'm BAPS", and 1/2/3 replies to the strictness ask.
// No Claude call — deterministic save + confirm.

import { readPending } from './pending.js';
import { sendMessage } from './whatsapp.js';
import { updateUser } from './database.js';

function parseStrictnessInput(text) {
  const t = (text || '').trim();
  if (t === '1' || /^strict$/i.test(t))   return 'strict';
  if (t === '2' || /^moderate$/i.test(t)) return 'moderate';
  if (t === '3' || /^flexible$/i.test(t)) return 'flexible';
  return null;
}

// Claims when:
//   a) fresh profile_update intent (explicit statement)
//   b) pending.need === 'strictness' AND text is a valid reply
export function profileUpdateClaims(user, intent, text) {
  if (intent.journey === 'profile_update') return true;
  if (intent.journey !== 'food') return false;
  const pending = readPending(user.pending_action);
  if (!pending || pending.need !== 'strictness') return false;
  return parseStrictnessInput(text) !== null;
}

export async function handleProfileUpdate(phone, text, user, intent, env) {
  const pending = readPending(user.pending_action);

  // Fresh explicit declaration takes priority — classify already extracted the level.
  // Check this BEFORE pending so "set my strictness to strict" always wins over
  // a stale pending strictness ask.
  const strictness = intent.params.strictness_level
    // Fallback: 1/2/3 reply to a pending strictness ask
    || (pending?.need === 'strictness' ? parseStrictnessInput(text) : null);
  if (strictness) {
    await updateUser(phone, { strictness, pending_action: null }, env);
    await sendMessage(phone, `Got it 🙏🏾 set you to ${strictness}. Ask me anything!`, env);
    return true;
  }

  // Fresh: explicit community declaration
  const community = intent.params.community;
  if (community) {
    await updateUser(phone, { community, pending_action: null }, env);
    const label = community === 'baps' ? 'BAPS' : 'Jain';
    await sendMessage(phone, `Got it 🙏🏾 set your community to ${label}. Ask me anything!`, env);
    return true;
  }

  return false;
}
