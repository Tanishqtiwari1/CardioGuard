import { useRef, useState } from 'react';
import { FileUp, LoaderCircle, ScanText, X } from 'lucide-react';
import { useT } from '../../i18n';
import { REPORT_LABELS, displayReportValue, parseReport } from '../../services/reportParser';

// Reads a photo or PDF of a lab report in the browser and offers the values it finds.
// The parent decides which form fields they fill (onApply receives the parsed values).
export default function ReportUpload({ onApply, relevant }) {
  const { t } = useT();
  const input = useRef(null);
  const [state, setState] = useState('idle');
  const [values, setValues] = useState({});
  const shown = Object.entries(values).filter(([key]) => !relevant || relevant.includes(key));

  const read = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setState('reading');
    try {
      const { extractReportText } = await import('../../services/reportOcr');
      setValues(parseReport(await extractReportText(file)));
      setState('done');
    } catch {
      setState('error');
    }
  };

  return <div className="report-upload">
    <input ref={input} type="file" accept="image/*,application/pdf" capture="environment" hidden onChange={read} />
    {state !== 'done' && <button type="button" className="upload-trigger" onClick={() => input.current?.click()} disabled={state === 'reading'}>
      {state === 'reading' ? <LoaderCircle size={18} className="spin" /> : <FileUp size={18} />}
      <span><strong>{state === 'reading' ? t('upload.reading') : t('upload.button')}</strong><small>{state === 'error' ? t('upload.error') : t('upload.hint')}</small></span>
    </button>}
    {state === 'done' && <div className="upload-result">
      <div className="upload-result-head"><ScanText size={16} /><strong>{t('upload.found')}</strong><button type="button" className="icon-btn" onClick={() => setState('idle')} aria-label="Close"><X size={16} /></button></div>
      {shown.length ? <>
        <dl>{shown.map(([key, value]) => <div key={key}><dt>{REPORT_LABELS[key][0]}</dt><dd>{displayReportValue(key, value)} <small>{REPORT_LABELS[key][1]}</small></dd></div>)}</dl>
        <small className="muted-text">{t('upload.check')}</small>
        <button type="button" className="btn btn-primary" onClick={() => { onApply(values); setState('idle'); }}>{t('upload.apply')}</button>
      </> : <p className="muted-text">{t('upload.none')}</p>}
    </div>}
  </div>;
}
