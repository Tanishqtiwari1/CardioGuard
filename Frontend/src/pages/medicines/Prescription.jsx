import { useRef, useState } from 'react';
import { Camera, Check, FileUp, LoaderCircle, Plus, Trash2 } from 'lucide-react';
import { getPrescriptions, parsePrescription, removePrescription, savePrescription } from '../../services/medicines';
import { readPrescriptionFile } from '../../services/medicineScan';
import { useToast } from '../../ui/toast';
import { ErrorState, Loading, MedicinePicker, PageFooter, PageHead, Status, instructionText, useLoad, useTx } from './shared';

const FREQUENCIES = ['once_daily', 'twice_daily', 'three_daily', 'four_daily', 'as_needed'];
const TIMINGS = ['morning', 'afternoon', 'evening', 'night', 'bedtime', 'before_breakfast', 'after_breakfast', 'before_lunch', 'after_lunch', 'before_dinner', 'after_dinner', 'empty_stomach'];
const FOOD = ['after_food', 'before_food', 'with_food'];
const EDITABLE = ['id', 'medicine_key', 'medicine_name', 'strength', 'dose', 'frequency', 'timing', 'food_relation', 'duration_days', 'instructions', 'confirmed'];

export default function Prescription() {
  const { t } = useTx();
  const toast = useToast();
  const list = useLoad(getPrescriptions);
  const [sourceType, setSourceType] = useState('digital');
  const [state, setState] = useState('idle');
  const [typed, setTyped] = useState('');
  const [editing, setEditing] = useState(null);
  const file = useRef(null);
  const camera = useRef(null);

  const parse = async (text, confidence) => {
    try {
      setEditing(await parsePrescription({ text, ocr_confidence: confidence ?? null, source_type: sourceType }));
      setState('idle');
      setTyped('');
    } catch (error) {
      setState(error.response?.status === 422 ? 'unreadable' : 'error');
    }
  };

  const onFile = async (event) => {
    const chosen = event.target.files?.[0];
    event.target.value = '';
    if (!chosen) return;
    setState('reading');
    try {
      const read = await readPrescriptionFile(chosen);
      await parse(read.text, read.confidence);
    } catch {
      setState('error');
    }
  };

  const remove = async (id) => {
    if (!window.confirm(t('med.rx.delete'))) return;
    try {
      await removePrescription(id);
      list.reload();
    } catch {
      toast(t('med.error'), { tone: 'error' });
    }
  };

  if (editing) return <Review prescription={editing} onDone={() => { setEditing(null); list.reload(); }} />;

  return <div className="med-page narrow">
    <PageHead title={t('med.rx.title')} text={t('med.rx.text')} />
    <section className="med-card">
      <div className="segmented" role="radiogroup" aria-label={t('med.rx.typed')}>
        {[['digital', 'med.rx.typed'], ['handwritten', 'med.rx.handwritten']].map(([value, key]) => <button key={value} type="button" role="radio" aria-checked={sourceType === value} className={sourceType === value ? 'active' : ''} onClick={() => setSourceType(value)}>{t(key)}</button>)}
      </div>
      {sourceType === 'handwritten' && <p className="med-note">{t('med.rx.handwrittenNote')}</p>}
      <input ref={file} type="file" accept="image/*,application/pdf" hidden onChange={onFile} />
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
      {state === 'reading'
        ? <div className="med-state" role="status"><LoaderCircle size={24} className="spin" /><p>{t('med.rx.reading')}</p></div>
        : <div className="med-actions">
          <button type="button" className="btn btn-primary btn-large" onClick={() => camera.current?.click()}><Camera size={18} /> {t('med.rx.camera')}</button>
          <button type="button" className="btn btn-ghost btn-large" onClick={() => file.current?.click()}><FileUp size={18} /> {t('med.rx.choose')}</button>
        </div>}
      {state === 'unreadable' && <p className="med-note" role="alert">{t('med.rx.unreadable')}</p>}
      {state === 'error' && <p className="med-note" role="alert">{t('med.error')}</p>}
      <label className="med-field"><span>{t('med.rx.typeIn')}</span><textarea rows={3} value={typed} onChange={(event) => setTyped(event.target.value)} placeholder={t('med.rx.typePlaceholder')} /></label>
      <button type="button" className="btn btn-ghost" disabled={!typed.trim()} onClick={() => parse(typed, null)}>{t('med.rx.readTyped')}</button>
    </section>

    {list.status === 'loading' && <Loading />}
    {list.status === 'error' && <ErrorState onRetry={list.reload} />}
    {list.status === 'ready' && (list.data.length === 0
      ? <p className="med-muted center">{t('med.rx.empty')}</p>
      : list.data.map((prescription) => <article key={prescription.id} className="med-card">
        <div className="med-row">
          <Status tone={prescription.status === 'confirmed' ? 'ok' : 'review'}>{t(`med.rx.status.${prescription.status}`)}</Status>
          <small className="med-muted">{prescription.prescribed_by}</small>
        </div>
        <ul className="med-rx-lines">
          {prescription.items.map((item) => <li key={item.id}><strong>{[item.medicine_name, item.strength].filter(Boolean).join(' ')}</strong><span>{instructionText(t, item) || t('med.rx.notStated')}</span></li>)}
        </ul>
        <div className="med-actions">
          <button type="button" className="btn btn-ghost" onClick={() => setEditing(prescription)}>{t('med.rx.review')}</button>
          <button type="button" className="btn btn-ghost" onClick={() => remove(prescription.id)}><Trash2 size={16} /> {t('med.remove')}</button>
        </div>
      </article>))}
    <PageFooter />
  </div>;
}

