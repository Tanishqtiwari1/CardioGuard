import { useCallback, useEffect, useMemo, useState } from 'react';
import { CloudOff, Download, HeartPulse, MapPin, Phone, RefreshCcw, Search, ShieldAlert, Stethoscope, UserPlus, Users, Wifi, X } from 'lucide-react';
import EmergencyCheck from '../components/emergency/EmergencyCheck';
import ScreeningForm from '../components/screening/ScreeningForm';
import ScreeningResult from '../components/screening/ScreeningResult';
import { useAuth } from '../context/AuthContext';
import { useT } from '../i18n';
import { getPatient, updateReferral } from '../services/api';
import { flushOutbox, getOutbox, loadPatients, newClientId, queuePatient, queueScreening } from '../services/outbox';
import { downloadReferralSlip } from '../services/pdfReport';
import { loadScreeningModel, predictScreening } from '../services/screeningModel';

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}

// Server patients plus anything still waiting in the outbox, newest screening first.
function mergePatients(serverPatients, outbox) {
  const byClientId = new Map(serverPatients.map((patient) => [patient.client_id, { ...patient, synced: true }]));
  outbox.patients.forEach((patient) => {
    const existing = byClientId.get(patient.client_id);
    byClientId.set(patient.client_id, { screening_count: 0, latest: null, ...existing, ...patient, synced: Boolean(existing) });
  });
  outbox.screenings.forEach((screening) => {
    const patient = byClientId.get(screening.patient_client_id);
    if (!patient) return;
    const pending = { ...screening.result, client_id: screening.client_id, screened_at: screening.screened_at, referral_status: 'none', form_data: screening, pending: true };
    if (!patient.latest || new Date(pending.screened_at) >= new Date(patient.latest.screened_at)) patient.latest = pending;
    patient.screening_count += 1;
  });
  return [...byClientId.values()].sort((a, b) => new Date(b.latest?.screened_at || b.created_at || 0) - new Date(a.latest?.screened_at || a.created_at || 0));
}

const needsReferral = (patient) => patient.latest?.risk_category === 'HIGH' && patient.latest?.referral_status === 'none';

