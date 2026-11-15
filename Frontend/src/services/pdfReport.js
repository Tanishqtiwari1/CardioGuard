// Builds PDF reports for a doctor visit, and referral slips for community health workers.
// jsPDF is loaded only when a PDF is requested, to keep the app quick to open.

const TEAL = [22, 119, 111];
const INK = [22, 42, 53];
const MUTED = [109, 128, 134];
const BAND_COLOURS = { LOW: [47, 157, 143], MODERATE: [214, 158, 46], HIGH: [220, 90, 70] };

async function writer(title, subtitle) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const width = doc.internal.pageSize.getWidth();
  let y = 18;

  doc.setFillColor(...TEAL);
  doc.rect(0, 0, width, 4, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(...INK);
  doc.text(title, 15, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(subtitle, 15, y + 6);
  doc.text(`CardioGuard  |  ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}`, width - 15, y, { align: 'right' });
  y += 16;

  const ensure = (needed) => {
    if (y + needed > 280) { doc.addPage(); y = 18; }
  };
  return {
    doc,
    heading(text) {
      ensure(14);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(...TEAL);
      doc.text(text, 15, y);
      doc.setDrawColor(220, 232, 229);
      doc.line(15, y + 2, width - 15, y + 2);
      y += 8;
    },
    paragraph(text, size = 10, colour = INK) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(size);
      doc.setTextColor(...colour);
      const lines = doc.splitTextToSize(text, width - 30);
      ensure(lines.length * size * 0.45 + 2);
      doc.text(lines, 15, y);
      y += lines.length * size * 0.45 + 2;
    },
    rows(pairs) {
      doc.setFontSize(10);
      pairs.forEach(([label, value], index) => {
        ensure(7);
        const x = index % 2 === 0 ? 15 : width / 2 + 2;
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...MUTED);
        doc.text(label, x, y);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...INK);
        doc.text(String(value), x + 48, y);
        if (index % 2 === 1 || index === pairs.length - 1) y += 6.5;
      });
      y += 2;
    },
    bullets(items) {
      items.forEach((item) => this.paragraph(`•  ${item}`));
      y += 1;
    },
    risk(label, probability, category) {
      ensure(22);
      const colour = BAND_COLOURS[category] || TEAL;
      doc.setFillColor(...colour);
      doc.roundedRect(15, y, width - 30, 18, 3, 3, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(20);
      doc.text(`${Number(probability).toFixed(1)}%`, 21, y + 12);
      doc.setFontSize(11);
      doc.text(`${category} RISK`, 60, y + 8);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text(label, 60, y + 13.5);
      y += 24;
    },
    space(amount = 4) { y += amount; },
  };
}

const yesNo = (value) => (value ? 'Yes' : 'No');
const date = (value) => new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const RESTECG = { 0: 'Normal', 1: 'ST-T wave abnormality', 2: 'Left ventricular hypertrophy' };
const CHEST_PAIN = { 1: 'Typical angina', 2: 'Atypical angina', 3: 'Non-anginal pain', 4: 'None (asymptomatic)' };
const FACTOR_LABELS = {
  age: 'Age', sex: 'Sex', cp: 'Chest pain type', trestbps: 'Resting blood pressure', chol: 'Cholesterol',
  fbs: 'Fasting blood sugar', restecg: 'Resting ECG', thalach: 'Maximum heart rate', exang: 'Exercise angina',
  oldpeak: 'ST depression', slope: 'ST slope', ca: 'Major vessels (fluoroscopy)', thal: 'Thallium stress test', smoker: 'Smoking', cigs_per_day: 'Cigarettes per day', bp_medication: 'BP medicine',
  prior_stroke: 'Previous stroke', hypertension: 'High blood pressure', diabetes: 'Diabetes',
  systolic_bp: 'Systolic blood pressure', bmi: 'BMI',
};

export function doctorQuestions(assessment, screening) {
  const questions = [];
  const clinical = assessment?.form_data;
  const home = screening?.form_data;
  const bp = clinical?.trestbps ?? home?.systolic_bp;
  if (bp >= 130) questions.push(`My blood pressure was ${bp} mmHg. Does it need treatment, and how often should I check it?`);
  if (clinical?.chol >= 200) questions.push(`My cholesterol was ${clinical.chol} mg/dL. Should I have a full lipid profile or start medicine?`);
  if (clinical?.fbs || home?.diabetes) questions.push('Should I have an HbA1c test to check my long-term blood sugar?');
  if (clinical?.cp && clinical.cp !== 4) questions.push('I get chest discomfort. Do I need an ECG, treadmill test or echo?');
  if (clinical?.exang) questions.push('I get chest discomfort when exercising. What activity is safe for me?');
  if (home?.smoker) questions.push('What help is available to stop smoking?');
  if ((assessment?.risk_category || screening?.risk_category) === 'HIGH') questions.push('Should I be taking a statin or aspirin given my risk?');
  questions.push('What is the one change that would lower my heart risk the most?');
  return questions.slice(0, 6);
}

