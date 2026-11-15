// Pulls clinical values out of the text of a lab, BP or ECG report.
// Works line by line: find a label, then take the first plausible number after it.

const MGDL_PER_MMOL_GLUCOSE = 18;
const MGDL_PER_MMOL_CHOLESTEROL = 38.67;

// The result is the first number after the label. Later numbers on the line are usually the
// reference range ("70-100"), so they are never used: a missing value is safer than a wrong one.
function firstNumberAfter(line, labelMatch) {
  // (?<![A-Za-z\d.]) skips digits inside words, e.g. the "1" in "(HbA1c) 5.8 %".
  const match = line.slice(labelMatch.index + labelMatch[0].length).match(/([<>≤≥]\s*)?(?<![A-Za-z\d.])(\d{1,3}(?:\.\d+)?)(\s*[-–]\s*\d)?/);
  // "<200" or "70-100" is a reference range, meaning the result itself wasn't read.
  if (!match || match[1] || match[3]) return undefined;
  return Number(match[2]);
}

function findValue(lines, label, { exclude, min, max, convert }) {
  for (const line of lines) {
    const match = line.match(label);
    if (!match || (exclude && exclude.test(line))) continue;
    const raw = firstNumberAfter(line, match);
    if (raw === undefined) continue;
    if (raw >= min && raw <= max) return raw;
    const converted = convert?.(line, raw);
    if (converted !== undefined) return converted;
  }
  return undefined;
}

