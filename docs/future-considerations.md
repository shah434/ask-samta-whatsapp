# Future Considerations

## Prompt Behavior Test Suite

Deferred until activity warrants the cost. Estimated ~$0.07/run with prompt caching, ~$0.22/run without. Recommend triggering only when `src/prompts.js` or `src/utils.js` change (not on every push).

### Test cases to implement

**Strictness routing**
- No strictness set + strictness-sensitive query (potato, onion, E471) → dual "If strict / If flexible" format
- No strictness set + non-sensitive query (cabbage, ghee) → single verdict
- Strict / moderate / flexible users each get correct verdict for potato, brinjal, onion
- Note: dual format collapses moderate into flexible — worth monitoring for user confusion

**Jain vs BAPS cross-contamination**
- BAPS user: potato/carrot/mushrooms must be SAFE at all levels
- Jain strict user: same ingredients must be NOT SAFE
- BAPS user: fermented foods (idli, dosa) must be SAFE
- Jain user: "Ekadashi" must never appear; BAPS user: "tithi" must not be primary term
- Jain user mentions Paryushana: stricter rules apply even at flexible, family disclaimer appended

**Calendar / tithi awareness**
- TODAY_IS_TITHI: false → food verdict only, zero mention of tithi or fasting
- TODAY_IS_TITHI: true → food verdict + observance name + fast type question
- Upcoming event in calendar → must not be treated as today
- No calendar block in prompt → Claude must not infer tithi from training data
- BAPS calendar query → directs to baps.org/Calendar, no date calculation
- 7-day window: event 3 days out must appear in list, not trigger "No tithis in next 7 days"
- Today counts as day 1: event today must appear in the 7-day list

**Sunset / sunrise accuracy**
- Verbatim time from data block — no rounding (8:14 PM must not become 8:15 PM)
- No stored city, no city in message → ask before giving time
- Stored city present → use it and say so
- After sunset reply, "yes" from Jain user → routes to tithi check

**Fasting flow**
- Unknown fast type → numbered menu, no food verdict
- Bare "upvas" → UPVAS_MENU asking Chovihar or Tivihar
- "upvas chovihar" / "upvas tivihar" compound → correct rules directly, no sub-menu
- Picking option 1 → Upvas Chovihar rules + YouTube link
- Picking option 2 → Upvas Tivihar rules + YouTube link
- Named fast (ayambil, ekasan) → skip menu, apply rules + YouTube link directly
- Upvas food question → always NOT SAFE
- Ayambil: paneer must be NOT SAFE (no dairy)
- BAPS fasting: Ekadashi menu (Nirjala/Jalahar/Farari), not Jain menu
- BAPS farari: sabudana SAFE, rice NOT SAFE

**Label scanning**
- Gelatin → NOT SAFE all levels
- E120 → NOT SAFE all levels
- E471 → uncertain for strict/moderate, no flag for flexible
- Natural flavors → uncertain for strict/moderate, permitted for flexible
- Vitamin D3 → uncertain; Vitamin D2 → SAFE
- Jain user: potato starch in ingredients → flag; BAPS user → do NOT flag
- Unclear image → exact scripted response
- Dish photo: open with "The image looks to be of..." — no meta-commentary about it not being a label

**Medicine and supplements**
- Any prescription drug mention → non-negotiable disclaimer about not changing medication
- Gelatin capsule, no HPMC confirmation → flag uncertain, recommend vegetarian/tablet alternative
- HPMC capsule explicitly labelled → SAFE on capsule front
- Omega-3 / fish oil → NOT SAFE unless explicitly labelled algae-based
- Vitamin D3 → uncertain for strict/moderate; ask for lichen-sourced or D2 alternative
- Vitamin D2 → SAFE all levels
- Collagen supplement → NOT SAFE (animal-derived)
- Whey/casein protein → dairy, apply strictness rules; egg white protein → NOT SAFE
- Shellac (E904) coating on tablet → NOT SAFE
- Carmine (E120) in vitamin coating → NOT SAFE
- Photo of product front → Branch B (search by name) → medicine rules applied
- Photo of supplement label with ingredients visible → Branch A → medicine rules applied
- Magnesium stearate → flag for strict users as uncertain

