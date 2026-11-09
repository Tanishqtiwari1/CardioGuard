import { useState } from 'react';
import { BellRing, Camera, Check, ChevronRight, Clock3, FileUp, HeartPulse, Pill, ScanSearch, SkipForward, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatTime, getCabinet, getDoses, getPrescriptions, getTimeline, localDate, logDose, medicineLabel } from '../../services/medicines';
import { useToast } from '../../ui/toast';
import { ErrorState, Loading, MATCH_TONE, OVERALL_TONE, PageFooter, PageHead, RELATION_TONE, Status, SummaryGrid, instructionText, useLoad, useTx } from './shared';

export default function Home() {
  const { t } = useTx();
  const cabinet = useLoad(getCabinet);
  if (cabinet.status === 'loading') return <Loading />;
  if (cabinet.status === 'error') return <ErrorState onRetry={cabinet.reload} />;
  const { medicines, summary, issues } = cabinet.data;
  const empty = medicines.length === 0;

  return <div className="med-page">
    <PageHead back={null} eyebrow={t('med.eyebrow')} title={t('med.title')} text={t('med.subtitle')}>
      <Link className="btn btn-primary btn-large" to="/medicines/scan"><Camera size={19} /> {t('med.scan')}</Link>
      {!empty && <Link className="btn btn-ghost btn-large" to="/medicines/check"><ScanSearch size={19} /> {t('med.checkAll')}</Link>}
    </PageHead>

    {empty
      ? <section className="med-card med-empty">
        <span className="med-empty-icon"><Pill size={30} /></span>
        <h2>{t('med.cabinet.emptyTitle')}</h2>
        <p>{t('med.cabinet.emptyText')}</p>
        <Link className="btn btn-primary btn-large" to="/medicines/scan"><Camera size={19} /> {t('med.scan')}</Link>
      </section>
      : <>
        <section className="med-card">
          <h2>{t('med.summary.title')}</h2>
          <SummaryGrid summary={summary} />
          {issues.length > 0
            ? <div className="med-issue-links">
              {issues.slice(0, 4).map((issue) => <IssueLink key={issue.id} issue={issue} />)}
              {issues.length > 4 && <Link className="med-more" to="/medicines/check">{t('med.checkAll')} <ChevronRight size={15} /></Link>}
            </div>
            : <p className="med-muted">{t('med.issues.none')} {t('med.issues.noneNote')}</p>}
        </section>
        <Today />
        <Cabinet medicines={medicines} />
      </>}

    <nav className="med-links" aria-label={t('med.eyebrow')}>
      <Link to="/medicines/prescription"><FileUp size={20} /><span>{t('med.rx.title')}</span><PrescriptionCount /><ChevronRight size={17} /></Link>
      <Link to="/medicines/health"><UserRound size={20} /><span>{t('med.healthDetails')}</span><ChevronRight size={17} /></Link>
      <Link to="/medicines/emergency"><HeartPulse size={20} /><span>{t('med.emergencySummary')}</span><ChevronRight size={17} /></Link>
    </nav>
    {!empty && <Timeline />}
    <PageFooter />
  </div>;
}

function PrescriptionCount() {
  const list = useLoad(getPrescriptions);
  return list.data?.length ? <small className="med-count">{list.data.length}</small> : null;
}

function IssueLink({ issue }) {
  const { tx } = useTx();
  const tone = issue.severity === 'important' ? 'alert' : 'review';
  const to = issue.medicine_ids.length === 1 ? `/medicines/${issue.medicine_ids[0]}` : '/medicines/check';
  return <Link className={`med-issue-link ${tone}`} to={to}>
    <span><strong>{tx(issue.title)}</strong><small>{issue.medicine || tx(issue.body)}</small></span>
    <ChevronRight size={17} />
  </Link>;
}

function Cabinet({ medicines }) {
  const { t, tx, locale } = useTx();
  const date = (value) => (value ? new Date(value).toLocaleDateString(locale, { month: 'short', year: 'numeric' }) : t('med.notAvailable'));
  return <section className="med-card">
    <h2>{t('med.cabinet.title')}</h2>
    <ul className="med-cabinet">
      {medicines.map((medicine) => {
        const instructions = instructionText(t, medicine.prescription_item);
        return <li key={medicine.id}>
          <Link to={`/medicines/${medicine.id}`} className="med-cabinet-item">
            <div className="med-cabinet-name">
              <strong>{medicineLabel(medicine)}</strong>
              <span>{medicine.brand_name ? medicine.medicine_name : ''}</span>
              <small>{medicine.reference ? tx(medicine.reference.use_short) : t('med.detail.noInfo')}</small>
            </div>
            <dl className="med-cabinet-facts">
              <div><dt>{t('med.cabinet.condition')}</dt><dd><Status tone={RELATION_TONE[medicine.relationship.status]}>{t(`med.rel.${medicine.relationship.status}`)}</Status></dd></div>
              <div><dt>{t('med.cabinet.prescription')}</dt><dd><Status tone={MATCH_TONE[medicine.prescription_match.status]}>{t(`med.match.${medicine.prescription_match.status}`)}</Status></dd></div>
              <div><dt>{t('med.cabinet.timing')}</dt><dd>{instructions || t('med.rx.notStated')}</dd></div>
              <div><dt>{t('med.cabinet.reminder')}</dt><dd>{medicine.reminder_active ? t('med.cabinet.reminderOn') : t('med.cabinet.reminderOff')}</dd></div>
              <div><dt>{t('med.cabinet.expiry')}</dt><dd className={medicine.expiry_status === 'expired' ? 'med-expired' : ''}>{date(medicine.expiry_date)}</dd></div>
              <div><dt>{t('med.cabinet.scanned')}</dt><dd>{date(medicine.last_scanned_at)}</dd></div>
            </dl>
            <span className={`med-overall ${OVERALL_TONE[medicine.overall]}`} aria-hidden="true" />
          </Link>
        </li>;
      })}
    </ul>
  </section>;
}

