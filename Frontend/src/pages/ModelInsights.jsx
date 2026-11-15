import { useEffect, useState } from 'react';
import { BarChart3, BookOpen, Database, Gauge, Info, Scale, ShieldCheck, Target } from 'lucide-react';
import EmptyState from '../components/common/EmptyState';
import { getModelInsights, getScreeningInsights } from '../services/api';
import './model-insights.css';

const featureLabels = {
  age: 'Age', sex: 'Sex at birth', cp: 'Chest pain type', trestbps: 'Resting blood pressure', chol: 'Cholesterol',
  fbs: 'Fasting sugar', restecg: 'Resting ECG', thalach: 'Maximum heart rate',
  exang: 'Exercise angina', oldpeak: 'ST depression', slope: 'ST slope', ca: 'Major vessels (fluoroscopy)', thal: 'Thallium stress test',
  smoker: 'Smoker', cigs_per_day: 'Cigarettes per day', bp_medication: 'BP medicine', prior_stroke: 'Previous stroke',
  hypertension: 'High blood pressure', diabetes: 'Diabetes', systolic_bp: 'Systolic BP', bmi: 'BMI',
};

const MODEL_CARDS = {
  clinical: {
    title: 'Clinical model (XGBoost)',
    use: 'Estimating the chance of significant coronary artery disease for someone who already has clinical results (ECG, exercise test).',
    notFor: 'Diagnosis, emergencies, or people without these test results. It must not replace angiography or a cardiologist.',
    data: 'UCI Heart Disease database: 918 patients referred for angiography at 4 hospitals in the USA, Hungary and Switzerland (1980s). About 79% are men.',
    limits: [
      'Everyone in the data was already suspected of heart disease, so the base rate (55%) is far higher than in the general population.',
      'People with no chest pain (asymptomatic) had high disease rates in this group, so "no chest pain" can raise the estimate.',
      'Only 35 women in the test set: results for women are less certain.',
    ],
  },
  screening: {
    title: 'Home screening model (logistic regression)',
    use: 'Estimating 10-year risk of coronary heart disease from questions anyone can answer and a blood pressure reading. Designed for self-checks and community health workers.',
    notFor: 'People who already have heart disease, or anyone with symptoms right now (use the emergency check).',
    data: 'Framingham Heart Study teaching dataset: 4,240 adults aged 32–70 from Framingham, USA, followed for 10 years.',
    limits: [
      'Framingham participants were mostly white Americans. South Asians develop heart disease earlier, so the model may underestimate their risk.',
      'Discrimination is moderate (ROC-AUC 0.70–0.73), typical for risk scores without blood tests.',
      'Cholesterol and glucose were tested and did not improve accuracy here, so they are not asked.',
    ],
  },
};

export default function ModelInsights() {
  const [which, setWhich] = useState('clinical');
  const [data, setData] = useState({});
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    Promise.all([getModelInsights(), getScreeningInsights()]).then(([clinical, screening]) => {
      if (active) setData({ clinical, screening });
    }).catch(() => {
      if (active) setError('Model evaluation is currently unavailable.');
    });
    return () => { active = false; };
  }, []);

  if (error) return <div className="center-page"><EmptyState title="Model insights unavailable" text={error} action="Back to overview" /></div>;
  if (!data.clinical) return <div className="auth-loading"><div className="loading-spinner" /><span>Loading the model evaluation...</span></div>;

  const model = data[which];
  return <div className="model-insights-page">
    <div className="page-heading">
      <div><span className="eyebrow"><BarChart3 size={13} /> Model transparency</span><h1>Model insights</h1><p>How each CardioGuard model was trained and tested, and where it can go wrong.</p></div>
      <div className="segmented">
        <button type="button" className={which === 'clinical' ? 'active' : ''} onClick={() => setWhich('clinical')}>Clinical model</button>
        <button type="button" className={which === 'screening' ? 'active' : ''} onClick={() => setWhich('screening')}>Home screening</button>
      </div>
    </div>
    <div className="model-method-note"><Info size={16} /><span>{model.evaluation_method}. Dataset: {model.dataset}. {model.sample_count} held-out samples.</span></div>
    {which === 'clinical' ? <ClinicalMetrics data={model} /> : <ScreeningMetrics data={model} />}
    <div className="model-insights-grid">
      <CalibrationPanel calibration={model.calibration} />
      <FairnessPanel fairness={model.fairness} />
    </div>
    <ModelCard card={MODEL_CARDS[which]} />
  </div>;
}

