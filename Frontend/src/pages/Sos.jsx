import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HeartPulse, Hospital, LoaderCircle, LocateFixed, MapPin, MessageCircle, MessageSquare, Navigation, Phone, Plus, RefreshCcw, Siren, Trash2, TriangleAlert, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import ErCard, { ErQr, useNow } from '../components/sos/ErCard';
import ManualLocation from '../components/specialists/ManualLocation';
import ProviderMap from '../components/specialists/ProviderMap';
import { LanguageToggle, useT } from '../i18n';
import { endSosShare, getHistory, getScreeningHistory, getScreeningModel, getStoredToken, updateSosShare } from '../services/api';
import { directionsUrl, distanceKm, fastestHospitals, roadRoute } from '../services/places';
import { appLink, clearSession, deleteProfile, emptyProfile, encodeCard, formatElapsed, latestResults, loadProfile, loadResults, loadSession, mapPinUrl, normalizePhone, saveProfile, saveResults, saveSession, smsUrl, startSession, whatsappUrl } from '../services/sos';
import { useToast } from '../ui/toast';
import './sos.css';

const PUSH_EVERY_MS = 20000;
const RESEARCH_AFTER_KM = 2;
const STARTED_OPTIONS = [0, 15, 30, 60, 120];
const FIELD_LIMIT = 160;

export default function Sos() {
  const { t } = useT();
  const toast = useToast();
  const [session, setSession] = useState(loadSession);
  const [profile, setProfile] = useState(loadProfile);
  const [results, setResults] = useState(loadResults);

  useEffect(() => { saveProfile(profile); }, [profile]);
  useEffect(() => {
    // The free server sleeps; wake it now so the first location upload isn't slow.
    getScreeningModel().catch(() => {});
    if (!getStoredToken()) return;
    Promise.all([getHistory(), getScreeningHistory()]).then(([assessments, screenings]) => {
      const latest = latestResults(assessments, screenings);
      if (latest) { saveResults(latest); setResults(latest); }
    }).catch(() => {});
  }, []);

  const start = () => { if (!session) setSession(startSession()); };
  const patch = useCallback((changes) => setSession((current) => {
    if (!current) return current;
    const next = { ...current, ...changes };
    saveSession(next);
    return next;
  }), []);
  const end = () => {
    if (!window.confirm(t('sos.endConfirm'))) return;
    endSosShare(session.shareId, session.key).catch(() => {});
    clearSession();
    setSession(null);
    toast(t('sos.ended'), { tone: 'success' });
  };
  const erase = () => {
    deleteProfile();
    setProfile(emptyProfile);
    toast(t('sos.deleted'), { tone: 'success' });
  };

  return <div className="sos-page">
    <header className="sos-top">
      <Link to="/" className="brand-mark"><span className="brand-icon"><HeartPulse size={19} /></span><span className="brand-copy"><strong>Cardio<span>Guard</span></strong><small>{t('sos.brand')}</small></span></Link>
      <LanguageToggle />
    </header>
    <main className="sos-main">
      {session
        ? <ActiveSos session={session} patch={patch} profile={profile} results={results} onEnd={end} />
        : <section className="sos-hero">
          <h1>{t('sos.title')}</h1>
          <p>{t('sos.text')}</p>
          <a className="sos-button" href="tel:108" onClick={start}><Siren size={38} /><span>{t('sos.button')}</span></a>
          <small>{t('sos.buttonHint')}</small>
        </section>}
      <PrepareForm profile={profile} setProfile={setProfile} onDelete={erase} />
    </main>
  </div>;
}