function Review({ prescription, onDone }) {
  const { t } = useTx();
  const toast = useToast();
  const [items, setItems] = useState(prescription.items);
  const [doctor, setDoctor] = useState(prescription.prescribed_by || '');
  const [saving, setSaving] = useState(false);
  const change = (index, changes) => setItems((list) => list.map((item, position) => (position === index ? { ...item, ...changes } : item)));
  const addLine = () => setItems((list) => [...list, { id: null, medicine_key: null, medicine_name: '', strength: '', frequency: null, timing: [], confirmed: false }]);
  const save = async () => {
    setSaving(true);
    try {
      const body = items.filter((item) => item.medicine_name).map((item) => Object.fromEntries(EDITABLE.map((key) => [key, item[key] === '' ? null : item[key] ?? (key === 'timing' ? [] : key === 'confirmed' ? false : null)])));
      await savePrescription(prescription.id, { items: body, prescribed_by: doctor || null, prescribed_on: prescription.prescribed_on || null });
      onDone();
    } catch {
      toast(t('med.error'), { tone: 'error' });
      setSaving(false);
    }
  };

  return <div className="med-page narrow">
    <PageHead back={null} title={t('med.rx.reviewTitle')} text={t('med.rx.reviewText')} />
    {items.map((item, index) => <Line key={item.id ?? `new-${index}`} item={item} onChange={(changes) => change(index, changes)} onRemove={() => setItems((list) => list.filter((_, position) => position !== index))} />)}
    <button type="button" className="btn btn-ghost" onClick={addLine}><Plus size={16} /> {t('med.rx.addLine')}</button>
    <label className="med-field"><span>{t('med.rx.prescribedBy')}</span><input value={doctor} onChange={(event) => setDoctor(event.target.value)} maxLength={120} /></label>
    {items.some((item) => !item.confirmed) && <p className="med-muted">{t('med.rx.needsAll')}</p>}
    <div className="med-sticky">
      <button type="button" className="btn btn-ghost" onClick={onDone}>{t('med.cancel')}</button>
      <button type="button" className="btn btn-primary" onClick={save} disabled={saving}><Check size={16} /> {t('med.rx.saveConfirm')}</button>
    </div>
  </div>;
}

