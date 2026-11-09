import { useState } from 'react';
import { BellRing, CalendarPlus, Check, Clock3, LoaderCircle, Moon, Sparkles, Sun, Sunrise, Trash2, X } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  createReminder, deleteReminder, downloadCalendarFile, explainMedicine, formatTime, getCapabilities, getHealthProfile, getMedicine,
  localDate, medicineLabel, removeMedicine, setReminderActive, updateMedicine,
} from '../../services/medicines';
import { useToast } from '../../ui/toast';
import { ConfidenceBadge, ErrorState, Escalate, Loading, MATCH_TONE, PageFooter, PageHead, RELATION_TONE, SourceNote, Status, instructionText, useLoad, useTx } from './shared';

const ALERT_MATCHES = ['strength_mismatch', 'ingredient_difference', 'similar_name_mismatch'];

export default function Detail() {
  const { id } = useParams();
  const { t, tx } = useTx();
  const toast = useToast();
  const navigate = useNavigate();
  const medicine = useLoad(() => getMedicine(id), [id]);
  const profile = useLoad(getHealthProfile);
  const [view, setView] = useState('simple');
  if (medicine.status === 'loading') return <Loading />;
  if (medicine.status === 'error') return <ErrorState onRetry={medicine.reload} />;

  const data = medicine.data;
  const info = data.information;
  const match = data.prescription_match;
  const line = data.prescription_item;
  const isMismatch = ALERT_MATCHES.includes(match.status);
  const instructions = instructionText(t, line);
  const hasTiming = Boolean(line && (line.frequency || line.timing?.length));

  const remove = async () => {
    if (!window.confirm(t('med.detail.removeConfirm'))) return;
    try {
      await removeMedicine(data.id);
      navigate('/medicines');
    } catch {
      toast(t('med.error'), { tone: 'error' });
    }
  };
  const confirmMedicine = async () => {
    try {
      await updateMedicine(data.id, { user_confirmed: true });
      medicine.reload();
    } catch {
      toast(t('med.error'), { tone: 'error' });
    }
  };

  return <div className="med-page narrow">
    <PageHead title={medicineLabel(data)}>
      <ConfidenceBadge value={data.identification_confidence} />
    </PageHead>
    {data.brand_name && <p className="med-muted">{data.medicine_name}</p>}

    {!data.user_confirmed && <section className="med-card med-callout review"><p>{t('med.conf.needsText')}</p><button type="button" className="btn btn-primary" onClick={confirmMedicine}><Check size={16} /> {t('med.detail.confirm')}</button></section>}

    {isMismatch && <section className="med-card med-callout alert" role="alert">
      <h2>{t('med.detail.mismatchTitle')}</h2>
      <p>{tx(match.message)}</p>
      <div className="med-whatdo"><strong>{t('med.detail.whatDo')}</strong><p>{tx(match.advice)}</p></div>
      <Escalate kind="doctor" doctorPhone={profile.data?.doctor_phone} showRx medicines={[data]} />
    </section>}

    {!info && <section className="med-card"><Status tone="info">{t('med.detail.noInfo')}</Status><p>{t('med.detail.noInfoText')}</p></section>}

    {info && <section className="med-card">
      <div className="segmented" role="tablist" aria-label={t('med.detail.simple')}>
        {['simple', 'medical'].map((value) => <button key={value} type="button" role="tab" aria-selected={view === value} className={view === value ? 'active' : ''} onClick={() => setView(value)}>{t(`med.detail.${value}`)}</button>)}
      </div>
      <h2>{t('med.detail.what')}</h2>
      {view === 'simple' ? <p className="med-lead">{tx(info.what_is)}</p> : <p className="med-lead">{info.name}: {info.medical_type}.</p>}
      {view === 'simple' && <Simpler medicineId={data.id} />}
      <h2>{t('med.detail.uses')}</h2>
      <ul className="med-bullets">{info.uses.map((use) => <li key={use.en}>{tx(use)}</li>)}</ul>
      <dl className="med-facts">
        <div><dt>{t('med.detail.type')}</dt><dd>{view === 'simple' ? tx(info.type_label) : info.medical_type}</dd></div>
        <div><dt>{t('med.detail.strength')}</dt><dd>{data.strength || t('med.notAvailable')}</dd></div>
      </dl>
    </section>}

    <section className="med-card">
      <h2>{t('med.detail.relevant')}</h2>
      <Status tone={RELATION_TONE[data.relationship.status]}>{t(`med.rel.${data.relationship.status}`)}</Status>
      {data.relationship.conditions.length > 0
        ? <ul className="med-rel-list">{data.relationship.conditions.map((row) => <li key={row.key}><strong>{tx(row.label)}</strong><p>{tx(row.reason)}</p></li>)}</ul>
        : <p>{tx(data.relationship.summary)}</p>}
      {data.report_context.map((row) => <div key={row.lab} className="med-context"><strong>{t('med.detail.report')}</strong><p>{tx(row.text)}</p></div>)}
      {data.cautions.length > 0 && <div className="med-context"><strong>{t('med.detail.forYou')}</strong><ul className="med-bullets">{data.cautions.map((row) => <li key={row.text.en}>{tx(row.text)}</li>)}</ul></div>}
    </section>

    <section className="med-card">
      <h2>{t('med.detail.myRx')}</h2>
      {line ? <p className="med-lead">{[line.medicine_name, line.strength].filter(Boolean).join(' ')}</p> : <p>{tx(match.message)}</p>}
      <h3>{t('med.detail.rxMatch')}</h3>
      <Status tone={MATCH_TONE[match.status]}>{t(`med.match.${match.status}`)}</Status>
      {match.checks.length > 0 && <ul className="med-checks">{match.checks.map((check) => {
        const good = ['matches', 'available'].includes(check.status);
        const Icon = good ? Check : X;
        return <li key={check.key} className={good ? 'ok' : 'review'}><Icon size={16} aria-hidden="true" />{t(`med.check.${check.key}.${check.status}`)}</li>;
      })}</ul>}
      {!isMismatch && match.status !== 'no_prescription' && line === null && <p>{tx(match.message)}</p>}
    </section>

    <section className="med-card">
      <h2>{t('med.detail.how')}</h2>
      {hasTiming
        ? <>
          <div className="med-instruction"><TimingIcon slots={line.timing} /><strong>{instructions}</strong></div>
          {line.dose && <p>{line.dose}</p>}
          {line.instructions && <p>{line.instructions}</p>}
          {isMismatch ? <p className="med-note">{tx(match.advice)}</p> : <p className="med-muted">{t('med.detail.rxSays')}</p>}
        </>
        : <><p className="med-lead">{t('med.detail.noTiming')}</p><p>{t('med.detail.noTimingText')}</p></>}
    </section>

    {info && <section className="med-card">
      <h2>{t('med.detail.important')}</h2>
      <Expand title={t('med.detail.precautions')} items={info.precautions} />
      <Expand title={t('med.detail.sideEffects')} items={info.side_effects} />
      <details className="med-expand">
        <summary>{t('med.detail.interactions')}</summary>
        {data.issues.filter((issue) => issue.type === 'interaction').length
          ? <ul className="med-bullets">{data.issues.filter((issue) => issue.type === 'interaction').map((issue) => <li key={issue.id}><strong>{issue.interaction.medicines.join(' + ')}:</strong> {tx(issue.body)}</li>)}</ul>
          : <p>{t('med.detail.noInteractions')}</p>}
      </details>
      <Expand title={t('med.detail.seekHelp')} items={info.seek_help} />
    </section>}

    <Reminders medicine={data} onChange={medicine.reload} />

    <section className="med-card">
      <h2>{t('med.detail.pack')}</h2>
      <dl className="med-facts">
        <div><dt>{t('med.cabinet.expiry')}</dt><dd className={data.expiry_status === 'expired' ? 'med-expired' : ''}>{data.expiry_date || t('med.notAvailable')}</dd></div>
        {data.dosage_form && <div><dt>{t('med.detail.form')}</dt><dd>{data.dosage_form}</dd></div>}
        {data.manufacturer && <div><dt>{t('med.detail.manufacturer')}</dt><dd>{data.manufacturer}</dd></div>}
        {data.batch_number && <div><dt>{t('med.detail.batch')}</dt><dd>{data.batch_number}</dd></div>}
      </dl>
      <SourceNote source={data.source} />
    </section>

    <section className="med-card">
      <h2>{t('med.detail.questions')}</h2>
      <Escalate kind="pharmacist" doctorPhone={profile.data?.doctor_phone} medicines={[data]} />
    </section>

    <button type="button" className="med-link-btn danger" onClick={remove}><Trash2 size={15} /> {t('med.remove')}</button>
    <PageFooter />
  </div>;
}