export default function Community() {
  const { t } = useT();
  const { user } = useAuth();
  const online = useOnline();
  const [serverPatients, setServerPatients] = useState([]);
  const [outbox, setOutbox] = useState(() => getOutbox(user.id));
  const [syncing, setSyncing] = useState(false);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [flow, setFlow] = useState(null);
  const [selected, setSelected] = useState(null);

  const refresh = useCallback(async () => {
    setSyncing(true);
    try { await flushOutbox(user.id); } catch { /* stays queued */ }
    const { patients } = await loadPatients(user.id);
    setServerPatients(patients);
    setOutbox(getOutbox(user.id));
    setSyncing(false);
  }, [user.id]);

  useEffect(() => { refresh(); loadScreeningModel().catch(() => {}); }, [refresh]);
  useEffect(() => { if (online) refresh(); }, [online, refresh]);

  const patients = useMemo(() => mergePatients(serverPatients, outbox), [serverPatients, outbox]);
  const pending = outbox.patients.length + outbox.screenings.length;
  const stats = {
    screened: patients.length,
    high: patients.filter((p) => p.latest?.risk_category === 'HIGH').length,
    toRefer: patients.filter(needsReferral).length,
    visited: patients.filter((p) => p.latest?.referral_status === 'visited').length,
  };
  const shown = patients.filter((patient) => {
    if (filter === 'refer' && !needsReferral(patient)) return false;
    if (filter === 'referred' && !['referred', 'visited'].includes(patient.latest?.referral_status)) return false;
    const text = `${patient.name} ${patient.village || ''}`.toLowerCase();
    return text.includes(query.trim().toLowerCase());
  });

  const saveScreening = async (person, values) => {
    const model = await loadScreeningModel();
    const result = predictScreening(model, values);
    queuePatient(user.id, person);
    queueScreening(user.id, { ...values, client_id: newClientId(), patient_client_id: person.client_id, screened_at: new Date().toISOString(), result });
    setOutbox(getOutbox(user.id));
    if (navigator.onLine) refresh();
    return result;
  };

  return <div className="community-page">
    <div className="page-heading">
      <div><span className="eyebrow"><Users size={13} /> {t('community.eyebrow')}</span><h1>{t('community.title')}</h1><p>{t('community.text')}</p></div>
      <div className="sync-box">
        <span className={`sync-status ${online ? 'online' : 'offline'}`}>{online ? <Wifi size={15} /> : <CloudOff size={15} />} {online ? t('community.online') : t('community.offline')}</span>
        {pending > 0 && <span className="sync-pending">{t('community.pending', { n: pending })}</span>}
        <button type="button" className="btn btn-ghost" onClick={refresh} disabled={!online || syncing}><RefreshCcw size={15} className={syncing ? 'spin' : ''} /> {t('community.syncNow')}</button>
      </div>
    </div>

    {flow
      ? <ScreeningFlow flow={flow} onSave={saveScreening} onClose={() => setFlow(null)} />
      : <>
        <div className="community-stats">
          <Stat icon={Users} label={t('community.statScreened')} value={stats.screened} />
          <Stat icon={HeartPulse} label={t('community.statHigh')} value={stats.high} tone="high" />
          <Stat icon={ShieldAlert} label={t('community.statToRefer')} value={stats.toRefer} tone="moderate" />
          <Stat icon={Stethoscope} label={t('community.statVisited')} value={stats.visited} tone="low" />
        </div>
        <section className="panel">
          <div className="community-toolbar">
            <div className="segmented">
              {[['all', 'community.filterAll'], ['refer', 'community.filterRefer'], ['referred', 'community.filterReferred']].map(([key, label]) => <button key={key} type="button" className={filter === key ? 'active' : ''} onClick={() => setFilter(key)}>{t(label)}</button>)}
            </div>
            <label className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('community.search')} /></label>
            <button type="button" className="btn btn-primary" onClick={() => setFlow({})}><UserPlus size={16} /> {t('community.newPerson')}</button>
          </div>
          {shown.length === 0
            ? <p className="muted-text community-empty">{t('community.empty')}</p>
            : <ul className="patient-list">{shown.map((patient) => <li key={patient.client_id}>
              <button type="button" onClick={() => setSelected(patient)}>
                <span className="patient-name"><strong>{patient.name}</strong><small>{[patient.latest?.form_data?.age ?? patient.age, patient.village].filter(Boolean).join(' · ')}</small></span>
                {patient.latest && <span className={`risk-chip ${patient.latest.risk_category.toLowerCase()}`}>{patient.latest.risk_probability.toFixed(1)}% · {t(`risk.${patient.latest.risk_category}`)}</span>}
                <span className={`referral-chip ${patient.latest?.referral_status || 'none'}`}>{needsReferral(patient) ? t('community.filterRefer') : t(`community.referral.${patient.latest?.referral_status || 'none'}`)}</span>
                {(!patient.synced || patient.latest?.pending) && <span className="unsynced"><CloudOff size={13} /> {t('community.notSynced')}</span>}
              </button>
            </li>)}</ul>}
        </section>
      </>}

    {selected && <PatientDrawer patient={selected} online={online} workerName={user.name}
      onClose={() => setSelected(null)}
      onChanged={refresh}
      onScreenAgain={() => { setFlow({ patient: selected }); setSelected(null); }} />}
  </div>;
}

function Stat({ icon: Icon, label, value, tone = '' }) {
  return <div className={`community-stat ${tone}`}><Icon size={18} /><strong>{value}</strong><span>{label}</span></div>;
}

