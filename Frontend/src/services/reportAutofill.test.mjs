// Run with: node --test Frontend/src/services/reportAutofill.test.mjs
// Synthetic report text in common Indian lab / cardiology layouts (no real patients).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ageFromBirthDate, parseCardiacFindings, parsePatientName, parseReport } from './reportParser.js';

const lines = (text) => text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);

test('reads the patient name from a lab report header, ignoring the doctor and lab', () => {
  const found = parseReport(`SUNRISE DIAGNOSTICS PVT LTD
Lab Name: Sunrise Diagnostics
Referred By: Dr. Anil Mehta
Patient Name : MR. RAJESH KUMAR SHARMA      Age/Sex : 54 Yrs / M
UHID: 2231187   Sample Collected: 12/11/2026
Total Cholesterol 236 mg/dL <200`);
  assert.equal(found.patient_name, 'Rajesh Kumar Sharma');
  assert.equal(found.age, 54);
  assert.equal(found.sex, 1);
  assert.equal(found.cholesterol, 236);
});

test('name variants: "Name:", "Pt. Name", titles and trailing fields', () => {
  assert.equal(parsePatientName(lines('Name: Mrs. Sunita Devi Age: 61 Years')), 'Sunita Devi');
  assert.equal(parsePatientName(lines('Pt. Name - Arjun Nair | MRN 55102')), 'Arjun Nair');
  assert.equal(parsePatientName(lines('Name of the Patient: Kavya R. Iyer (F)')), 'Kavya R. Iyer');
  assert.equal(parsePatientName(lines("Patient's Name : SMT. MEENA O'BRIEN")), "Meena O'Brien");
});

test('does not mistake other names for the patient', () => {
  assert.equal(parsePatientName(lines('Referred By: Dr. Anil Mehta\nConsultant: Dr Priya Rao\nLab Name: City Pathology')), undefined);
  assert.equal(parsePatientName(lines('Name of Test: Lipid Profile')), undefined);
  assert.equal(parsePatientName(lines('Patient Name: 123456')), undefined);
});

test('works out age from a date of birth only when unambiguous', () => {
  const today = new Date(2026, 10, 16); // 16 Nov 2026
  assert.equal(ageFromBirthDate('DOB: 25/12/1968', today), 57);      // day > 12: clearly day-first
  assert.equal(ageFromBirthDate('Date of Birth: 12/25/1968', today), 57); // month-first
  assert.equal(ageFromBirthDate('D.O.B 03/04/1970', today), 56);     // both readings agree
  assert.equal(ageFromBirthDate('DOB: 10/12/1970', today), undefined); // 10 Dec vs 12 Oct: different ages
  assert.equal(parseReport('Patient Name: Asha Rao\nDOB: 25/12/1968\nGender: Female').age, new Date().getFullYear() - 1968 - (new Date() < new Date(new Date().getFullYear(), 11, 25) ? 1 : 0));
});

test('reads a treadmill (TMT) report', () => {
  const found = parseReport(`TREADMILL TEST REPORT
Patient Name: Vikram Singh   Age: 62 Yrs   Sex: Male
Resting BP: 150/90 mmHg
Resting ECG: Normal sinus rhythm, within normal limits
Chest Pain: Typical angina on exertion
Max Heart Rate achieved: 128 bpm (80% of target)
Exercise induced angina: Present
ST segment depression of 2.1 mm in V4-V6, horizontal / flat ST segment
Impression: Test positive for inducible ischaemia`);
  assert.equal(found.patient_name, 'Vikram Singh');
  assert.equal(found.age, 62);
  assert.equal(found.sex, 1);
  assert.equal(found.systolic_bp, 150);
  assert.equal(found.restecg, 0);
  assert.equal(found.cp, 1);
  assert.equal(found.max_heart_rate, 128);
  assert.equal(found.exang, 1);
  assert.equal(found.oldpeak, 2.1);
  assert.equal(found.slope, 2);
});

test('reads ECG abnormalities and negatives', () => {
  assert.equal(parseCardiacFindings(lines('ECG: Sinus rhythm with LVH by voltage criteria')).restecg, 2);
  assert.equal(parseCardiacFindings(lines('Resting ECG: ST-T changes in lateral leads')).restecg, 1);
  assert.equal(parseCardiacFindings(lines('ECG: Abnormal')).restecg, undefined); // not specific enough
  assert.equal(parseCardiacFindings(lines('Exercise induced angina: No')).exang, 0);
  assert.equal(parseCardiacFindings(lines('Chest pain: Atypical angina')).cp, 2);
  assert.equal(parseCardiacFindings(lines('Chest Pain: Nil')).cp, 4);
  assert.equal(parseCardiacFindings(lines('Downsloping ST depression 1.5 mm')).slope, 3);
  assert.equal(parseCardiacFindings(lines('ST depression: Nil')).oldpeak, 0);
});

test('reads angiography and thallium findings', () => {
  const found = parseCardiacFindings(lines(`CORONARY ANGIOGRAPHY: Double vessel disease (LAD, RCA)
Myocardial perfusion (Thallium) SPECT: Reversible perfusion defect in inferior wall`));
  assert.equal(found.ca, 2);
  assert.equal(found.thal, 7);
  assert.equal(parseCardiacFindings(lines('Impression: TVD')).ca, 3);
  assert.equal(parseCardiacFindings(lines('Thallium scan: fixed defect, anterior wall')).thal, 6);
  assert.equal(parseCardiacFindings(lines('MPI: Normal myocardial perfusion')).thal, 3);
  assert.equal(parseCardiacFindings(lines('Vessels coloured by fluoroscopy: 1')).ca, 1);
});

test('ignores reference ranges and unlabelled numbers for the new fields', () => {
  const found = parseCardiacFindings(lines('ST depression 0.5-1.0 mm considered borderline\nNormal range for ECG intervals'));
  assert.equal(found.oldpeak, undefined);
  assert.equal(found.restecg, undefined);
});