function Expand({ title, items }) {
  const { tx } = useTx();
  return <details className="med-expand"><summary>{title}</summary><ul className="med-bullets">{items.map((item) => <li key={item.en}>{tx(item)}</li>)}</ul></details>;
}

function TimingIcon({ slots = [] }) {
  const text = slots.join(' ');
  const Icon = /night|bedtime|dinner/.test(text) ? Moon : /morning|breakfast/.test(text) ? Sunrise : /afternoon|lunch/.test(text) ? Sun : Clock3;
  return <Icon size={22} aria-hidden="true" />;
}

// Only offered when the server has AI enabled. The verified text above always stays on screen.
function Simpler({ medicineId }) {
  const { t, lang } = useTx();
  const capabilities = useLoad(getCapabilities);
  const [state, setState] = useState({ status: 'idle', text: null });
  if (!capabilities.data?.ai_available) return null;
  const run = async () => {
    setState({ status: 'loading', text: null });
    try {
      const result = await explainMedicine(medicineId, lang);
      setState({ status: 'done', text: result.generated ? result.text : null });
    } catch {
      setState({ status: 'done', text: null });
    }
  };
  if (state.text) return <div className="med-context"><p>{state.text}</p><small className="med-muted">{t('med.detail.aiNote')}</small></div>;
  return <button type="button" className="med-link-btn" onClick={run} disabled={state.status === 'loading'}>{state.status === 'loading' ? <LoaderCircle size={14} className="spin" /> : <Sparkles size={14} />} {t('med.detail.simpler')}</button>;
}

