# Samta — WhatsApp Jain Assistant

A WhatsApp bot that helps the Jain community navigate daily religious
practice — food safety, fasting, tithi, sunset times, and more.
Deployed on Cloudflare Workers at `asksamta.greenbitenyc.workers.dev`.

---

## What Samta Does

- **Dietary guidance** — checks if food, dishes, or ingredients are safe
- **Food label scanning** — reads ingredient lists from photos and flags concerns
- **Cosmetic and skincare scanning** — checks personal care product ingredients
- **Restaurant finder** — finds Jain-friendly restaurants nearby via Google Places
- **Fasting / pachkhan guidance** — Jain menu: Upvas Chovihar, Upvas Tivihar, Ekasan, Ayambil, Biyasan, Chauvihar, Tivihar, Navkarsi — each with a YouTube video link; bare "upvas" prompts a Chovihar/Tivihar sub-question; option 8 (complex fasts) handled by Claude
- **Jain tithi calendar** — live data from YJA calendar; today's observance, upcoming tithis with 7-day window, correct day names per timezone
- **Sunrise and sunset** — exact times for any city worldwide, today or tomorrow; offers tithi check after sunset reply
- **Ingredient substitution** — suggests community-compliant alternatives with exact ratios
- **Medicine and supplement checking** — text or photo; flags gelatin capsules, D3/lanolin source, omega-3, collagen, shellac, carmine, protein powder, probiotics; safe swap per flag; prescription medication disclaimer always included
- **Multi-language** — responds in the language the user writes in including Gujarati and Hindi
- **City memory** — remembers your city for sunset and restaurant queries

---

## Communities Supported

| Community | Strictness Levels |
|-----------|------------------|
| Jain | Strict, Moderate, Flexible |

---

## Stack

| Service | Purpose | Cost |
|---------|---------|------|
| WhatsApp Meta Cloud API | Messaging | Free |
| Cloudflare Workers | Bot infrastructure | Free |
| Supabase (PostgreSQL) | User database | Free |
| Anthropic Claude Sonnet | AI responses | ~$0.31/month |
| Google Places API | Restaurant finder | Free tier |
| Open-Meteo | Geocoding | Free |
| sunrise-sunset.org | Sun times | Free |
| YJA Google Calendar | Jain tithi calendar | Free |

**Total cost at pilot scale (50 msg/day): ~$0.31/month**

---

## Project Structure

```
worker.js                    — Main Cloudflare Worker handler (dispatch only)
wrangler.toml                — Cloudflare deployment config
.github/workflows/           — GitHub Actions auto-deploy
src/
  prompts.js                 — All dietary rules and use case prompts
  classify.js                — Single classify() call; returns structured intent
  database.js                — Supabase user management (getUser / updateUser)
  whatsapp.js                — Meta WhatsApp API functions
  claude.js                  — Anthropic API with prompt caching + spend tracking
  location.js                — Google Places restaurant search
  onboarding.js              — Welcome message and strictness question text
  utils.js                   — buildSystemPrompt() — static/dynamic two-block split
  calendar.js                — Jain ICS calendar fetch, KV cache, formatEventsForClaude
  sunset.js                  — Sunrise/sunset lookup (today + tomorrow)
  pending.js                 — serializePending / readPending with validation
  fasting-rules.js           — Code-driven fasting rules, menus, YouTube links
  fasting-match.js           — Fuzzy matching for transliterated fast names
  search.js                  — identifyProduct (vision) + searchProductIngredients (Brave)
  resolveLocation.js         — Open-Meteo geocoder
  reverseGeocode.js          — Reverse geocoding from coordinates
  route-fallback.js          — Haiku re-router for ambiguous messages
  rebuild-city-journey.js    — Shared resolve/pending/resume core for city journeys
  rebuild-food.js            — Food and image handler (catch-all)
  rebuild-sunset.js          — Sunset/sunrise journey
  rebuild-restaurant.js      — Restaurant journey
  rebuild-tithi.js           — Tithi/calendar journey
  rebuild-city-update.js     — Explicit city-update journey
  rebuild-profile-update.js  — Strictness and community update (no Claude)
```

---

## File Ownership

| File | Owner | Notes |
|------|-------|-------|
| worker.js | Core team | Main handler — touch carefully |
| src/prompts.js | Content team | Edit dietary rules and use cases here |
| src/fasting-rules.js | Content team | Fast menu text, rules, YouTube links |
| src/database.js | Core team | Supabase functions |
| src/whatsapp.js | Core team | Meta API functions |
| src/claude.js | Core team | Anthropic API with caching |
| src/location.js | Core team | Google Places integration |
| src/onboarding.js | Either | Welcome and strictness question text |
| src/utils.js | Core team | System prompt builder |
| src/calendar.js | Either | Jain calendar integration |
| src/sunset.js | Either | Sunrise/sunset integration |
| src/fasting-match.js | Either | Add new fast name variants here |

---

## Database Schema

Supabase `users` table:

```sql
phone_number       text    -- WhatsApp phone number
community          text    -- jain
strictness         text    -- strict | moderate | flexible
language           text    -- en | gu | hi | other
observance         text    -- none | ekadashi | paryushana | fasting
city               text    -- stored city for sunset/restaurant queries
message_count      integer -- total messages sent
history_1_q        text    -- most recent question
history_1_a        text    -- most recent answer
history_2_q        text    -- second most recent question
history_2_a        text    -- second most recent answer
history_3_q        text    -- third most recent question
history_3_a        text    -- third most recent answer
pending_action     text    -- validated JSON; shape: { need, intent, choices? }
```

---

## Key Features

### Fasting Menu
Options 1–7 are fully code-driven — no Claude involved:
1. Upvas Chovihar (no food, no water)
2. Upvas Tivihar (no food, boiled water allowed)
3. Ekasan, 4. Ayambil, 5. Biyasan, 6. Chauvihar, 7. Tivihar, 8. Navkarsi

Option 8 (complex / custom fasts) invokes Claude.
Each reply includes rules + a YouTube video link + elders disclaimer.
Typing bare "upvas" triggers a Chovihar/Tivihar sub-question.
Typing compound terms ("upvas chovihar") goes directly to the right rules.

### Response Continuity
Short follow-up replies ("sure", "yes", "ok") are handled with context:
- After tithi response ending with `?` → clarifying question
- After food response ending with `?` → "What would you like to know?"
- After sunset → "yes" routes to tithi check

### Prompt Caching
Static content (dietary rules, use cases) is cached by Anthropic.
Saves ~70% on Claude API costs for repeat users.

### Conversation Threading
Last 3 exchanges stored in Supabase and passed to Claude.
Enables natural follow-up questions without repeating context.

### City Memory
When a user provides a city for sunset or restaurant queries it is
stored in Supabase and reused automatically. Users can update anytime
by mentioning a new city.

---

## Updating Dietary Rules

All dietary rules and use cases live in `src/prompts.js`.
Fast menu text and YouTube links live in `src/fasting-rules.js`.
No infrastructure knowledge needed to update either.

```
1. Edit the file in GitHub
2. Commit with a clear message
3. GitHub Actions deploys in 30 seconds
4. Test on WhatsApp
```
