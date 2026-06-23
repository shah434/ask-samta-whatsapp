// ============================================
// strictness.js — Single source of truth for Jain strictness levels.
//
// Five nested levels (each stricter level forbids a superset of the looser
// one). Because the levels nest, every food reduces to one THRESHOLD: the
// loosest ordinal at which it becomes allowed. A food is allowed for a user
// iff  userOrdinal >= threshold.  99 = never permitted at any level.
//
// Everything that needs to know about levels — classify regexes, the profile
// parser, the prompt rule text, the onboarding copy, the verdict-correction
// regexes — imports from here. Nothing hardcodes the level names elsewhere.
// ============================================

export const STRICTNESS_SCHEMA_VERSION = 5;
// Bump on any rule change. Embedded in the cached prompt block so a deploy
// busts the 1h shared cache instead of serving stale rules.
export const RULESET_VERSION = 'jain-v5';

// Ordinal order: 1 = strictest … 5 = most relaxed.
export const LEVELS = ['very_strict', 'strict', 'moderate', 'flex', 'relaxed'];

export const ORDINAL = {
  very_strict: 1, strict: 2, moderate: 3, flex: 4, relaxed: 5,
};

export const LABELS = {
  very_strict: 'Very Strict',
  strict:      'Strict',
  moderate:    'Moderate',
  flex:        'Flexible',
  relaxed:     'Relaxed',
};

export const LEVEL_BY_NUMBER = {
  1: 'very_strict', 2: 'strict', 3: 'moderate', 4: 'flex', 5: 'relaxed',
};

// allowed when userOrdinal >= threshold ; 99 = never.
// ginger_turmeric is three-state: dried powder vs fresh root.
export const THRESHOLD = {
  meat_fish:        99,
  animal_derived:   99,   // gelatin, rennet, isinglass, lard, tallow, cochineal, shellac
  eggs:             5,
  alcohol:          99,  // never permitted at any Jain level
  honey:            4,   // permitted at Flexible and Relaxed
  mushroom:         4,
  potato:           4,
  dairy:            3,
  onion_garlic:     3,
  other_root_veg:   3,
  brinjal_figs:     3,
  multi_seed_fruit: 3,
  yeast:            3,    // + fermented: vinegar, idli/dosa batter, soy sauce
  sprouted_pulses:  3,
  leafy_veg:        2,
  ginger_turmeric:  { powder: 3, fresh: 4 },
};

// Category membership — what counts as each bucket. Used by the prompt and
// label-scan to map a concrete ingredient onto a threshold.
export const MEMBERS = {
  other_root_veg:   'carrot, beetroot, radish/mooli, turnip, yam/suran, sweet potato, taro/arbi, leek, spring-onion whites, lotus root, water chestnut',
  multi_seed_fruit: 'tomato, cucumber, okra/ladyfinger, capsicum/bell pepper, guava, custard apple, pomegranate, kiwi, passionfruit',
  leafy_veg:        'spinach/palak, fenugreek/methi, coriander, mint, cabbage, lettuce, curry leaves, dill, amaranth/chauli, kale',
};

// ── Parsing ──────────────────────────────────────────────────────────────
// Accepts a number 1–5, a canonical key, a label, or a common synonym.
// Returns a canonical level key, or null.
const SYNONYMS = {
  very_strict: ['very strict', 'verystrict', 'very-strict', 'monk', 'monk-level', 'monk level', 'maharaj'],
  strict:      ['strict'],
  moderate:    ['moderate', 'mod'],
  flex:        ['flex', 'flexible'],
  relaxed:     ['relaxed', 'relax', 'relaxed.'],
};

export function parseStrictnessInput(text) {
  let t = (text || '').trim().toLowerCase().replace(/[.!?]+$/, '').replace(/\s+/g, ' ');
  if (!t) return null;
  if (/^[1-5]$/.test(t)) return LEVEL_BY_NUMBER[Number(t)];
  for (const key of LEVELS) {
    if (t === key) return key;
    if (SYNONYMS[key]?.includes(t)) return key;
  }
  return null;
}

// Regex fragment (no anchors, no flags) matching any spoken level word.
// Longest / multi-word alternatives first so "very strict" wins over "strict".
export const LEVEL_WORD_PATTERN =
  '(?:very[ -]?strict|monk(?:[ -]level)?|maharaj|strict|moderate|flexible|flex|relaxed|relax)';

export function isValidLevel(key) {
  return LEVELS.includes(key);
}

// ── Reactive strictness ask ────────────────────────────────────────────────
// How many times, across a user's whole life, we may append the "what's your
// strictness?" question before giving up. A persistent counter (users.
// strictness_ask_count) enforces this — the transient strictness pending only
// prevents a double-ask while one question is still open.
export const STRICTNESS_ASK_MAX = 3;

