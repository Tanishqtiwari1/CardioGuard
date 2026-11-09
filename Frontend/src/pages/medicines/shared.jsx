import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, CircleHelp, ExternalLink, FileText, LoaderCircle, Phone, Pill, Search, Share2, ShieldCheck, Stethoscope, Store, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useT } from '../../i18n';
import { medicineLabel, searchReference } from '../../services/medicines';
import { useToast } from '../../ui/toast';

export function useTx() {
  const { t, lang } = useT();
  // English needs a singular form ("1 needs review"). Hindi falls back to the shared sentence.
  const tn = (key, n) => t(lang === 'en' && n === 1 ? `${key}.one` : key, { n });
  return { t, tn, lang, tx: (value) => value?.[lang] ?? value?.en ?? '', locale: lang === 'hi' ? 'hi-IN' : 'en-IN' };
}

export function useLoad(loader, deps = []) {
  const [state, setState] = useState({ status: 'loading', data: null });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(loader, deps);
  const reload = useCallback(async () => {
    try {
      const data = await run();
      setState({ status: 'ready', data });
    } catch {
      setState((current) => (current.data ? current : { status: 'error', data: null }));
    }
  }, [run]);
  useEffect(() => {
    let active = true;
    run().then((data) => { if (active) setState({ status: 'ready', data }); }).catch(() => { if (active) setState({ status: 'error', data: null }); });
    return () => { active = false; };
  }, [run]);
  return { ...state, reload, setData: (data) => setState({ status: 'ready', data }) };
}

const ICONS = { ok: CheckCircle2, review: AlertTriangle, alert: XCircle, info: CircleHelp };

/** A status always carries a word and an icon, so it never depends on colour alone. */
export function Status({ tone = 'info', children }) {
  const Icon = ICONS[tone];
  return <span className={`med-status ${tone}`}><Icon size={15} aria-hidden="true" />{children}</span>;
}

export const OVERALL_TONE = { consistent: 'ok', other_use: 'info', needs_information: 'info', needs_verification: 'review', mismatch: 'alert' };
export const RELATION_TONE = { commonly_used: 'ok', may_be_related: 'review', not_directly_related: 'info', needs_verification: 'alert', no_conditions: 'info' };
export const MATCH_TONE = { match: 'ok', strength_mismatch: 'alert', ingredient_difference: 'alert', similar_name_mismatch: 'alert', needs_verification: 'review', not_on_prescription: 'review', no_prescription: 'info' };
export const CONFIDENCE_TONE = { high: 'ok', needs_confirmation: 'review', unable: 'alert', manual: 'info' };

export function ConfidenceBadge({ value }) {
  const { t } = useTx();
  return <Status tone={CONFIDENCE_TONE[value] || 'info'}>{t(`med.conf.${value}`)}</Status>;
}

export function PageHead({ back = '/medicines', eyebrow, title, text, children }) {
  const { t } = useTx();
  return <header className="med-head">
    <div className="med-head-top">
      {back && <Link className="med-back" to={back}><ArrowLeft size={17} /> {t('med.back')}</Link>}
    </div>
    {eyebrow && <span className="eyebrow">{eyebrow}</span>}
    <h1>{title}</h1>
    {text && <p>{text}</p>}
    {children && <div className="med-actions">{children}</div>}
  </header>;
}

export function Loading({ label }) {
  const { t } = useTx();
  return <div className="med-state" role="status"><LoaderCircle size={26} className="spin" /><p>{label || t('med.loading')}</p></div>;
}

export function ErrorState({ onRetry }) {
  const { t } = useTx();
  return <div className="med-state" role="alert"><AlertTriangle size={26} /><p>{t('med.error')}</p>{onRetry && <button type="button" className="btn btn-ghost" onClick={onRetry}>{t('med.retry')}</button>}</div>;
}

export function PageFooter() {
  const { t } = useTx();
  return <p className="med-footer"><ShieldCheck size={15} /> {t('med.footer')}</p>;
}

export function SummaryGrid({ summary }) {
  const { tn } = useTx();
  const rows = [
    ['ok', summary.consistent, 'med.summary.consistent'],
    ['review', summary.needs_verification, 'med.summary.verify'],
    ['alert', summary.mismatches, 'med.summary.mismatch'],
    ['alert', summary.allergies, 'med.summary.allergy'],
    ['alert', summary.expired, 'med.summary.expired'],
    ['review', summary.duplicates, 'med.summary.duplicates'],
    ['review', summary.interactions, 'med.summary.interactions'],
    ['info', summary.other_use, 'med.summary.other'],
    ['info', summary.needs_information, 'med.summary.info'],
  ];
  // Always show the main five, including at zero, so "0 duplicates" is visible. Extra rows only when they apply.
  const always = new Set(['med.summary.consistent', 'med.summary.verify', 'med.summary.mismatch', 'med.summary.duplicates', 'med.summary.interactions']);
  return <ul className="med-summary">
    {rows.filter(([, count, key]) => always.has(key) || count > 0).map(([tone, count, key]) => {
      const Icon = ICONS[count === 0 && tone !== 'ok' ? 'ok' : tone];
      return <li key={key} className={count === 0 ? 'zero' : tone}><Icon size={20} aria-hidden="true" /><span>{tn(key, count)}</span></li>;
    })}
  </ul>;
}

