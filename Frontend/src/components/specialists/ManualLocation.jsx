import { useState } from 'react';
import { LoaderCircle, LocateFixed, MapPin, Search, X } from 'lucide-react';
import { geocode } from '../../services/places';
import { useToast } from '../../ui/toast';

export default function ManualLocation({ onChoose, onClose, onUseMine, placeholder = 'City, area, PIN code or address', searchLabel = 'Search' }) {
  const toast = useToast();
  const [value, setValue] = useState('');
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    if (!value.trim()) return;
    setBusy(true);
    try {
      const places = await geocode(value.trim());
      setResults(places);
      if (places.length === 1) onChoose(places[0]);
    } catch {
      toast('Location search is unavailable right now. Please try again.', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return <form className="manual-location" onSubmit={submit}>
    <label className="search-box"><MapPin size={16} /><input autoFocus value={value} onChange={(event) => setValue(event.target.value)} placeholder={placeholder} aria-label="Location" /></label>
    <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? <LoaderCircle size={16} className="spin" /> : <Search size={16} />} {searchLabel}</button>
    {onUseMine && <button type="button" className="btn btn-ghost" onClick={onUseMine}><LocateFixed size={16} /> Use my location</button>}
    <button type="button" className="icon-btn" onClick={onClose} aria-label="Cancel"><X size={16} /></button>
    {results && results.length === 0 && <p className="muted-text manual-results">No places found. Try a nearby city or PIN code.</p>}
    {results && results.length > 1 && <ul className="manual-results">{results.map((place) => <li key={`${place.lat},${place.lon}`}><button type="button" onClick={() => onChoose(place)}><MapPin size={14} /> {place.label}</button></li>)}</ul>}
  </form>;
}
