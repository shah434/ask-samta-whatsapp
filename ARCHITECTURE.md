# Samta — Architecture

## Overview

```
WhatsApp → worker.js → classify() → journey handler → Claude → WhatsApp
```

Every message goes through four stages: parallel I/O, early exits, journey dispatch, and handler execution.

---

## Stage 1 — Parallel I/O

Before any logic runs, three things fire simultaneously:

- Send a reaction (👍) to the message
- Load the user from KV (~5ms hit) or Supabase (~200ms on miss)
- Load the Jain calendar from KV cache

For images, the download also starts here and runs in parallel with everything else.

---

## Stage 2 — Early Exits

Handled before `classify()`. No Claude involved.

| Trigger | Response |
|---|---|
| `help` | Welcome message |
| Bare greeting | Welcome message |
| `delete me` | Confirmation flow (KV TTL + image meme) |
| Pending delete + any reply | Confirm or cancel deletion |
| Rate limit / spend cap | Block message |
| New user | Create row + welcome, then continue |

---

## Stage 3 — classify() → Journey Dispatch

`classify()` reads the text once and returns a structured intent:

```js
{ journey, params: { city_raw?, food_text?, fast_term?, sun_kind?, sun_date?, ... }, prompt_blocks: [] }
```

`worker.js` checks each journey's claim function in priority order:

| Priority | Journey | Handles |
|---|---|---|
| 1 | `sunset` | Sunset / sunrise time queries (today or tomorrow) |
| 2 | `restaurant` | Find places to eat |
| 3 | `city_update` | "my city is X", "I live in X" |
| 4 | `profile_update` | "make me strict", "I'm BAPS", pending strictness reply |
| 5 | `tithi` | Calendar / fast day questions |
| 6 | `routeFallback` | Ambiguous messages (≥3 chars) — Haiku re-routes to sunset or restaurant |
| 7 | fasting (code-driven) | Pachkhan menu, 1–7 picks, named fasts |
| 8 | stale pending clear | Nothing claimed it → user moved on → clear pending_action |
| 9 | **food** (catch-all) | Everything else, including images |

Each handler returns `true` if it handled the turn. `worker.js` returns 200 immediately after.

---

## Stage 4 — Inside Each Handler

### City journeys (sunset, restaurant, tithi, city_update)

All share one resolve/pending/resume core in `rebuild-city-journey.js`. Each journey supplies only its ask-city prompt and `answer()` function.

```
Fresh request with city_raw → geocode → save → answer
                              └ ambiguous → offer numbered picker → save on reply
Saved city, no city_raw     → answer directly (no re-asking)
No city anywhere            → store pending_action → ask
Next message is bare reply  → resume stored intent → answer
```

### Sunset handler (rebuild-sunset.js)

Detects `sun_date: 'tomorrow'` from classify and passes it to `getSunForPlace(place, date)`.
The sunrise-sunset.org API accepts a date param — today and tomorrow both work correctly.

### Food handler (rebuild-food.js)

```
Image → identifyProduct()
          ├ Branch A: ingredient label visible → send image to Claude
          └ Branch B: product front → Brave search → text call to Claude
Text  → straight Claude call

After Claude:
  → strip calendar markers
  → tithi claim guard (prevent hallucinated fasting claims)
  → strictness ask if needed (once per session via pending_action)
  → sendMessage
  → ctx.waitUntil: deferred history write to Supabase
```

### Profile update (rebuild-profile-update.js)

Direct Supabase write — no Claude involved. Handles:
- Fresh: "make me strict", "I'm BAPS"
- Pending resume: user replied 1/2/3 to the strictness question

### Fasting (code-driven in worker.js)

Flat lookup against `fasting-rules.js`. No Claude for any named fast (Upvas, Ayambil, Ekasan, etc.). Claude is only invoked if the user picks option 8 (complex fasts).

---

## Multi-Turn State

