// Run with: node --test Frontend/src/services/places.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { directionsUrl, distanceKm, fromNominatim, geocode, rankByRoadTime, rankProviders, roundCoord, specialtyLabel, suitsHeartEmergency } from './places.js';

const origin = { lat: 28.6318, lon: 77.2194 };
const place = (id, kind, cardiology, lat, lon) => ({ id, name: id, kind, cardiology, lat, lon });

test('distance is about right (Connaught Place to India Gate ~2.4 km)', () => {
  assert.ok(Math.abs(distanceKm(origin, { lat: 28.6129, lon: 77.2295 }) - 2.33) < 0.2);
});

test('only an approximate location is sent to third parties', () => {
  assert.equal(roundCoord(28.631769), 28.63);
});

test('cardiology evidence ranks first, then hospitals, then distance', () => {
  const ranked = rankProviders([
    place('near clinic', 'clinic', 'unknown', 28.632, 77.22),
    place('far hospital', 'hospital', 'unknown', 28.70, 77.30),
    place('named heart centre', 'clinic', 'name', 28.66, 77.25),
    place('tagged cardiology', 'hospital', 'listed', 28.75, 77.35),
  ], origin);
  assert.deepEqual(ranked.map((item) => item.id), ['tagged cardiology', 'named heart centre', 'far hospital', 'near clinic']);
  assert.equal(rankProviders(ranked, origin, 'distance')[0].id, 'near clinic');
});

test('labels never overstate what the data says', () => {
  assert.equal(specialtyLabel({ kind: 'hospital', cardiology: 'listed' }), 'Cardiology');
  assert.equal(specialtyLabel({ kind: 'clinic', cardiology: 'name' }), 'Likely cardiology (from name)');
  assert.equal(specialtyLabel({ kind: 'hospital', cardiology: 'unknown' }), 'Hospital · ask about cardiology');
});

test('directions use the searched place as origin only for manual locations', () => {
  const destination = { lat: 28.64, lon: 77.18 };
  assert.ok(!directionsUrl(destination, { ...origin, manual: false }).includes('origin='));
  assert.ok(directionsUrl(destination, { ...origin, manual: true }).includes('origin=28.6318%2C77.2194'));
});

test('SOS ranks by road time, not straight-line distance', () => {
  const near = { id: 'near by air', distanceKm: 1 };
  const far = { id: 'fast by road', distanceKm: 3 };
  const unknown = { id: 'no route', distanceKm: 0.5 };
  const ranked = rankByRoadTime([near, far, unknown], [900, 300, null], [5000, 3000, null]);
  assert.deepEqual(ranked.map((item) => item.id), ['fast by road', 'near by air', 'no route']);
  assert.equal(ranked[0].driveSeconds, 300);
});

test('Nominatim results become providers, and non-medical matches are dropped', () => {
  const hospital = fromNominatim({
    category: 'amenity', type: 'hospital', name: 'Delhi Heart Institute', osm_type: 'way', osm_id: 7, lat: '28.6', lon: '77.2',
    extratags: { phone: '+91 11 1234', emergency: 'yes' }, address: { road: 'Ring Road', city: 'New Delhi', postcode: '110001' },
  });
  assert.equal(hospital.id, 'way/7');
  assert.equal(hospital.kind, 'hospital');
  assert.equal(hospital.cardiology, 'name');
  assert.equal(hospital.phone, '+91 11 1234');
  assert.equal(hospital.emergency, true);
  assert.equal(hospital.address, 'Ring Road, New Delhi, 110001');
  assert.equal(fromNominatim({ category: 'highway', type: 'bus_stop', name: 'Hospital Stop', lat: '1', lon: '1' }), null);
  assert.equal(fromNominatim({ category: 'amenity', type: 'hospital', lat: '1', lon: '1' }), null);
});

test('SOS leaves out places that do not treat adult heart emergencies', () => {
  for (const name of ["Kalawati Saran Children's Hospital", 'Guru Harkrishan Polyclinic', 'Mrs. Girdhar Lal Maternity Hospital', 'Goyal MRI & Diagnostic Centre', 'Sharma Eye Hospital', 'City Dental Hospital']) {
    assert.equal(suitsHeartEmergency({ name }), false, name);
  }
  for (const name of ['Dr. Ram Manohar Lohia Hospital', 'Sir Ganga Ram Hospital', 'Delhi Heart and Lung Institute', 'Dentonville General Hospital']) {
    assert.equal(suitsHeartEmergency({ name }), true, name);
  }
});

test('typed locations search India first, then worldwide', async () => {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const inIndia = String(url).includes('countrycodes=in');
    const pin = decodeURIComponent(String(url)).includes('110001');
    const body = inIndia && !pin ? [] : [{ lat: '28.63', lon: '77.21', display_name: inIndia ? 'New Delhi, India' : 'Abroad' }];
    return { ok: true, json: async () => body };
  };
  try {
    assert.equal((await geocode('110001'))[0].label, 'New Delhi, India');
    assert.equal(calls.length, 1);
    assert.equal((await geocode('Paris'))[0].label, 'Abroad');
    assert.equal(calls.length, 3);
  } finally {
    globalThis.fetch = original;
  }
});
