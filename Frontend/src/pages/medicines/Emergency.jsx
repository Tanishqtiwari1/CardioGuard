import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ErQr } from '../../components/sos/ErCard';
import { useAuth } from '../../context/AuthContext';
import { getEmergencySummary, getHealthProfile, giveEmergencyConsent, withdrawEmergencyConsent } from '../../services/medicines';
import { appLink, encodeCard, loadProfile, saveProfile } from '../../services/sos';
import { useToast } from '../../ui/toast';
import { ErrorState, Loading, PageFooter, PageHead, useLoad, useTx } from './shared';

// Hospital staff need the generic name, so a brand is always shown alongside it.
const medicineText = (summary) => summary.medicines.map((item) => [item.brand_name ? `${item.brand_name} (${item.name})` : item.name, item.strength].filter(Boolean).join(' ')).join(', ');
const resultsText = (summary) => summary.recent_results.map((row) => `${row.label} ${row.value} ${row.unit}${row.date ? ` (${row.date})` : ''}`).join('; ');
const contactText = (summary) => [summary.emergency_contact.name, summary.emergency_contact.phone].filter(Boolean).join(' ');

export default function Emergency() {
  const { t } = useTx();
  const toast = useToast();
  const profile = useLoad(getHealthProfile);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);

  const change = async (action) => {
    setBusy(true);
    try {
      await action();
      await profile.reload();
    } catch {
      toast(t('med.error'), { tone: 'error' });
    } finally {
      setBusy(false);
      setAgreed(false);
    }
  };

  if (profile.status === 'loading') return <Loading />;
  if (profile.status === 'error') return <ErrorState onRetry={profile.reload} />;
  const consented = Boolean(profile.data.emergency_consent_at);

  return <div className="med-page narrow">
    <PageHead title={t('med.emergency.title')} text={t('med.emergency.text')} />
    {consented
      ? <Summary onTurnOff={() => { if (window.confirm(t('med.emergency.turnOffConfirm'))) change(withdrawEmergencyConsent); }} busy={busy} />
      : <section className="med-card">
        <h2>{t('med.emergency.consentTitle')}</h2>
        <ul className="med-bullets">{[1, 2, 3].map((n) => <li key={n}>{t(`med.emergency.consent${n}`)}</li>)}</ul>
        <label className="med-check-row"><input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} /><span><strong>{t('med.emergency.agree')}</strong></span></label>
        <button type="button" className="btn btn-primary btn-large" disabled={!agreed || busy} onClick={() => change(giveEmergencyConsent)}>{t('med.emergency.turnOn')}</button>
      </section>}
    <PageFooter />
  </div>;
}

function Summary({ onTurnOff, busy }) {
  const { t } = useTx();
  const toast = useToast();
  const { user } = useAuth();
  const [summary, setSummary] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { getEmergencySummary().then(setSummary).catch(() => setFailed(true)); }, []);
  if (failed) return <ErrorState />;
  if (!summary) return <Loading />;

  const details = {
    name: user?.name || summary.name,
    medicines: medicineText(summary),
    allergies: summary.allergies.join(', '),
    conditions: summary.conditions.join(', '),
  };
  const url = appLink(`/er/${encodeCard(details, null, null, { vitals: resultsText(summary), contact: contactText(summary) })}`);
  const addToSos = () => {
    const current = loadProfile();
    saveProfile({ ...current, name: current.name || details.name, medicines: details.medicines, allergies: details.allergies, conditions: details.conditions });
    toast(t('med.emergency.sosAdded'), { tone: 'success' });
  };
  const none = t('med.emergency.none');
  return <>
    <section className="med-card">
      <dl className="med-emergency">
        <div className="alert"><dt>{t('med.emergency.allergies')}</dt><dd>{details.allergies || none}</dd></div>
        <div><dt>{t('med.emergency.medicines')}</dt><dd>{details.medicines || none}</dd></div>
        <div><dt>{t('med.emergency.conditions')}</dt><dd>{details.conditions || none}</dd></div>
        <div><dt>{t('med.emergency.results')}</dt><dd>{resultsText(summary) || none}</dd></div>
        <div><dt>{t('med.emergency.contact')}</dt><dd>{contactText(summary) || none}</dd></div>
      </dl>
      <div className="med-actions">
        <Link className="btn btn-ghost" to="/medicines/health">{t('med.emergency.editDetails')}</Link>
        <button type="button" className="btn btn-ghost" onClick={addToSos}>{t('med.emergency.addSos')}</button>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={onTurnOff}>{t('med.emergency.turnOff')}</button>
      </div>
    </section>
    <section className="med-card med-qr">
      <h2>{t('med.emergency.qr')}</h2>
      <ErQr url={url} alt={t('med.emergency.qr')} enlargeLabel={t('med.emergency.enlarge')} closeLabel={t('med.emergency.close')} />
    </section>
  </>;
}