function ScreeningFlow({ flow, onSave, onClose }) {
  const { t } = useT();
  const existing = flow.patient;
  const [stage, setStage] = useState('emergency');
  const [person, setPerson] = useState({
    client_id: existing?.client_id || newClientId(),
    name: existing?.name || '', village: existing?.village || '', phone: existing?.phone || '',
  });
  const [values, setValues] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const initial = existing?.latest?.form_data
    ? { ...existing.latest.form_data, client_id: undefined, patient_client_id: undefined }
    : existing ? { age: existing.age ?? 45, sex: existing.sex ?? 1 } : undefined;

  const submit = async (data) => {
    if (!person.name.trim()) { setError(t('community.errorName')); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    setError('');
    const record = { ...person, name: person.name.trim(), age: data.age, sex: data.sex, village: person.village || null, phone: person.phone || null };
    setValues(data);
    setResult(await onSave(record, data));
    setStage('result');
  };

  return <div className="screening-flow">
    <button type="button" className="btn btn-ghost flow-close" onClick={onClose}><X size={16} /> {t('community.close')}</button>
    {stage === 'emergency' && <EmergencyCheck onClear={() => setStage('form')} />}
    {stage === 'form' && <section className="panel">
      <ScreeningForm initial={initial} onSubmit={submit} onReport={(found) => { if (found.patient_name) setPerson((current) => ({ ...current, name: found.patient_name })); }}>
        <h3>{t('community.personDetails')}</h3>
        <div className="form-grid">
          <div className="field"><label>{t('community.name')}</label><input value={person.name} onChange={(event) => setPerson({ ...person, name: event.target.value })} required /></div>
          <div className="field"><label>{t('community.village')}</label><input value={person.village} onChange={(event) => setPerson({ ...person, village: event.target.value })} /></div>
          <div className="field"><label>{t('community.phone')}</label><input type="tel" inputMode="tel" value={person.phone} onChange={(event) => setPerson({ ...person, phone: event.target.value })} /></div>
        </div>
        {error && <div className="form-error">{error}</div>}
      </ScreeningForm>
    </section>}
    {stage === 'result' && result && <>
      {result.risk_category === 'HIGH' && <div className="refer-banner"><ShieldAlert size={18} /> {t('community.referNow')}</div>}
      <ScreeningResult result={result} values={values} actions={<button type="button" className="btn btn-primary" onClick={onClose}>{t('community.saved')} ✓</button>} />
    </>}
  </div>;
}

function PatientDrawer({ patient, online, workerName, onClose, onChanged, onScreenAgain }) {
  const { t } = useT();
  const [detail, setDetail] = useState(null);
  useEffect(() => {
    if (patient.synced && patient.id && online) getPatient(patient.id).then(setDetail).catch(() => {});
  }, [patient, online]);

  const screenings = detail?.screenings || (patient.latest ? [patient.latest] : []);
  const latest = screenings[0];
  const setReferral = async (status) => {
    const updated = await updateReferral(latest.id, status);
    setDetail((current) => ({ ...current, screenings: [updated, ...current.screenings.slice(1)] }));
    onChanged();
  };
  const canUpdate = online && latest?.id && !latest.pending;

  return <div className="drawer-backdrop" onClick={onClose}>
    <aside className="patient-drawer" onClick={(event) => event.stopPropagation()}>
      <div className="drawer-head"><div><h2>{patient.name}</h2><p className="muted-text">{[patient.village && <span key="v"><MapPin size={13} /> {patient.village}</span>, patient.phone && <a key="p" href={`tel:${patient.phone}`}><Phone size={13} /> {patient.phone}</a>]}</p></div><button type="button" className="icon-btn" onClick={onClose} aria-label={t('community.close')}><X size={18} /></button></div>
      {latest && <div className={`drawer-risk ${latest.risk_category.toLowerCase()}`}>
        <strong>{latest.risk_probability.toFixed(1)}%</strong><span>{t(`risk.${latest.risk_category}`)} · {t(`community.referral.${latest.referral_status}`)}</span>
      </div>}
      <div className="drawer-actions">
        {latest?.referral_status === 'none' && <button type="button" className="btn btn-primary" disabled={!canUpdate} onClick={() => setReferral('referred')}>{t('community.markReferred')}</button>}
        {latest?.referral_status === 'referred' && <button type="button" className="btn btn-primary" disabled={!canUpdate} onClick={() => setReferral('visited')}>{t('community.markVisited')}</button>}
        {latest && <button type="button" className="btn btn-ghost" onClick={() => downloadReferralSlip({ patient, screening: latest, workerName })}><Download size={15} /> {t('community.referralSlip')}</button>}
        <button type="button" className="btn btn-ghost" onClick={onScreenAgain}><RefreshCcw size={15} /> {t('community.screenAgain')}</button>
      </div>
      <h3>{t('community.history')}</h3>
      {!detail && patient.synced && <p className="muted-text">{online ? '…' : t('community.offlineDetail')}</p>}
      <ul className="drawer-history">{screenings.map((item) => <li key={item.client_id || item.id}>
        <span>{new Date(item.screened_at).toLocaleDateString()}</span>
        <span>BP {item.form_data.systolic_bp}</span>
        <span className={`risk-chip ${item.risk_category.toLowerCase()}`}>{item.risk_probability.toFixed(1)}%</span>
      </li>)}</ul>
    </aside>
  </div>;
}
