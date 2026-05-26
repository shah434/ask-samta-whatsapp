// ============================================
// rebuild-restaurant.js — v3.1 restaurant journey (thin; shared city core)
// ============================================
// Same shape as rebuild-sunset.js. Supplies only what's unique to restaurant:
// the ask-city prompt and how to answer once we have a resolved place.
// ============================================
import { cityJourneyClaims, handleCityJourney } from './rebuild-city-journey.js';
import { searchRestaurants, searchTemples } from './location.js';
import { sendMessage } from './whatsapp.js';

export function rebuildRestaurantClaims(user, intent, text) {
  return cityJourneyClaims(user, intent, 'restaurant', text);
}

function formatPlaces(results) {
  return results.slice(0, 5).map(p => {
    const name = p.displayName?.text || 'Unnamed';
    const addr = p.formattedAddress || '';
    const phoneNo = p.nationalPhoneNumber ? `\n📞 ${p.nationalPhoneNumber}` : '';
    const website = p.websiteUri ? `\n🌐 ${p.websiteUri}` : '';
    const rating = p.rating ? `⭐ ${p.rating}` : '';
    const open = p.regularOpeningHours?.openNow != null
      ? (p.regularOpeningHours.openNow ? ' | Open now' : ' | Closed now')
      : '';
    const ratingLine = (rating || open) ? `\n${rating}${open}` : '';
    return `*${name}*\n${addr}${phoneNo}${website}${ratingLine}`;
  }).join('\n\n');
}

async function answerRestaurant(phone, user, place, intent, env) {
  const isTemple = intent.params?.place_type === 'temple';
  const loc = user.city || [place.name, place.admin1, place.country].filter(Boolean).join(', ');

  if (isTemple) {
    const results = await searchTemples(user.community, loc, env);
    if (!results.length) {
      await sendMessage(phone, `I couldn't find any temples in ${loc} right now. Try searching "Jain center ${loc}" on Google Maps, or check jainworld.com 🙏`, env);
      return;
    }
    const label = user.community === 'baps' ? 'BAPS mandirs' : 'Jain temples';
    await sendMessage(phone, `Here are some ${label} near ${loc}:\n\n${formatPlaces(results)}\n\nCall ahead to confirm timings 🙏`, env);
    return;
  }

  const communityQuery = user.community === 'baps'
    ? 'BAPS Swaminarayan friendly'
    : 'Jain friendly';
  const results = await searchRestaurants(communityQuery, loc, env);

  if (!results.length) {
    await sendMessage(phone, `I couldn't find vegetarian-friendly spots in ${loc} right now. Try a nearby larger city 🙏`, env);
    return;
  }

  await sendMessage(phone, formatPlaces(results), env);
}

export async function handleRebuildRestaurant(phone, text, user, intent, env) {
  const isTemple = intent.params?.place_type === 'temple';
  return handleCityJourney(phone, text, user, intent, env, {
    name: 'restaurant',
    askCityPrompt: isTemple
      ? `Which city should I search for temples in? 🙏`
      : `Which city should I find restaurants in? 🙏`,
    answer: answerRestaurant,
  });
}