export function SourceNote({ source }) {
  const { t, locale } = useTx();
  if (!source) return null;
  const when = (value) => new Date(value).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
  const label = source.labels?.[0];
  const url = source.url || label?.url;
  return <aside className="med-source">
    <strong>{t('med.source.title')}</strong>
    <span>{source.name}{source.kind === 'fda_label' && ` · ${t('med.source.labelDate', { date: when(source.version) })}`}</span>
    <span>{source.last_verified ? t('med.source.lastVerified', { date: when(source.last_verified) }) : t('med.source.notVerified')}</span>
    <span>{t('med.source.pending')}</span>
    {url && <a href={url} target="_blank" rel="noreferrer">{t('med.source.view')} <ExternalLink size={13} /></a>}
  </aside>;
}

export function buildShareText(medicines, t) {
  const lines = medicines.map((medicine) => `- ${medicineLabel(medicine)}`);
  return [t('med.share.title'), ...lines, '', t('med.share.note')].join('\n');
}

export function ShareSummary({ medicines }) {
  const { t } = useTx();
  const toast = useToast();
  const share = async () => {
    const text = buildShareText(medicines, t);
    try {
      if (navigator.share) { await navigator.share({ text }); return; }
      await navigator.clipboard.writeText(text);
      toast(t('med.help.copied'), { tone: 'success' });
    } catch { /* The patient closed the share sheet. */ }
  };
  return <button type="button" className="btn btn-ghost" onClick={share}><Share2 size={16} /> {t('med.help.share')}</button>;
}

/** Next steps when something needs a professional. Links into the existing provider search. */
export function Escalate({ kind = 'pharmacist', doctorPhone, medicines = [], showRx = false }) {
  const { t } = useTx();
  const doctorFirst = kind === 'doctor';
  const doctor = <Link key="doctor" className={`btn ${doctorFirst ? 'btn-primary' : 'btn-ghost'}`} to="/specialists"><Stethoscope size={16} /> {t('med.help.findDoctor')}</Link>;
  const pharmacy = <Link key="pharmacy" className={`btn ${doctorFirst ? 'btn-ghost' : 'btn-primary'}`} to="/specialists?type=pharmacy"><Store size={16} /> {t('med.help.findPharmacy')}</Link>;
  return <div className="med-escalate">
    <strong>{doctorFirst ? t('med.help.doctor') : t('med.help.pharmacist')}</strong>
    <div className="med-actions">
      {doctorFirst ? [doctor, pharmacy] : [pharmacy, doctor]}
      {doctorPhone && <a className="btn btn-ghost" href={`tel:${doctorPhone.replace(/\s/g, '')}`}><Phone size={16} /> {t('med.help.callDoctor')}</a>}
      {showRx && <Link className="btn btn-ghost" to="/medicines/prescription"><FileText size={16} /> {t('med.help.viewRx')}</Link>}
      {medicines.length > 0 && <ShareSummary medicines={medicines} />}
    </div>
  </div>;
}

/** Search the reference by name. Offers a typed name only when `allowTyped` is set. */
export function MedicinePicker({ onPick, allowTyped = true, initial = '' }) {
  const { t } = useTx();
  const [query, setQuery] = useState(initial);
  const [results, setResults] = useState(null);
  useEffect(() => {
    const needle = query.trim();
    if (needle.length < 2) { setResults(null); return undefined; }
    let active = true;
    const timer = setTimeout(() => {
      searchReference(needle).then((found) => { if (active) setResults(found); }).catch(() => { if (active) setResults([]); });
    }, 220);
    return () => { active = false; clearTimeout(timer); };
  }, [query]);
  return <div className="med-picker">
    <label className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('med.manual.placeholder')} aria-label={t('med.manual.placeholder')} /></label>
    {results && <ul className="med-picker-list">
      {results.map((item) => <li key={item.key}><button type="button" onClick={() => onPick(item)}><Pill size={15} /><span><strong>{item.name}</strong>{item.brands.length > 0 && <small>{item.brands.join(', ')}</small>}</span></button></li>)}
      {results.length === 0 && !allowTyped && <li className="med-muted">{t('med.manual.noResults')}</li>}
      {allowTyped && <li><button type="button" className="typed" onClick={() => onPick({ key: null, name: query.trim(), strengths: [] })}><span><strong>{t('med.manual.addTyped', { name: query.trim() })}</strong><small>{t('med.manual.typedNote')}</small></span></button></li>}
    </ul>}
  </div>;
}

export const timingLabel = (t, item) => (item?.timing || []).map((slot) => t(`med.timing.${slot}`)).join(', ');

/** "Once daily · At night · After food · 30 days", using only what the prescription states. */
export function instructionText(t, item) {
  if (!item) return '';
  return [
    item.frequency && t(`med.freq.${item.frequency}`),
    timingLabel(t, item),
    item.food_relation && t(`med.food.${item.food_relation}`),
    item.duration_days && t('med.days', { n: item.duration_days }),
  ].filter(Boolean).join(' · ');
}
