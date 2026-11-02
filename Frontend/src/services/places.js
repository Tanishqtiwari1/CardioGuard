// Nearby healthcare providers from OpenStreetMap (real, openly licensed data; no API key).
//   Overpass API  -> hospitals, clinics and doctors around a point
//   Nominatim     -> turns a typed city / area / PIN code into coordinates
// Privacy: only a rounded location (~1 km) is sent to these services. The precise location
// stays in the browser and is used only to calculate distances. Nothing is stored.

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org';
// Open road routing (no key, no live traffic). During an SOS the location goes here at ~100 m precision.
const OSRM_URL = 'https://router.project-osrm.org';
const SOS_RADII_KM = [5, 10, 25];
const CARDIO_NAME = /cardi|heart|हृदय|दिल/i;
const CACHE_KEY = 'cardioguard_places_cache';

export const roundCoord = (value) => Math.round(value * 100) / 100;

export function distanceKm(a, b) {
  const rad = (deg) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

async function fetchJson(url, options, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function geocodeIn(query, countryCode) {
  const params = new URLSearchParams({ q: query, format: 'json', limit: '5', addressdetails: '0' });
  if (countryCode) params.set('countrycodes', countryCode);
  const results = await fetchJson(`${NOMINATIM_URL}/search?${params}`, { headers: { 'Accept-Language': 'en' } }, 15000);
  return results.map((item) => ({ lat: Number(item.lat), lon: Number(item.lon), label: item.display_name }));
}

// India first: a PIN code like 110001 also exists in other countries. Worldwide only if India has no match.
export async function geocode(query) {
  const inIndia = await geocodeIn(query, 'in');
  return inIndia.length ? inIndia : geocodeIn(query);
}

export async function reverseGeocode({ lat, lon }) {
  const params = new URLSearchParams({ lat: roundCoord(lat), lon: roundCoord(lon), format: 'json', zoom: '14' });
  try {
    const result = await fetchJson(`${NOMINATIM_URL}/reverse?${params}`, { headers: { 'Accept-Language': 'en' } }, 10000);
    return result.display_name?.split(',').slice(0, 3).join(',') || null;
  } catch {
    return null;
  }
}

function address(tags) {
  const parts = [
    [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' '),
    tags['addr:suburb'] || tags['addr:neighbourhood'],
    tags['addr:city'] || tags['addr:district'],
    tags['addr:postcode'],
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : tags['addr:full'] || null;
}

function cardiologyEvidence(tags) {
  const speciality = `${tags['healthcare:speciality'] || ''} ${tags['healthcare:speciality:en'] || ''}`;
  if (/cardio/i.test(speciality)) return 'listed';
  if (CARDIO_NAME.test(`${tags.name || ''} ${tags['name:en'] || ''}`)) return 'name';
  return 'unknown';
}

function kindOf(tags) {
  const value = tags.amenity || tags.healthcare;
  if (value === 'hospital') return 'hospital';
  if (value === 'doctors' || value === 'doctor') return 'doctor';
  return 'clinic';
}

function normalise(element) {
  const tags = element.tags || {};
  const lat = element.lat ?? element.center?.lat;
  const lon = element.lon ?? element.center?.lon;
  const name = tags.name || tags['name:en'];
  if (!name || lat === undefined) return null;
  const website = tags.website || tags['contact:website'] || tags.url || null;
  return {
    id: `${element.type}/${element.id}`,
    name,
    kind: kindOf(tags),
    cardiology: cardiologyEvidence(tags),
    speciality: tags['healthcare:speciality'] || null,
    lat,
    lon,
    address: address(tags),
    phone: tags.phone || tags['contact:phone'] || tags['contact:mobile'] || null,
    website,
    bookingUrl: tags['booking'] || tags['contact:booking'] || null,
    openingHours: tags.opening_hours || null,
    emergency: tags.emergency === 'yes',
    osmUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
  };
}

const KM_PER_DEGREE = 111.32;
const MEDICAL_TYPES = new Set(['hospital', 'clinic', 'doctors', 'doctor']);

// Nominatim result -> the same shape as an Overpass element, or null if it isn't a medical place.
export function fromNominatim(item) {
  if (!['amenity', 'healthcare'].includes(item.category) || !MEDICAL_TYPES.has(item.type)) return null;
  const place = item.address || {};
  return normalise({
    type: item.osm_type,
    id: item.osm_id,
    lat: Number(item.lat),
    lon: Number(item.lon),
    tags: {
      ...item.extratags,
      name: item.name,
      [item.category]: item.type,
      'addr:housenumber': place.house_number,
      'addr:street': place.road,
      'addr:suburb': place.suburb || place.neighbourhood,
      'addr:city': place.city || place.town || place.village || place.state_district,
      'addr:postcode': place.postcode,
    },
  });
}

// Fast, reliable lookup of named medical places inside a box around a point.
async function nominatimSearch(term, center, radiusKm) {
  const latSpan = radiusKm / KM_PER_DEGREE;
  const lonSpan = radiusKm / (KM_PER_DEGREE * Math.cos((center.lat * Math.PI) / 180));
  const params = new URLSearchParams({
    q: term,
    format: 'jsonv2',
    limit: '40',
    bounded: '1',
    extratags: '1',
    addressdetails: '1',
    viewbox: [center.lon - lonSpan, center.lat + latSpan, center.lon + lonSpan, center.lat - latSpan].map((value) => value.toFixed(3)).join(','),
  });
  const results = await fetchJson(`${NOMINATIM_URL}/search?${params}`, { headers: { 'Accept-Language': 'en' } }, 10000);
  return results.map(fromNominatim).filter((item) => item && distanceKm(center, item) <= radiusKm);
}

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// Used when Overpass is down. One request at a time, as Nominatim's usage policy asks.
async function nominatimProviders(center, radiusKm) {
  const found = new Map();
  let failures = 0;
  const terms = ['hospital', 'clinic', 'heart'];
  for (const [index, term] of terms.entries()) {
    if (index) await wait(1100);
    try {
      (await nominatimSearch(term, center, radiusKm)).forEach((item) => found.set(item.id, item));
    } catch {
      failures += 1;
    }
  }
  if (failures === terms.length) throw new Error('Place search unavailable');
  return [...found.values()];
}

function readCache() {
  try { return JSON.parse(sessionStorage.getItem(CACHE_KEY)) || {}; } catch { return {}; }
}

// Providers within radiusKm of a point. Results are cached for this browser tab only.
export async function searchProviders(center, radiusKm) {
  const lat = roundCoord(center.lat);
  const lon = roundCoord(center.lon);
  const radius = Math.round(radiusKm * 1000);
  const cacheKey = `${lat},${lon},${radius}`;
  const cache = readCache();
  if (cache[cacheKey]) return cache[cacheKey];

  const around = `(around:${radius},${lat},${lon})`;
  const query = `[out:json][timeout:25];(
    nwr["healthcare:speciality"~"cardio",i]${around};
    nwr["amenity"="hospital"]${around};
    nwr["healthcare"="hospital"]${around};
    nwr["amenity"="clinic"]${around};
    nwr["healthcare"="clinic"]${around};
    nwr["amenity"="doctors"]${around};
    nwr["healthcare"="doctor"]${around};
  );out center tags 300;`;
  let providers;
  try {
    const data = await fetchJson(OVERPASS_URL, { method: 'POST', body: new URLSearchParams({ data: query }) }, 12000);
    const seen = new Set();
    providers = data.elements.map(normalise).filter((item) => {
      if (!item || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  } catch {
    providers = await nominatimProviders({ lat, lon }, radiusKm);
  }
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ...cache, [cacheKey]: providers })); } catch { /* quota */ }
  return providers;
}

const EVIDENCE_RANK = { listed: 0, name: 1, unknown: 2 };

// Cardiology evidence first, then hospitals (which usually have a cardiology department), then distance.
export function rankProviders(providers, origin, sort = 'relevance') {
  const withDistance = providers.map((item) => ({ ...item, distanceKm: distanceKm(origin, item) }));
  return withDistance.sort((a, b) => {
    if (sort === 'distance') return a.distanceKm - b.distanceKm;
    if (sort === 'name') return a.name.localeCompare(b.name);
    return EVIDENCE_RANK[a.cardiology] - EVIDENCE_RANK[b.cardiology]
      || (a.kind === 'hospital' ? 0 : 1) - (b.kind === 'hospital' ? 0 : 1)
      || a.distanceKm - b.distanceKm;
  });
}

export function directionsUrl(destination, origin) {
  const params = new URLSearchParams({ api: '1', destination: `${destination.lat},${destination.lon}`, travelmode: 'driving' });
  if (origin?.manual) params.set('origin', `${origin.lat},${origin.lon}`);
  return `https://www.google.com/maps/dir/?${params}`;
}

const routePoint = ({ lat, lon }) => `${lon.toFixed(3)},${lat.toFixed(3)}`;

// Places whose names show they don't treat adult heart emergencies.
const NOT_FOR_HEART_EMERGENCY = /child|paediatric|pediatric|\bkids\b|maternity|mother|\bwomen|gynae|gyneco|\beye\b|nethra|netra|dental|\bent\b|veterinary|\banimal|psychiatr|mental|\bskin\b|derma|polyclinic|diagnostic|imaging|\bmri\b|pathology|\bdialysis\b|ayurved|homeo|physiotherapy|rehab/i;

export const suitsHeartEmergency = (provider) => !NOT_FOR_HEART_EMERGENCY.test(provider.name);

// Hospitals around a point, widening the search until suitable ones are found.
export async function nearbyHospitals(center) {
  const point = { lat: roundCoord(center.lat), lon: roundCoord(center.lon) };
  for (const radius of SOS_RADII_KM) {
    const hospitals = (await nominatimSearch('hospital', point, radius)).filter((item) => item.kind === 'hospital' && suitsHeartEmergency(item));
    if (hospitals.length) return hospitals;
  }
  return [];
}

// Puts hospitals with road times from `durations` first, fastest first.
export function rankByRoadTime(hospitals, durations = [], distances = []) {
  return hospitals
    .map((hospital, index) => ({ ...hospital, driveSeconds: durations[index] ?? null, driveMeters: distances[index] ?? null }))
    .sort((a, b) => (a.driveSeconds ?? Infinity) - (b.driveSeconds ?? Infinity) || a.distanceKm - b.distanceKm);
}

// The closest hospital in a straight line can be far by road, so compare actual routes.
export async function fastestHospitals(origin, limit = 3) {
  const hospitals = await nearbyHospitals(origin);
  const candidates = hospitals
    .map((item) => ({ ...item, distanceKm: distanceKm(origin, item) }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, 10);
  if (!candidates.length) return [];
  try {
    const points = [origin, ...candidates].map(routePoint).join(';');
    const table = await fetchJson(`${OSRM_URL}/table/v1/driving/${points}?sources=0&annotations=duration,distance`, {}, 12000);
    return rankByRoadTime(candidates, table.durations[0].slice(1), table.distances[0].slice(1)).slice(0, limit);
  } catch {
    return rankByRoadTime(candidates).slice(0, limit);
  }
}

export async function roadRoute(origin, destination) {
  const data = await fetchJson(`${OSRM_URL}/route/v1/driving/${routePoint(origin)};${destination.lon.toFixed(6)},${destination.lat.toFixed(6)}?overview=full&geometries=geojson`, {}, 12000);
  const route = data.routes?.[0];
  if (!route) throw new Error('No route found');
  return { points: route.geometry.coordinates.map(([lon, lat]) => [lat, lon]), seconds: route.duration, meters: route.distance };
}

export function specialtyLabel(provider) {
  if (provider.cardiology === 'listed') return 'Cardiology';
  if (provider.cardiology === 'name') return 'Likely cardiology (from name)';
  if (provider.kind === 'hospital') return 'Hospital · ask about cardiology';
  if (provider.kind === 'doctor') return provider.speciality ? `Doctor · ${provider.speciality.replace(/;/g, ', ')}` : 'Doctor · speciality not listed';
  return 'Clinic · ask about cardiology';
}
