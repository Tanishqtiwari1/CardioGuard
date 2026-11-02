// Run with: node --test Frontend/src/services/sos.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeCard, encodeCard, formatElapsed, latestResults, mapPinUrl, normalizePhone, smsUrl, whatsappUrl } from './sos.js';

test('phone numbers are normalised for WhatsApp and SMS', () => {
  assert.equal(normalizePhone('98765 43210'), '919876543210');
  assert.equal(normalizePhone('098765-43210'), '919876543210');
  assert.equal(normalizePhone('+1 415 555 2671'), '14155552671');
  assert.equal(normalizePhone('12345'), null);
  assert.equal(normalizePhone(''), null);
});

test('message links escape the text', () => {
  assert.equal(whatsappUrl('919876543210', 'a b&c'), 'https://wa.me/919876543210?text=a%20b%26c');
  assert.equal(smsUrl('919876543210', 'a b'), 'sms:+919876543210?&body=a%20b');
  assert.equal(mapPinUrl({ lat: 28.6, lon: 77.2 }), 'https://maps.google.com/?q=28.600000,77.200000');
});

test('ER card survives the QR link, including Hindi text', () => {
  const results = { c: { p: 73.9, b: 'HIGH', d: '2026-10-05T00:00:00' } };
  const data = encodeCard({ name: 'सुनीता देवी', age: 66, sex: 'Female', medicines: 'Metformin 500 mg', allergies: 'Penicillin', conditions: 'Diabetes' }, results, 1800000000000);
  assert.match(data, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeCard(data), { name: 'सुनीता देवी', age: 66, sex: 'Female', medicines: 'Metformin 500 mg', allergies: 'Penicillin', conditions: 'Diabetes', symptomAt: 1800000000000, results });
});

test('a damaged card is rejected, not shown as data', () => {
  assert.equal(decodeCard('%%%not-valid'), null);
  assert.equal(decodeCard('bnVsbA'), null);
});

test('latest results keep only what the card needs', () => {
  assert.equal(latestResults([], []), null);
  const results = latestResults([{ risk_probability: 73.9, risk_category: 'HIGH', created_at: 'x', form_data: { chol: 1 } }], []);
  assert.deepEqual(results, { c: { p: 73.9, b: 'HIGH', d: 'x' } });
});

test('timer format', () => {
  assert.equal(formatElapsed(65000), '01:05');
  assert.equal(formatElapsed(3725000), '1:02:05');
  assert.equal(formatElapsed(-5), '00:00');
});