const STATUS_ICON = { taken: Check, skipped: SkipForward, snoozed: Clock3 };
const STATUS_TONE = { taken: 'ok', skipped: 'alert', snoozed: 'review' };

function Today() {
  const { t, locale } = useTx();
  const toast = useToast();
  const today = localDate();
  const doses = useLoad(() => getDoses(today, 7), [today]);
  const [showHistory, setShowHistory] = useState(false);
  if (doses.status !== 'ready') return null;
  const [current, ...earlier] = doses.data;
  if (!doses.data.some((day) => day.doses.length)) return null;

  const mark = async (dose, status) => {
    try {
      await logDose({ reminder_id: dose.reminder_id, scheduled_date: dose.scheduled_date, scheduled_time: dose.scheduled_time, status, ...(status === 'snoozed' && { snooze_minutes: 15 }) });
      doses.reload();
    } catch {
      toast(t('med.error'), { tone: 'error' });
    }
  };

  return <section className="med-card">
    <h2><BellRing size={20} /> {t('med.today.title')}</h2>
    {current.doses.length === 0 && <p className="med-muted">{t('med.today.empty')}</p>}
    <ul className="med-doses">
      {current.doses.map((dose) => <li key={`${dose.reminder_id}-${dose.scheduled_time}`}>
        <div className="med-dose-copy"><strong>{formatTime(dose.scheduled_time, locale)}</strong><span>{medicineLabel(dose)}</span></div>
        {dose.status
          ? <div className="med-dose-done"><DoseStatus dose={dose} /><button type="button" className="med-link-btn" onClick={() => mark(dose, dose.status === 'taken' ? 'skipped' : 'taken')}>{dose.status === 'taken' ? t('med.dose.skipped') : t('med.dose.taken')}</button></div>
          : <div className="med-dose-actions">
            <button type="button" className="btn btn-primary" onClick={() => mark(dose, 'taken')}>{t('med.dose.taken')}</button>
            <button type="button" className="btn btn-ghost" onClick={() => mark(dose, 'snoozed')}>{t('med.dose.snooze')}</button>
            <button type="button" className="btn btn-ghost" onClick={() => mark(dose, 'skipped')}>{t('med.dose.skipped')}</button>
          </div>}
      </li>)}
    </ul>
    <p className="med-muted">{t('med.today.optional')}</p>
    {earlier.some((day) => day.doses.length) && <button type="button" className="med-link-btn" aria-expanded={showHistory} onClick={() => setShowHistory((open) => !open)}>{t('med.history.title')}</button>}
    {showHistory && <div className="med-history">{earlier.filter((day) => day.doses.length).map((day) => <div key={day.date}>
      <strong>{new Date(`${day.date}T00:00`).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })}</strong>
      <ul>{day.doses.map((dose) => <li key={`${dose.reminder_id}-${dose.scheduled_time}`}><span>{formatTime(dose.scheduled_time, locale)} {medicineLabel(dose)}</span><DoseStatus dose={dose} /></li>)}</ul>
    </div>)}</div>}
  </section>;

  function DoseStatus({ dose }) {
    if (!dose.status) return <Status tone="info">{t('med.history.notMarked')}</Status>;
    const Icon = STATUS_ICON[dose.status];
    return <span className={`med-status ${STATUS_TONE[dose.status]}`}><Icon size={15} aria-hidden="true" />{t(`med.dose.${dose.status}`)}{dose.snoozed_until && ` ${t('med.dose.until', { time: formatTime(dose.snoozed_until, locale) })}`}</span>;
  }
}

function Timeline() {
  const { t, locale } = useTx();
  const events = useLoad(getTimeline);
  if (events.status !== 'ready') return null;
  return <details className="med-card med-disclosure">
    <summary>{t('med.timeline.title')}</summary>
    {events.data.length === 0
      ? <p className="med-muted">{t('med.timeline.empty')}</p>
      : <ol className="med-timeline">{events.data.slice(0, 20).map((event) => <li key={event.id}>
        <time>{new Date(event.created_at).toLocaleDateString(locale, { day: 'numeric', month: 'short' })}</time>
        <span><strong>{t(`med.event.${event.event_type}`)}</strong><small>{event.summary}</small></span>
      </li>)}</ol>}
  </details>;
}
