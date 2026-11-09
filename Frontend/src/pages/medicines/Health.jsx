import { useEffect, useRef, useState } from 'react';
import { FileUp, LoaderCircle, Plus, X } from 'lucide-react';
import { getHealthProfile, getVocabulary, localDate, saveHealthProfile } from '../../services/medicines';
import { parseLipids, parseReport } from '../../services/reportParser';
import { useToast } from '../../ui/toast';
import { ErrorState, Loading, PageFooter, PageHead, useTx } from './shared';

const blank = { conditions: [], allergies: [], labs: [], doctor_name: '', doctor_phone: '', emergency_contact_name: '', emergency_contact_phone: '' };
// Report fields that the medicine checks use, mapped to their lab names.
const FROM_REPORT = { cholesterol: 'total_cholesterol', fasting_glucose: 'fasting_glucose', hba1c: 'hba1c', systolic_bp: 'systolic_bp', pulse: 'pulse', ldl: 'ldl', triglycerides: 'triglycerides' };

export default function Health() {
  const { t, tx } = useTx();
  const toast = useToast();
  const [status, setStatus] = useState('loading');
  const [vocabulary, setVocabulary] = useState(null);
  const [profile, setProfile] = useState(blank);
  const [suggestions, setSuggestions] = useState({ conditions: [], labs: [] });
  const [custom, setCustom] = useState('');
  const [allergy, setAllergy] = useState('');
  const [lab, setLab] = useState({ key: 'ldl', value: '', date: localDate() });
  const [saving, setSaving] = useState(false);

  const load = () => {
    setStatus('loading');
    Promise.all([getHealthProfile(), getVocabulary()]).then(([data, words]) => {
      setProfile({ ...blank, ...Object.fromEntries(Object.entries(data).map(([key, value]) => [key, value ?? blank[key]])) });
      setSuggestions(data.suggestions);
      setVocabulary(words);
      setStatus('ready');
    }).catch(() => setStatus('error'));
  };
  useEffect(load, []);

  if (status === 'loading') return <Loading />;
  if (status === 'error') return <ErrorState onRetry={load} />;

  const set = (changes) => setProfile((current) => ({ ...current, ...changes }));
  const toggle = (key) => set({ conditions: profile.conditions.includes(key) ? profile.conditions.filter((item) => item !== key) : [...profile.conditions, key] });
  const addCustom = () => { if (custom.trim()) { set({ conditions: [...new Set([...profile.conditions, custom.trim()])] }); setCustom(''); } };
  const addAllergy = () => { if (allergy.trim()) { set({ allergies: [...new Set([...profile.allergies, allergy.trim()])] }); setAllergy(''); } };
  const addLabs = (rows) => set({ labs: [...profile.labs.filter((row) => !rows.some((added) => added.key === row.key && added.date === row.date)), ...rows] });
  const addLab = () => {
    const value = Number(lab.value);
    if (!value || value <= 0) return;
    addLabs([{ key: lab.key, value, date: lab.date || null, source: 'manual' }]);
    setLab({ ...lab, value: '' });
  };
  const save = async () => {
    setSaving(true);
    try {
      const { conditions, allergies, labs, doctor_name, doctor_phone, emergency_contact_name, emergency_contact_phone } = profile;
      const data = await saveHealthProfile({ conditions, allergies, labs, doctor_name: doctor_name || null, doctor_phone: doctor_phone || null, emergency_contact_name: emergency_contact_name || null, emergency_contact_phone: emergency_contact_phone || null });
      setSuggestions(data.suggestions);
      toast(t('med.health.saved'), { tone: 'success' });
    } catch {
      toast(t('med.error'), { tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const customConditions = profile.conditions.filter((key) => !vocabulary.conditions[key]);
  const pending = suggestions.conditions.filter((key) => !profile.conditions.includes(key));

  return <div className="med-page narrow">
    <PageHead title={t('med.health.title')} text={t('med.health.text')} />

    <section className="med-card">
      <h2>{t('med.health.conditions')}</h2>
      {pending.length > 0 && <div className="med-context"><p>{t('med.health.suggestion')}</p><div className="med-chips">{pending.map((key) => <button key={key} type="button" onClick={() => toggle(key)}><Plus size={13} /> {tx(vocabulary.conditions[key])}</button>)}</div></div>}
      <div className="med-chips">
        {Object.entries(vocabulary.conditions).map(([key, label]) => <button key={key} type="button" className={profile.conditions.includes(key) ? 'active' : ''} aria-pressed={profile.conditions.includes(key)} onClick={() => toggle(key)}>{tx(label)}</button>)}
        {customConditions.map((key) => <button key={key} type="button" className="active" onClick={() => toggle(key)}>{key} <X size={13} /></button>)}
      </div>
      <div className="med-add-row">
        <input value={custom} onChange={(event) => setCustom(event.target.value)} placeholder={t('med.health.otherCondition')} aria-label={t('med.health.otherCondition')} maxLength={80} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addCustom(); } }} />
        <button type="button" className="btn btn-ghost" onClick={addCustom}>{t('med.health.add')}</button>
      </div>
    </section>

    <section className="med-card">
      <h2>{t('med.health.allergies')}</h2>
      {profile.allergies.length > 0 && <div className="med-chips">{profile.allergies.map((item) => <button key={item} type="button" className="active" onClick={() => set({ allergies: profile.allergies.filter((value) => value !== item) })}>{item} <X size={13} /></button>)}</div>}
      <div className="med-add-row">
        <input value={allergy} onChange={(event) => setAllergy(event.target.value)} placeholder={t('med.health.allergyPlaceholder')} aria-label={t('med.health.allergies')} maxLength={80} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addAllergy(); } }} />
        <button type="button" className="btn btn-ghost" onClick={addAllergy}>{t('med.health.add')}</button>
      </div>
    </section>

    <section className="med-card">
      <h2>{t('med.health.results')}</h2>
      {profile.labs.length > 0 && <ul className="med-plain">{profile.labs.map((row, index) => <li key={`${row.key}-${row.date}-${index}`} className="med-row"><span>{tx(vocabulary.labs[row.key])}: <strong>{row.value} {vocabulary.labs[row.key].unit}</strong>{row.date && <small className="med-muted"> · {row.date}</small>}</span><button type="button" className="icon-btn" aria-label={t('med.remove')} onClick={() => set({ labs: profile.labs.filter((_, position) => position !== index) })}><X size={15} /></button></li>)}</ul>}
      <div className="med-grid-3">
        <label className="med-field"><span>{t('med.health.resultName')}</span><select value={lab.key} onChange={(event) => setLab({ ...lab, key: event.target.value })}>{Object.entries(vocabulary.labs).map(([key, label]) => <option key={key} value={key}>{tx(label)}</option>)}</select></label>
        <label className="med-field"><span>{t('med.health.value')} ({vocabulary.labs[lab.key].unit})</span><input type="number" min="0" step="any" value={lab.value} onChange={(event) => setLab({ ...lab, value: event.target.value })} /></label>
        <label className="med-field"><span>{t('med.health.date')}</span><input type="date" value={lab.date} onChange={(event) => setLab({ ...lab, date: event.target.value })} /></label>
      </div>
      <div className="med-actions">
        <button type="button" className="btn btn-ghost" onClick={addLab}><Plus size={16} /> {t('med.health.addResult')}</button>
        <ReportReader vocabulary={vocabulary} onAdd={addLabs} />
      </div>
    </section>

    <section className="med-card">
      <h2>{t('med.health.doctor')}</h2>
      <div className="med-grid-2">
        <label className="med-field"><span>{t('med.health.doctorName')}</span><input value={profile.doctor_name} maxLength={120} onChange={(event) => set({ doctor_name: event.target.value })} /></label>
        <label className="med-field"><span>{t('med.health.doctorPhone')}</span><input type="tel" value={profile.doctor_phone} maxLength={30} onChange={(event) => set({ doctor_phone: event.target.value })} /></label>
      </div>
      <h2>{t('med.health.contact')}</h2>
      <div className="med-grid-2">
        <label className="med-field"><span>{t('med.health.contactName')}</span><input value={profile.emergency_contact_name} maxLength={120} onChange={(event) => set({ emergency_contact_name: event.target.value })} /></label>
        <label className="med-field"><span>{t('med.health.contactPhone')}</span><input type="tel" value={profile.emergency_contact_phone} maxLength={30} onChange={(event) => set({ emergency_contact_phone: event.target.value })} /></label>
      </div>
    </section>

    <div className="med-sticky"><button type="button" className="btn btn-primary btn-large" onClick={save} disabled={saving}>{saving && <LoaderCircle size={16} className="spin" />} {t('med.save')}</button></div>
    <PageFooter />
  </div>;
}

