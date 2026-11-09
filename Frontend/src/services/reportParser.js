// Pulls clinical values out of the text of a lab, BP or ECG report.
// Works line by line: find a label, then take the first plausible number after it.

const MGDL_PER_MMOL_GLUCOSE = 18;
const MGDL_PER_MMOL_CHOLESTEROL = 38.67;

// The result is the first number after the label. Later numbers on the line are usually the
// reference range ("70-100"), so they are never used: a missing value is safer than a wrong one.
function firstNumberAfter(line, labelMatch) {
  const match = line.slice(labelMatch.index + labelMatch[0].length).match(/([<>≤≥]\s*)?(\d{1,3}(?:\.\d+)?)(\s*[-–]\s*\d)?/);
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

  const ageSex = all.match(/age\s*\/\s*(?:sex|gender)\s*[:\-]?\s*(\d{1,3})\s*(?:y(?:ea)?rs?|y)?\s*\/\s*([mf])/i);
  if (ageSex) {
    found.age = Number(ageSex[1]);
    found.sex = ageSex[2].toLowerCase() === 'm' ? 1 : 0;
  } else {
    const age = findValue(lines, /\bage\b/i, { exclude: /average|stage|page/i, min: 1, max: 120 });
    if (age) found.age = age;
    const sex = all.match(/(?:sex|gender)\s*[:\-]?\s*(male|female|m\b|f\b)/i);
    if (sex) found.sex = sex[1].toLowerCase().startsWith('m') ? 1 : 0;
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
};
