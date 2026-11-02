import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Building2, Clock, ExternalLink, FileText, Globe, HeartPulse, List, LoaderCircle, LocateFixed, Map as MapIcon, MapPin, Navigation, Phone, RefreshCcw, Search, SearchX, ShieldCheck, Stethoscope, X } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import ManualLocation from '../components/specialists/ManualLocation';
import ProviderMap from '../components/specialists/ProviderMap';
import { directionsUrl, rankProviders, reverseGeocode, searchProviders, specialtyLabel } from '../services/places';
import { useToast } from '../ui/toast';

const RADII = [5, 10, 25];
const FILTERS = [['all', 'All'], ['cardio', 'Cardiology'], ['hospital', 'Hospitals'], ['clinic', 'Clinics & doctors']];
const KIND_ICON = { hospital: Building2, clinic: Stethoscope, doctor: Stethoscope };

export default function Specialists() {
  const toast = useToast();
  const { state } = useLocation();
  const context = state?.risk ? state : null;
  const [origin, setOrigin] = useState(null);
  const [status, setStatus] = useState('choose');
  const [radius, setRadius] = useState(5);
  const [providers, setProviders] = useState([]);
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('relevance');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [mobileView, setMobileView] = useState('list');
  const [movedTo, setMovedTo] = useState(null);
  const [manualOpen, setManualOpen] = useState(false);

  const runSearch = useCallback(async (center, km) => {
    setStatus('loading');
    setSelectedId(null);
    setDetailId(null);
    setMovedTo(null);
    try {
      setProviders(await searchProviders(center, km));
      setStatus('ready');
    } catch {
      setStatus('error');
      toast('We couldn’t load nearby specialists right now.', { tone: 'error' });
    }
  }, [toast]);

  useEffect(() => { if (origin) runSearch(origin, radius); }, [origin, radius, runSearch]);

  const useMyLocation = () => {
    if (!navigator.geolocation) { setStatus('denied'); return; }
    setStatus('locating');
    navigator.geolocation.getCurrentPosition(async (position) => {
      const here = { lat: position.coords.latitude, lon: position.coords.longitude, manual: false, label: 'Your current location' };
      setOrigin(here);
      const label = await reverseGeocode(here);
      if (label) setOrigin((current) => (current === here || current?.lat === here.lat ? { ...here, label: `Near ${label}` } : current));
    }, (error) => {
      setStatus('denied');
      toast(error.code === 1 ? 'Location permission was denied. You can enter a location instead.' : 'We couldn’t detect your location. Try entering it manually.', { tone: 'error' });
    }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 });
  };

  const chooseManual = (place) => {
    setManualOpen(false);
    setOrigin({ lat: place.lat, lon: place.lon, manual: true, label: place.label.split(',').slice(0, 3).join(',') });
  };

  const ranked = useMemo(() => (origin ? rankProviders(providers, origin, sort) : []), [providers, origin, sort]);
  const shown = ranked.filter((item) => {
    if (filter === 'cardio' && item.cardiology === 'unknown') return false;
    if (filter === 'hospital' && item.kind !== 'hospital') return false;
    if (filter === 'clinic' && item.kind === 'hospital') return false;
    return `${item.name} ${item.address || ''} ${specialtyLabel(item)}`.toLowerCase().includes(query.trim().toLowerCase());
  });
  const detail = ranked.find((item) => item.id === detailId);
  const select = useCallback((id) => { setSelectedId(id); setDetailId(id); }, []);
  const cardioCount = ranked.filter((item) => item.cardiology !== 'unknown').length;

  const header = <div className="page-heading specialists-heading">
    <div>
      <span className="eyebrow"><Stethoscope size={13} /> Recommended next step</span>
      <h1>Find a specialist</h1>
      <p>{context
        ? <>Your latest {context.kind === 'home' ? 'home screening' : 'assessment'} estimate is in the <strong>{context.band?.toLowerCase()}</strong> band. Consider discussing it with a <strong>cardiologist</strong>.</>
        : <>Consider discussing your CardioGuard assessment with a qualified healthcare professional, such as a <strong>cardiologist</strong>.</>}</p>
    </div>
    <Link className="btn btn-ghost" to="/reports"><FileText size={16} /> Share assessment with doctor</Link>
  </div>;

  if (!origin || status === 'locating' || (status === 'denied' && !origin)) {
    return <div className="specialists-page">
      {header}
      <section className="panel location-card">
        <div className={`locate-orb ${status === 'locating' ? 'active' : ''}`} aria-hidden="true"><LocateFixed size={30} /><i /><i /></div>
        {status === 'denied'
          ? <><h2>We couldn’t access your location.</h2><p className="muted-text">You can enter your location manually to find nearby specialists.</p></>
          : <><h2>Find specialists near you</h2><p className="muted-text">We use your location only to show nearby healthcare providers.</p></>}
        <div className="location-actions">
          {status !== 'denied' && <button type="button" className="btn btn-primary btn-large" onClick={useMyLocation} disabled={status === 'locating'}>
            {status === 'locating' ? <><LoaderCircle size={18} className="spin" /> Finding your location…</> : <><LocateFixed size={18} /> Use my location</>}
          </button>}
          <button type="button" className={`btn btn-large ${status === 'denied' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setManualOpen(true)}><MapPin size={18} /> {status === 'denied' ? 'Enter location' : 'Enter location manually'}</button>
        </div>
        {manualOpen && <ManualLocation onChoose={chooseManual} onClose={() => setManualOpen(false)} />}
        <PrivacyNote />
      </section>
    </div>;
  }

  return <div className="specialists-page">
    {header}
    <div className="specialists-toolbar">
      <button type="button" className="location-chip" onClick={() => setManualOpen((open) => !open)} title="Change location">
        <MapPin size={15} /><span>{origin.label}</span><small>Change</small>
      </button>
      <label className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name, area or specialty" /></label>
      <select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort results" className="select-pill">
        <option value="relevance">Best match</option><option value="distance">Nearest first</option><option value="name">Name A–Z</option>
      </select>
      <select value={radius} onChange={(event) => setRadius(Number(event.target.value))} aria-label="Search radius" className="select-pill">
        {RADII.map((km) => <option key={km} value={km}>Within {km} km</option>)}
      </select>
    </div>
    {manualOpen && <div className="panel manual-inline"><ManualLocation onChoose={chooseManual} onClose={() => setManualOpen(false)} onUseMine={() => { setManualOpen(false); useMyLocation(); }} /></div>}
    <div className="specialists-filters">
      <div className="segmented">{FILTERS.map(([key, label]) => <button type="button" key={key} className={filter === key ? 'active' : ''} onClick={() => setFilter(key)}>{label}</button>)}</div>
      <div className="segmented view-toggle" role="tablist" aria-label="View">
        <button type="button" role="tab" aria-selected={mobileView === 'list'} className={mobileView === 'list' ? 'active' : ''} onClick={() => setMobileView('list')}><List size={15} /> Specialists</button>
        <button type="button" role="tab" aria-selected={mobileView === 'map'} className={mobileView === 'map' ? 'active' : ''} onClick={() => setMobileView('map')}><MapIcon size={15} /> Map</button>
      </div>
    </div>

    <div className={`specialists-split view-${mobileView}`}>
      <section className="specialists-list" aria-label="Nearby providers">
        {status === 'loading' && <Skeletons />}
        {status === 'error' && <StateCard icon={SearchX} title="We couldn’t load nearby specialists right now." text="The map service may be busy. Please try again in a moment.">
          <button type="button" className="btn btn-primary" onClick={() => runSearch(origin, radius)}><RefreshCcw size={16} /> Try again</button>
        </StateCard>}
        {status === 'ready' && shown.length === 0 && <StateCard icon={SearchX} title={providers.length ? 'No matches for these filters.' : 'No specialists found nearby.'} text={providers.length ? 'Try a different search or filter.' : 'Try a wider area or another location.'}>
          {radius < 25 && <button type="button" className="btn btn-primary" onClick={() => setRadius(RADII[RADII.indexOf(radius) + 1])}>Expand search radius</button>}
          <button type="button" className="btn btn-ghost" onClick={() => setManualOpen(true)}>Change location</button>
        </StateCard>}
        {status === 'ready' && shown.length > 0 && <>
          <p className="results-summary">{shown.length} places within {radius} km{cardioCount ? ` · ${cardioCount} with cardiology indicated` : ''}</p>
          <ul className="provider-list">
            {shown.slice(0, 60).map((provider) => <ProviderCard key={provider.id} provider={provider} origin={origin} selected={provider.id === selectedId} onSelect={() => select(provider.id)} />)}
          </ul>
        </>}
        <PrivacyNote />
      </section>

      <section className="specialists-map">
        <ProviderMap providers={status === 'ready' ? shown.slice(0, 60) : []} origin={origin} selectedId={selectedId} onSelect={select} onAreaChange={(center) => setMovedTo(center)} />
        {movedTo && status === 'ready' && <button type="button" className="btn btn-primary search-area" onClick={() => setOrigin({ ...movedTo, manual: true, label: 'Map area' })}><RefreshCcw size={15} /> Search this area</button>}
        {status === 'loading' && <div className="map-loading"><LoaderCircle size={20} className="spin" /> Finding providers…</div>}
      </section>

      {detail && <ProviderDetail provider={detail} origin={origin} onClose={() => setDetailId(null)} />}
    </div>
  </div>;
}

function ProviderCard({ provider, origin, selected, onSelect }) {
  const Icon = KIND_ICON[provider.kind];
  return <li>
    <article className={`provider-card ${selected ? 'selected' : ''} ${provider.cardiology !== 'unknown' ? 'cardio' : ''}`}>
      <button type="button" className="provider-main" onClick={onSelect} aria-pressed={selected}>
        <span className={`provider-icon ${provider.kind}`}><Icon size={18} /></span>
        <span className="provider-copy">
          <span className={`provider-tag ${provider.cardiology}`}>{provider.cardiology !== 'unknown' && <HeartPulse size={12} />}{specialtyLabel(provider)}</span>
          <strong>{provider.name}</strong>
          <small>{provider.address || 'Address not listed'}</small>
        </span>
        <span className="provider-distance">{formatKm(provider.distanceKm)}</span>
      </button>
      <div className="provider-actions">
        <button type="button" className="mini-btn" onClick={onSelect}>View details</button>
        <a className="mini-btn" href={directionsUrl(provider, origin)} target="_blank" rel="noreferrer"><Navigation size={13} /> Directions</a>
        {provider.phone && <a className="mini-btn" href={`tel:${provider.phone.split(';')[0].replace(/\s/g, '')}`}><Phone size={13} /> Call</a>}
      </div>
    </article>
  </li>;
}

function ProviderDetail({ provider, origin, onClose }) {
  const phone = provider.phone?.split(';')[0].trim();
  const bookingUrl = provider.bookingUrl || provider.website;
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return <aside className="provider-detail" aria-label={`${provider.name} details`}>
    <div className="sheet-handle" aria-hidden="true" />
    <div className="detail-head">
      <button type="button" className="icon-btn" onClick={onClose} aria-label="Back to results"><ArrowLeft size={18} /></button>
      <span className={`provider-tag ${provider.cardiology}`}>{provider.cardiology !== 'unknown' && <HeartPulse size={12} />}{specialtyLabel(provider)}</span>
      <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
    </div>
    <h2>{provider.name}</h2>
    <p className="muted-text">{provider.kind === 'hospital' ? 'Hospital' : provider.kind === 'doctor' ? 'Doctor’s practice' : 'Clinic'} · {formatKm(provider.distanceKm)} away</p>
    <div className="detail-map"><ProviderMap providers={[provider]} origin={origin} selectedId={provider.id} onSelect={() => {}} compact /></div>
    <dl className="detail-facts">
      <Fact icon={MapPin} label="Address" value={provider.address || 'Not listed. Use directions to find it.'} />
      {phone && <Fact icon={Phone} label="Phone" value={<a href={`tel:${phone.replace(/\s/g, '')}`}>{phone}</a>} />}
      {provider.website && <Fact icon={Globe} label="Website" value={<a href={provider.website} target="_blank" rel="noreferrer">{provider.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</a>} />}
      {provider.openingHours && <Fact icon={Clock} label="Opening hours" value={provider.openingHours} />}
      {provider.emergency && <Fact icon={ShieldCheck} label="Emergency" value="Emergency department listed" />}
    </dl>
    {provider.cardiology === 'unknown' && <p className="detail-note">Cardiology services aren’t listed for this place. Call ahead to check before visiting.</p>}
    <div className="detail-actions">
      <a className="btn btn-primary" href={directionsUrl(provider, origin)} target="_blank" rel="noreferrer"><Navigation size={16} /> Get directions</a>
      {phone ? <a className="btn btn-ghost" href={`tel:${phone.replace(/\s/g, '')}`}><Phone size={16} /> Call</a> : <span className="btn btn-ghost" aria-disabled="true">No phone listed</span>}
      {bookingUrl
        ? <a className="btn btn-ghost" href={bookingUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Book appointment</a>
        : <span className="btn btn-ghost" aria-disabled="true" title="No online booking link is listed for this provider">Book by phone or in person</span>}
    </div>
    <Link className="share-assessment" to="/reports"><FileText size={16} /><span><strong>Share your assessment with the doctor</strong><small>Download your CardioGuard report (educational estimate, not a diagnosis).</small></span></Link>
    <p className="data-source">Listing from <a href={provider.osmUrl} target="_blank" rel="noreferrer">OpenStreetMap</a>. Details may be out of date; confirm with the provider.</p>
  </aside>;
}

function Fact({ icon: Icon, label, value }) {
  return <div><dt><Icon size={14} /> {label}</dt><dd>{value}</dd></div>;
}

function StateCard({ icon: Icon, title, text, children }) {
  return <div className="state-card"><span className="state-icon"><Icon size={26} /></span><h3>{title}</h3><p className="muted-text">{text}</p><div className="state-actions">{children}</div></div>;
}

function Skeletons() {
  return <ul className="provider-list" aria-busy="true" aria-label="Loading providers">{Array.from({ length: 5 }, (_, index) => <li key={index} className="skeleton-card"><i /><span><b /><b /><b /></span></li>)}</ul>;
}

function PrivacyNote() {
  return <p className="privacy-note"><ShieldCheck size={14} /> Your location is used only to find nearby healthcare providers and is never saved. An approximate (~1 km) location is sent to OpenStreetMap to search. Avoid sharing more location information than necessary.</p>;
}

const formatKm = (km) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`);
