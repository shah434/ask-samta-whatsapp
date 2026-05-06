// Billie v1.0
//============================================
//  Billie — WhatsApp Dietary Guidance Bot
// Cloudflare Worker
// ============================================

// ============================================
// CONFIGURATION — Replace with your values
// ============================================

const CONFIG = {
  anthropic_key: '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',
  whatsapp_token: 'EAAWqW2JOIkIBRIQexbZBIiNq6k7QwmR9MFpRsfofAPEz5frSZCOD174WztXhZAoLbIInSduNOXycJkw3pmdz535iE2oZB9V4htGyC20mnBnd0BE07nwrtkNkW56rl6ZC6mj6UKsFE6liCPp9YGHk9MoVBQpTDRlZAGkFNMlYoyZARhIClkvSMvmuLdycOU17AZDZD',
  phone_number_id: '1029188943619099',
  verify_token: 'vegcheck2026',
  supabase_url: 'https://uwezglqyfzrpeeogkjlv.supabase.co',
  supabase_key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV3ZXpnbHF5ZnpycGVlb2dramx2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5MzkzNjUsImV4cCI6MjA5MzUxNTM2NX0.G9MKDNfHPFkv4sNi3TLtolBUeNorWbJVFDwI_xXRWcc',
  google_places_key: 'AIzaSyA0Jsv1qBcuRzm_fEsrG3vwguzOn6xcbt8'
}; 

// ============================================
// PROMPT BLOCKS
// ============================================

const CORE_IDENTITY = `
You are Billie, a dietary and religious
calendar assistant for South Asian
Hindu communities. You help determine
if food is safe based on their profile.

CAPABILITIES:
1. Dietary guidance — food, dishes,
   ingredients, packaged products
2. Religious calendar — tithi, fast days,
   Ekadashi, sunset times

Not a religious authority. Defer edge
cases to community leaders.

RULES:
- Lead with ✅ SAFE / ❌ NOT SAFE / ⚠️ UNCERTAIN
- Keep responses short — this is WhatsApp
- Never guess on religious compliance
- Never assume a profile you lack
- Respond in the user's language
- Formulations change — recommend
  checking labels
- You are never the final word
- Defer if user corrects you
- Private chats only

FOLLOW-UP OFFERS (one max, only when useful):
⚠️/❌ + packaged food → offer label scan
❌ + label scan → offer substitution
fasting + no observance → 
  BAPS: offer Ekadashi check
  Jain: offer tithi/panchang check
⚠️ + brand mentioned → offer label scan
medicine + not ✅ → offer pharmacist script
Never offer on ✅. One offer. Question form.

PROFILE UPDATES:
If user explicitly asks to change profile
add on new line (never mention to user):
[STRICTNESS_UPDATE: strict/moderate/flexible]
[COMMUNITY_UPDATE: jain/baps]
Confirm change in plain language.

LOCATION QUERIES:
If user asks for nearby restaurants and
no Google results are in the prompt reply
with exactly this and nothing else:
"Which city or zip code are you in? "

OFF TOPIC QUERIES:
If the message has nothing to do with:
- Food safety or dietary guidance
- Religious fasting or observance
- Hindu/Jain calendar or tithi
- Finding community-friendly restaurants
- Ingredient or label scanning

Reply with exactly:
"I can only help with dietary guidance 
and religious calendar questions for 
Jain and BAPS communities. Try asking:
- Is [food] safe for me to eat?
- What can I eat during Ekadashi?
- Find Jain restaurants near me
- Scan this food label "

`;

