import { useEffect, useRef, useState } from 'react';
import { Camera, Check, FileUp, ImagePlus, Keyboard, LoaderCircle, RotateCcw, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { addMedicine, getCabinet, getCapabilities, identifyMedicine, readImageWithAi } from '../../services/medicines';
import { checkPhoto, readPhoto, releaseOcr } from '../../services/medicineScan';
import { useToast } from '../../ui/toast';
import { ConfidenceBadge, MedicinePicker, PageFooter, PageHead, Status, SummaryGrid, useTx } from './shared';

let nextScanId = 1;

export default function Scan() {
  const { t } = useTx();
  const toast = useToast();
  const [step, setStep] = useState('capture');
  const [scans, setScans] = useState([]);
  const [aiAvailable, setAiAvailable] = useState(false);
  const [enhanced, setEnhanced] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const camera = useRef(null);
  const gallery = useRef(null);
  const retakeTarget = useRef(null);
  const queue = useRef(Promise.resolve());
  const urls = useRef([]);

  useEffect(() => {
    getCapabilities().then((data) => setAiAvailable(data.ai_available)).catch(() => {});
    return () => {
      urls.current.forEach((url) => URL.revokeObjectURL(url));
      releaseOcr().catch(() => {});
    };
  }, []);

  useEffect(() => { window.scrollTo({ top: 0 }); }, [step]);

  const patch = (id, changes) => setScans((list) => list.map((scan) => (scan.id === id ? { ...scan, ...changes } : scan)));

  const process = async (id, file, useAi) => {
    try {
      patch(id, { stage: 'checking', error: false });
      const issues = await checkPhoto(file);
      if (issues.length) {
        patch(id, { stage: null, result: await identifyMedicine({ text: '', quality_issues: issues }) });
        return;
      }
      patch(id, { stage: 'reading' });
      const read = useAi ? { text: (await readImageWithAi(file)).text, confidence: null, cutOff: false } : await readPhoto(file);
      patch(id, { stage: 'matching' });
      const result = await identifyMedicine({ text: read.text, ocr_confidence: read.confidence });
      if (result.status === 'unable' && read.cutOff) result.reason = 'text_cut_off';
      patch(id, { stage: null, result, draft: draftFrom(result) });
    } catch {
      patch(id, { stage: null, error: true });
    }
  };

  // Photos are read one at a time so a phone doesn't run out of memory.
  const enqueue = (files, replaceId) => {
    files.forEach((file, index) => {
      const url = URL.createObjectURL(file);
      urls.current.push(url);
      const id = replaceId && index === 0 ? replaceId : nextScanId++;
      setScans((list) => {
        const scan = { id, preview: url, stage: 'checking', result: null, error: false, saved: false };
        return list.some((item) => item.id === id) ? list.map((item) => (item.id === id ? scan : item)) : [...list, scan];
      });
      queue.current = queue.current.then(() => process(id, file, enhanced));
    });
  };

  const onFiles = (event) => {
    const files = [...event.target.files];
    event.target.value = '';
    if (files.length) enqueue(files, retakeTarget.current);
    retakeTarget.current = null;
  };

  const retake = (id) => { retakeTarget.current = id; camera.current?.click(); };
  const discard = (id) => setScans((list) => list.filter((scan) => scan.id !== id));
  const addManual = (item) => {
    setManualOpen(false);
    setScans((list) => [...list, {
      id: nextScanId++, preview: null, stage: null, error: false, saved: false, manual: true,
      result: { status: 'needs_confirmation', medicine_key: item.key, medicine_name: item.name, strength: null, candidates: [], notes: [], known_strengths: item.strengths },
      draft: { medicine_key: item.key, medicine_name: item.name, strength: '', brand_name: null, known: item.strengths },
    }]);
    setStep('review');
  };

  const save = async (scan) => {
    const { result, draft } = scan;
    try {
      await addMedicine({
        medicine_key: draft.medicine_key, medicine_name: draft.medicine_name, brand_name: draft.brand_name || null,
        strength: draft.strength || null, dosage_form: result.dosage_form || null, manufacturer: result.manufacturer || null,
        expiry_date: draft.expiry_date || null, batch_number: result.batch_number || null,
        identification_confidence: scan.manual ? 'manual' : result.status, entry_method: scan.manual ? 'manual' : 'scan', user_confirmed: true,
      });
      patch(scan.id, { saved: true });
    } catch {
      toast(t('med.error'), { tone: 'error' });
    }
  };

  const done = scans.filter((scan) => !scan.stage);
  const busy = scans.some((scan) => scan.stage);
  const pending = scans.filter((scan) => scan.result && !scan.saved);
  const found = done.filter((scan) => scan.result && scan.result.status !== 'unable').length;

  const inputs = <>
    <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={onFiles} />
    <input ref={gallery} type="file" accept="image/*" multiple hidden onChange={onFiles} />
  </>;

  if (step === 'result') return <ScanResult scans={scans} onMore={() => { setScans([]); setStep('capture'); }} />;

  if (step === 'review') {
    return <div className="med-page narrow">
      {inputs}
      <PageHead back={null} title={t('med.scan.reviewTitle')} text={t('med.scan.reviewText')} />
      {scans.filter((scan) => !scan.saved).map((scan) => <ReviewCard key={scan.id} scan={scan} patch={patch} onSave={save} onRetake={retake} onDiscard={discard} />)}
      <div className="med-sticky">
        <button type="button" className="btn btn-ghost" onClick={() => setStep('capture')}>{t('med.back')}</button>
        <button type="button" className="btn btn-primary" onClick={() => setStep('result')} disabled={!scans.some((scan) => scan.saved)}>{t('med.scan.viewDetails')}</button>
      </div>
      {pending.length > 0 && <p className="med-muted center">{t('med.scan.reviewText')}</p>}
    </div>;
  }

  return <div className="med-page narrow">
    {inputs}
    <PageHead title={t('med.scan.title')} text={t('med.scan.text')} />
    <div className="med-capture">
      <button type="button" className="med-capture-main" onClick={() => camera.current?.click()}>
        <Camera size={34} /><span>{scans.length ? t('med.scan.next', { n: scans.length + 1 }) : t('med.scan.button')}</span>
      </button>
      <div className="med-actions">
        <button type="button" className="btn btn-ghost" onClick={() => gallery.current?.click()}><ImagePlus size={17} /> {t('med.scan.gallery')}</button>
        <Link className="btn btn-ghost" to="/medicines/prescription"><FileUp size={17} /> {t('med.uploadRx')}</Link>
        <button type="button" className="btn btn-ghost" aria-expanded={manualOpen} onClick={() => setManualOpen((open) => !open)}><Keyboard size={17} /> {t('med.scan.manual')}</button>
      </div>
      {manualOpen && <MedicinePicker onPick={addManual} />}
      <p className="med-muted">{t('med.scan.tips')}</p>
      {aiAvailable
        ? <label className="med-check-row"><input type="checkbox" checked={enhanced} onChange={(event) => setEnhanced(event.target.checked)} /><span><strong>{t('med.scan.enhanced')}</strong><small>{t('med.scan.enhancedNote')}</small></span></label>
        : null}
      {!enhanced && <p className="med-muted">{t('med.scan.privacy')}</p>}
    </div>

    {scans.length > 0 && <section className="med-card" aria-live="polite">
      <h2>{t('med.scan.found')}</h2>
      {found > 0 && <p>{found === 1 ? t('med.scan.foundOne') : t('med.scan.foundCount', { n: found })}</p>}
      <ol className="med-scan-list">
        {scans.map((scan) => <li key={scan.id}>
          {scan.preview && <img src={scan.preview} alt="" />}
          <span className="med-scan-copy">
            {scan.stage
              ? <><LoaderCircle size={17} className="spin" /> {t(`med.scan.stage.${scan.stage}`)}</>
              : scan.error
                ? <>{t('med.error')}</>
                : scan.result.status === 'unable'
                  ? <strong>{t('med.scan.unclear')}</strong>
                  : <strong>{[scan.result.brand_name || scan.result.medicine_name || scan.result.candidates?.[0]?.name, scan.result.strength].filter(Boolean).join(' ')}</strong>}
          </span>
          {scan.result && <ConfidenceBadge value={scan.result.status} />}
        </li>)}
      </ol>
      <button type="button" className="btn btn-primary btn-large" disabled={busy || !done.some((scan) => scan.result)} onClick={() => setStep('review')}>{t('med.scan.review')}</button>
    </section>}
    <PageFooter />
  </div>;
}

function draftFrom(result) {
  return {
    medicine_key: result.medicine_key,
    medicine_name: result.medicine_name,
    brand_name: result.brand_name,
    strength: result.strength || '',
    expiry_date: result.expiry_date || '',
    known: result.known_strengths || [],
  };
}

function ReviewCard({ scan, patch, onSave, onRetake, onDiscard }) {
  const { t } = useTx();
  const { result, draft } = scan;
  const update = (changes) => patch(scan.id, { draft: { ...draft, ...changes } });
  const choose = (item) => update({ medicine_key: item.key, medicine_name: item.name, brand_name: null, known: item.strengths || [], strength: (item.strengths || []).includes(draft?.strength) ? draft.strength : '' });

  if (scan.error) {
    return <article className="med-card"><p>{t('med.error')}</p><div className="med-actions"><button type="button" className="btn btn-primary" onClick={() => onRetake(scan.id)}><RotateCcw size={16} /> {t('med.scan.retake')}</button><button type="button" className="btn btn-ghost" onClick={() => onDiscard(scan.id)}><Trash2 size={16} /> {t('med.scan.notThis')}</button></div></article>;
  }
  if (!result) return null;

  if (result.status === 'unable' && !draft?.medicine_name) {
    const specific = ['blurry', 'too_dark', 'glare', 'too_small', 'text_cut_off', 'unreadable_text', 'name_not_found'].includes(result.reason);
    return <article className="med-card med-review">
      {scan.preview && <img className="med-review-photo" src={scan.preview} alt="" />}
      <Status tone="alert">{t('med.conf.unable')}</Status>
      <h3>{t('med.reason.title')}</h3>
      <p>{specific && `${t(`med.reason.${result.reason}`)} `}{t('med.reason.retake')}</p>
      <div className="med-actions">
        <button type="button" className="btn btn-primary" onClick={() => onRetake(scan.id)}><RotateCcw size={16} /> {t('med.scan.retake')}</button>
        <button type="button" className="btn btn-ghost" onClick={() => onDiscard(scan.id)}><Trash2 size={16} /> {t('med.scan.notThis')}</button>
      </div>
      <p className="med-muted">{t('med.scan.searchInstead')}</p>
      <MedicinePicker onPick={(item) => patch(scan.id, { draft: { medicine_key: item.key, medicine_name: item.name, brand_name: null, strength: '', expiry_date: '', known: item.strengths || [] }, result: { ...result, status: 'needs_confirmation' }, manual: true })} />
    </article>;
  }

  const needsChoice = !draft?.medicine_name;
  const custom = draft?.strength && !draft.known.includes(draft.strength);
  return <article className="med-card med-review">
    {scan.preview && <img className="med-review-photo" src={scan.preview} alt="" />}
    <ConfidenceBadge value={scan.manual ? 'manual' : result.status} />
    {!scan.manual && <p className="med-muted">{result.status === 'high' ? t('med.conf.highText') : t('med.conf.needsText')}</p>}
    {result.notes?.map((note) => <p key={note} className="med-note">{t(`med.notes.${note}`)}</p>)}

    {result.candidates?.length > 0 && <fieldset className="med-choices">
      <legend>{t('med.scan.didYouMean')}</legend>
      {result.candidates.map((item) => <button type="button" key={item.key} className={draft?.medicine_key === item.key ? 'active' : ''} aria-pressed={draft?.medicine_key === item.key} onClick={() => choose(item)}>{item.name}</button>)}
    </fieldset>}

    {!needsChoice && <>
      <h3>{[draft.brand_name, draft.medicine_name].filter(Boolean).join(' · ')}</h3>
      <label className="med-field"><span>{t('med.scan.chooseStrength')}</span>
        {draft.known.length > 0
          ? <select value={draft.strength} onChange={(event) => update({ strength: event.target.value })}>
            <option value="">{t('med.scan.strengthUnknown')}</option>
            {custom && <option value={draft.strength}>{draft.strength}</option>}
            {draft.known.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          : <input value={draft.strength} onChange={(event) => update({ strength: event.target.value })} placeholder="20 mg" />}
      </label>
      <label className="med-field"><span>{t('med.cabinet.expiry')}</span><input type="date" value={draft.expiry_date || ''} onChange={(event) => update({ expiry_date: event.target.value })} /></label>
      {(result.dosage_form || result.manufacturer || result.batch_number) && <dl className="med-facts">
        {result.dosage_form && <div><dt>{t('med.detail.form')}</dt><dd>{result.dosage_form}</dd></div>}
        {result.manufacturer && <div><dt>{t('med.detail.manufacturer')}</dt><dd>{result.manufacturer}</dd></div>}
        {result.batch_number && <div><dt>{t('med.detail.batch')}</dt><dd>{result.batch_number}</dd></div>}
      </dl>}
    </>}

    <div className="med-actions">
      <button type="button" className="btn btn-primary" disabled={needsChoice} onClick={() => onSave(scan)}><Check size={16} /> {t('med.scan.yes')}</button>
      {scan.preview && <button type="button" className="btn btn-ghost" onClick={() => onRetake(scan.id)}><RotateCcw size={16} /> {t('med.scan.retake')}</button>}
      <button type="button" className="btn btn-ghost" onClick={() => onDiscard(scan.id)}><Trash2 size={16} /> {t('med.scan.notThis')}</button>
    </div>
  </article>;
}

function ScanResult({ scans, onMore }) {
  const { t, tn } = useTx();
  const [data, setData] = useState(null);
  useEffect(() => { getCabinet().then(setData).catch(() => setData(false)); }, []);
  const saved = scans.filter((scan) => scan.saved).length;
  const unconfirmed = scans.filter((scan) => scan.result && !scan.saved).length;
  const matches = data ? data.medicines.filter((item) => item.prescription_match.status === 'match').length : 0;
  const noPrescription = data && data.medicines.every((item) => item.prescription_match.status === 'no_prescription');
  return <div className="med-page narrow">
    <PageHead back={null} title={t('med.scan.resultTitle')} />
    <section className="med-card">
      <ul className="med-summary">
        <li className="ok"><Check size={20} /><span>{tn('med.scan.identified', saved)}</span></li>
        {unconfirmed > 0 && <li className="review"><Camera size={20} /><span>{tn('med.scan.needsConfirm', unconfirmed)}</span></li>}
        {data && !noPrescription && <li className="ok"><Check size={20} /><span>{tn('med.scan.rxMatches', matches)}</span></li>}
      </ul>
      {data && <SummaryGrid summary={data.summary} />}
      <div className="med-actions">
        <Link className="btn btn-primary btn-large" to="/medicines/check">{t('med.scan.viewDetails')}</Link>
        {noPrescription && <Link className="btn btn-ghost btn-large" to="/medicines/prescription"><FileUp size={18} /> {t('med.scan.addRx')}</Link>}
        <button type="button" className="btn btn-ghost btn-large" onClick={onMore}><Camera size={18} /> {t('med.scan.scanMore')}</button>
      </div>
    </section>
    <PageFooter />
  </div>;
}
