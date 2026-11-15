// Run with: node --test Frontend/src/services/emergencyProviders.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MEDULANCE, NATIONAL } from './emergencyProviders.js';

test('the number we dial is the number we show', () => {
  assert.equal(MEDULANCE.phone.replace(/\D/g, ''), MEDULANCE.phoneDisplay.replace(/\D/g, ''));
  assert.match(MEDULANCE.phone, /^\+91\d{10}$/);
});

test('Medulance links use https on medulance.com', () => {
  assert.match(MEDULANCE.bookingUrl, /^https:\/\/medulance\.com\//);
  assert.match(MEDULANCE.source, /^https:\/\/medulance\.com\//);
});

test('national numbers are 112 (emergency) and 108 (ambulance)', () => {
  assert.deepEqual(NATIONAL, { emergency: '112', ambulance: '108' });
});