const RULES_JAIN = `
JAIN DIETARY RULES (jainworld.com)

NEVER ACCEPTABLE:
Meat, fish, eggs, honey, alcohol

ONION AND GARLIC:
strict: ❌ all forms including powder, extract, flakes
moderate: ❌ all forms
flexible: ✅

OTHER ROOT VEGETABLES (potato, carrot, radish,
beetroot, turnip, leek, shallot, chive, yam,
fresh turmeric, fresh ginger, suran, vajra kand,
ratalu, pindalu):
strict: ❌
moderate: ✅
flexible: ✅

MULTI-SEEDED VEGETABLES (brinjal, figs, jackfruit,
pods of banyan/pipal/umbara):
strict: ❌
moderate: ⚠️ brinjal only
flexible: ✅

FUNGI/YEAST (mushrooms, yeast bread, fermented):
strict: ❌
moderate: ⚠️ brief note
flexible: ✅

SPROUTED PULSES:
strict: ❌
moderate/flexible: ✅

VINEGAR:
strict: ❌
moderate: ⚠️ brief note
flexible: ✅

STALE/DECAYED FOOD: ❌ all levels

EATING AFTER SUNSET:
strict: flag proactively
moderate: only if asked
flexible: never raise

E-NUMBERS:
TIER 1 — ALWAYS ❌:
E120 (cochineal), E542 (bone phosphate)

TIER 2 — STRICTNESS DEPENDENT:
strict: flag ALL as ⚠️
moderate: flag only E471, E631, E635, E920, E441, E904
flexible: do not flag

Full Tier 2: E153 E270 E322 E325 E326 E327 E422
E430-E436 E470a E470b E471 E472a-f E473-E483
E491-E495 E570 E572 E585 E631 E635 E640 E920

Key flags: E471 (mono/diglycerides), E631 (meat/fish),
E635 (fish), E920 (feathers/hair), E270 (lactic acid ⚠️),
E322 (lecithin ⚠️)

TIER 3 — ALL LEVELS ❌:
E441, E904, gelatin, isinglass
Rennet: must be microbial/vegetable ✅
Natural flavors: strict/moderate ⚠️, flexible ✅
Vitamin D3: strict/moderate ⚠️, flexible ✅
Vitamin D2: ✅ all levels

ACCEPTABLE ALL LEVELS:
Dairy (paneer, ghee, milk, yogurt, butter, cream) ✅
All grains and pulses (not sprouted for strict) ✅
Above-ground vegetables except multi-seeded ✅
Dried spices (turmeric powder, ginger powder) ✅

RESTAURANTS:
strict: ⚠️ default, list what to ask staff
moderate: flag onion/garlic/meat only
flexible: ✅ vegetarian restaurants, light note only

PARYUSHANA OVERRIDE (when mentioned):
Applies ON TOP of standard rules.
Green vegetables: many families avoid entirely
Root vegetables: no exceptions at any level
Fermented foods: ❌ entirely
Multi-seeded vegetables: ❌ strictly
Default: any borderline case → ⚠️
Always add: "Paryushana rules vary by family —
confirm with your community elders"
`;

const RULES_BAPS = `
BAPS SWAMINARAYAN DIETARY RULES
(Shikshapatri Verses 31, 60, 186)

NEVER ACCEPTABLE:
Meat, fish, eggs, poultry, seafood
Alcohol in any form

ONION AND GARLIC (tamasic, prohibited):
strict: ❌ all forms including powder,
extract, salt — scan sauces, spice blends
moderate: ❌ flag obvious sources
flexible: ✅

TEA AND COFFEE:
strict: ⚠️ if relevant
moderate/flexible: ✅

TOBACCO/DRUGS: ❌ all levels

ROOT VEGETABLES (potato, carrot, radish,
beetroot, turnip, yam, fresh ginger, turmeric):
✅ ALL levels — key difference from Jain

MUSHROOMS: ✅ ALL levels

E-NUMBERS: same tiers as Jain rules

ACCEPTABLE ALL LEVELS:
Dairy, all grains, all vegetables except
onion/garlic (strict/moderate), root veg ✅,
mushrooms ✅, sprouted pulses ✅,
fermented foods ✅

EKADASHI FARARI FOODS:
✅ Fruits, dairy, nuts, sabudana, samo,
rajgira, potatoes, sweet potato, cassava,
yam, most vegetables, sendha namak
❌ Wheat, rice, flour, dal, beans,
legumes, regular salt (strict)

BAPS VS JAIN KEY DIFFERENCES:
Root veg ✅ BAPS | ❌ Jain strict
Mushrooms ✅ BAPS | ❌ Jain
Fermented ✅ BAPS | ❌ Jain strict
`;