function ClinicalMetrics({ data }) {
  const metrics = [['accuracy', 'Accuracy'], ['precision', 'Precision'], ['recall', 'Recall'], ['f1_score', 'F1-score'], ['roc_auc', 'ROC-AUC']];
  const maxImportance = Math.max(...data.feature_importance.map((item) => item.importance), 0.001);
  return <>
    <div className="model-metric-grid">{metrics.map(([key, label]) => <div className="model-metric" key={key}><span>{label}</span><strong>{(data.metrics[key] * 100).toFixed(1)}%</strong><div className="model-meter"><i style={{ width: `${data.metrics[key] * 100}%` }} /></div></div>)}</div>
    <div className="model-insights-grid">
      <ConfusionPanel matrix={data.confusion_matrix} title="Confusion matrix" note="Rows are actual labels; columns are predicted labels (threshold 50%)." />
      <section className="panel feature-panel"><div className="panel-heading"><div><span className="eyebrow"><Database size={13} /> Input signals</span><h2>Feature importance</h2></div></div><div className="feature-importance-list">{data.feature_importance.map((item) => <div className="importance-row" key={item.feature}><div><strong>{featureLabels[item.feature] || item.feature}</strong><span>{item.importance.toFixed(3)}</span></div><div className="importance-track"><i style={{ width: `${Math.max((item.importance / maxImportance) * 100, 2)}%` }} /></div></div>)}</div><small className="model-footnote">Importance is taken from the trained XGBoost model.</small></section>
    </div>
    {data.extended_model && <ExtendedModelPanel ext={data.extended_model} />}
  </>;
}

function ScreeningMetrics({ data }) {
  const [referral, high] = data.operating_points;
  const weights = data.features.map((name, index) => ({ name, value: data.coefficients[index] })).sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const maxWeight = Math.max(...weights.map((item) => Math.abs(item.value)));
  const cards = [
    ['ROC-AUC (held-out)', data.metrics.roc_auc.toFixed(3), data.metrics.roc_auc],
    ['ROC-AUC (5-fold CV)', `${data.metrics.cv_roc_auc_mean.toFixed(3)}`, data.metrics.cv_roc_auc_mean],
    ['Brier score', data.calibration.brier_score.toFixed(3), 1 - data.calibration.brier_score],
    [`Sensitivity at ${high.threshold * 100}%`, `${(high.sensitivity * 100).toFixed(1)}%`, high.sensitivity],
    [`Sensitivity at ${referral.threshold * 100}%`, `${(referral.sensitivity * 100).toFixed(1)}%`, referral.sensitivity],
  ];
  return <>
    <div className="model-metric-grid">{cards.map(([label, value, fill]) => <div className="model-metric" key={label}><span>{label}</span><strong>{value}</strong><div className="model-meter"><i style={{ width: `${fill * 100}%` }} /></div></div>)}</div>
    <div className="model-insights-grid">
      <ConfusionPanel matrix={high.confusion_matrix} title={`At the ${high.threshold * 100}% "high risk" cut-off`}
        note={`Flags ${(high.flagged_share * 100).toFixed(0)}% of people; specificity ${(high.specificity * 100).toFixed(1)}%. At ${referral.threshold * 100}% it catches ${(referral.sensitivity * 100).toFixed(0)}% of future cases but flags ${(referral.flagged_share * 100).toFixed(0)}% of people. Accuracy is not shown: only ${(data.metrics.base_rate * 100).toFixed(0)}% develop heart disease, so "nobody" would score ${(100 - data.metrics.base_rate * 100).toFixed(0)}%.`} />
      <section className="panel feature-panel"><div className="panel-heading"><div><span className="eyebrow"><Database size={13} /> Input signals</span><h2>Model weights</h2></div></div><div className="feature-importance-list">{weights.map((item) => <div className="importance-row" key={item.name}><div><strong>{featureLabels[item.name] || item.name}</strong><span>{item.value > 0 ? '+' : ''}{item.value.toFixed(3)}</span></div><div className="importance-track"><i style={{ width: `${Math.max((Math.abs(item.value) / maxWeight) * 100, 2)}%` }} /></div></div>)}</div><small className="model-footnote">Logistic regression weights on standardised inputs: the change in log-odds for one standard deviation.</small></section>
    </div>
  </>;
}

