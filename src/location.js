// ============================================
// location.js — Google Places and location detection
// ============================================

export async function searchRestaurants(communityQuery, location, env, coords = null) {
  // When precise GPS coordinates are available, omit the city name from the
  // text query and let locationBias do the geographic work. Including a city
  // name (e.g. "New York") pulls Google's ranking toward the city centre and
  // competes with the pin — nearby neighbourhood results get buried.
  const textQuery = coords
    ? `${communityQuery} vegetarian restaurant`
    : `${communityQuery} vegetarian restaurant ${location}`;

  const body = { textQuery, maxResultCount: 5 };
  if (coords) {
    body.locationBias = {
      circle: { center: { latitude: coords.lat, longitude: coords.lng }, radius: 8000 },
    };
    body.rankPreference = 'DISTANCE'; // sort by proximity to pin, not by Google relevance
  }

  console.log(`[places] restaurant query="${textQuery}" coords=${coords ? `${coords.lat.toFixed(4)},${coords.lng.toFixed(4)}` : 'none'} rank=${coords ? 'distance' : 'relevance'}`);

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
  console.log(`[places] restaurant status=${res.status} results=${data.places?.length ?? 0}`);
  return data.places || [];
}

export async function searchTemples(community, location, env, coords = null) {
  const category = community === 'baps'
    ? 'BAPS Swaminarayan mandir temple'
    : 'Jain temple derasar mandir';
  // Same principle: drop city name when coords are available.
  const textQuery = coords ? category : `${category} ${location}`;
  const body = { textQuery, maxResultCount: 5 };
  if (coords) {
    body.locationBias = {
      circle: { center: { latitude: coords.lat, longitude: coords.lng }, radius: 15000 },
    };
    body.rankPreference = 'DISTANCE';
  }

  console.log(`[places] temple query="${textQuery}" coords=${coords ? `${coords.lat.toFixed(4)},${coords.lng.toFixed(4)}` : 'none'} rank=${coords ? 'distance' : 'relevance'}`);

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
  console.log(`[places] temple status=${res.status} results=${data.places?.length ?? 0}`);
  return data.places || [];
}

