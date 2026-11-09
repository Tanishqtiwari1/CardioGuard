// Run with: node --test Frontend/src/services/medicineScan.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCalendarFile } from './medicineCalendar.js';
import { measureImage, qualityIssues } from './medicineScan.js';

function image(width, height, shade) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = shade(x, y);
      pixels.set([value, value, value, 255], (y * width + x) * 4);
    }
  }
  return measureImage(pixels, width, height);
}

const size = { width: 800, height: 600 };

test('a sharp, well lit photo passes', () => {
  assert.deepEqual(qualityIssues({ ...size, ...image(80, 60, (x) => (x % 4 < 2 ? 40 : 210)) }), []);
});

test('a flat, featureless photo counts as blurry', () => {
  assert.deepEqual(qualityIssues({ ...size, ...image(80, 60, () => 150) }), ['blurry']);
});

test('a dark photo is refused', () => {
  assert.deepEqual(qualityIssues({ ...size, ...image(80, 60, (x) => (x % 4 < 2 ? 5 : 40)) }), ['too_dark']);
});

test('a washed-out photo is refused', () => {
  assert.deepEqual(qualityIssues({ ...size, ...image(80, 60, () => 255) }), ['glare']);
});

test('a tiny photo is refused', () => {
  assert.deepEqual(qualityIssues({ width: 120, height: 90, brightness: 150, sharpness: 500, glare: 0 }), ['too_small']);
});

test('calendar file repeats each time and stops on the end date', () => {
  const file = buildCalendarFile({ id: 7, times: ['08:00', '21:00'], start_date: '2026-11-09', end_date: '2026-12-08' }, 'CardioGuard: Atorva 20 mg', new Date('2026-11-09T00:00:00Z'));
  assert.equal(file.match(/BEGIN:VEVENT/g).length, 2);
  assert.match(file, /DTSTART:20261109T210000/);
  assert.match(file, /RRULE:FREQ=DAILY;UNTIL=20261208T235959/);
  assert.match(file, /BEGIN:VALARM/);
});

test('calendar file supports specific days', () => {
  const file = buildCalendarFile({ id: 1, times: ['09:00'], days_of_week: [0, 4], start_date: '2026-11-09', end_date: null }, 'A', new Date('2026-11-09T00:00:00Z'));
  assert.match(file, /RRULE:FREQ=WEEKLY;BYDAY=MO,FR/);
});
