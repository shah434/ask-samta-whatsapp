// ============================================
// onboarding.js — Welcome message + strictness question text
// ============================================

// Default community for new users. Change when BAPS launches.
export const DEFAULT_DIET = 'jain';

export function getWelcomeMessage() {
  return `Hello 🙏 I'm Samta — your friend for daily dietary and fasting questions.


You can ask me things like:
- Is today a fast day?
- What time is sunrise / sunset?
- What can I eat during fast?
- Find Jain/vegetarian restaurants near me
- Find Jain temples / mandirs near me
- What can I substitute for onion?
- Are the ingredients in this food or supplement safe?

Or send a photo of any food label, menu, or product to scan 🙏`;
}

export function getStrictnessQuestion() {
  return `So I can tailor future answers — which fits you?
1 — Strict (no root veg, no fermented, no exceptions)
2 — Moderate (core rules, flexible on edge cases)
3 — Flexible (basic vegetarian rules)`;
}

