// Run with: node --test Frontend/src/services/reportParser.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseLipids, parseReport } from './reportParser.js';

test('reads a typical Indian lipid and sugar report', () => {
  const found = parseReport(`Age/Sex : 54 Yrs / M
Total Cholesterol 236 mg/dL <200
HDL Cholesterol 38 mg/dL >40
LDL Cholesterol 160 mg/dL <100
Cholesterol/HDL Ratio 6.2
Fasting Blood Sugar 132 mg/dL 70-100
HbA1c 7.1 % 4.0-5.6`);
  assert.deepEqual(found, { age: 54, sex: 1, cholesterol: 236, fasting_glucose: 132, hba1c: 7.1 });
});

test('reads vitals', () => {
  const found = parseReport('Vitals: BP 148/92 mmHg  Pulse: 84 /min\nHeight: 168 cm  Weight 74 kg\nGender: Female  Age: 61');
  assert.deepEqual(found, { systolic_bp: 148, diastolic_bp: 92, pulse: 84, height_cm: 168, weight_kg: 74, age: 61, sex: 0 });
});

test('converts mmol/L to mg/dL', () => {
  const found = parseReport('Glucose, Fasting (FPG) 6.4 mmol/L (3.9-5.5)\nCholesterol total 5.8 mmol/L');
  assert.equal(found.fasting_glucose, 115);
  assert.equal(found.cholesterol, 224);
});

test('reads maximum heart rate from a treadmill report', () => {
  assert.equal(parseReport('Max Heart Rate achieved: 142 bpm (85% of target)').max_heart_rate, 142);
});

test('never takes a value from the reference range', () => {
  // OCR missed the result: better to find nothing than to report "70".
  assert.equal(parseReport('Fasting Blood Sugar mg/dL 70-100').fasting_glucose, undefined);
  assert.equal(parseReport('Total Cholesterol mg/dL <200').cholesterol, undefined);
});

test('recovers a decimal point dropped by OCR in HbA1c', () => {
  assert.equal(parseReport('HbA1c 71 % 4.0-5.6').hba1c, 7.1);
});

test('ignores unrelated text', () => {
  assert.deepEqual(parseReport('Average stage page 3 of 4\nReference range 70-100'), {});
});

test('reads LDL and triglycerides for medicine context', () => {
  assert.deepEqual(parseLipids(`LDL Cholesterol 158 mg/dL <100
VLDL Cholesterol 32 mg/dL
Triglycerides 180 mg/dL <150
LDL/HDL Ratio 3.1`), { ldl: 158, triglycerides: 180 });
});

test('never takes a reference range as the LDL result', () => {
  assert.deepEqual(parseLipids('LDL Cholesterol <100 mg/dL'), {});
});