function Reminders({ medicine, onChange }) {
  const { t, locale } = useTx();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const act = async (action) => {
    try {
      await action();
      onChange();
    } catch {
      toast(t('med.error'), { tone: 'error' });
    }
  };
  const title = `CardioGuard: ${medicineLabel(medicine)}`;
  return <section className="med-card">
    <h2><BellRing size={19} /> {t('med.detail.reminders')}</h2>
    {medicine.reminders.length === 0 && <p className="med-muted">{t('med.remind.none')}</p>}
    <ul className="med-reminders">
      {medicine.reminders.map((reminder) => <li key={reminder.id}>
        <div><strong>{reminder.times.map((time) => formatTime(time, locale)).join(', ')}</strong>
          <small>{reminder.days_of_week?.length ? reminder.days_of_week.map((day) => new Date(2024, 0, 1 + day).toLocaleDateString(locale, { weekday: 'short' })).join(', ') : t('med.remind.everyDay')}{reminder.end_date && ` · ${t('med.remind.until', { date: reminder.end_date })}`}{!reminder.active && ` · ${t('med.remind.paused')}`}</small>
        </div>
        <div className="med-actions">
          <button type="button" className="btn btn-ghost" onClick={() => downloadCalendarFile(reminder, title)}><CalendarPlus size={15} /> {t('med.remind.calendar')}</button>
          <button type="button" className="btn btn-ghost" onClick={() => act(() => setReminderActive(reminder.id, !reminder.active))}>{reminder.active ? t('med.remind.pause') : t('med.remind.resume')}</button>
          <button type="button" className="btn btn-ghost" onClick={() => act(() => deleteReminder(reminder.id))}>{t('med.remind.delete')}</button>
        </div>
      </li>)}
    </ul>
    {medicine.reminders.length > 0 && <p className="med-muted">{t('med.remind.calendarNote')}</p>}
    {medicine.can_create_reminder
      ? (open ? <ReminderForm medicine={medicine} onDone={() => { setOpen(false); onChange(); }} onCancel={() => setOpen(false)} /> : medicine.reminders.length === 0 && <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}><BellRing size={16} /> {t('med.remind.create')}</button>)
      : <div className="med-blocked"><strong>{t('med.remind.blocked')}</strong><p>{t(`med.block.${medicine.reminder_blocked_reason}`)}</p></div>}
  </section>;
}

