import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Clock } from 'lucide-react';
import { formatElapsed } from '../../services/sos';

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

const when = (value) => new Date(value).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

// Whole pixels per square keep dense codes sharp. Tap to fill the screen for scanning.
export function ErQr({ url, alt, enlargeLabel, closeLabel }) {
  const [src, setSrc] = useState(null);
  const [large, setLarge] = useState(false);
  useEffect(() => {
    let active = true;
    // Lower error correction leaves room for longer medicine lists.
    QRCode.toDataURL(url, { errorCorrectionLevel: url.length > 900 ? 'L' : 'M', margin: 3, scale: 8, color: { dark: '#000000', light: '#ffffff' } })
      .then((data) => { if (active) setSrc(data); })
      .catch(() => { if (active) setSrc(null); });
    return () => { active = false; };
  }, [url]);
  if (!src) return null;
  return <>
    <button type="button" className="er-qr-button" onClick={() => setLarge(true)} aria-label={enlargeLabel}><img className="er-qr" src={src} alt={alt} /><span>{enlargeLabel}</span></button>
    {large && <button type="button" className="er-qr-full" onClick={() => setLarge(false)} aria-label={closeLabel}><img src={src} alt={alt} /><span>{closeLabel}</span></button>}
  </>;
}

// The clinical facts. Labels stay in English because hospital staff read them.
export default function ErCard({ card }) {
  const now = useNow();
  const { name, age, sex, medicines, allergies, conditions, symptomAt, results } = card;
  const person = [age && `${age} years`, sex].filter(Boolean).join(', ');
  return <div className="er-facts">
    <div className="er-person"><strong>{name || 'Name not provided'}</strong>{person && <span>{person}</span>}</div>
    {symptomAt && <div className="er-onset"><Clock size={18} /><div><span>Symptom onset (reported)</span><strong>{when(symptomAt)}</strong><small>{formatElapsed(now - symptomAt)} ago</small></div></div>}
    <Fact label="Allergies" value={allergies} alert />
    <Fact label="Current medicines" value={medicines} />
    <Fact label="Medical conditions" value={conditions} />
    {results?.c && <Fact label="CardioGuard clinical estimate" value={`${results.c.p}% (${results.c.b} band) · ${new Date(results.c.d).toLocaleDateString()}`} />}
    {results?.h && <Fact label="CardioGuard 10-year home screening" value={`${results.h.p}% (${results.h.b} band) · ${new Date(results.h.d).toLocaleDateString()}`} />}
    <p className="er-disclaimer">Entered by the patient and not verified. CardioGuard estimates are educational and are not a diagnosis.</p>
  </div>;
}

function Fact({ label, value, alert }) {
  return <div className={`er-fact ${alert && value ? 'alert' : ''}`}><span>{label}</span><p>{value || 'Not provided'}</p></div>;
}
