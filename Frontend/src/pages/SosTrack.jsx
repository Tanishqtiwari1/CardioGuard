import { useEffect, useMemo, useRef, useState } from 'react';
import { HeartPulse, Hospital, LoaderCircle, Navigation, Phone, TriangleAlert } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { useNow } from '../components/sos/ErCard';
import ProviderMap from '../components/specialists/ProviderMap';
import { LanguageToggle, useT } from '../i18n';
import { readSosShare } from '../services/api';
import { directionsUrl, distanceKm, roadRoute } from '../services/places';
import { formatElapsed } from '../services/sos';
import './sos.css';

const POLL_MS = 15000;
const WAIT_FOR_FIRST_LOCATION_MS = 3 * 60 * 1000;
const STALE_AFTER_SECONDS = 180;

// The page family members open from the SOS message.
export default function SosTrack() {
  const { shareId } = useParams();
  const { t } = useT();
  const now = useNow();
  const [share, setShare] = useState(null);
  const [status, setStatus] = useState('waiting');
  const [receivedAt, setReceivedAt] = useState(0);
  const [route, setRoute] = useState(null);
  const openedAt = useRef(Date.now());
  const seen = useRef(false);
  const routedFrom = useRef(null);

  useEffect(() => {
    let active = true;
    let timer;
    seen.current = false;
    openedAt.current = Date.now();
    routedFrom.current = null;
    setShare(null);
    setStatus('waiting');
    const poll = async () => {
      try {
        const data = await readSosShare(shareId);
        if (!active) return;
        seen.current = true;
        setShare(data);
        setReceivedAt(Date.now() - (data.server_time - data.updated_at) * 1000);
        setStatus('live');
      } catch (error) {
        if (!active) return;
        // The message can arrive before the first location does, so a missing share isn't final yet.
        if (error.response?.status === 404 && (seen.current || Date.now() - openedAt.current > WAIT_FOR_FIRST_LOCATION_MS)) {
          setStatus('ended');
          return;
        }
      }
      timer = setTimeout(poll, POLL_MS);
    };
    poll();
    return () => { active = false; clearTimeout(timer); };
  }, [shareId]);

  const hospital = useMemo(() => (share?.hospital_lat != null
    ? { id: 'destination', name: share.hospital_name, kind: 'hospital', cardiology: 'unknown', lat: share.hospital_lat, lon: share.hospital_lon }
    : null), [share?.hospital_name, share?.hospital_lat, share?.hospital_lon]);
  const person = useMemo(() => (share ? { lat: share.lat, lon: share.lon } : null), [share?.lat, share?.lon]);
  const providers = useMemo(() => (hospital ? [hospital] : []), [hospital]);

  useEffect(() => {
    if (!person || !hospital) { setRoute(null); return undefined; }
    const previous = routedFrom.current;
    if (previous?.hospital === hospital.id + hospital.lat && distanceKm(previous.point, person) < 0.5) return undefined;
    routedFrom.current = { point: person, hospital: hospital.id + hospital.lat };
    let active = true;
    roadRoute(person, hospital).then((result) => { if (active) setRoute(result); }).catch(() => { if (active) setRoute(null); });
    return () => { active = false; };
  }, [person, hospital]);

  const ageSeconds = receivedAt ? Math.max(0, (now - receivedAt) / 1000) : 0;
  const ageText = ageSeconds < 90 ? `${Math.round(ageSeconds)} s` : t('sos.minutes', { n: Math.round(ageSeconds / 60) });

  return <div className="sos-page">
    <header className="sos-top"><span className="brand-mark"><span className="brand-icon"><HeartPulse size={19} /></span><span className="brand-copy"><strong>Cardio<span>Guard</span></strong><small>{t('track.title')}</small></span></span><LanguageToggle /></header>
    <main className="sos-main">
      {status === 'waiting' && <section className="sos-section sos-state"><LoaderCircle size={28} className="spin" /><h1>{t('track.waiting')}</h1><p className="muted-text">{t('track.waitingHint')}</p></section>}
      {status === 'ended' && <section className="sos-section sos-state"><TriangleAlert size={28} /><h1>{t('track.endedTitle')}</h1><p className="muted-text">{t('track.endedText')}</p></section>}
      {status === 'live' && share && <>
        <section className="sos-timer" aria-live="off">
          <div><span>{t('sos.elapsed')}</span><strong>{share.symptom_started_at ? formatElapsed(now - share.symptom_started_at * 1000) : '–'}</strong></div>
          <a className="btn emergency-call" href="tel:108"><Phone size={20} /> {t('sos.call108')}</a>
        </section>
        {ageSeconds > STALE_AFTER_SECONDS
          ? <p className="sos-notice warn" role="status"><TriangleAlert size={16} /> {t('track.stale')}</p>
          : <p className="sos-notice" role="status"><span className="sos-live-dot" /> {t('track.updated', { time: ageText })}</p>}
        <section className="sos-map-wrap"><ProviderMap providers={providers} origin={person} selectedId={hospital?.id} route={route?.points} label={t('track.title')} /></section>
        {hospital && <p className="track-hospital"><Hospital size={18} /><span><small>{t('track.hospital')}</small><strong>{hospital.name}</strong>{route && <small>{t('sos.minutes', { n: Math.max(1, Math.round(route.seconds / 60)) })} · {(route.meters / 1000).toFixed(1)} km</small>}</span></p>}
        <div className="sos-actions">
          <a className="btn btn-primary" href={directionsUrl(person)} target="_blank" rel="noreferrer"><Navigation size={16} /> {t('track.toPatient')}</a>
          {hospital && <a className="btn btn-ghost" href={directionsUrl(hospital)} target="_blank" rel="noreferrer"><Navigation size={16} /> {t('track.toHospital')}</a>}
        </div>
      </>}
    </main>
  </div>;
}
