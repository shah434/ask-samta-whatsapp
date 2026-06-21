// ============================================
// unit.test.js — Pure function tests for Samta
// Covers: classify (classify.js), stripTags (utils.js),
//         detectFastTerm (fasting-match.js),
//         readPending/serializePending (pending.js),
//         cityJourneyClaims (rebuild-city-journey.js)
// Run: npm test
// ============================================

import { describe, it, expect } from 'vitest';
import { stripTags, stripLevelMenu, stripLeadingFalseVerdict } from '../src/utils.js';
import { classify } from '../src/classify.js';
import { detectFastTerm } from '../src/fasting-match.js';

// ============================================
// profile_update journey (classify)
// ============================================

describe('profile_update journey', () => {

  it('"make me strict" → profile_update, strictness_level: strict', () => {
    const r = classify('make me strict');
    expect(r.journey).toBe('profile_update');
    expect(r.params.strictness_level).toBe('strict');
    expect(r.prompt_blocks).toEqual([]);
  });

  it('"set me to moderate" → profile_update', () => {
    const r = classify('set me to moderate');
    expect(r.journey).toBe('profile_update');
    expect(r.params.strictness_level).toBe('moderate');
  });

  it('"I\'m flexible" → profile_update, canonicalized to flex', () => {
    const r = classify("I'm flexible");
    expect(r.journey).toBe('profile_update');
    expect(r.params.strictness_level).toBe('flex');
  });

  it('"make me very strict" → profile_update, very_strict', () => {
    const r = classify('make me very strict');
    expect(r.journey).toBe('profile_update');
    expect(r.params.strictness_level).toBe('very_strict');
  });

  it('"relaxed" (bare) → profile_update, relaxed', () => {
    const r = classify('relaxed');
    expect(r.journey).toBe('profile_update');
    expect(r.params.strictness_level).toBe('relaxed');
  });

  it('"set me to flex" → profile_update, flex', () => {
    const r = classify('set me to flex');
    expect(r.journey).toBe('profile_update');
    expect(r.params.strictness_level).toBe('flex');
  });

  it('"I\'m BAPS" → profile_update, community: baps', () => {
    const r = classify("I'm BAPS");
    expect(r.journey).toBe('profile_update');
    expect(r.params.community).toBe('baps');
  });

  it('"I\'m Jain" → profile_update, community: jain', () => {
    const r = classify("I'm Jain");
    expect(r.journey).toBe('profile_update');
    expect(r.params.community).toBe('jain');
  });

  it('"switch me to BAPS" → profile_update', () => {
    const r = classify('switch me to BAPS');
    expect(r.journey).toBe('profile_update');
    expect(r.params.community).toBe('baps');
  });

  it('"I\'m Jain, can I eat paneer?" stays food (not profile_update)', () => {
    const r = classify("I'm Jain, can I eat paneer?");
    expect(r.journey).not.toBe('profile_update');
  });
});

// ============================================
// stripTags
// ============================================

describe('stripTags', () => {

  it('returns text unchanged when no tags present', () => {
    const text = '✅ SAFE — tofu is fine at all levels 🙏';
    expect(stripTags(text)).toBe(text);
  });

  it('trims leading/trailing whitespace', () => {
    expect(stripTags('  Some response  ')).toBe('Some response');
  });

  it('handles empty string', () => {
    expect(stripTags('')).toBe('');
  });
});

// ============================================
// stripLevelMenu — removes Claude's self-generated level menu
// ============================================

// ============================================
// stripLeadingFalseVerdict — removes a wrong opening NOT SAFE for unset users
// ============================================

describe('stripLeadingFalseVerdict', () => {
  const threshold = "✅ SAFE if you're Flexible or more relaxed — ✋ not permitted at Moderate, Strict, or Very Strict, since alcohol is avoided at stricter levels.";

  it('strips a leading NOT SAFE paragraph when a threshold line follows', () => {
    const input = `✋ NOT SAFE — Labatt Blue Light

Alcohol is not permitted at Strict or Very Strict, and only allowed at Flexible and Relaxed. Beer contains fermented grains.

Since your strictness isn't set yet, here's where this falls: ${threshold}`;
    expect(stripLeadingFalseVerdict(input)).toBe(threshold);
  });

  it('leaves a correct threshold-only response untouched', () => {
    expect(stripLeadingFalseVerdict(threshold)).toBe(threshold);
  });

  it('leaves a genuine always-banned NOT SAFE untouched (no threshold line follows)', () => {
    const alwaysBanned = '✋ NOT SAFE — contains chicken, never permitted at any level.';
    expect(stripLeadingFalseVerdict(alwaysBanned)).toBe(alwaysBanned);
  });

  it('leaves a correct ✅ SAFE response untouched', () => {
    const safe = '✅ SAFE — plain rice and dal are fine at every level.';
    expect(stripLeadingFalseVerdict(safe)).toBe(safe);
  });

  it('handles empty / null input', () => {
    expect(stripLeadingFalseVerdict('')).toBe('');
    expect(stripLeadingFalseVerdict(null)).toBe('');
  });
});