// The report is read in the browser. Only the values the patient accepts are saved.
function ReportReader({ vocabulary, onAdd }) {
  const { t, tx } = useTx();
  const input = useRef(null);
  const [state, setState] = useState('idle');
  const [found, setFound] = useState([]);
  const read = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setState('reading');
    try {
      const { extractReportText } = await import('../../services/reportOcr');
      const text = await extractReportText(file);
      const values = { ...parseReport(text), ...parseLipids(text) };
      setFound(Object.entries(values).filter(([key]) => FROM_REPORT[key]).map(([key, value]) => ({ key: FROM_REPORT[key], value, date: localDate(), source: 'report' })));
      setState('done');
    } catch {
      setState('error');
    }
  };
  return <>
    <input ref={input} type="file" accept="image/*,application/pdf" hidden onChange={read} />
    <button type="button" className="btn btn-ghost" disabled={state === 'reading'} onClick={() => input.current?.click()}>{state === 'reading' ? <LoaderCircle size={16} className="spin" /> : <FileUp size={16} />} {state === 'reading' ? t('med.health.reading') : t('med.health.fromReport')}</button>
    {state === 'error' && <p className="med-note" role="alert">{t('med.error')}</p>}
    {state === 'done' && <div className="med-context med-full">
      {found.length
        ? <>
          <strong>{t('med.health.reportFound')}</strong>
          <ul className="med-plain">{found.map((row) => <li key={row.key}>{tx(vocabulary.labs[row.key])}: <strong>{row.value} {vocabulary.labs[row.key].unit}</strong></li>)}</ul>
          <button type="button" className="btn btn-primary" onClick={() => { onAdd(found); setState('idle'); }}>{t('med.health.useValues')}</button>
        </>
        : <p>{t('med.health.reportNone')}</p>}
    </div>}
  </>;
}
