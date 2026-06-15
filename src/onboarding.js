// ============================================
// onboarding.js — Welcome message + strictness question text
// ============================================

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
  return `Here's what each level means:

*Strict* — No root vegetables in any form (potato, carrot, radish, beetroot, yam — including powders and starches), no brinjal/eggplant or figs, no mushrooms or yeast, no fermented foods, no sprouted pulses. Onion and garlic never permitted.

*Moderate* — Root vegetables are allowed. Brinjal and mushrooms are noted but not blocked. Core rules: no meat, eggs, honey, onion, garlic, or alcohol.

*Flexible* — Basic vegetarian rules. Onion and garlic are permitted. Only meat, fish, eggs, honey, gelatin, and alcohol are avoided.`;
}

export function getStrictnessQuestion() {
  return `So I can tailor future answers — which fits you?
1 — Strict (no root veg, no fermented, no exceptions)
2 — Moderate (core rules, flexible on edge cases)
3 — Flexible (basic vegetarian rules)

Type *details* to see what's allowed at each level before choosing.

💡 Type *help* anytime to see what else I can do.`;
}

