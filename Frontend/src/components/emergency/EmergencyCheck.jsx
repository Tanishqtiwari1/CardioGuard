import { useState } from 'react';
import { ArrowRight, Check, Phone, Siren, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useT } from '../../i18n';

const SYMPTOMS = ['emergency.s1', 'emergency.s2', 'emergency.s3', 'emergency.s4', 'emergency.s5', 'emergency.s6'];

// Shown before any risk assessment: someone with heart attack or stroke symptoms
// needs an ambulance, not a 10-year risk score.
export default function EmergencyCheck({ onClear }) {
  const { t } = useT();
  const [checked, setChecked] = useState([]);
  const [alert, setAlert] = useState(false);
  const toggle = (key) => setChecked((list) => (list.includes(key) ? list.filter((item) => item !== key) : [...list, key]));

  if (alert) return <EmergencyAlert onBack={() => { setAlert(false); setChecked([]); }} />;

  return <section className="panel emergency-check">
    <span className="eyebrow"><TriangleAlert size={13} /> {t('emergency.eyebrow')}</span>
    <h2>{t('emergency.title')}</h2>
    <p className="muted-text">{t('emergency.text')}</p>
    <div className="symptom-list">
      {SYMPTOMS.map((key) => <button type="button" key={key} className={`symptom ${checked.includes(key) ? 'active' : ''}`} onClick={() => toggle(key)} aria-pressed={checked.includes(key)}>
        <span className="symptom-box">{checked.includes(key) && <Check size={14} />}</span>{t(key)}
      </button>)}
    </div>
    <div className="form-actions">
      {checked.length
        ? <button type="button" className="btn btn-danger" onClick={() => setAlert(true)}><Siren size={17} /> {t('emergency.some')}</button>
        : <button type="button" className="btn btn-primary" onClick={onClear}>{t('emergency.none')} <ArrowRight size={17} /></button>}
    </div>
  </section>;
}

export function EmergencyAlert({ onBack }) {
  const { t } = useT();
  return <section className="emergency-alert" role="alert">
    <div className="emergency-alert-head"><Siren size={30} /><h2>{t('emergency.alertTitle')}</h2></div>
    <p>{t('emergency.alertText')}</p>
    <div className="emergency-calls">
      <a className="btn emergency-call" href="tel:108"><Phone size={20} /> {t('emergency.call108')}</a>
      <a className="btn emergency-call secondary" href="tel:112"><Phone size={20} /> {t('emergency.call112')}</a>
    </div>
    <Link className="btn btn-danger emergency-sos-link" to="/sos"><Siren size={18} /> {t('emergency.openSos')}</Link>
    <h3>{t('emergency.whileWaiting')}</h3>
    <ol>{['emergency.w1', 'emergency.w2', 'emergency.w3', 'emergency.w4', 'emergency.w5'].map((key) => <li key={key}>{t(key)}</li>)}</ol>
    {onBack && <button type="button" className="subtle-link emergency-back" onClick={onBack}>{t('emergency.mistake')}</button>}
  </section>;
}