function ActiveSos({ session, patch, profile, results, onEnd }) {
  const { t } = useT();
  const now = useNow();
  const [locationStatus, setLocationStatus] = useState(session.position ? 'on' : 'locating');
  const [hospitals, setHospitals] = useState([]);
  const [hospitalStatus, setHospitalStatus] = useState('idle');
  const [route, setRoute] = useState(null);
  const [shareFailed, setShareFailed] = useState(false);
  const lastPush = useRef({ at: 0, signature: '' });
  const searchedAt = useRef(null);
  const { position, hospital, symptomAt, shareId, key } = session;

  // Live location, and keep the screen on so sharing doesn't pause.
  useEffect(() => {
    if (!navigator.geolocation) { setLocationStatus('off'); return undefined; }
    const watch = navigator.geolocation.watchPosition(({ coords }) => {
      patch({ position: { lat: coords.latitude, lon: coords.longitude, accuracy: coords.accuracy, manual: false } });
      setLocationStatus('on');
    }, () => setLocationStatus((current) => (current === 'on' ? current : 'off')), { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 });
    let wakeLock;
    const keepAwake = () => {
      if (document.visibilityState === 'visible') navigator.wakeLock?.request('screen').then((lock) => { wakeLock = lock; }).catch(() => {});
    };
    keepAwake();
    document.addEventListener('visibilitychange', keepAwake);
    return () => {
      navigator.geolocation.clearWatch(watch);
      document.removeEventListener('visibilitychange', keepAwake);
      wakeLock?.release?.().catch(() => {});
    };
  }, [patch]);

  // Send the location to the family link. Hospital or onset changes go immediately.
  useEffect(() => {
    if (!position) return;
    const signature = `${hospital?.id}|${symptomAt}`;
    if (signature === lastPush.current.signature && Date.now() - lastPush.current.at < PUSH_EVERY_MS) return;
    lastPush.current = { at: Date.now(), signature };
    updateSosShare(shareId, key, {
      lat: position.lat,
      lon: position.lon,
      accuracy_m: position.accuracy ?? null,
      symptom_started_at: symptomAt / 1000,
      hospital_name: hospital?.name ?? null,
      hospital_lat: hospital?.lat ?? null,
      hospital_lon: hospital?.lon ?? null,
    }).then(() => setShareFailed(false)).catch(() => {
      setShareFailed(true);
      lastPush.current.at = 0;
    });
  }, [position, hospital, symptomAt, shareId, key]);

  const findHospitals = useCallback(async (point) => {
    searchedAt.current = point;
    setHospitalStatus('loading');
    try {
      const found = await fastestHospitals(point);
      setHospitals(found);
      setHospitalStatus(found.length ? 'ready' : 'empty');
      patch({ hospital: found[0] ?? null });
    } catch {
      setHospitalStatus('error');
    }
  }, [patch]);

  useEffect(() => {
    if (!position) return;
    if (!searchedAt.current || distanceKm(searchedAt.current, position) > RESEARCH_AFTER_KM) findHospitals(position);
  }, [position, findHospitals]);

  const hospitalId = hospital?.id;
  const hasPosition = Boolean(position);
  useEffect(() => {
    if (!hasPosition || !hospital) { setRoute(null); return undefined; }
    let active = true;
    roadRoute(position, hospital).then((result) => { if (active) setRoute(result.points); }).catch(() => { if (active) setRoute(null); });
    return () => { active = false; };
    // Recalculated when the destination changes, not on every small location update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hospitalId, hasPosition]);

  const message = useMemo(() => {
    const time = new Date(symptomAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return [
      t('sos.msgHead', { name: profile.name.trim() || t('sos.msgSomeone') }),
      t('sos.msgStarted', { time }),
      `${t('sos.msgLive')} ${appLink(`/track/${shareId}`)}`,
      position && `${t('sos.msgPin')} ${mapPinUrl(position)}`,
      hospital && t('sos.msgGoing', { name: hospital.name }),
      hospital && `${t('sos.msgRoute')} ${directionsUrl(hospital)}`,
    ].filter(Boolean).join('\n');
  }, [t, profile.name, symptomAt, shareId, position, hospital]);

  const contacts = profile.contacts
    .map((contact) => ({ ...contact, phone: normalizePhone(contact.phone) }))
    .filter((contact) => contact.phone);
  const cardUrl = appLink(`/er/${encodeCard(profile, results, symptomAt)}`);
  const hasCardDetails = profile.name || profile.medicines || profile.allergies || profile.conditions || results;
  const minutesAgo = Math.round((session.sosAt - symptomAt) / 60000);
  const providers = useMemo(() => hospitals.map((item) => ({ ...item })), [hospitals]);
  const mapsSearch = position ? `https://www.google.com/maps/search/hospital/@${position.lat},${position.lon},14z` : 'https://www.google.com/maps/search/hospital+near+me';

  return <>
    <section className="sos-timer" aria-live="off">
      <div><span>{t('sos.elapsed')}</span><strong>{formatElapsed(now - symptomAt)}</strong></div>
      <a className="btn emergency-call" href="tel:108"><Phone size={20} /> {t('sos.call108')}</a>
      <a className="btn emergency-call secondary" href="tel:112"><Phone size={20} /> {t('sos.call112')}</a>
    </section>
    <fieldset className="sos-onset">
      <legend>{t('sos.startedWhen')}</legend>
      {STARTED_OPTIONS.map((minutes) => <button type="button" key={minutes} className={minutesAgo === minutes ? 'active' : ''} aria-pressed={minutesAgo === minutes} onClick={() => patch({ symptomAt: session.sosAt - minutes * 60000 })}>{minutes ? t('sos.ago', { n: minutes }) : t('sos.now')}</button>)}
    </fieldset>

    <section className="sos-section">
      <h2><MessageCircle size={20} /> {t('sos.familyTitle')}</h2>
      <p className="muted-text">{t('sos.familyHint')}</p>
      <LocationStatus status={locationStatus} position={position} />
      {shareFailed && <p className="sos-notice warn" role="status"><TriangleAlert size={16} /> {t('sos.shareFailed')}</p>}
      {locationStatus === 'off' && !position && <ManualLocation placeholder={t('sos.enterPlace')} searchLabel={t('sos.search')} onClose={() => {}} onChoose={(place) => { patch({ position: { lat: place.lat, lon: place.lon, accuracy: null, manual: true } }); setLocationStatus('on'); }} />}
      <ul className="sos-contacts">
        {contacts.map((contact) => <li key={contact.phone}>
          <strong>{contact.name || `+${contact.phone}`}</strong>
          <a className="btn btn-whatsapp" href={whatsappUrl(contact.phone, message)} target="_blank" rel="noreferrer"><MessageCircle size={17} /> {t('sos.whatsapp')}</a>
          <a className="btn btn-ghost" href={smsUrl(contact.phone, message)}><MessageSquare size={17} /> {t('sos.sms')}</a>
        </li>)}
        {contacts.length === 0 && <li><a className="btn btn-whatsapp" href={whatsappUrl('', message)} target="_blank" rel="noreferrer"><MessageCircle size={17} /> {t('sos.chooseContact')}</a></li>}
      </ul>
      <p className="sos-keep-open">{t('sos.keepOpen')}</p>
    </section>

    <section className="sos-section">
      <h2><Hospital size={20} /> {t('sos.hospitalsTitle')}</h2>
      <p className="muted-text">{t('sos.hospitalsHint')}</p>
      <div className="sos-hospitals">
        <div className="sos-hospital-list">
          {hospitalStatus === 'loading' && <p className="sos-notice"><LoaderCircle size={16} className="spin" /> {t('sos.findingHospitals')}</p>}
          {['error', 'empty'].includes(hospitalStatus) && <div className="sos-notice warn column"><span><TriangleAlert size={16} /> {t('sos.noHospitals')}</span>
            <span className="sos-actions">
              <button type="button" className="btn btn-ghost" onClick={() => findHospitals(position)}><RefreshCcw size={15} /> {t('sos.tryAgain')}</button>
              <a className="btn btn-ghost" href={mapsSearch} target="_blank" rel="noreferrer"><MapPin size={15} /> {t('sos.openMaps')}</a>
            </span></div>}
          {hospitals.map((item) => <article key={item.id} className={`sos-hospital ${item.id === hospitalId ? 'selected' : ''}`}>
            <button type="button" onClick={() => patch({ hospital: item })} aria-pressed={item.id === hospitalId}>
              <span className="sos-drive">{item.driveSeconds != null ? t('sos.minutes', { n: Math.max(1, Math.round(item.driveSeconds / 60)) }) : `${item.distanceKm.toFixed(1)} km`}</span>
              <span className="sos-hospital-copy"><strong>{item.name}</strong><small>{[item.driveMeters != null && `${(item.driveMeters / 1000).toFixed(1)} km`, item.cardiology !== 'unknown' && t('sos.heartCare'), item.emergency && t('sos.emergencyListed')].filter(Boolean).join(' · ')}</small></span>
            </button>
            <div className="sos-actions">
              <a className="btn btn-primary" href={directionsUrl(item, position)} target="_blank" rel="noreferrer"><Navigation size={15} /> {t('sos.navigate')}</a>
              {item.phone && <a className="btn btn-ghost" href={`tel:${item.phone.split(';')[0].replace(/\s/g, '')}`}><Phone size={15} /> {t('sos.call')}</a>}
            </div>
          </article>)}
        </div>
        <div className="sos-map-wrap">
          {position
            ? <ProviderMap providers={providers} origin={position} selectedId={hospitalId} onSelect={(id) => patch({ hospital: hospitals.find((item) => item.id === id) })} route={route} label={t('sos.hospitalsTitle')} />
            : <div className="sos-map-empty"><LocateFixed size={26} /> {t('sos.locating')}</div>}
        </div>
      </div>
    </section>

    <section className="sos-section">
      <h2><HeartPulse size={20} /> {t('sos.cardTitle')}</h2>
      <p className="muted-text">{hasCardDetails ? t('sos.cardHint') : t('sos.cardEmpty')}</p>
      <div className="er-layout">
        <ErQr url={cardUrl} alt={t('sos.cardTitle')} enlargeLabel={t('sos.qrEnlarge')} closeLabel={t('community.close')} />
        <ErCard card={{ ...profile, symptomAt, results }} />
      </div>
    </section>

    <section className="sos-section">
      <h2>{t('emergency.whileWaiting')}</h2>
      <ol className="sos-steps">{['emergency.w1', 'emergency.w2', 'emergency.w3', 'emergency.w4', 'emergency.w5'].map((item) => <li key={item}>{t(item)}</li>)}</ol>
      <button type="button" className="btn btn-ghost sos-end" onClick={onEnd}><X size={16} /> {t('sos.end')}</button>
    </section>
  </>;
}

function LocationStatus({ status, position }) {
  const { t } = useT();
  if (status === 'locating') return <p className="sos-notice" role="status"><LoaderCircle size={16} className="spin" /> {t('sos.locating')}</p>;
  if (status === 'off' && !position) return <p className="sos-notice warn" role="status"><TriangleAlert size={16} /> {t('sos.locationOff')}</p>;
  if (position?.manual) return <p className="sos-notice" role="status"><MapPin size={16} /> {t('sos.locationManual')}</p>;
  return <p className="sos-notice" role="status"><span className="sos-live-dot" /> {t('sos.locationOn', { n: Math.round(position?.accuracy || 0) })}</p>;
}

function PrepareForm({ profile, setProfile, onDelete }) {
  const { t } = useT();
  const set = (field, value) => setProfile((current) => ({ ...current, [field]: value }));
  const setContact = (index, field, value) => set('contacts', profile.contacts.map((item, i) => (i === index ? { ...item, [field]: value } : item)));
  return <section className="sos-section">
    <h2>{t('sos.prepareTitle')}</h2>
    <p className="muted-text">{t('sos.prepareHint')}</p>
    <div className="sos-form">
      <Text label={t('sos.name')} value={profile.name} onChange={(value) => set('name', value)} autoComplete="name" />
      <div className="sos-form-row">
        <Text label={t('sos.age')} type="number" min="1" max="120" value={profile.age} onChange={(value) => set('age', value)} />
        <div className="sos-field"><label htmlFor="sos-sex">{t('sos.sex')}</label><select id="sos-sex" value={profile.sex} onChange={(event) => set('sex', event.target.value)}><option value="">–</option><option value="Female">{t('common.female')}</option><option value="Male">{t('common.male')}</option></select></div>
      </div>
      <Text label={t('sos.medicines')} hint={t('sos.medicinesHint')} value={profile.medicines} onChange={(value) => set('medicines', value)} multiline />
      <Text label={t('sos.allergies')} value={profile.allergies} onChange={(value) => set('allergies', value)} multiline />
      <Text label={t('sos.conditions')} value={profile.conditions} onChange={(value) => set('conditions', value)} multiline />
    </div>
    <h3 className="sos-subhead">{t('sos.contacts')}</h3>
    <ul className="sos-contact-form">
      {profile.contacts.map((contact, index) => {
        const invalid = contact.phone && !normalizePhone(contact.phone);
        return <li key={index}>
          <Text label={t('sos.contactName')} value={contact.name} onChange={(value) => setContact(index, 'name', value)} />
          <Text label={t('sos.contactPhone')} type="tel" value={contact.phone} onChange={(value) => setContact(index, 'phone', value)} error={invalid ? t('sos.badPhone') : ''} />
          {profile.contacts.length > 1 && <button type="button" className="icon-btn" aria-label={t('sos.removeContact')} onClick={() => set('contacts', profile.contacts.filter((_, i) => i !== index))}><Trash2 size={17} /></button>}
        </li>;
      })}
    </ul>
    {profile.contacts.length < 3 && <button type="button" className="btn btn-ghost" onClick={() => set('contacts', [...profile.contacts, { name: '', phone: '' }])}><Plus size={16} /> {t('sos.addContact')}</button>}
    <div className="sos-form-foot"><small>{t('sos.saved')}</small><button type="button" className="sos-delete" onClick={onDelete}><Trash2 size={14} /> {t('sos.delete')}</button></div>
  </section>;
}

function Text({ label, hint, value, onChange, multiline, error, ...props }) {
  const id = `sos-${label.replace(/\W+/g, '-')}-${props.type || 'text'}`;
  const shared = { id, value, onChange: (event) => onChange(event.target.value), 'aria-invalid': Boolean(error), ...props };
  return <div className="sos-field">
    <label htmlFor={id}>{label}{hint && <span>{hint}</span>}</label>
    {multiline ? <textarea rows={2} maxLength={FIELD_LIMIT} {...shared} /> : <input type={props.type || 'text'} maxLength={props.type === 'number' ? undefined : 80} {...shared} />}
    {error && <small className="sos-error">{error}</small>}
  </div>;
}