function Line({ item, onChange, onRemove }) {
  const { t } = useTx();
  const [picking, setPicking] = useState(!item.medicine_name);
  const edit = (changes) => onChange({ ...changes, confirmed: false });
  const toggleTiming = (slot) => edit({ timing: item.timing.includes(slot) ? item.timing.filter((value) => value !== slot) : [...item.timing, slot] });
  const uncertain = item.confidence !== 'high';
  return <article className={`med-card med-rx-line ${item.confirmed ? 'done' : ''}`}>
    {item.raw_line && <p className="med-raw"><span>{t('med.rx.lineOriginal')}:</span> {item.raw_line}</p>}
    {uncertain && <Status tone="review">{t('med.conf.needs_confirmation')}</Status>}
    {item.candidates?.length > 0 && !item.medicine_key && <fieldset className="med-choices">
      <legend>{t('med.scan.didYouMean')}</legend>
      {item.candidates.map((candidate) => <button type="button" key={candidate.key} onClick={() => edit({ medicine_key: candidate.key, medicine_name: candidate.name })}>{candidate.name}</button>)}
    </fieldset>}
    <div className="med-field">
      <span>{t('med.rx.name')}</span>
      {picking
        ? <MedicinePicker initial={item.medicine_name || ''} onPick={(picked) => { edit({ medicine_key: picked.key, medicine_name: picked.name }); setPicking(false); }} />
        : <button type="button" className="med-value-btn" onClick={() => setPicking(true)}>{item.medicine_name}</button>}
    </div>
    <div className="med-grid-2">
      <label className="med-field"><span>{t('med.rx.strength')}</span><input value={item.strength || ''} onChange={(event) => edit({ strength: event.target.value })} placeholder="20 mg" /></label>
      <label className="med-field"><span>{t('med.rx.frequency')}</span>
        <select value={item.frequency || ''} onChange={(event) => edit({ frequency: event.target.value || null })}>
          <option value="">{t('med.rx.notStated')}</option>
          {FREQUENCIES.map((value) => <option key={value} value={value}>{t(`med.freq.${value}`)}</option>)}
        </select>
      </label>
      <label className="med-field"><span>{t('med.rx.food')}</span>
        <select value={item.food_relation || ''} onChange={(event) => edit({ food_relation: event.target.value || null })}>
          <option value="">{t('med.rx.notStated')}</option>
          {FOOD.map((value) => <option key={value} value={value}>{t(`med.food.${value}`)}</option>)}
        </select>
      </label>
      <label className="med-field"><span>{t('med.rx.duration')}</span><input type="number" min="1" max="730" value={item.duration_days || ''} onChange={(event) => edit({ duration_days: event.target.value ? Number(event.target.value) : null })} /></label>
    </div>
    <fieldset className="med-chips">
      <legend>{t('med.rx.timing')}</legend>
      {[...new Set([...TIMINGS, ...item.timing])].map((slot) => <button key={slot} type="button" className={item.timing.includes(slot) ? 'active' : ''} aria-pressed={item.timing.includes(slot)} onClick={() => toggleTiming(slot)}>{t(`med.timing.${slot}`)}</button>)}
    </fieldset>
    <label className="med-field"><span>{t('med.rx.instructions')}</span><input value={item.instructions || ''} onChange={(event) => edit({ instructions: event.target.value })} maxLength={300} /></label>
    <div className="med-row">
      <label className="med-check-row"><input type="checkbox" checked={item.confirmed} disabled={!item.medicine_name} onChange={(event) => onChange({ confirmed: event.target.checked })} /><span><strong>{t('med.rx.confirmLine')}</strong></span></label>
      <button type="button" className="med-link-btn" onClick={onRemove}>{t('med.rx.removeLine')}</button>
    </div>
  </article>;
}