export function parseReport(text) {
  const lines = text.split(/\r?\n/).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const all = lines.join('\n');
  const found = {};

  const bp = all.match(/(?:b\.?\s?p\.?|blood pressure)[^\d\n]{0,25}(\d{2,3})\s*\/\s*(\d{2,3})/i)
    || all.match(/\b(\d{2,3})\s*\/\s*(\d{2,3})\s*mm\s*hg/i);
  if (bp && Number(bp[1]) >= 70 && Number(bp[1]) <= 260 && Number(bp[2]) >= 40 && Number(bp[2]) < Number(bp[1])) {
    found.systolic_bp = Number(bp[1]);
    found.diastolic_bp = Number(bp[2]);
  } else {
    const systolic = findValue(lines, /systolic/i, { min: 70, max: 260 });
    if (systolic) found.systolic_bp = systolic;
  }

  const cholesterol = findValue(lines, /(?:total\s+)?cholesterol|\bs\.?\s?chol/i, {
    exclude: /hdl|ldl|vldl|ratio|non[-\s]?hdl/i,
    min: 80, max: 600,
    convert: (line, value) => (/mmol/i.test(line) && value >= 2 && value <= 15 ? Math.round(value * MGDL_PER_MMOL_CHOLESTEROL) : undefined),
  });
  if (cholesterol) found.cholesterol = cholesterol;

  const glucose = findValue(lines, /(?:fasting\s+(?:blood\s+|plasma\s+)?(?:glucose|sugar))|(?:glucose|sugar)[,\s-]*\(?\s*fasting|\bf\.?b\.?s\b|\bfpg\b/i, {
    min: 40, max: 600,
    convert: (line, value) => (/mmol/i.test(line) && value >= 2 && value <= 33 ? Math.round(value * MGDL_PER_MMOL_GLUCOSE) : undefined),
  });
  if (glucose) found.fasting_glucose = glucose;

  const hba1c = findValue(lines, /hba1c|hb\s?a1c|glyc(?:at|osyl)ated\s+ha?emoglobin|\ba1c\b/i, {
    min: 3, max: 20,
    // OCR often drops the decimal point ("7.1" read as "71").
    convert: (line, value) => (Number.isInteger(value) && value >= 30 && value <= 199 ? value / 10 : undefined),
  });
  if (hba1c) found.hba1c = hba1c;

  const maxHr = findValue(lines, /max(?:imum|\.)?\s*(?:heart\s*rate|hr)\b|peak\s*(?:heart\s*rate|hr)\b/i, { min: 60, max: 230 });
  if (maxHr) found.max_heart_rate = maxHr;

  const pulse = findValue(lines, /pulse(?:\s*rate)?|(?:resting\s+)?heart\s*rate|\bhr\b/i, { exclude: /max|peak|target/i, min: 30, max: 220 });
  if (pulse) found.pulse = pulse;

  const height = findValue(lines, /height/i, { min: 100, max: 230 });
  if (height) found.height_cm = height;
  const weight = findValue(lines, /weight/i, { min: 25, max: 250 });
  if (weight) found.weight_kg = weight;

  const ageSex = all.match(/age\s*\/\s*(?:sex|gender)\s*[:\-]?\s*(\d{1,3})\s*(?:y(?:ea)?rs?|y)?(?:\s*\d{1,2}\s*m(?:onths?)?)?(?:\s*\d{1,2}\s*d(?:ays?)?)?\s*\/\s*([mf])/i);
  const sexAge = all.match(/\b(male|female|m|f)\s*\/\s*(\d{1,3})\s*(?:y(?:ea)?rs?|y)\b/i);
  if (ageSex) {
    found.age = Number(ageSex[1]);
    found.sex = ageSex[2].toLowerCase() === 'm' ? 1 : 0;
  } else if (sexAge && Number(sexAge[2]) >= 1 && Number(sexAge[2]) <= 120) {
    found.age = Number(sexAge[2]);
    found.sex = sexAge[1].toLowerCase().startsWith('m') ? 1 : 0;
  } else {
    const age = findValue(lines, /\bage\b/i, { exclude: /average|stage|page/i, min: 1, max: 120 });
    if (age) found.age = age;
    const sex = all.match(/(?:sex|gender)\s*[:\-]?\s*(male|female|m\b|f\b)/i);
    if (sex) found.sex = sex[1].toLowerCase().startsWith('m') ? 1 : 0;
  }

  if (found.age === undefined) {
    const age = ageFromBirthDate(all);
    if (age !== undefined) found.age = age;
  }

  const name = parsePatientName(lines);
  if (name) found.patient_name = name;

  Object.assign(found, parseCardiacFindings(lines));
  return found;
}

// ---- Patient name ---------------------------------------------------------------------------
// Labels in order of reliability. "patient name\b" so "the patient named ..." (disclaimers) doesn't match.
const NAME_LABELS = [
  /(?:patient(?:'?s)?\s*name\b|pt\.?\s*name\b|name\s+of\s+(?:the\s+)?patient\b)\s*[:\-.]?\s*/i,
  /(?:customer|client|beneficiary)\s*name\b\s*[:\-.]?\s*/i,
  /^name\b\s*[:\-.]?\s*/i,
  /^prepared\s+for\b\s*[:\-.]?\s*/i,
];
// Fields that often follow the name on the same printed line.
const NAME_STOP = /\s+(?:age|sex|gender|uhid|mrn|id|patient\s*id|reg(?:istration)?|ref(?:\.|erred)?|date|dob|d\.o\.b|sample|lab|bill|visit|phone|mobile|contact|ward|bed|ipd|opd|collected|reported|barcode|booking|order|sid)\b.*$/i;
const NOT_A_PATIENT = /referr|ref\.?\s*by|consultant|doctor|physician|dr\.?\s*name|lab(?:oratory)?\s*name|hospital\s*name|centre|center|clinic\s*name|technician|signature/i;
const TITLES = /^(?:mr|mrs|ms|miss|mx|master|baby|shri|sri|smt|kumari|kum|km)(?:\.\s*|\s+)/i;
// A person's name doesn't contain these; sentences picked up by mistake usually do.
const NOT_NAME_WORDS = /\b(?:and|or|the|of|is|are|be|to|for|with|by|not|this|that|report|test|result|lab|hospital|diagnostic|pathology|clinic|summary|health|checkup|smart|details?|info|gender|age)\b/i;

function titleCase(name) {
  return name.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
}

function cleanName(raw) {
  let name = raw.replace(NAME_STOP, '').replace(/[|,;:]+.*$/, '').trim();
  name = name.replace(TITLES, '').replace(/\s*\(.*$/, '').trim();
  // Letters, spaces, dots, apostrophes and hyphens only; 2-60 characters; at most 5 words.
  if (!/^[A-Za-z][A-Za-z .'-]{1,59}$/.test(name) || (name.match(/[A-Za-z]/g) || []).length < 2) return undefined;
  if (name.split(/\s+/).length > 5 || NOT_NAME_WORDS.test(name)) return undefined;
  return name === name.toUpperCase() || name === name.toLowerCase() ? titleCase(name) : name;
}

export function parsePatientName(lines) {
  for (const label of NAME_LABELS) {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (NOT_A_PATIENT.test(line.split(/[:\-]/)[0])) continue;
      const match = line.match(label);
      if (!match) continue;
      const rest = line.slice(match.index + match[0].length).trim();
      // Label on its own line ("Prepared for" / "Priya Malhotra"): the name is on the next line.
      const name = cleanName(rest || lines[i + 1] || '');
      if (name) return name;
    }
  }
  return undefined;
}

// ---- Age from a date of birth ---------------------------------------------------------------
// Only used when the report prints no age. Ambiguous dates (03/04/1965) are used only when
// both day/month readings give the same age.
export function ageFromBirthDate(text, today = new Date()) {
  const match = text.match(/(?:d\.?o\.?b\.?|date\s+of\s+birth|birth\s*date)\s*[:\-]?\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/i);
  if (!match) return undefined;
  const [a, b, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const ageOn = (day, month) => {
    if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
    let age = today.getFullYear() - year;
    if (today.getMonth() + 1 < month || (today.getMonth() + 1 === month && today.getDate() < day)) age -= 1;
    return age >= 1 && age <= 120 ? age : undefined;
  };
  const dayFirst = ageOn(a, b);
  const monthFirst = ageOn(b, a);
  if (dayFirst !== undefined && (monthFirst === undefined || monthFirst === dayFirst)) return dayFirst;
  if (dayFirst === undefined && monthFirst !== undefined) return monthFirst;
  return undefined;
}

// ---- ECG / exercise-test / imaging findings (UCI codes used by the clinical model) ---------
const YES = /\b(?:yes|present|positive|\+ve|seen|noted|occurred)\b/i;
const NO = /\b(?:no|nil|none|absent|negative|-ve|not\s+(?:seen|noted|present))\b/i;

function afterLabel(line, label) {
  const match = line.match(label);
  return match ? line.slice(match.index + match[0].length) : null;
}

export function parseCardiacFindings(lines) {
  const found = {};
  for (const line of lines) {
    // Chest pain type: 1 typical angina, 2 atypical angina, 3 non-anginal, 4 none/asymptomatic.
    if (found.cp === undefined && /chest\s*pain|angina\s*type|presenting\s*complaint/i.test(line) && !/exercise|induced|during\s+(?:test|exercise)/i.test(line)) {
      if (/atypical\s+angina/i.test(line)) found.cp = 2;
      else if (/typical\s+angina/i.test(line)) found.cp = 1;
      else if (/non[-\s]?anginal/i.test(line)) found.cp = 3;
      else if (/asymptomatic|no\s+chest\s+pain|chest\s*pain\s*[:\-]?\s*(?:nil|none|no|absent)\b/i.test(line)) found.cp = 4;
    }
    // Resting ECG: 0 normal, 1 ST-T wave abnormality, 2 left ventricular hypertrophy.
    if (found.restecg === undefined && /\b(?:resting\s+)?(?:ecg|ekg|electrocardiogra\w*)\b/i.test(line) && !/stress|exercise|tmt|treadmill/i.test(line)) {
      const rest = afterLabel(line, /\b(?:resting\s+)?(?:ecg|ekg|electrocardiogra\w*)\b/i) || '';
      if (/\blvh\b|left\s+ventricular\s+hypertrophy/i.test(rest)) found.restecg = 2;
      else if (/st[-\s]?t\b|st\s*(?:segment|wave)?\s*(?:changes?|abnormalit\w*|depression|elevation)|t[-\s]?wave\s+inversion/i.test(rest)) found.restecg = 1;
      else if (/\bnormal\b|within\s+normal\s+limits|\bwnl\b/i.test(rest) && !/abnormal/i.test(rest)) found.restecg = 0;
    }
    // Exercise-induced angina: 1 yes, 0 no.
    if (found.exang === undefined) {
      const rest = afterLabel(line, /(?:exercise[-\s]*induced\s+angina|angina\s+(?:during|on)\s+(?:exercise|exertion|test)|exertional\s+angina|\bexang\b)\s*[:\-]?/i);
      if (rest !== null) {
        if (NO.test(rest.slice(0, 20))) found.exang = 0;
        else if (YES.test(rest.slice(0, 20))) found.exang = 1;
      }
    }
    // ST depression (oldpeak), mm.
    if (found.oldpeak === undefined) {
      const rest = afterLabel(line, /(?:st[-\s]*(?:segment\s+)?depression|oldpeak)\s*(?:of)?\s*[:\-]?\s*/i);
      const value = rest && rest.match(/^(\d(?:\.\d+)?)(?![\d.])\s*(?:mm)?(?!\s*(?:[-–]|to)\s*\d)/i);
      if (value && Number(value[1]) <= 6.2) found.oldpeak = Number(value[1]);
      else if (rest !== null && /^(?:nil|none|no|absent)\b/i.test(rest)) found.oldpeak = 0;
    }
    // ST slope at peak exercise: 1 upsloping, 2 flat/horizontal, 3 downsloping.
    if (found.slope === undefined && /\bst\b|slope/i.test(line)) {
      if (/down[-\s]?slop/i.test(line)) found.slope = 3;
      else if (/up[-\s]?slop/i.test(line)) found.slope = 1;
      else if (/\b(?:flat|horizontal)\b/i.test(line) && /slope|st\s*(?:segment|depression)/i.test(line)) found.slope = 2;
    }
    // Major vessels: number of diseased / coloured vessels (0-3).
    if (found.ca === undefined) {
      const words = { single: 1, one: 1, double: 2, two: 2, triple: 3, three: 3 };
      const m = line.match(/\b(single|double|triple|one|two|three|[0-3])[-\s]*(?:major\s+)?vessels?\s*(?:coronary\s+(?:artery\s+)?)?(?:disease|involvement|stenosis|cad|colou?red|affected)/i)
        || line.match(/(?:major\s+)?vessels?\s*(?:colou?red(?:\s+by\s+fluoroscopy)?|by\s+fluoroscopy|involved|diseased)\s*[:\-]?\s*([0-3])\b/i);
      if (m) found.ca = words[m[1].toLowerCase()] ?? Number(m[1]);
      else if (/\b(svd|dvd|tvd)\b/i.test(line)) found.ca = { svd: 1, dvd: 2, tvd: 3 }[line.match(/\b(svd|dvd|tvd)\b/i)[1].toLowerCase()];
    }
    // Thallium / myocardial perfusion: 3 normal, 6 fixed defect, 7 reversible defect.
    if (found.thal === undefined && /thall?ium|perfusion|\bmpi\b|spect|\bthal\b/i.test(line)) {
      if (/reversible\s+(?:perfusion\s+)?(?:defect|ischa?emia)/i.test(line)) found.thal = 7;
      else if (/fixed\s+(?:perfusion\s+)?defect/i.test(line)) found.thal = 6;
      else if (/\bnormal\b/i.test(line) && !/abnormal/i.test(line)) found.thal = 3;
    }
  }
  return found;
}

// Kept apart from parseReport because the risk forms don't use these values.
export function parseLipids(text) {
  const lines = text.split(/\r?\n/).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const found = {};
  const ldl = findValue(lines, /\bldl\b(?:[-\s]*c(?:holesterol)?\b)?/i, {
    exclude: /vldl|non[-\s]?hdl|ratio/i,
    min: 20, max: 500,
    convert: (line, value) => (/mmol/i.test(line) && value >= 0.5 && value <= 13 ? Math.round(value * MGDL_PER_MMOL_CHOLESTEROL) : undefined),
  });
  if (ldl) found.ldl = ldl;
  const triglycerides = findValue(lines, /triglycerides?|\btg\b/i, { min: 20, max: 3000 });
  if (triglycerides) found.triglycerides = triglycerides;
  return found;
}

export const REPORT_LABELS = {
  systolic_bp: ['Blood pressure (upper)', 'mmHg'],
  diastolic_bp: ['Blood pressure (lower)', 'mmHg'],
  cholesterol: ['Total cholesterol', 'mg/dL'],
  fasting_glucose: ['Fasting glucose', 'mg/dL'],
  hba1c: ['HbA1c', '%'],
  max_heart_rate: ['Maximum heart rate', 'bpm'],
  pulse: ['Pulse', 'bpm'],
  height_cm: ['Height', 'cm'],
  weight_kg: ['Weight', 'kg'],
  age: ['Age', 'years'],
  sex: ['Sex', ''],
  patient_name: ['Patient name', ''],
  cp: ['Chest pain type', ''],
  restecg: ['Resting ECG', ''],
  exang: ['Exercise-induced angina', ''],
  oldpeak: ['ST depression', 'mm'],
  slope: ['ST slope', ''],
  ca: ['Major vessels', ''],
  thal: ['Thallium test', ''],
};

// Readable text for coded values in the "values found" preview.
const CODED = {
  sex: { 1: 'Male', 0: 'Female' },
  cp: { 1: 'Typical angina', 2: 'Atypical angina', 3: 'Non-anginal pain', 4: 'No chest pain' },
  restecg: { 0: 'Normal', 1: 'ST-T wave abnormality', 2: 'Left ventricular hypertrophy' },
  exang: { 0: 'No', 1: 'Yes' },
  slope: { 1: 'Upsloping', 2: 'Flat', 3: 'Downsloping' },
  thal: { 3: 'Normal', 6: 'Fixed defect', 7: 'Reversible defect' },
};
export function displayReportValue(key, value) {
  return CODED[key]?.[value] ?? value;
}