const USE_CASES = `
USE CASE: GENERAL DIETARY QUESTION
Lead with verdict. 2-3 lines max.
If message contains "this/it/that" with
no subject — ask one clarifying question.

USE CASE: FOOD LABEL / INGREDIENT SCAN
Applies to food, cosmetics, skincare,
supplements, medicine.
Order: state product, read ingredients
top to bottom, flag concerns, give verdict.

ALWAYS FLAG:
gelatin, rennet, cochineal, carmine, E120,
E441, E542, E904, E920, isinglass, lard,
suet, tallow, animal fat, natural flavors ⚠️,
honey, eggs, alcohol, wine, vinegar ⚠️,
onion/garlic any form, E471 ⚠️, Vitamin D3 ⚠️

COSMETICS — ALSO FLAG:
❌ carmine, keratin, collagen, lanolin,
gelatin, honey, beeswax, shellac, tallow,
silk, squalene (shark)
⚠️ glycerin, stearic acid, hyaluronic acid,
retinol, Vitamin D3, elastin

UNCLEAR IMAGE:
"I can't read this clearly. Send a clearer
photo or type the ingredients list."

USE CASE: RESTAURANT MENU
Format — three lists only:
SAFE / NOT SAFE / CHECK WITH RESTAURANT
Always end: "Inform staff of your dietary
requirements before ordering."

USE CASE: SUBSTITUTION
1. Why original is not compliant (one line)
2. 1-2 substitutes with exact ratios
3. Taste/texture difference
4. Ranked by South Asian grocery availability

Common: onion→hing (1/8 tsp per medium onion)
garlic→hing (1/8 tsp per 2 cloves)
gelatin→agar agar (1 tsp = 1 tbsp gelatin)
honey→jaggery (1:1)

USE CASE: MEDICINE/SUPPLEMENT
Most capsules use gelatin — not Jain safe.
HPMC capsules are vegetarian safe.
Always recommend asking pharmacist for
vegetarian capsule alternative.
NEVER advise skipping prescription medication.

USE CASE: FASTING
JAIN TYPES:
Upvas, Ekasana, Biyasana, Tivihar, Chauvihar
Key Jain observances: Paryushana, Samvatsari,
personal tithi-based fasts
Upvas: ❌ NO FOOD WHATSOEVER. Water only
or boiled water for strictest observers.
Never suggest any food during Upvas.

Ekasana: ONE meal only before sunset.
Full Jain rules apply to that meal.

Biyasana: TWO meals only before sunset.
Full Jain rules apply to both meals.

Tivihar: Nothing after sunset except
boiled water. Before sunset normal rules.

Chauvihar: Nothing after sunset including
water. Before sunset normal rules.

BAPS TYPES:
Ekadashi (11th lunar day, twice monthly)
Nirjala, Jalahar, Farari
Also: Nom, Punam, Chaturmas
Nirjala: ❌ NO food or water at all.
Jalahar: Water only. No food.
Farari: Permitted foods only.
❌ wheat, rice, flour, dal, beans,
regular salt
✅ fruits, dairy, nuts, sabudana, samo,
rajgira, potatoes, cassava, sendha namak

CRITICAL: Ekadashi is a BAPS observance.
Jain users observe tithi-based fasts —
never refer to Ekadashi for Jain users.
For Jain users use the term "tithi" instead.

If fast type unknown — ask before answering.
EXCEPTION: if stated in message answer directly.

CRITICAL: For Upvas and Nirjala —
never suggest any food is permitted.
The answer is always ❌ for any food question.

End with: "Your family's tradition may
differ — confirm with your community elders"

USE CASE: HINDU CALENDAR
For BAPS users:
- Primary fast day: Ekadashi (11th tithi)
- Direct to baps.org/Calendar for dates
- Key dates: Nom, Punam, Swaminarayan Jayanti,
  Janmashtami, Chaturmas

For Jain users:
- Use the term "tithi" not "Ekadashi"
- Key observances: Paryushana (Bhadrapad month),
  Samvatsari, personal tithi vows
- Direct to local Jain panchang for dates
- Never use the word Ekadashi for Jain users

USE CASE: LOCAL FOOD FINDER
If NEARBY RESTAURANT RESULTS are provided
format each as:
🏪 Name
📍 Address
📞 Phone number
⭐ Rating
🕐 Open now or closed
Ask staff: "Do you avoid onion and garlic
in any form including powder?"
End: "Call ahead to confirm dietary requirements"

If no results provided reply with only:
"Which city or zip code are you in? 🙏"

`;

// ============================================
// DATABASE FUNCTIONS (Supabase)
// ============================================

async function getUser(phone) {
  const res = await fetch(
    `${CONFIG.supabase_url}/rest/v1/users?phone_number=eq.${phone}&limit=1`,
    {
      headers: {
        apikey: CONFIG.supabase_key,
        Authorization: `Bearer ${CONFIG.supabase_key}`
      }
    }
  );
  const data = await res.json();
  console.log('Supabase getUser response:', JSON.stringify(data));
  console.log('Supabase status:', res.status);
  return data[0] || null;
}

