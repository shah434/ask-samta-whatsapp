// ============================================
// strictness.test.js — pure-logic tests for the 5-level model.
// ============================================
import { describe, it, expect } from 'vitest';
import {
  LEVELS, ORDINAL, THRESHOLD, LEVEL_BY_NUMBER,
  parseStrictnessInput, labelFor, isValidLevel, renderJainRules,
  shouldAskStrictness, STRICTNESS_ASK_MAX,
} from '../src/strictness.js';

describe('strictness — level table', () => {
  it('has exactly five nested levels in order', () => {
    expect(LEVELS).toEqual(['very_strict', 'strict', 'moderate', 'flex', 'relaxed']);
    expect(LEVELS.map((k) => ORDINAL[k])).toEqual([1, 2, 3, 4, 5]);
  });

  it('maps numbers 1–5 to the right keys', () => {
    expect(LEVEL_BY_NUMBER[1]).toBe('very_strict');
    expect(LEVEL_BY_NUMBER[5]).toBe('relaxed');
  });
});

describe('strictness — parseStrictnessInput', () => {
  it('accepts each number 1–5', () => {
    expect(parseStrictnessInput('1')).toBe('very_strict');
    expect(parseStrictnessInput('2')).toBe('strict');
    expect(parseStrictnessInput('3')).toBe('moderate');
    expect(parseStrictnessInput('4')).toBe('flex');
    expect(parseStrictnessInput('5')).toBe('relaxed');
  });

  it('accepts canonical keys, labels and synonyms', () => {
    expect(parseStrictnessInput('very strict')).toBe('very_strict');
    expect(parseStrictnessInput('Very Strict')).toBe('very_strict');
    expect(parseStrictnessInput('monk')).toBe('very_strict');
    expect(parseStrictnessInput('flexible')).toBe('flex');
    expect(parseStrictnessInput('relax')).toBe('relaxed');
    expect(parseStrictnessInput('Relaxed.')).toBe('relaxed');
    expect(parseStrictnessInput('  moderate  ')).toBe('moderate');
  });

  it('rejects out-of-range numbers and junk', () => {
    for (const junk of ['0', '6', '12', '', '   ', 'spicy', 'strictish', null, undefined]) {
      expect(parseStrictnessInput(junk)).toBeNull();
    }
  });
});

describe('strictness — helpers', () => {
  it('labelFor returns a human label, "not set" for unknown', () => {
    expect(labelFor('flex')).toBe('Flexible');
    expect(labelFor('very_strict')).toBe('Very Strict');
    expect(labelFor(undefined)).toBe('not set');
    expect(labelFor('bogus')).toBe('not set');
  });

  it('isValidLevel guards the key space', () => {
    expect(isValidLevel('moderate')).toBe(true);
    expect(isValidLevel('flexible')).toBe(false); // synonym is not a stored key
  });
});

describe('strictness — thresholds encode the matrix', () => {
  const allowedAt = (food, ord) => {
    const thr = THRESHOLD[food];
    if (typeof thr === 'object') return ord >= thr.fresh ? 'fresh' : ord >= thr.powder ? 'powder' : 'no';
    return ord >= thr;
  };

  it('meat & gelatin are never permitted', () => {
    for (let o = 1; o <= 5; o++) {
      expect(allowedAt('meat_fish', o)).toBe(false);
      expect(allowedAt('animal_derived', o)).toBe(false);
    }
  });

  it('eggs only at Relaxed (5)', () => {
    expect(allowedAt('eggs', 4)).toBe(false);
    expect(allowedAt('eggs', 5)).toBe(true);
  });

  it('dairy & onion/garlic allowed from Moderate (3), not at Strict (2)', () => {
    for (const f of ['dairy', 'onion_garlic']) {
      expect(allowedAt(f, 2)).toBe(false);
      expect(allowedAt(f, 3)).toBe(true);
    }
  });

  it('potato is stricter than other roots — Flex (4), not Moderate (3)', () => {
    expect(allowedAt('potato', 3)).toBe(false);
    expect(allowedAt('potato', 4)).toBe(true);
    expect(allowedAt('other_root_veg', 3)).toBe(true);
  });

  it('leafy veg banned only at Very Strict (1)', () => {
    expect(allowedAt('leafy_veg', 1)).toBe(false);
    expect(allowedAt('leafy_veg', 2)).toBe(true);
  });

  it('ginger/turmeric: powder from Moderate, fresh from Flex', () => {
    expect(allowedAt('ginger_turmeric', 2)).toBe('no');
    expect(allowedAt('ginger_turmeric', 3)).toBe('powder');
    expect(allowedAt('ginger_turmeric', 4)).toBe('fresh');
  });

  it('every food is monotonic across levels (nesting holds)', () => {
    for (const food of Object.keys(THRESHOLD)) {
      const rank = (o) => {
        const r = allowedAt(food, o);
        return r === true ? 1 : r === false ? 0 : r === 'no' ? 0 : r === 'powder' ? 1 : 2;
      };
      for (let o = 2; o <= 5; o++) expect(rank(o)).toBeGreaterThanOrEqual(rank(o - 1));
    }
  });
});

describe('strictness — shouldAskStrictness', () => {
  // The "happy path": unset user, a level-dependent verdict (MULTILEVEL fired),
  // no prior asks, not fasting, not a greeting.
  const base = {
    strictnessSet: false,
    multiLevelVerdict: true,
    askCount: 0,
    alreadyAsked: false,
    isFasting: false,
    isGreeting: false,
  };

  it('asks on a level-dependent verdict for an unset user', () => {
    expect(shouldAskStrictness(base)).toBe(true);
  });

  it('never asks once strictness is set', () => {
    expect(shouldAskStrictness({ ...base, strictnessSet: true })).toBe(false);
  });

  it('does NOT ask without the MULTILEVEL signal (safe-everywhere / chatter)', () => {
    expect(shouldAskStrictness({ ...base, multiLevelVerdict: false })).toBe(false);
  });

  it('stops asking at the lifetime cap', () => {
    expect(shouldAskStrictness({ ...base, askCount: STRICTNESS_ASK_MAX - 1 })).toBe(true);
    expect(shouldAskStrictness({ ...base, askCount: STRICTNESS_ASK_MAX })).toBe(false);
    expect(shouldAskStrictness({ ...base, askCount: STRICTNESS_ASK_MAX + 5 })).toBe(false);
  });

  it('does not double-ask while a strictness question is still open', () => {
    expect(shouldAskStrictness({ ...base, alreadyAsked: true })).toBe(false);
  });

  it('does not pivot to a strictness ask during a fast', () => {
    expect(shouldAskStrictness({ ...base, isFasting: true })).toBe(false);
  });

  it('does not ask on a greeting', () => {
    expect(shouldAskStrictness({ ...base, isGreeting: true })).toBe(false);
  });

  it('the cap is 3', () => {
    expect(STRICTNESS_ASK_MAX).toBe(3);
  });
});

describe('strictness — renderJainRules', () => {
  it('mentions all five level labels and the derivatives exception', () => {
    const txt = renderJainRules();
    for (const lbl of ['Very Strict', 'Strict', 'Moderate', 'Flexible', 'Relaxed']) {
      expect(txt).toContain(lbl);
    }
    expect(txt).toMatch(/potato starch = potato/i);
    expect(txt).toMatch(/ginger\/turmeric powder/i);
  });
});