describe('stripLevelMenu', () => {
  const verdict = "✅ SAFE if you're Flexible or more relaxed — ✋ not permitted at Moderate, Strict, or Very Strict, since potato is a root vegetable the stricter levels avoid.";

  it('removes a self-generated "Which level fits you best?" menu', () => {
    const input = `${verdict}

Which level fits you best?
1 — Very Strict
2 — Strict
3 — Moderate
4 — Flexible
5 — Relaxed`;
    expect(stripLevelMenu(input)).toBe(verdict);
  });

  it('NEVER eats the threshold verdict line (which names Strict/Moderate)', () => {
    expect(stripLevelMenu(verdict)).toBe(verdict);
  });

  it('removes the bare numbered level list on its own', () => {
    const input = `Here you go.
1 — Very Strict
2 — Strict
3 — Moderate
4 — Flexible
5 — Relaxed`;
    expect(stripLevelMenu(input)).toBe('Here you go.');
  });

  it('leaves an unrelated numbered list alone', () => {
    const input = `Try these swaps:
1 — hing instead of onion
2 — jaggery instead of honey`;
    expect(stripLevelMenu(input)).toBe(input);
  });

  it('leaves a plain verdict with no menu untouched', () => {
    const clean = '✅ SAFE — plain rice and dal are fine at every level.';
    expect(stripLevelMenu(clean)).toBe(clean);
  });

  it('handles empty / null input', () => {
    expect(stripLevelMenu('')).toBe('');
    expect(stripLevelMenu(null)).toBe('');
  });
});

// ============================================
// detectFastTerm
// ============================================

describe('detectFastTerm', () => {

  // --- Exact matches ---
  it('"ayambil" → matched, category ayambil', () => {
    const r = detectFastTerm('ayambil');
    expect(r.matched).toBe(true);
    expect(r.category).toBe('ayambil');
  });

  it('"pachkhan" → matched, category pachkhan_general', () => {
    const r = detectFastTerm('pachkhan');
    expect(r.matched).toBe(true);
    expect(r.category).toBe('pachkhan_general');
  });

  it('"porsi" → matched, category porsi', () => {
    const r = detectFastTerm('porsi');
    expect(r.matched).toBe(true);
    expect(r.category).toBe('porsi');
  });

  it('"upvas" → matched, category upvas', () => {
    const r = detectFastTerm('upvas');
    expect(r.matched).toBe(true);
    expect(r.category).toBe('upvas');
  });

  it('"atthai" → matched, category atthai', () => {
    const r = detectFastTerm('atthai');
    expect(r.matched).toBe(true);
    expect(r.category).toBe('atthai');
  });

  // --- Spelling variants (exact in FAST_TERMS) ---
  it('"ayambhil" → matched, category ayambil', () => {
    const r = detectFastTerm('ayambhil');
    expect(r.matched).toBe(true);
    expect(r.category).toBe('ayambil');
  });

  it('"porsee" → matched, category porsi', () => {
    const r = detectFastTerm('porsee');
    expect(r.matched).toBe(true);
    expect(r.category).toBe('porsi');
  });

  it('"porasi" → matched, category porsi', () => {
    const r = detectFastTerm('porasi');
    expect(r.matched).toBe(true);
    expect(r.category).toBe('porsi');
  });

  it('"navakarsi" → matched, category navkarsi', () => {
    const r = detectFastTerm('navakarsi');
    expect(r.matched).toBe(true);
    expect(r.category).toBe('navkarsi');
  });

  it('"pacchakhan" → matched, category pachkhan_general', () => {
    const r = detectFastTerm('pacchakhan');
    expect(r.matched).toBe(true);
    expect(r.category).toBe('pachkhan_general');
  });

  // --- Gujarati script ---
  it('Gujarati "પચ્ચક્ખાણ" → matched, category pachkhan_general', () => {
    const r = detectFastTerm('પચ્ચક્ખાણ');
    expect(r.matched).toBe(true);
    expect(r.category).toBe('pachkhan_general');
  });

  it('Gujarati "પચખાણ" → matched, category pachkhan_general', () => {
    const r = detectFastTerm('પચખાણ');
    expect(r.matched).toBe(true);
    expect(r.category).toBe('pachkhan_general');
  });

  // --- Term embedded in a sentence ---
  it('fast term in a sentence is found', () => {
    const r = detectFastTerm('I am doing ayambhil today, what can I eat?');
    expect(r.matched).toBe(true);
    expect(r.category).toBe('ayambil');
  });

  // --- No match ---
  it('"tofu" → no match', () => {
    expect(detectFastTerm('tofu').matched).toBe(false);
  });

  it('"is this safe" → no match', () => {
    expect(detectFastTerm('is this safe').matched).toBe(false);
  });

  it('null → no match, no crash', () => {
    const r = detectFastTerm(null);
    expect(r.matched).toBe(false);
  });

  it('empty string → no match', () => {
    expect(detectFastTerm('').matched).toBe(false);
  });

  // --- Short tokens skipped (< 4 chars) ---
  it('very short tokens do not false-positive', () => {
    expect(detectFastTerm('eat').matched).toBe(false);
  });
});