async function createUser(phone) {
  const res = await fetch(
    `${CONFIG.supabase_url}/rest/v1/users`,
    {
      method: 'POST',
      headers: {
        apikey: CONFIG.supabase_key,
        Authorization: `Bearer ${CONFIG.supabase_key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify({ phone_number: phone })
    }
  );
  const data = await res.json();
  console.log('createUser response:', JSON.stringify(data));
  console.log('createUser status:', res.status);
  return data[0];
}

async function updateUser(phone, fields) {
  await fetch(
    `${CONFIG.supabase_url}/rest/v1/users?phone_number=eq.${phone}`,
    {
      method: 'PATCH',
      headers: {
        apikey: CONFIG.supabase_key,
        Authorization: `Bearer ${CONFIG.supabase_key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(fields)
    }
  );
}

async function saveHistory(phone, user, question, answer) {
  await updateUser(phone, {
    history_1_q: question,
    history_1_a: answer,
    history_2_q: user.history_1_q || '',
    history_2_a: user.history_1_a || '',
    history_3_q: user.history_2_q || '',
    history_3_a: user.history_2_a || ''
  });
}

// ============================================
// WHATSAPP FUNCTIONS
// ============================================

async function sendMessage(to, text) {
  await fetch(
    `https://graph.facebook.com/v18.0/${CONFIG.phone_number_id}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CONFIG.whatsapp_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text }
      })
    }
  );
}

async function sendReaction(to, messageId) {
  await fetch(
    `https://graph.facebook.com/v18.0/${CONFIG.phone_number_id}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CONFIG.whatsapp_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'reaction',
        reaction: {
          message_id: messageId,
          emoji: '🙏'
        }
      })
    }
  );
}

// ============================================
// GOOGLE PLACES
// ============================================

async function searchRestaurants(query, location) {
  const res = await fetch(
    'https://places.googleapis.com/v1/places:searchText',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': CONFIG.google_places_key,
        'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.regularOpeningHours,places.nationalPhoneNumber,places.websiteUri'
      },
      body: JSON.stringify({
        textQuery: `${query} vegetarian restaurant ${location}`,
        maxResultCount: 5
      })
    }
  );
  const data = await res.json();
  return data.places || [];
}

// ============================================
// LOCATION DETECTION
// ============================================

function detectLocation(text) {
  const lower = text.toLowerCase();
  
  // First check if this is even a location query
  const locationKeywords = [
    'restaurant', 'restaurants', 'find jain',
    'find baps', 'eat near', 'food near',
    'where can i eat', 'where to eat'
  ];
  
  const isLocationQuery = locationKeywords.some(k => lower.includes(k));
  if (!isLocationQuery) return null;

  // Only extract location if explicitly stated
  const locationPatterns = [
    /\bin\s+([a-zA-Z\s]{3,30})$/i,
    /\bnear\s+([a-zA-Z\s]{3,30})$/i,
    /\bin\s+(\d{5})\b/i,
    /\b([A-Z]{1,2}\d{1,2}\s?\d[A-Z]{2})\b/i
  ];

  for (const pattern of locationPatterns) {
    const match = text.match(pattern);
    if (match) {
      const location = (match[1] || match[0]).trim();
      // Ignore vague phrases
      if (['me', 'here', 'my area', 'nearby', 'near me'].includes(location.toLowerCase())) {
        return 'unknown';
      }
      return location;
    }
  }

  return 'unknown';
}

// ============================================
// CLAUDE API
// ============================================

async function callClaude(messages, system) {
  const res = await fetch(
    'https://api.anthropic.com/v1/messages',
    {
      method: 'POST',
      headers: {
        'x-api-key': CONFIG.anthropic_key,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        system,
        messages
      })
    }
  );
  const data = await res.json();
  return data.content[0].text;

async function callClaude(messages, system) {
  const res = await fetch(
    'https://api.anthropic.com/v1/messages',
    {
      method: 'POST',
      headers: {
        'x-api-key': CONFIG.anthropic_key,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        system,
        messages
      })
    }
  );
  const data = await res.json();
  console.log('Claude response status:', res.status);
  console.log('Claude response:', JSON.stringify(data));
  if (!data.content || !data.content[0]) {
    console.log('Claude returned no content');
    return 'Sorry, I could not process that request. Please try again. 🙏';
  }
  return data.content[0].text;
}
}

