// ============================================
// onboarding.js — User onboarding flow
// ============================================
//
// DIET EXPANSION GUIDE:
//   1. Add your new diet to SUPPORTED_DIETS below (e.g. { id: 'baps', label: 'BAPS Swaminarayan' }).
//   2. When SUPPORTED_DIETS.length > 1 the diet-picker step auto-enables (see DIET_EXPANSION
//      comments in handleOnboarding below).
//   3. Before launching, run a DB migration:
//        UPDATE users SET community = 'jain' WHERE community IS NULL;
//      so existing users are not presented with the picker on their next message.
// ============================================

import { updateUser } from './database.js';
import { sendMessage } from './whatsapp.js';

// ── Diet registry ─────────────────────────────────────────────────────────────
// Add entries here to support additional diets.
// When length === 1 the single diet is auto-assigned and the picker step is skipped.
export const SUPPORTED_DIETS = [
  { id: 'jain', label: 'Jain' },
  // { id: 'baps', label: 'BAPS Swaminarayan' },  // uncomment to re-enable
];

export const DEFAULT_DIET = SUPPORTED_DIETS[0].id;       // 'jain'
const MULTI_DIET        = SUPPORTED_DIETS.length > 1;    // false for now

// ── Message helpers ───────────────────────────────────────────────────────────

function buildDietPickerMessage() {
  const lines = SUPPORTED_DIETS.map((d, i) => `${i + 1} — ${d.label}`);
  return `Which dietary tradition do you follow?\n${lines.join('\n')}`;
}

function buildStrictnessQuestion() {
  // DIET_EXPANSION: pass community label here if you want community-specific wording.
  return `How strictly do you follow Jain dietary rules?
1 — Strict (all rules, no exceptions)
2 — Moderate (core rules, flexible on edge cases)
3 — Flexible (basic vegetarian rules)`;
}

// Called by worker.js to start or re-prompt onboarding.
export function getOnboardingMessage(reason, user) {
  if (reason === 'new_user') {
    // DIET_EXPANSION: when MULTI_DIET is true, show the diet picker first.
    if (MULTI_DIET) {
      return `Jai Jinendra! 🙏 I'm Samta, your dietary guidance assistant.\n\n${buildDietPickerMessage()}`;
    }
    return `Jai Jinendra! 🙏 I'm Samta, your Jain dietary assistant.\n\n${buildStrictnessQuestion()}`;
  }

  if (reason === 'no_diet') {
    return buildD