function ReminderForm({ medicine, onDone, onCancel }) {
  const { t, locale } = useTx();
  const toast = useToast();
  const line = medicine.prescription_item;
  const count = line.times_per_day;
  const suggested = medicine.suggested_reminder_times;
  const [times, setTimes] = useState(() => Array.from({ length: count }, (_, index) => suggested[index] || ''));
  const [specific, setSpecific] = useState(false);
  const [days, setDays] = useState([]);
  const [start, setStart] = useState(localDate());
  const [end, setEnd] = useState('');
  const [saving, setSaving] = useState(false);
  const valid = times.every(Boolean) && new Set(times).size === times.length && (!specific || days.length > 0);

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await createReminder({ cabinet_medicine_id: medicine.id, times, days_of_week: specific ? days : null, start_date: start, end_date: end || null });
      toast(t('med.remind.created'), { tone: 'success' });
      onDone();
    } catch (error) {
      const code = error.response?.data?.detail?.code;
      toast(code ? t(`med.block.${code}`) : t('med.error'), { tone: 'error' });
      setSaving(false);
    }
  };

  return <form className="med-reminder-form" onSubmit={submit}>
    <p className="med-context">{t('med.remind.fromRx', { text: instructionText(t, line) })}</p>
    <p className="med-muted">{suggested.length ? t('med.remind.adjust') : t('med.remind.chooseTime')}</p>
    <div className="med-grid-2">
      {times.map((value, index) => <label key={index} className="med-field"><span>{t('med.remind.time', { n: index + 1 })}</span><input type="time" required value={value} onChange={(event) => setTimes((list) => list.map((item, position) => (position === index ? event.target.value : item)))} /></label>)}
    </div>
    <div className="segmented" role="radiogroup" aria-label={t('med.remind.days')}>
      <button type="button" role="radio" aria-checked={!specific} className={!specific ? 'active' : ''} onClick={() => setSpecific(false)}>{t('med.remind.everyDay')}</button>
      <button type="button" role="radio" aria-checked={specific} className={specific ? 'active' : ''} onClick={() => setSpecific(true)}>{t('med.remind.specific')}</button>
    </div>
    {specific && <fieldset className="med-chips"><legend>{t('med.remind.days')}</legend>
      {[0, 1, 2, 3, 4, 5, 6].map((day) => <button key={day} type="button" className={days.includes(day) ? 'active' : ''} aria-pressed={days.includes(day)} onClick={() => setDays((list) => (list.includes(day) ? list.filter((item) => item !== day) : [...list, day]))}>{new Date(2024, 0, 1 + day).toLocaleDateString(locale, { weekday: 'short' })}</button>)}
    </fieldset>}
    <div className="med-grid-2">
      <label className="med-field"><span>{t('med.remind.start')}</span><input type="date" required value={start} onChange={(event) => setStart(event.target.value)} /></label>
      <label className="med-field"><span>{t('med.remind.end')}</span><input type="date" min={start} value={end} onChange={(event) => setEnd(event.target.value)} /></label>
    </div>
    <div className="med-actions">
      <button type="submit" className="btn btn-primary" disabled={!valid || saving}>{t('med.remind.save')}</button>
      <button type="button" className="btn btn-ghost" onClick={onCancel}>{t('med.cancel')}</button>
    </div>
  </form>;
}
