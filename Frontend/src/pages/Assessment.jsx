import { useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CircleHelp, FileCheck2, LoaderCircle, LockKeyhole, RotateCcw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { submitAssessment } from '../services/api';
import { defaultHealthData } from '../services/storage';
import Stepper from '../components/assessment/Stepper';
import ReportUpload from '../components/screening/ReportUpload';

const EXTRA_KEYS = ['slope', 'ca', 'thal'];
const EXTRA_OPTIONS = {
  slope: [[1, 'Upsloping'], [2, 'Flat'], [3, 'Downsloping']],
  ca: [[0, '0'], [1, '1'], [2, '2'], [3, '3']],
  thal: [[3, 'Normal'], [6, 'Fixed defect'], [7, 'Reversible defect']],
};
const steps = ['Personal profile', 'Clinical signals', 'Lifestyle context', 'Review'];

export default function Assessment() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState(0);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState(defaultHealthData);
  const update = (name, value) => setFormData((data) => ({ ...data, [name]: value }));
  const applyReport = (found) => setFormData((data) => ({
    ...data,
    ...(found.age && { age: found.age }),
    ...(found.sex !== undefined && { sex: found.sex }),
    ...(found.systolic_bp && { trestbps: found.systolic_bp }),
    ...(found.cholesterol && { chol: found.cholesterol }),
    ...(found.fasting_glucose && { fbs: found.fasting_glucose > 120 ? 1 : 0 }),
    ...(found.max_heart_rate && { thalach: found.max_heart_rate }),
  }));
  const next = () => {
    if (step === 3) { const given = EXTRA_KEYS.filter((key) => formData[key] != null).length; if (given > 0 && given < 3) { setError('Enter all three stress-test results, or clear them to use the standard model.'); return; } }
    if (formData.age >= 1 && formData.age <= 120) { setError(''); setStep((value) => Math.min(value + 1, 4)); } else setError('Enter an age between 1 and 120 to continue.');
  };
  const submit = async (event) => {
    event.preventDefault(); setLoading(true); setPhase(1);
    const timer = setInterval(() => setPhase((value) => Math.min(value + 1, 3)), 850);
    try { const result = await submitAssessment(formData); clearInterval(timer); setPhase(4); setTimeout(() => navigate('/dashboard', { state: { result, formData } }), 500); }
    catch (requestError) { clearInterval(timer); setLoading(false); setError(requestError.response?.data?.detail || 'We could not reach the AI service. Check that the backend is running.'); }
  };
  if (loading) return <Processing phase={phase} />;
  return <div className="assessment-page"><div className="page-heading compact-heading"><div><span className="eyebrow">Personal health baseline</span><h1>Let's understand your heart.</h1><p>A few clinical signals are all we need to create your first CardioGuard estimate.</p></div><div className="privacy-badge"><LockKeyhole size={15} /> Private workspace</div></div><div className="assessment-layout"><section className="assessment-panel"><Stepper current={step} /><div className="step-title"><span>Step {step} of 4</span><h2>{steps[step - 1]}</h2><p>{step === 1 ? 'Start with the signals that help us personalize your baseline.' : step === 2 ? 'These clinical measures give the model its strongest context.' : step === 3 ? 'A little more context helps us read the clinical signals correctly.' : 'Review your information before we generate your estimate.'}</p></div><form onSubmit={submit}>{step < 4 && <ReportUpload onApply={applyReport} relevant={['age', 'sex', 'systolic_bp', 'cholesterol', 'fasting_glucose', 'max_heart_rate']} />}{step === 1 && <div className="form-grid"><Field label="Age" hint="Years" name="age" value={formData.age} update={update} type="number" min="1" max="120" /><Choice label="Sex at birth" hint="Used as a model signal" value={formData.sex} options={[[1, 'Male'], [0, 'Female']]} onChange={(value) => update('sex', value)} /></div>}{step === 2 && <div className="form-grid"><Field label="Resting blood pressure" hint="Systolic · mmHg" name="trestbps" value={formData.trestbps} update={update} type="number" min="70" max="240" /><Field label="Total cholesterol" hint="mg/dL" name="chol" value={formData.chol} update={update} type="number" min="80" max="500" /><Choice label="Fasting blood sugar" hint="Above 120 mg/dL?" value={formData.fbs} options={[[0, 'No'], [1, 'Yes']]} onChange={(value) => update('fbs', value)} /><Choice label="Resting ECG" hint="Clinical reading" value={formData.restecg} options={[[0, 'Normal'], [1, 'ST-T wave'], [2, 'Hypertrophy']]} onChange={(value) => update('restecg', value)} /></div>}{step === 3 && <div className="form-grid"><Field label="Maximum heart rate" hint="BPM achieved" name="thalach" value={formData.thalach} update={update} type="number" min="50" max="250" /><Choice label="Chest pain type" hint="Most typical chest discomfort" value={formData.cp} options={[[4, 'None'], [1, 'Typical angina'], [2, 'Atypical angina'], [3, 'Non-cardiac pain']]} onChange={(value) => update('cp', value)} /><Choice label="Exercise-induced angina" hint="Discomfort during exertion" value={formData.exang} options={[[0, 'No'], [1, 'Yes']]} onChange={(value) => update('exang', value)} /><div className="full-field"><label>ST depression <span><CircleHelp size={14} /> oldpeak measured by exercise test</span></label><input type="range" min="0" max="6" step="0.1" value={formData.oldpeak} onChange={(event) => update('oldpeak', Number(event.target.value))} /><div className="range-meta"><span>0.0 · none</span><strong>{formData.oldpeak.toFixed(1)}</strong><span>6.0 · high</span></div></div><StressTests data={formData} update={update} /></div>}{step === 4 && <Review data={formData} />}{error && <div className="form-error">{error}</div>}<div className="form-actions">{step > 1 ? <button type="button" className="btn btn-ghost" onClick={() => setStep((value) => value - 1)}><ArrowLeft size={17} /> Back</button> : <button type="button" className="btn btn-ghost" onClick={() => setFormData(defaultHealthData)}><RotateCcw size={16} /> Reset</button>}{step < 4 ? <button type="button" className="btn btn-primary" onClick={next}>Continue <ArrowRight size={17} /></button> : <button type="submit" className="btn btn-primary">Generate my estimate <ArrowRight size={17} /></button>}</div></form></section><aside className="assessment-aside"><div className="aside-quote"><span className="quote-mark">“</span><p>The goal isn't to predict your future. It's to help you ask better questions about your health today.</p><small>CardioGuard approach</small></div><div className="aside-checks"><p>What you'll receive</p><span><Check size={15} /> A clear risk band</span><span><Check size={15} /> Contributing factors</span><span><Check size={15} /> Personalized next steps</span></div><div className="aside-foot"><FileCheck2 size={18} /><span>Your answers are used only to create this assessment.</span></div></aside></div></div>;
}
function Field({ label, hint, name, value, update, ...props }) { return <div className="field"><label htmlFor={name}>{label}<span>{hint}</span></label><input id={name} name={name} value={value} onChange={(event) => update(name, props.type === 'number' ? Number(event.target.value) : event.target.value)} {...props} /></div>; }
function Choice({ label, hint, value, options, onChange }) { return <div className="choice-field"><label>{label}<span>{hint}</span></label><div className="choice-grid">{options.map(([option, text]) => <button type="button" className={Number(value) === option ? 'choice active' : 'choice'} key={text} onClick={() => onChange(option)}>{text}{Number(value) === option && <Check size={15} />}</button>)}</div></div>; }
function Review({ data }) { const labels = [['age', 'Age', 'years'], ['sex', 'Sex at birth', data.sex ? 'Male' : 'Female'], ['cp', 'Chest pain type', { 1: 'Typical angina', 2: 'Atypical angina', 3: 'Non-cardiac pain', 4: 'None' }[data.cp]], ['trestbps', 'Resting blood pressure', 'mmHg'], ['chol', 'Total cholesterol', 'mg/dL'], ['thalach', 'Maximum heart rate', 'BPM'], ['oldpeak', 'ST depression', 'oldpeak']]; const extended = EXTRA_KEYS.every((key) => data[key] != null); const extras = extended ? [['slope', 'ST slope', ''], ['ca', 'Major vessels', ''], ['thal', 'Thallium test', '']].map(([key, label]) => [key, label, '', (EXTRA_OPTIONS[key].find(([v]) => v === Number(data[key])) || [])[1]]) : []; return <><div className="review-grid">{labels.map(([key, label, suffix]) => <div className="review-item" key={key}><span>{label}</span><strong>{data[key]} <small>{suffix}</small></strong></div>)}{extras.map(([key, label, , text]) => <div className="review-item" key={key}><span>{label}</span><strong>{text}</strong></div>)}</div><p className="review-model">{extended ? 'Stress-test results entered: the extended 13-input model will be used.' : 'No stress-test results: the standard 10-input model will be used.'}</p></>; }
function Processing({ phase }) { const items = ['Validating your information', 'Processing clinical signals', 'Running AI prediction', 'Preparing your insights']; return <div className="processing-page"><div className="processing-orb"><LoaderCircle size={38} /></div><span className="eyebrow">CardioGuard intelligence</span><h1>Reading the signals<br /><em>behind the numbers.</em></h1><div className="processing-list">{items.map((item, index) => <div className={phase > index ? 'processing-item complete' : phase === index ? 'processing-item active' : 'processing-item'} key={item}><span>{phase > index ? <Check size={14} /> : phase === index ? <LoaderCircle size={14} /> : index + 1}</span>{item}{phase > index && <small>done</small>}</div>)}</div><p>This usually takes a few seconds. Please keep this window open.</p></div>; }

