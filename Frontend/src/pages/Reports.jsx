import { useEffect, useState } from 'react';
import { Download, FileText, HeartPulse, MessageCircleQuestion, Printer, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import EmptyState from '../components/common/EmptyState';
import RiskGauge from '../components/dashboard/RiskGauge';
import { useAuth } from '../context/AuthContext';
import useHistoryData from '../hooks/useHistoryData';
import { getScreeningHistory, submitAssessment } from '../services/api';
import { doctorQuestions, downloadDoctorReport } from '../services/pdfReport';
import { defaultHealthData } from '../services/storage';

const FACTOR_LABELS = {
  age: 'Age', sex: 'Sex', cp: 'Chest pain type', trestbps: 'Resting blood pressure', chol: 'Cholesterol',
  fbs: 'Fasting blood sugar', restecg: 'Resting ECG', thalach: 'Maximum heart rate', exang: 'Exercise angina', oldpeak: 'ST depression', slope: 'ST slope', ca: 'Major vessels (fluoroscopy)', thal: 'Thallium stress test',
};

export default function Reports() {
  const { user } = useAuth();
  const { history, loading } = useHistoryData();
  const [screenings, setScreenings] = useState([]);
  const [factors, setFactors] = useState([]);
  const latest = history[0];
  const screening = screenings[0];

  useEffect(() => { getScreeningHistory().then(setScreenings).catch(() => {}); }, []);
  useEffect(() => {
    if (!latest) return;
    // Re-run the latest assessment (without saving) to get which inputs pushed the estimate up.
    submitAssessment({ ...latest.form_data, cp: latest.form_data.cp ?? defaultHealthData.cp }, false)
      .then((result) => setFactors(Object.entries(result.shap_values).filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name]) => name)))
      .catch(() => {});
  }, [latest]);

  if (loading) return <div className="auth-loading"><div className="loading-spinner" /><span>Loading your private report...</span></div>;
  if (!latest && !screening) return <div className="center-page"><EmptyState title="No report to review" text="Complete an assessment or a home screening to generate a report you can take to your doctor." /></div>;

  const trend = [
    ...history.map((item) => ({ date: item.created_at, risk: item.risk_probability, category: item.risk_category, kind: 'clinical' })),
    ...screenings.map((item) => ({ date: item.screened_at, risk: item.risk_probability, category: item.risk_category, kind: 'home' })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date));
  const download = () => downloadDoctorReport({ userName: user?.name, assessment: latest, assessmentFactors: factors, screening, history: trend });

  return <div className="reports-page">
    <div className="page-heading"><div><span className="eyebrow">Take this to your doctor</span><h1>Health report</h1><p>A summary of your results, what drives them, and questions to ask at your next visit.</p></div><div className="report-actions"><button className="btn btn-ghost" onClick={() => window.print()}><Printer size={16} /> Print</button><button className="btn btn-primary" onClick={download}><Download size={16} /> Download PDF</button></div></div>
    <article className="report-sheet">
      <div className="report-header"><div className="brand-mark"><span className="brand-icon"><HeartPulse size={18} /></span><span className="brand-copy"><strong>Cardio<span>Guard</span></strong><small>AI health intelligence</small></span></div><span className="report-date">{new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</span></div>
      <div className="report-title"><div><span className="eyebrow">Personal health snapshot</span><h2>Prepared for {user?.name}</h2><p>Share this with a qualified doctor</p></div><div className="report-status"><ShieldCheck size={17} /> Educational estimate</div></div>

      {latest && <div className="report-main">
        <RiskGauge value={latest.risk_probability} category={latest.risk_category} />
        <div className="report-summary">
          <h3>Clinical assessment · {new Date(latest.created_at).toLocaleDateString()}</h3>
          <p>Estimated chance of significant coronary artery disease: {latest.risk_category.toLowerCase()} band.</p>
          {factors.length > 0 && <p><strong>Main contributing factors:</strong> {factors.map((name) => FACTOR_LABELS[name] || name).join(', ')}</p>}
          <div className="report-measure-grid">
            <Measure label="Blood pressure" value={`${latest.form_data.trestbps} mmHg`} />
            <Measure label="Cholesterol" value={`${latest.form_data.chol} mg/dL`} />
            <Measure label="Maximum heart rate" value={`${latest.form_data.thalach} BPM`} />
            <Measure label="Age" value={`${latest.form_data.age} years`} />
          </div>
        </div>
      </div>}

      {screening && <div className="report-measures">
        <h3>Home screening · {new Date(screening.screened_at).toLocaleDateString()}</h3>
        <p>10-year risk of coronary heart disease: <strong>{screening.risk_probability.toFixed(1)}%</strong> ({screening.risk_category.toLowerCase()})</p>
        <div className="report-measure-grid">
          <Measure label="Systolic BP" value={`${screening.form_data.systolic_bp} mmHg`} />
          <Measure label="BMI" value={screening.form_data.bmi ?? 'Not known'} />
          <Measure label="Smoker" value={screening.form_data.smoker ? 'Yes' : 'No'} />
          <Measure label="Diabetes" value={screening.form_data.diabetes ? 'Yes' : 'No'} />
        </div>
      </div>}

      {trend.length > 1 && <div className="report-measures">
        <h3>Trend</h3>
        <table className="report-trend"><tbody>{trend.slice(0, 8).map((item) => <tr key={`${item.kind}-${item.date}`}><td>{new Date(item.date).toLocaleDateString()}</td><td>{item.kind === 'home' ? 'Home screening (10-year)' : 'Clinical assessment'}</td><td><span className={`risk-chip ${item.category.toLowerCase()}`}>{item.risk.toFixed(1)}%</span></td></tr>)}</tbody></table>
      </div>}

      <div className="report-measures">
        <h3><MessageCircleQuestion size={16} /> Questions to ask your doctor</h3>
        <ul className="question-list">{doctorQuestions(latest, screening).map((question) => <li key={question}>{question}</li>)}</ul>
      </div>
      <div className="report-footer"><FileText size={16} /> These are statistical estimates, not a diagnosis.</div>
    </article>
    <Link className="subtle-link report-back" to="/dashboard">Back to overview</Link>
  </div>;
}

function Measure({ label, value }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
