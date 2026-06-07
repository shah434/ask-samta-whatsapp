# Spec: WhatsApp Precise Location Sharing

## Context

Users currently provide their city by typing a name, which gets geocoded to lat/lng and stored. This is already good enough for tithi/sunset (city-level precision is all that's needed). For restaurant/temple searches the current code passes the city *string* to Google Places Text Search — meaning GPS precision doesn't help unless the search is also upgraded to use `locationBias`. This spec does both: accepts WhatsApp location pins AND upgrades the Places search to use coordinates when available.

Previously, `worker.js` rejected `type: "location"` messages with an error. That's been fixed.

**Status: Implemented.** Deployed to staging. Merge to main and `npx wrangler deploy` to ship to prod.

---

## Architectural facts that shape the design

1. `classify()` receives only a text string — never the message type. Location detection happens in `worker.js` **before** `classify()` is called. `classify.js` has no changes.
2. The `needsFreshPending` optimisation skips Supabase for non-food intents. Location messages bypass this — they always need the pending state (a city-ask may be in flight).
3. `handleCityJourney` resumes pending via `isBareReply(text)`. A location pin has `text = ''` so `isBareReply('')` → false. The `locationPin` path is checked **before** the `isBareReply` guard.
4. `searchRestaurants` / `searchTemples` previously used a plain text query string only. GPS coordinates improve results via `locationBias` passed to the Google Places API. Without this the "more precise results" promise would be false.

---

## The 4 Touchpoints

| # | When | Behaviour |
|---|------|-----------|
| 1 | **First-time city ask** (sunset / restaurant / tithi — no saved city) | Append share-location instructions to the "Which city?" prompt |
| 2 | **City update** (`city_update` journey — explicit "my city is X") | Append instructions; user can type OR share a pin |
| 3 | **Restaurant / temple response** | If city is saved: `locationBias` used automatically. If no city: append location-share instructions to the ask. |
| 4 | **Tithi / sunset city ask** | Same as touchpoint 1 |

---

## Failure paths — exact message text

| Scenario | Message user sees |
|---|---|
| Nominatim returns no city/town/village/county | `I had trouble reading your location — please type your city name 🙏🏾` |
| Nominatim or Open-Meteo network error | `I had trouble reading your location — please type your city name 🙏🏾` |
| Location pin arrives while non-city pending is active (e.g. strictness question) | Location saved silently, `pending_action` preserved so the in-flight question still works on next reply. Confirmation: `Got it — updated your location to {city} 🙏🏾` |
| User ignores location offer and types city instead | Normal text flow — no change needed |
| User shares location while traveling (overwrites home city) | Confirmation: `Got it — updated your location to {city} 🙏🏾` |

---

## How-to-share copy

```
Or share your exact location 📍
Tap the *+* or 📎 icon in WhatsApp → *Location* → *Share Current Location*
```

Appears appended to every "which city?" prompt and after every restaurant/temple response where no city is saved. Defined in `src/prompts.js` as `LOCATION_SHARE_INVITE` and `LOCATION_SHARE_FOR_RESULTS`.

---

## Implementation

### `src/reverseGeocode.js` (new file)

Converts GPS lat/lng into a place object via two **parallel** free API calls:

1. **Nominatim** — city name: `https://nominatim.openstreetmap.org/reverse?format=json&lat={lat}&lon={lng}`
   - Header: `User-Agent: SamtaAgent/1.0` (ToS requirement)
   - Name priority: `address.city → town → village → county` (never suburb or neighbourhood)
2. **Open-Meteo forecast** — timezone: `https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lng}&timezone=auto&forecast_days=0`

Returns `{ name, admin1, country, latitude, longitude, timezone }` or `null` on any failure.

### `worker.js`

- `'location'` added to allowed message types (was rejected before)
- Location messages skip `classify()` entirely; `needsFreshPending = true` always
- After greeting/delete guards: dispatches to the pending journey's handler (or `handleCityUpdate` for cold pins) with a synthetic intent carrying `locationPin: { lat, lng }`

### `src/rebuild-city-journey.js`

`locationPin` fast-path inserted at top of `handleCityJourney`, before `isBareReply`:
- Calls `reverseGeocode`; on failure sends error message and keeps pending
- If pending is a city ask for this journey: `saveCity` + `journey.answer` (using `pending.intent`, not the synthetic one)
- Otherwise (cold pin / non-city pending): saves lat/lng/city/timezone via `updateUser` **without touching `pending_action`**, sends confirmation

### `src/location.js`

`searchRestaurants(query, location, env, coords = null)` and `searchTemples(community, location, env, coords = null)` — when `coords` is provided, adds `locationBias: { circle: { center: { lat, lng }, radius: 8000 } }` to the Places request. Temples use 15km radius (Jain temples are rarer).

### `src/rebuild-restaurant.js`

Passes `{ lat: user.latitude, lng: user.longitude }` as `coords` when saved. Appends `LOCATION_SHARE_FOR_RESULTS` to all response messages (results, no-results, ask prompts) when no coords are saved.

### Prompt touchpoints

`rebuild-sunset.js`, `rebuild-tithi.js`, `rebuild-city-update.js` — `LOCATION_SHARE_INVITE` appended to `askCityPrompt` string in each handler.

---

## Data model

No new DB columns. Existing `latitude`, `longitude`, `city`, `timezone` fields hold GPS data identically to geocoded data. Precision comes from source (GPS vs geocoder), not schema.

---

## Files changed

| File | Change |
|---|---|
| `worker.js` | Allow `type: "location"`; skip classify; dispatch to journey handler |
| `src/reverseGeocode.js` | **New** — parallel Nominatim + Open-Meteo |
| `src/rebuild-city-journey.js` | `locationPin` fast-path; import reverseGeocode |
| `src/location.js` | `coords` + `locationBias` on both search functions |
| `src/rebuild-restaurant.js` | Pass coords; append location offer to all responses |
| `src/rebuild-sunset.js` | Append `LOCATION_SHARE_INVITE` to ask prompt |
| `src/rebuild-tithi.js` | Append `LOCATION_SHARE_INVITE` to ask prompt |
| `src/rebuild-city-update.js` | Append `LOCATION_SHARE_INVITE` to ask prompt |
| `src/prompts.js` | Add `LOCATION_SHARE_INVITE`, `LOCATION_SHARE_FOR_RESULTS` |

`classify.js` and `pending.js` — no changes.

---

## Verification

1. `npx vitest run` — all 121 tests pass, no regressions
2. `npx wrangler deploy --env staging` — deployed to `greenbite-staging.greenbitenyc.workers.dev`
3. Test on WhatsApp with a staging number:
   - Send "restaurants near me" (no city) → see location-share prompt → share pin → get results immediately
   - Send "sunset" (no city) → see location-share prompt → share pin → get sunset
   - Share a cold location pin (no pending) → see "Got it — updated your location to X"
   - Send "restaurants near me" (city already saved) → results appear with `locationBias` applied
   - Type a city name after seeing the location-share prompt → existing text flow still works