export async function downloadDoctorReport({ userName, assessment, assessmentFactors, screening, history }) {
  const w = await writer('Heart health report', `Prepared for ${userName || 'CardioGuard user'} to share with a doctor`);

  if (assessment) {
    const f = assessment.form_data;
    w.heading(`Clinical assessment  (${date(assessment.created_at)})`);
    w.risk('Estimated chance of significant coronary artery disease (UCI clinical model)', assessment.risk_probability, assessment.risk_category);
    w.rows([
      ['Age', `${f.age} years`], ['Sex', f.sex ? 'Male' : 'Female'],
      ['Chest pain type', CHEST_PAIN[f.cp] || 'Not recorded'], ['Resting BP', `${f.trestbps} mmHg`],
      ['Cholesterol', `${f.chol} mg/dL`], ['Fasting sugar > 120', yesNo(f.fbs)],
      ['Resting ECG', RESTECG[f.restecg] || f.restecg], ['Max heart rate', `${f.thalach} bpm`],
      ['Exercise angina', yesNo(f.exang)], ['ST depression', f.oldpeak],
      ...(f.slope != null && f.ca != null && f.thal != null ? [
        ['ST slope', { 1: 'Upsloping', 2: 'Flat', 3: 'Downsloping' }[f.slope] || f.slope],
        ['Major vessels (fluoroscopy)', f.ca],
        ['Thallium stress test', { 3: 'Normal', 6: 'Fixed defect', 7: 'Reversible defect' }[f.thal] || f.thal],
      ] : []),
      ['Model used', assessment.model_id === 'extended' ? 'Extended clinical model (13 inputs)' : 'Standard clinical model (10 inputs)'],
    ]);
    if (assessmentFactors?.length) {
      w.paragraph('Factors that raised this estimate the most:', 10, MUTED);
      w.bullets(assessmentFactors.map((name) => FACTOR_LABELS[name] || name));
    }
  }

  if (screening) {
    const f = screening.form_data;
    w.heading(`Home screening  (${date(screening.screened_at)})`);
    w.risk('Estimated 10-year risk of coronary heart disease (Framingham model)', screening.risk_probability, screening.risk_category);
    w.rows([
      ['Age', `${f.age} years`], ['Sex', f.sex ? 'Male' : 'Female'],
      ['Systolic BP', `${f.systolic_bp} mmHg`], ['BMI', f.bmi ?? 'Not known'],
      ['Smoker', f.smoker ? `Yes (${f.cigs_per_day}/day)` : 'No'], ['Diabetes', yesNo(f.diabetes)],
      ['High BP diagnosed', yesNo(f.hypertension)], ['On BP medicine', yesNo(f.bp_medication)],
      ['Previous stroke', yesNo(f.prior_stroke)],
    ]);
  }

  if (history?.length > 1) {
    w.heading('Trend');
    w.rows(history.slice(0, 8).map((item) => [date(item.date), `${Number(item.risk).toFixed(1)}%  ${item.category}  (${item.kind})`]));
  }

  w.heading('Questions to ask your doctor');
  w.bullets(doctorQuestions(assessment, screening));

  w.space();
  w.paragraph('This is an AI-generated educational assessment and is NOT a medical diagnosis. ', 9, INK);
  w.paragraph('These are statistical estimates from machine learning models, not a diagnosis. The clinical model was trained on 918 patients '
    + 'from the UCI Heart Disease database (82% accuracy on held-out patients). The home screening model was trained on the Framingham '
    + 'Heart Study (ROC-AUC 0.71) and may underestimate risk for South Asian people.', 8, MUTED);
  w.doc.save(`cardioguard-report-${new Date().toISOString().slice(0, 10)}.pdf`);
}

export async function downloadReferralSlip({ patient, screening, workerName }) {
  const w = await writer('Referral slip', 'Community cardiovascular risk screening');
  const f = screening.form_data;
  w.heading('Person referred');
  w.rows([
    ['Name', patient.name], ['Village / ward', patient.village || '-'],
    ['Age', `${f.age} years`], ['Sex', f.sex ? 'Male' : 'Female'],
    ['Phone', patient.phone || '-'], ['Screened on', date(screening.screened_at)],
  ]);
  w.heading('Screening result');
  w.risk('Estimated 10-year risk of coronary heart disease', screening.risk_probability, screening.risk_category);
  w.rows([
    ['Systolic BP', `${f.systolic_bp} mmHg`], ['BMI', f.bmi ?? 'Not measured'],
    ['Smoker', f.smoker ? `Yes (${f.cigs_per_day}/day)` : 'No'], ['Diabetes', yesNo(f.diabetes)],
    ['High BP diagnosed', yesNo(f.hypertension)], ['On BP medicine', yesNo(f.bp_medication)],
    ['Previous stroke', yesNo(f.prior_stroke)],
  ]);
  w.heading('Requested at health centre');
  w.bullets([
    'Confirm blood pressure (repeat reading)',
    'Random or fasting blood sugar',
    'Lipid profile if available',
    'ECG if symptoms are reported',
    'Advice and treatment as per NPCDCS / NP-NCD guidelines',
  ]);
  w.space(6);
  w.rows([['Referred by', workerName || 'Community health worker'], ['Signature', '____________________']]);
  w.space(4);
  w.paragraph('Screening estimate from the CardioGuard home model (Framingham Heart Study). Not a diagnosis.', 8, MUTED);
  w.doc.save(`referral-${patient.name.replace(/\s+/g, '-').toLowerCase()}.pdf`);
}