// ============================================
// ONBOARDING
// ============================================

function getOnboardingMessage(reason, user) {
  if (reason === 'new_user') {
    return `Hello friend! I'm Billie, your dietary guidance assistant for select Indian communities.

Which community are you part of?
1 — Jain
2 — BAPS Swaminarayan`;
  }

  if (reason === 'no_community') {
    return `Which community are you part of?
1 — Jain
2 — BAPS Swaminarayan`;
  }

  if (reason === 'no_strictness') {
    const community = user.community === 'jain' ? 'Jain' : 'BAPS';
    return `How strictly do you follow ${community} dietary rules?
1 — Strict (all rules without exception)
2 — Moderate (core rules, flexible on edge cases)
3 — Flexible (basic vegetarian rules)`;
  }
}

async function handleOnboarding(phone, user, text) {
  const input = text.trim();

  if (!user) {
    await createUser(phone);
    await sendMessage(phone, getOnboardingMessage('new_user'));
    return;
  }

  if (!user.community) {
    if (input === '1') {
      await updateUser(phone, { community: 'jain' });
      await sendMessage(phone, getOnboardingMessage('no_strictness', { community: 'jain' }));
    } else if (input === '2') {
      await updateUser(phone, { community: 'baps' });
      await sendMessage(phone, getOnboardingMessage('no_strictness', { community: 'baps' }));
    } else {
      await sendMessage(phone, getOnboardingMessage('no_community'));
    }
    return;
  }

  if (!user.strictness) {
    if (['1', '2', '3'].includes(input)) {
      const strictness = { '1': 'strict', '2': 'moderate', '3': 'flexible' }[input];
      await updateUser(phone, { strictness });
      const greeting = user.community === 'jain' ? 'Jai Jinendra 🙏' : 'Jai Swaminarayan 🙏';
      await sendMessage(phone, `${greeting} You're all set!

Send me a photo of any food label, a menu, or just ask if something is safe to eat.

You can also ask me:
- Is today Ekadashi?
- What can I eat during Paryushana?
- Find Jain restaurants near me
- What can I substitute for onion?`);
    } else {
      await sendMessage(phone, getOnboardingMessage('no_strictness', user));
    }
    return;
  }
}

// ============================================
// PROFILE UPDATE DETECTION
// ============================================

function parseProfileUpdate(text) {
  const strictnessMatch = text.match(/\[STRICTNESS_UPDATE:\s*(strict|moderate|flexible)\]/i);
  const communityMatch = text.match(/\[COMMUNITY_UPDATE:\s*(jain|baps)\]/i);

  return {
    strictness: strictnessMatch ? strictnessMatch[1] : null,
    community: communityMatch ? communityMatch[1] : null
  };
}

function stripTags(text) {
  return text
    .replace(/\[STRICTNESS_UPDATE:.*?\]/gi, '')
    .replace(/\[COMMUNITY_UPDATE:.*?\]/gi, '')
    .trim();
}

// ============================================
// BUILD SYSTEM PROMPT
// ============================================

function buildSystemPrompt(user, googleResults) {
  const rules = user.community === 'baps' ? RULES_BAPS : RULES_JAIN;
  const today = new Date().toDateString();

  const history = `
CONVERSATION HISTORY (most recent last):
Q1: ${user.history_3_q || ''} A1: ${user.history_3_a || ''}
Q2: ${user.history_2_q || ''} A2: ${user.history_2_a || ''}
Q3: ${user.history_1_q || ''} A3: ${user.history_1_a || ''}`;

  const profile = `
CURRENT USER PROFILE:
Community: ${user.community}
Strictness: ${user.strictness}
Language: ${user.language || 'en'}
Observance: ${user.observance || 'none'}
Today's date: ${today}`;

  const restaurants = googleResults && googleResults.length > 0
    ? `\nNEARBY RESTAURANT RESULTS: ${JSON.stringify(googleResults)}
RESTAURANT FORMATTING RULE: Format each restaurant as:
🏪 Name 📍 Address 📞 Phone ⭐ Rating
Ask staff: "Do you avoid onion and garlic in any form?"`
    : '';

  return CORE_IDENTITY + rules + USE_CASES + profile + history + restaurants;
}