function OptionalChoice({ label, hint, value, options, onChange }) { return <div className="choice-field"><label>{label}<span>{hint}</span></label><div className="choice-grid">{options.map(([option, text]) => { const active = value != null && Number(value) === option; return <button type="button" aria-pressed={active} className={active ? 'choice active' : 'choice'} key={text} onClick={() => onChange(active ? null : option)}>{text}{active && <Check size={15} />}</button>; })}</div></div>; }
function StressTests({ data, update }) {
  const given = EXTRA_KEYS.filter((key) => data[key] != null).length;
  const [open, setOpen] = useState(given > 0);
  const clear = () => EXTRA_KEYS.forEach((key) => update(key, null));
  return <div className="full-field stress-tests">
    <button type="button" className="stress-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
      <span><strong>Stress-test results</strong> <em>Optional</em></span>
      <small>{given === 3 ? 'All three entered · extended model will be used' : given ? `${given} of 3 entered` : 'Only if you have results from a thallium / fluoroscopy test'}</small>
    </button>
    {open && <div className="stress-body">
      <p className="stress-note">If you enter all three, CardioGuard uses its extended model, which was more accurate on patients with these results. Leave them blank if you don't have them; the standard model is used and nothing is guessed.</p>
      <div className="form-grid">
        <OptionalChoice label="ST slope at peak exercise" hint="From an exercise ECG" value={data.slope} options={EXTRA_OPTIONS.slope} onChange={(v) => update('slope', v)} />
        <OptionalChoice label="Major vessels on fluoroscopy" hint="Number coloured (0–3)" value={data.ca} options={EXTRA_OPTIONS.ca} onChange={(v) => update('ca', v)} />
        <OptionalChoice label="Thallium stress test" hint="Scan result" value={data.thal} options={EXTRA_OPTIONS.thal} onChange={(v) => update('thal', v)} />
      </div>
      {given > 0 && <button type="button" className="btn btn-ghost stress-clear" onClick={clear}><RotateCcw size={15} /> Clear stress-test results</button>}
    </div>}
  </div>;
}
