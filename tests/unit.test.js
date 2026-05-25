// ============================================
// unit.test.js — Pure function tests for Samta
// Covers: classifyQuery, parseProfileUpdate,
//         stripTags (utils.js), detectFastTerm
//         (fasting-match.js)
// Run: npm test
// ============================================

import { describe, it, expect } from 'vitest';
import { classifyQuery, stripTags } from '../src/utils.js';
import { classify } from '../src/classify.js';
import { detectFastTerm } from '../src/fasting-match.js';

// ============================================
// classifyQuery
// ============================================

describe('classifyQuery', () => {

  // --- Image ---
  it('image with no text → label_scan', () => {
    expect(classifyQuery('', true)).toContain('label_scan');
  });

  it('image with text → label_scan included', () => {
    const result = classifyQuery('is this safe?', true);
    expect(result).toContain('label_scan');
  });

  // --- Restaurant ---
  it('"restaurant near me" → restaurant', () => {
    expect(classifyQuery('restaurant near me', false)).toContain('restaurant');
  });

  it('"where to eat in chicago" → restaurant', () => {
    expect(classifyQuery('where to eat in chicago', false)).toContain('restaurant');
  });

  it('"find jain food nearby" → restaurant', () => {
    expect(classifyQuery('find jain food nearby', false)).toContain('restaurant');
  });

  // --- Substitution ---
  it('"substitute for onion" → substitution', () => {
    expect(classifyQuery('substitute for onion', false)).toContain('substitution');
  });

  it('"what can I use instead of garlic" → substitution', () => {
    expect(classifyQuery('what can I use instead of garlic', false)).toContain('substitution');
  });

  // --- Medicine ---
  it('"is my vitamin safe" → medicine', () => {
    expect(classifyQuery('is my vitamin safe', false)).toContain('medicine');
  });

  it('"can I take this supplement" → medicine', () => {
    expect(classifyQuery('can I take this supplement', false)).toContain('medicine');
  });

  it('"is this capsule jain safe" → medicine', () => {
    expect(classifyQuery('is this capsule jain safe', false)).toContain('medicine');
  });

  // --- Fasting (English keywords) ---
  it('"I am fasting today" → fasting', () => {
    expect(classifyQuery('I am fasting today', false)).toContain('fasting');
  });

  it('"paryushan is coming up" → fasting', () => {
    expect(classifyQuery('paryushan is coming up', false)).toContain('fasting');
  });

  it('"ekadashi tomorrow" → fasting', () => {
    expect(classifyQuery('ekadashi tomorrow', false)).toContain('fasting');
  });

  // --- Fasting (fuzzy match via detectFastTerm) ---
  it('"porsee" → fasting via fuzzy match', () => {
    expect(classifyQuery('porsee', false)).toContain('fasting');
  });

  it('"ayambhil" → fasting via fuzzy match', () => {
    expect(classifyQuery('ayambhil', false)).toContain('fasting');
  });

  it('"pachkhan" → fasting via fuzzy match', () => {
    expect(classifyQuery('pachkhan', false)).toContain('fasting');
  });

  it('Gujarati "પચ્ચક્ખાણ" → fasting', () => {
    expect(classifyQuery('પચ્ચક્ખાણ', false)).toContain('fasting');
  });

  // --- Calendar ---
  it('"what tithi is today" → calendar', () => {
    expect(classifyQuery('what tithi is today', false)).toContain('calendar');
  });

  it('"sunset in chicago" → calendar', () => {
    expect(classifyQuery('sunset in chicago', false)).toContain('calendar');
  });

  it('"what time is sunrise" → calendar', () => {
    expect(classifyQuery('what time is sunrise', false)).toContain('calendar');
  });

  // --- General fallback ---
  it('"is tofu safe" → general', () => {
    expect(classifyQuery('is tofu safe', false)).toContain('general');
  });

  it('empty text, no image → general', () => {
    expect(classifyQuery('', false)).toContain('general');
  });

  it('null text → general', () => {
    expect(classifyQuery(null, false)).toContain('general');
  });

  // --- Multi-type ---
  it('"substitute for onion during my fast" → substitution + fasting', () => {
    const result = classifyQuery('substitute for onion during my fast', false);
    expect(result).toContain('substitution');
    expect(result).toContain('fasting');
  });

  it('"restaurant near me, I am fasting" → restaurant + fasting', () => {
    const result = classifyQuery('restaurant near me, I am fasting', false);
    expect(result).toContain('restaurant');
    expect(result).toContain('fasting');
  });

  // --- No duplicates ---
  it('returns no duplicate keys', () => {
    const result = classifyQuery('substitute for onion during my fast', false);
    expect(result.length).toBe(new Set(result).size);
  });
});

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

  it('"I\'m flexible" → profile_update', () => {
    const r = classify("I'm flexible");
    expect(r.journey).toBe('profile_update');
    expect(r.params.strictness_level).toBe('flexible');
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
