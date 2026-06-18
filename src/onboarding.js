// ============================================
// onboarding.js — Welcome message + strictness question text
// ============================================

import { LEVELS, LABELS, ORDINAL } from './strictness.js';

// Default community for new users. Change when BAPS launches.
export const DEFAULT_DIET = 'jain';

export function getWelcomeMessage() {
  return `Hello 🙏🏾 I'm Samta — your friend for daily dietary and fasting questions.


You can ask me things like:
- Is today a fast day?
- What time is sunrise / sunset?
- What can I eat during fast?
- Find Jain/vegetarian restaurants near me
- Find Jain temples / mandirs near me
- What can I substitute for onion?
- Are the ingredients in this food or supplement safe?

Or send a photo of any food label, menu, or product to scan 🙏🏾`;
}

export function getStrictnessDetails(community) {
  if (community === 'baps') {
    return `Here's what each level means for BAPS:

*Strict* — No onion or garlic in any form (powder, extract, flakes, sauces). No meat, fish, eggs, poultry, seafood, or alcohol in any form including cooking wine.

*Moderate* — No onion or garlic in obvious forms (curry paste, gravies, spice blends). Core rules apply: no meat, fish, eggs, or alcohol.

*Flexible* — Basic vegetarian rules. Onion and garlic are permitted. Only meat, fish, eggs, seafood, and alcohol are avoided.`;
  }
  return `Here's what each level means (each step down adds back more foods):

*${LABELS.very_strict}* — Monk-level. Nothing animal, no roots, no onion/garlic, no dairy, no leafy greens, no mushrooms or fermented foods. The most restrictive.

*${LABELS.strict}* — Like Very Strict, but leafy vegetables (spinach, methi, coriander) are allowed.

*${LABELS.moderate}* — Adds back dairy, onion & garlic, other root vegetables, brinjal/figs, multi-seeded fruits, yeast/fermented foods, and ginger/turmeric powder. Still no potato, mushroom, honey, alcohol, or eggs.

*${LABELS.flex}* — Standard vegetarian, no eggs. Adds back potato, mushrooms, honey, alcohol, and fresh ginger/turmeric.

*${LABELS.relaxed}* — Vegetarian including eggs. Only meat, fish, and animal-derived products (gelatin) are avoided.`;
}

export function getStrictnessQuestion(community) {
  // BAPS keeps its legacy 3-level scale — the 5-level model is Jain-only.
  if (community === 'baps') {
    return `So I can tailor future answers — which fits you?
1 — Strict (no onion/garlic in any form)
2 — Moderate (core rules, flexible on edge cases)
3 — Flexible (basic vegetarian rules)

Type *details* to see what's allowed at each level before choosing.`;
  }
  const blurbs = {
    very_strict: 'monk-level, no exceptions',
    strict:      'no animal, no roots, leafy greens ok',
    moderate:    'dairy, onion/garlic & roots ok; no potato/mushroom/honey',
    flex:        'standard vegetarian, no eggs',
    relaxed:     'vegetarian including eggs',
  };
  const lines = LEVELS
    .map((k) => `${ORDINAL[k]} — ${LABELS[k]} (${blurbs[k]})`)
    .join('\n');
  return `So I can tailor future answers — which fits you?
${lines}

Type *details* to see what's allowed at each level before choosing.`;
}

