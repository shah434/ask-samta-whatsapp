// ============================================
// location.js — Google Places and location detection
// ============================================

export async function searchRestaurants(communityQuery, location, env, coords = null) {
  const body = {
    textQuery: `${communityQuery} vegetarian restaurant ${location}`,
    maxResultCount: 5,
  };
  if (coords) {
    body.locationBias = {
      circle: { center: { latitude: coords.lat, longitude: coords.lng }, radius: 8000 },
    };
  }
  const res = await fetch(
    'https://places.googleapis.com/v1/places:searchText',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': env.GOOGLE_PLACES_KEY,
        'X-Goog-FieldMask': [
          'places.displayName',
          'places.formattedAddress',
          'places.rating',
          'places.userRatingCount',
          'places.regularOpeningHours',
          'places.nationalPhoneNumber',
          'places.websiteUri'
        ].join(',')
      },
      body: JSON.stringify(body),
    }
  );
  const data = await res.json();
  console.log('Google Places status:', res.status);
  console.log('Google Places response:', JSON.stringify(data).substring(0, 500));
  return data.places || [];
}

export async function searchTemples(community, location, env, coords = null) {
  const query = community === 'baps'
    ? `BAPS Swaminarayan mandir temple ${location}`
    : `Jain temple derasar mandir ${location}`;
  const body = { textQuery: query, maxResultCount: 5 };
  if (coords) {
    body.locationBias = {
      circle: { center: { latitude: coords.lat, longitude: coords.lng }, radius: 15000 },
    };
  }
  const res = await fetch(
    'https://places.googleapis.com/v1/places:searchText',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': env.GOOGLE_PLACES_KEY,
        'X-Goog-FieldMask': [
          'places.displayName',
          'places.formattedAddress',
          'places.rating',
          'places.regularOpeningHours',
          'places.nationalPhoneNumber',
          'places.websiteUri'
        ].join(',')
      },
      body: JSON.stringify(body),
    }
  );
  const data = await res.json();
  console.log(`[places] temple query="${query}" status=${res.status}`);
  return data.places || [];
}

