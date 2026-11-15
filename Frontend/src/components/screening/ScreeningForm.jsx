import { useState } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { useT } from '../../i18n';
import { bmiFrom, defaultScreening } from '../../services/screeningModel';
import ReportUpload from './ReportUpload';

export default function ScreeningForm({ initial, onSubmit, submitLabel, children, onReport }) {
  const { t } = useT();
  const [data, setData] = useState({ ...defaultScreening, ...initial });
  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');
  const [bmiUnknown, setBmiUnknown] = useState(initial ? initial.bmi === null || initial.bmi === undefined : false);
  const [error, setError] = useState('');
  const update = (key, value) => setData((current) => ({ ...current, [key]: value }));
  const bmi = bmiUnknown ? null : bmiFrom(height, weight) ?? (initial?.bmi && !height && !weight ? initial.bmi : null);

  const applyReport = (found) => {
    onReport?.(found);
    if (found.systolic_bp) update('systolic_bp', found.systolic_bp);
    if (found.age) update('age', found.age);
    if (found.sex !== undefined) update('sex', found.sex);
    // Fasting glucose >= 126 mg/dL or HbA1c >= 6.5% meets the diabetes threshold.
    if (found.fasting_glucose >= 126 || found.hba1c >= 6.5) update('diabetes', 1);
    if (found.height_cm) setHeight(found.height_cm);
    if (found.weight_kg) setWeight(found.weight_kg);
    if (found.height_cm || found.weight_kg) setBmiUnknown(false);
  };

  const submit = (event) => {
    event.preventDefault();
    if (!(data.age >= 18 && data.age <= 100)) return setError(t('screen.errorAge'));
    if (!(data.systolic_bp >= 70 && data.systolic_bp <= 260)) return setError(t('screen.errorBp'));
    setError('');
    onSubmit({ ...data, cigs_per_day: data.smoker ? Number(data.cigs_per_day) || 0 : 0, bmi });
  };

  return <form className="screening-form" onSubmit={submit}>
    {children}
    <ReportUpload onApply={applyReport} relevant={[...(onReport ? ['patient_name'] : []), 'systolic_bp', 'diastolic_bp', 'fasting_glucose', 'hba1c', 'height_cm', 'weight_kg', 'age', 'sex']} />
    <div className="form-grid">
      <NumberField label={t('screen.age')} hint={t('common.years')} value={data.age} onChange={(value) => update('age', value)} min={18} max={100} />
      <YesNo label={t('screen.sex')} value={data.sex} options={[[1, t('common.male')], [0, t('common.female')]]} onChange={(value) => update('sex', value)} />
      <NumberField label={t('screen.sbp')} hint={t('screen.sbpHint')} value={data.systolic_bp} onChange={(value) => update('systolic_bp', value)} min={70} max={260} />
      <YesNo label={t('screen.hypertension')} value={data.hypertension} onChange={(value) => update('hypertension', value)} />
      <YesNo label={t('screen.bpMeds')} value={data.bp_medication} onChange={(value) => update('bp_medication', value)} />
      <YesNo label={t('screen.diabetes')} value={data.diabetes} onChange={(value) => update('diabetes', value)} />
      <YesNo label={t('screen.smoker')} value={data.smoker} onChange={(value) => { update('smoker', value); if (value && !data.cigs_per_day) update('cigs_per_day', 10); }} />
      {data.smoker ? <NumberField label={t('screen.cigs')} value={data.cigs_per_day} onChange={(value) => update('cigs_per_day', value)} min={1} max={100} /> : null}
      <YesNo label={t('screen.stroke')} value={data.prior_stroke} onChange={(value) => update('prior_stroke', value)} />
    </div>
    <div className="bmi-row">
      {!bmiUnknown && <>
        <NumberField label={t('screen.height')} value={height} onChange={setHeight} min={100} max={230} optional />
        <NumberField label={t('screen.weight')} value={weight} onChange={setWeight} min={25} max={250} optional />
        <div className="bmi-value"><span>{t('screen.bmi')}</span><strong>{bmi ?? '–'}</strong></div>
      </>}
      <label className="check-line"><input type="checkbox" checked={bmiUnknown} onChange={(event) => setBmiUnknown(event.target.checked)} /> {t('screen.bmiUnknown')}</label>
    </div>
    {error && <div className="form-error">{error}</div>}
    <div className="form-actions"><button type="submit" className="btn btn-primary">{submitLabel || t('screen.submit')} <ArrowRight size={17} /></button></div>
  </form>;
}

function NumberField({ label, hint, value, onChange, optional, ...props }) {
  return <div className="field">
    <label>{label}{hint && <span>{hint}</span>}</label>
    <input type="number" inputMode="decimal" value={value ?? ''} onChange={(event) => onChange(event.target.value === '' ? '' : Number(event.target.value))} required={!optional} {...props} />
  </div>;
}

function YesNo({ label, value, onChange, options }) {
  const { t } = useT();
  const choices = options || [[1, t('common.yes')], [0, t('common.no')]];
  return <div className="choice-field">
    <label>{label}</label>
    <div className="choice-grid">{choices.map(([option, text]) => <button type="button" key={option} className={Number(value) === option ? 'choice active' : 'choice'} onClick={() => onChange(option)}>{text}{Number(value) === option && <Check size={15} />}</button>)}</div>
  </div>;
}