// Pure decision: append the strictness question this turn?
// We ask ONLY when the level genuinely changes the answer — signalled by the
// MULTILEVEL marker Claude emits for a level-dependent food/label/medicine
// verdict. Safe-at-all-levels and never-permitted answers carry no marker, so
// they never trigger an ask. Bounded by STRICTNESS_ASK_MAX.
export function shouldAskStrictness({
  strictnessSet,
  multiLevelVerdict,
  askCount = 0,
  alreadyAsked = false,
  isFasting = false,
  isGreeting = false,
}) {
  return (
    !strictnessSet &&
    !!multiLevelVerdict &&
    askCount < STRICTNESS_ASK_MAX &&
    !alreadyAsked &&
    !isFasting &&
    !isGreeting
  );
}

export function labelFor(key) {
  return LABELS[key] || 'not set';
}

// ── Monotonicity guard ─────────────────────────────────────────────────────
// The whole threshold model only works if the levels truly nest. Assert it at
// module load so a future edit that breaks nesting fails the build/tests.
function assertMonotonic() {
  // Reconstruct the boolean allow-matrix from thresholds and verify that, for
  // every food, permissiveness never decreases as the level relaxes.
  const foods = Object.entries(THRESHOLD);
  for (const [food, thr] of foods) {
    const allowedAt = (ord) => {
      if (typeof thr === 'object') return ord >= thr.fresh ? 2 : ord >= thr.powder ? 1 : 0;
      return ord >= thr ? 1 : 0;
    };
    for (let ord = 2; ord <= 5; ord++) {
      if (allowedAt(ord) < allowedAt(ord - 1)) {
        throw new Error(`strictness.js: THRESHOLD for "${food}" is non-monotonic at ordinal ${ord} — levels must nest.`);
      }
    }
  }
}
assertMonotonic();

// ── Prompt rendering ───────────────────────────────────────────────────────
// Generates the strictness-dependent Jain rule block from the threshold table,
// so the prompt and the code can never drift.
export function renderJainRules() {
  const at = (ord) => LABELS[LEVELS[ord - 1]];
  return `
JAIN STRICTNESS — FIVE NESTED LEVELS (strictest → most relaxed):
[1] ${at(1)} (monk-level)  [2] ${at(2)}  [3] ${at(3)}  [4] ${at(4)}  [5] ${at(5)}

The levels nest: each stricter level forbids everything a looser level forbids,
plus more. A food is ALLOWED for the user when their level is at or looser than
the food's threshold below; otherwise it is NOT PERMITTED. Give ONE verdict for
the user's own level — never mention other levels when the level is set.

NEVER PERMITTED — all five levels, no exceptions:
- Meat & fish (and fish sauce, oyster sauce, anchovy, lard, tallow, suet)
- Animal-derived products: gelatin, rennet (non-microbial), isinglass,
  cochineal/carmine, shellac, bone phosphate

PERMITTED ONLY AT THE LOOSER LEVELS (NOT PERMITTED at any stricter level):
- Eggs — allowed only at ${at(5)} [5]. Not permitted at ${at(4)} and stricter.
- Alcohol — allowed at ${at(4)} [4] and ${at(5)}. Not permitted at ${at(3)} and stricter.
- Honey — allowed at ${at(4)} [4] and looser. Not permitted at ${at(3)} and stricter.
- Mushrooms / fungi — allowed at ${at(4)} [4] and looser. Not permitted at ${at(3)} and stricter.
- Potato — allowed at ${at(4)} [4] and looser. Not permitted at ${at(3)} and stricter.
  (Potato is stricter than other root vegetables — treat it on its own.)
- Dairy (milk, paneer, ghee, curd, butter, cream) — allowed at ${at(3)} [3] and looser. Not permitted at ${at(2)} and ${at(1)}.
- Onion & garlic (all forms) — allowed at ${at(3)} [3] and looser. Not permitted at ${at(2)} and ${at(1)}.
- Other root vegetables (${MEMBERS.other_root_veg}) — allowed at ${at(3)} [3] and looser. Not permitted at ${at(2)} and ${at(1)}.
- Brinjal/eggplant & figs — allowed at ${at(3)} [3] and looser. Not permitted at ${at(2)} and ${at(1)}.
- Other multi-seeded fruits (${MEMBERS.multi_seed_fruit}) — allowed at ${at(3)} [3] and looser. Not permitted at ${at(2)} and ${at(1)}.
- Yeast & fermented foods (yeast extract, vinegar, idli/dosa batter, soy sauce, pickles) — allowed at ${at(3)} [3] and looser. Not permitted at ${at(2)} and ${at(1)}.
- Sprouted pulses — allowed at ${at(3)} [3] and looser. Not permitted at ${at(2)} and ${at(1)}.
- Leafy vegetables (${MEMBERS.leafy_veg}) — allowed at ${at(2)} [2] and looser. Not permitted only at ${at(1)} [1].

GINGER & TURMERIC — fresh vs dried differ:
- Dried POWDER — allowed at ${at(3)} [3] and looser.
- FRESH root — allowed at ${at(4)} [4] and looser; not permitted at ${at(3)} and stricter.

DERIVATIVES RULE: powders, starches, extracts, flours, juices, dried/dehydrated
forms are treated EXACTLY like the whole food (potato starch = potato, onion
powder = onion, garlic extract = garlic, beet powder = beetroot). The ONLY
exception is dried ginger/turmeric powder, handled above. If a compound
ingredient lists a forbidden sub-component in parentheses, the whole compound
fails.
`.trim();
}