**Response continuity**
- Short reply ("sure", "yes") after tithi response ending with `?` → clarifying question, not food journey
- Short reply after food response ending with `?` → "What would you like to know?"
- Short reply after upcoming-tithis list → clarifying: pachkhan or food check
- Specific follow-up ("what can I eat on Chaudas") → routes to food directly, no interruption

**Restaurant flow**
- Google results provided → format includes name, address, phone, rating, open status
- No Google results → exact scripted location ask, no extra tips
- New city in message → [CITY_UPDATE:] tag in raw response, stripped from user-facing text
- Jain: shared fryer and onion/garlic in sauces flagged; BAPS: root veg not flagged

**Response format**
- General dietary questions: 3 lines max, verdict first
- SAFE verdict: no follow-up offer
- NOT SAFE on packaged food: offer label scan
- Label scan not safe: offer substitution
- Bare topic words ("sunset", "label", "pachkhan"): exact scripted clarifying question, no "Jai Jinendra" opener

---

## Future Use Cases

### Restaurant Menu Scan (photo)
**Status: not started — ~2-3 days for MVP**

User sends a photo of a restaurant menu page. Bot returns 3-5 safe dish picks and 1-2 things to ask the server.

Complexity:
- Menus are unstructured (no ingredient list) — bot must infer ingredients from dish name + cuisine
- Hidden ingredients (garlic in sauce, egg wash on naan, bone broth) — can flag likely risks but can't confirm
- Response length: 30+ dishes need smart filtering, not a wall of text
- Multi-page menus require multiple WhatsApp messages (one image at a time)
- "Ask the restaurant" script needed for uncertain dishes

Recommended phased approach:
1. Single dish name check (text) — already works today
2. "Safe picks" from one menu photo — ~2-3 days, covers 80% of use case
3. Full audit with confidence levels + ask-the-waiter script — ~1 week
4. Multi-page menu — complex, ~2 weeks

### Time-Aware "What Can I Eat Now?"
**Status: not started — ~1 day**

If it's 7pm and user is on Ekasan, bot already knows their fast type and the local sunset time — should answer "nothing more today, your one meal window has passed" without the user needing to ask two questions. Requires combining pending fast state with live sunset data per user.

### Paryushana Planner
**Status: not started — ~2 days**

8-10 day guided breakdown during Paryushana (Bhadrapad month). Each day has distinct rules (Samvatsari, Atthai progression, etc.). High emotional value, used intensely once a year, no good digital equivalent exists. Could be a static code-driven flow like the fasting menu — no Claude needed if rules are deterministic.

### Daily Check-In (opt-in push)
**Status: not started — ~1 day**

Morning cron message for opted-in users: "Today is Ayambil. Your sunset in Brooklyn is 8:17pm." Zero user effort, high retention value. Requires an opt-in flag in the users table and a cron job in wrangler.toml.

### Fast Streak Tracking
**Status: not started — ~1 day**

"I've done 12 Ayambils this year." Personal data the user owns, creates a reason to keep messaging. Requires a counter column per fast type in the users table.

### Guest/Hosting Mode
**Status: not started — low complexity**

"I'm hosting dinner for non-Jain guests, what can I make that works for everyone?" Reverse of the normal use case. Could be prompt-only — no new infrastructure needed, just a use case block in prompts.js.

### Kid-Friendly Explanations
**Status: not started — prompt-only**

"Explain Paryushana to my 8-year-old." The community is multigenerational. A dedicated prompt instruction for simplified language when the user mentions a child or young person. Prompt-only change, no infrastructure.

### Travel Eating Guide
**Status: not started — ~1 day**

"I'm in Nashville for 3 days, what should I watch out for?" Combines location awareness with Jain dietary rules for an unfamiliar city. Could reuse the restaurant finder for local options + a prompt block for regional cuisine risks.
