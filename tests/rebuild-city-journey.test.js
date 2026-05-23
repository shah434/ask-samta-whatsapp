// ============================================
// rebuild-city-journey.test.js — claim/isolation logic for city journeys
// Run: npm test
// ============================================
// Tests cityJourneyClaims() — the rule that decides which journey owns a turn.
// The handler itself (handleCityJourney) calls network/WhatsApp/Claude and is
// tested live in WhatsApp, not here. This file locks the PENDING-ALWAYS-WINS
// rule that prevents one journey from hijacking another's pending flow.
// ============================================

import { describe, it, expect } from 'vitest';
import { cityJourneyClaims } from '../src/rebuild-city-journey.js';
import { serializePending } from '../src/pending.js';

const sunsetIntent = { journey: 'sunset', params: {}, prompt_blocks: ['calendar'] };
const restIntent = { journey: 'restaurant', params: {}, prompt_blocks: ['restaurant'] };
const foodIntent = { journey: 'food', params: {}, prompt_blocks: ['general'] };

const pendingSunset = { pending_action: serializePending({ need: 'city', intent: sunsetIntent }) };
const pendingRest = { pending_action: serializePending({ need: 'city', intent: restIntent }) };
const noPending = { pending_action: null };

describe('cityJourneyClaims — fresh requests', () => {
  it('fresh sunset → sunset gate claims', () => {
    expect(cityJourneyClaims(noPending, sunsetIntent, 'sunset')).toBe(true);
  });
  it('fresh restaurant → restaurant gate claims', () => {
    expect(cityJourneyClaims(noPending, restIntent, 'restaurant')).toBe(true);
  });
  it('fresh sunset → restaurant gate does NOT claim', () => {
    expect(cityJourneyClaims(noPending, sunsetIntent, 'restaurant')).toBe(false);
  });
  it('fresh food → neither city gate claims', () => {
    expect(cityJourneyClaims(noPending, foodIntent, 'sunset')).toBe(false);
    expect(cityJourneyClaims(noPending, foodIntent, 'restaurant')).toBe(false);
  });
});

describe('cityJourneyClaims — resume (pending owns the turn)', () => {
  it('pending sunset → sunset gate claims any reply', () => {
    expect(cityJourneyClaims(pendingSunset, foodIntent, 'sunset')).toBe(true);
  });
  it('pending restaurant → restaurant gate claims any reply', () => {
    expect(cityJourneyClaims(pendingRest, foodIntent, 'restaurant')).toBe(true);
  });
});

describe('cityJourneyClaims — PENDING ALWAYS WINS (no hijack)', () => {
  it('pending restaurant + fresh sunset intent → sunset gate does NOT claim', () => {
    expect(cityJourneyClaims(pendingRest, sunsetIntent, 'sunset')).toBe(false);
  });
  it('pending restaurant + fresh sunset intent → restaurant gate still claims', () => {
    expect(cityJourneyClaims(pendingRest, sunsetIntent, 'restaurant')).toBe(true);
  });
  it('pending sunset + fresh restaurant intent → restaurant gate does NOT claim', () => {
    expect(cityJourneyClaims(pendingSunset, restIntent, 'restaurant')).toBe(false);
  });
  it('pending sunset + fresh restaurant intent → sunset gate still claims', () => {
    expect(cityJourneyClaims(pendingSunset, restIntent, 'sunset')).toBe(true);
  });
});

describe('cityJourneyClaims — corrupt pending falls back to fresh', () => {
  it('corrupt pending_action is ignored; fresh intent decides', () => {
    const corrupt = { pending_action: '{not json' };
    expect(cityJourneyClaims(corrupt, sunsetIntent, 'sunset')).toBe(true);
    expect(cityJourneyClaims(corrupt, sunsetIntent, 'restaurant')).toBe(false);
  });
});