function ConfusionPanel({ matrix, title, note }) {
  return <section className="panel confusion-panel"><div className="panel-heading"><div><span className="eyebrow"><Gauge size={13} /> Classification results</span><h2>{title}</h2></div></div><div className="matrix-wrap"><div className="matrix-axis matrix-axis-top"><span>Predicted negative</span><span>Predicted positive</span></div><div className="matrix-body"><div className="matrix-axis matrix-axis-side"><span>Actual negative</span><span>Actual positive</span></div><div className="matrix-grid">{matrix.flatMap((row, rowIndex) => row.map((value, colIndex) => <div className={`matrix-cell ${rowIndex === colIndex ? 'correct' : 'incorrect'}`} key={`${rowIndex}-${colIndex}`}><strong>{value}</strong><small>{rowIndex === colIndex ? 'correct' : rowIndex === 1 ? 'missed' : 'false alarm'}</small></div>))}</div></div></div><small className="model-footnote">{note}</small></section>;
}

// Predicted vs observed risk: points on the diagonal mean "30% predicted" really is about 30%.
function CalibrationPanel({ calibration }) {
  const size = 240;
  const pad = 30;
  const max = Math.max(...calibration.bins.flatMap((bin) => [bin.predicted, bin.observed]), 0.2);
  const top = Math.min(1, Math.ceil(max * 10) / 10);
  const scale = (value) => pad + (value / top) * (size - pad * 2);
  const ticks = [0, top / 2, top];
  return <section className="panel"><div className="panel-heading"><div><span className="eyebrow"><Target size={13} /> Calibration</span><h2>Are the percentages honest?</h2></div></div>
    <svg viewBox={`0 0 ${size} ${size}`} className="calibration-chart" role="img" aria-label="Calibration chart of predicted against observed risk">
      {ticks.map((tick) => <g key={tick}>
        <line x1={pad} x2={size - pad} y1={size - scale(tick)} y2={size - scale(tick)} className="grid-line" />
        <text x={pad - 6} y={size - scale(tick) + 3} textAnchor="end">{Math.round(tick * 100)}%</text>
        <text x={scale(tick)} y={size - pad + 14} textAnchor="middle">{Math.round(tick * 100)}%</text>
      </g>)}
      <line x1={scale(0)} y1={size - scale(0)} x2={scale(top)} y2={size - scale(top)} className="ideal-line" />
      <polyline points={calibration.bins.map((bin) => `${scale(bin.predicted)},${size - scale(bin.observed)}`).join(' ')} className="model-line" />
      {calibration.bins.map((bin) => <circle key={bin.predicted} cx={scale(bin.predicted)} cy={size - scale(bin.observed)} r="3.5" className="model-dot"><title>{`Predicted ${(bin.predicted * 100).toFixed(0)}%, observed ${(bin.observed * 100).toFixed(0)}%`}</title></circle>)}
      <text x={size / 2} y={size - 2} textAnchor="middle" className="axis-label">Predicted risk</text>
      <text x={8} y={size / 2} textAnchor="middle" className="axis-label" transform={`rotate(-90 8 ${size / 2})`}>Observed rate</text>
    </svg>
    <small className="model-footnote">Each dot is a group of test patients. The dashed line is perfect calibration. Brier score {calibration.brier_score.toFixed(3)} (lower is better).</small>
  </section>;
}