One column: `users.pending_action` (Supabase + KV mirror). Shape:

```js
{ need: 'city' | 'city_pick' | 'strictness' | 'fast_pick', intent, choices? }
```

- `readPending()` validates on every read. Returns `null` on any corruption → start fresh.
- `serializePending()` refuses unknown `need` values or journeys.
- A fresh classified intent always wins over any pending record.
- A bare reply ("London", "1", "strict") is claimed by whichever journey is currently pending.
- Any real food/question message that reaches the stale pending clear → pending is wiped.

---

## Storage

```
KV (fast, ~5ms)                  Supabase (source of truth, ~200ms)
────────────────────────         ──────────────────────────────────
user:{phone}                     users table (one row per phone)
jain_calendar_events               community, strictness, city, timezone,
ratelimit:{phone}:{date}           latitude, longitude, pending_action,
spend:{date}                       history_1_q/a … history_3_q/a,
pending_delete:{phone}             message_count
log:image:{timestamp}
```

`getUser` reads KV first. On miss, fetches Supabase and writes KV. `updateUser` always writes Supabase then merges into KV. City writes must go through `updateUser` — never KV-only.

Spend tracking is best-effort — KV has no atomic increment so concurrent requests can undercount. Thresholds are set conservatively ($8 image cap, $10 full cap) and the Anthropic billing alert is the real backstop.

---

## Prompt Cache

Two cache buckets, shared across all users of the same community:

```
Static (cached, 1h TTL):   CORE_IDENTITY + RULES_JAIN/BAPS + all USE_CASEs
Dynamic (never cached):    user profile, history (3 turns), calendar data, search snippets
```

Always sending all USE_CASEs in the static block means the cache key is identical for every Jain user regardless of query type. Cache reads cost ~10× less than regular input tokens.

`buildSystemPrompt(user, calendarData, sunData, searchSnippets)` — no `googleResults` param, restaurant handler builds its own output directly.

---

## File Map

```
worker.js                      Entry point. Dispatch only — no business logic.
src/
  classify.js                  Single classify() call. Returns structured intent.
  prompts.js                   All dietary rules and use case prompts. Edit here.
  utils.js                     buildSystemPrompt(). Two-block static/dynamic split.
  claude.js                    Anthropic API wrapper. Tracks daily spend in KV.
  database.js                  getUser / updateUser / createUser / deleteUser.
  whatsapp.js                  sendMessage / sendReaction / sendImage / getImageAsBase64.
  pending.js                   serializePending / readPending with validation.
  onboarding.js                DEFAULT_DIET, getWelcomeMessage, getStrictnessQuestion.
  calendar.js                  Jain ICS calendar fetch, KV cache, formatEventsForClaude.
  sunset.js                    Sunrise/sunset lookup. getSunForPlace(place, date?) accepts 'tomorrow'.
  location.js                  Google Places restaurant search.
  search.js                    identifyProduct (Claude vision) + searchProductIngredients (Brave).
  fasting-rules.js             Code-driven fasting rules. No Claude. rulesFor / rulesForNumber.
  fasting-match.js             Fuzzy matching for transliterated fast names.
  resolveLocation.js           Open-Meteo geocoder. Returns resolved / ambiguous / missing / error.
  route-fallback.js            Haiku re-router for ambiguous messages (skipped if text < 3 chars).
  rebuild-city-journey.js      Shared resolve/pending/resume core for city-needing journeys.
  rebuild-food.js              Food and image handler (catch-all).
  rebuild-sunset.js            Sunset journey. Passes sun_date param for tomorrow queries.
  rebuild-restaurant.js        Restaurant journey (thin wrapper over city-journey core).
  rebuild-tithi.js             Tithi/calendar journey (thin wrapper over city-journey core).
  rebuild-city-update.js       Explicit city-update journey ("my city is X").
  rebuild-profile-update.js    Strictness and community update (direct DB write, no Claude).
```