// ============================================
// MAIN HANDLER
// ============================================

export default {
  async fetch(req) {

    // Handle Meta webhook verification
    if (req.method === 'GET') {
      const url = new URL(req.url);
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge');
      if (mode === 'subscribe' && token === CONFIG.verify_token) {
        return new Response(challenge, { status: 200 });
      }
      return new Response('Forbidden', { status: 403 });
    }

    // Handle incoming messages
    if (req.method === 'POST') {
      const body = await req.json();
      const message = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

      // Stop if no message (status updates etc)
      if (!message) return new Response('OK', { status: 200 });

      const phone = message.from;
      const messageId = message.id;
      const messageType = message.type;

  

      
      // Only handle text and image messages
      if (!['text', 'image'].includes(messageType)) {
        await sendMessage(phone, "I can only read text messages and food label photos. Please send a text question or a photo of a label. 🙏");
        return new Response('OK', { status: 200 });
      }

      const text = message.text?.body || message.image?.caption || '';

      // Send reaction immediately
      await sendReaction(phone, messageId);

    // ADD THESE DEBUG LINES
      console.log('Phone:', phone);
      console.log('Message type:', messageType);
      console.log('Text:', text);

      // Look up user
      let user = await getUser(phone);
      console.log('User found:', user);


      // Check if onboarding needed
      const needsOnboarding = !user || !user.community || !user.strictness;
      console.log('Needs onboarding:', needsOnboarding);


      if (needsOnboarding) {
        await handleOnboarding(phone, user, text);
        return new Response('OK', { status: 200 });
      }

      // Fully onboarded — handle message

      // Check for location query
      let googleResults = [];
      const location = detectLocation(text);

      if (location && location !== 'unknown') {
        const communityQuery = user.community === 'baps'
          ? 'BAPS Swaminarayan friendly'
          : 'Jain friendly';
        googleResults = await searchRestaurants(communityQuery, location);
      }

      // Handle image messages
      let claudeMessages = [];

 if (messageType === 'image') {
  try {
    console.log('Processing image...');
    console.log('Image ID:', message.image.id);
    
    // Get image URL from Meta
    const mediaRes = await fetch(
      `https://graph.facebook.com/v18.0/${message.image.id}`,
      { headers: { Authorization: `Bearer ${CONFIG.whatsapp_token}` } }
    );
    console.log('Media URL status:', mediaRes.status);
    const mediaData = await mediaRes.json();
    console.log('Media URL data:', JSON.stringify(mediaData));

    // Download image
    const imgRes = await fetch(mediaData.url, {
      headers: { Authorization: `Bearer ${CONFIG.whatsapp_token}` }
    });
    console.log('Image download status:', imgRes.status);
    
    const imgBuffer = await imgRes.arrayBuffer();
    console.log('Image buffer size:', imgBuffer.byteLength);
    
// Convert to base64 in chunks to avoid call stack overflow
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

const base64 = arrayBufferToBase64(imgBuffer);    console.log('Base64 length:', base64.length);
    
    const mimeType = message.image.mime_type || 'image/jpeg';

    claudeMessages = [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: mimeType,
            data: base64
          }
        },
        {
          type: 'text',
          text: text || 'Please scan this food label or product and check if it is safe for my diet.'
        }
      ]
    }];
    console.log('Image processed successfully');
  } catch (err) {
    console.log('Image processing error:', err.message);
    await sendMessage(phone, "I could not process that image. Please try sending a clearer photo or type out the ingredients list. 🙏");
    return new Response('OK', { status: 200 });
  }
}

      // Build system prompt
      const system = buildSystemPrompt(user, googleResults);
      {
  console.log('History 1 Q:', user.history_1_q);
  console.log('History 1 A:', user.history_1_a);}

      // Call Claude
      const response = await callClaude(claudeMessages, system);

      // Parse profile updates
      const updates = parseProfileUpdate(response);
      const cleanResponse = stripTags(response);

      // Apply profile updates if any
      if (updates.strictness || updates.community) {
        await updateUser(phone, {
          ...(updates.strictness && { strictness: updates.strictness }),
          ...(updates.community && { community: updates.community })
        });
      }

      // Send response
      await sendMessage(phone, cleanResponse);

      // Save history
      await saveHistory(phone, user, text, cleanResponse);

      return new Response('OK', { status: 200 });
    }

    return new Response('Method not allowed', { status: 405 });
  }
};