function FairnessPanel({ fairness }) {
  const groups = [['by_sex', 'Sex'], ['by_age', 'Age'], ['by_hospital', 'Hospital']].filter(([key]) => fairness[key]);
  return <section className="panel"><div className="panel-heading"><div><span className="eyebrow"><Scale size={13} /> Fairness check</span><h2>Does it work for everyone?</h2></div></div>
    <div className="fairness-table-wrap"><table className="fairness-table">
      <thead><tr><th>Group</th><th>People</th><th>Had disease</th><th>Predicted (avg)</th><th>ROC-AUC</th><th>Recall</th></tr></thead>
      {groups.map(([key, label]) => <tbody key={key}>
        <tr className="fairness-group"><td colSpan="6">{label}</td></tr>
        {fairness[key].map((row) => <tr key={row.group}><td>{row.group}</td><td>{row.count}</td><td>{(row.positive_rate * 100).toFixed(0)}%</td><td>{(row.mean_predicted * 100).toFixed(0)}%</td><td>{row.roc_auc === null ? '–' : row.roc_auc.toFixed(2)}</td><td>{(row.recall * 100).toFixed(0)}%</td></tr>)}
      </tbody>)}
    </table></div>
    <small className="model-footnote">Measured on the held-out test set. Recall uses a {fairness.threshold * 100}% cut-off. Small groups (under ~50 people) give uncertain numbers; ROC-AUC needs both outcomes in a group.</small>
  </section>;
}

function ModelCard({ card }) {
  return <section className="panel model-card"><div className="panel-heading"><div><span className="eyebrow"><BookOpen size={13} /> Model card</span><h2>{card.title}</h2></div><span className="last-updated"><ShieldCheck size={15} /> Not a diagnosis</span></div>
    <dl>
      <div><dt>Intended use</dt><dd>{card.use}</dd></div>
      <div><dt>Not for</dt><dd>{card.notFor}</dd></div>
      <div><dt>Training data</dt><dd>{card.data}</dd></div>
      <div><dt>Known limitations</dt><dd><ul>{card.limits.map((item) => <li key={item}>{item}</li>)}</ul></dd></div>
    </dl>
  </section>;
}


function ExtendedModelPanel({ ext }) {
  const rows = [['accuracy', 'Accuracy'], ['precision', 'Precision'], ['recall', 'Recall'], ['f1_score', 'F1-score'], ['roc_auc', 'ROC-AUC'], ['false_negatives', 'Missed high-risk'], ['false_positives', 'False alarms']];
  const cmp = ext.comparison.test_rows_with_extra_inputs;
  const fmt = (key, v) => (key.startsWith('false_') ? v : `${(v * 100).toFixed(1)}%`);
  return <section className="panel extended-panel">
    <div className="panel-heading"><div><span className="eyebrow"><Target size={13} /> Extended model</span><h2>When stress-test results are entered</h2></div></div>
    <p className="model-footnote">{ext.used_when} Compared on the {cmp.standard_model.count} held-out patients who have all three results (never used for training). {ext.note}</p>
    <div className="table-scroll"><table className="extended-table"><thead><tr><th>Metric</th><th>Standard (10 inputs)</th><th>Extended (13 inputs)</th></tr></thead>
      <tbody>{rows.map(([key, label]) => <tr key={key}><td>{label}</td><td>{fmt(key, cmp.standard_model[key])}</td><td><strong>{fmt(key, cmp.extended_model[key])}</strong></td></tr>)}</tbody></table></div>
    <small className="model-footnote">Cross-validated ROC-AUC on training patients with these results: {ext.cv_roc_auc_complete_rows.toFixed(3)} ± {ext.cv_roc_auc_std.toFixed(3)}. Left blank, the extended model was less accurate than the standard one, so blank results always use the standard model.</small>
  </section>;
}
