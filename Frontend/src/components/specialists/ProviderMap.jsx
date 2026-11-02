import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Standard OpenStreetMap tiles (free with attribution). Dark mode darkens them with a CSS filter.
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const GLYPH = {
  hospital: '<path d="M12 6v12M6 12h12" stroke-width="3"/>',
  clinic: '<path d="M4 12h4l2-5 4 10 2-5h4" stroke-width="2.4"/>',
  doctor: '<circle cx="12" cy="9" r="3.2" stroke-width="2.4"/><path d="M6 19c1-3.5 3.3-5 6-5s5 1.5 6 5" stroke-width="2.4"/>',
};

function providerIcon(provider, selected) {
  return L.divIcon({
    className: '',
    html: `<span class="map-pin ${provider.kind} ${provider.cardiology !== 'unknown' ? 'cardio' : ''} ${selected ? 'selected' : ''}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${GLYPH[provider.kind]}</svg></span>`,
    iconSize: [34, 42],
    iconAnchor: [17, 40],
  });
}

const originIcon = L.divIcon({ className: '', html: '<span class="map-origin"><i></i></span>', iconSize: [22, 22], iconAnchor: [11, 11] });

// Leaflet map of providers. Fits all results on each new search; pans to the selected one.
export default function ProviderMap({ providers, origin, selectedId, onSelect, onAreaChange, compact = false, route = null, label = 'Map of nearby healthcare providers' }) {
  const container = useRef(null);
  const map = useRef(null);
  const tiles = useRef(null);
  const markers = useRef(new Map());
  const originMarker = useRef(null);
  const lastFitKey = useRef('');
  const suppressMove = useRef(false);
  const routeLine = useRef(null);

  useEffect(() => {
    map.current = L.map(container.current, { zoomControl: !compact, attributionControl: true, scrollWheelZoom: !compact, dragging: !compact || !L.Browser.mobile });
    map.current.attributionControl.setPrefix(false);
    tiles.current = L.tileLayer(TILE_URL, { attribution: ATTRIBUTION, maxZoom: 19 }).addTo(map.current);
    map.current.on('moveend', () => {
      if (suppressMove.current) { suppressMove.current = false; return; }
      const center = map.current.getCenter();
      onAreaChange?.({ lat: center.lat, lon: center.lng });
    });
    const observer = new ResizeObserver(() => map.current?.invalidateSize());
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      map.current.remove();
      map.current = null;
      markers.current.clear();
      originMarker.current = null;
      routeLine.current = null;
      lastFitKey.current = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // Markers for the current result set.
  useEffect(() => {
    const current = markers.current;
    const ids = new Set(providers.map((item) => item.id));
    current.forEach((marker, id) => { if (!ids.has(id)) { marker.remove(); current.delete(id); } });
    providers.forEach((provider) => {
      let marker = current.get(provider.id);
      if (!marker) {
        marker = L.marker([provider.lat, provider.lon], { icon: providerIcon(provider, false), title: provider.name, keyboard: true, riseOnHover: true })
          .addTo(map.current)
          .on('click', () => onSelect?.(provider.id));
        current.set(provider.id, marker);
      }
    });
    if (origin) {
      if (!originMarker.current) originMarker.current = L.marker([origin.lat, origin.lon], { icon: originIcon, interactive: false, zIndexOffset: 1000 }).addTo(map.current);
      else originMarker.current.setLatLng([origin.lat, origin.lon]);
    }
    // Rounded so a moving patient doesn't keep resetting the view.
    const fitKey = `${origin?.lat?.toFixed(2)},${origin?.lon?.toFixed(2)}|${[...ids].sort().join(',')}`;
    if (fitKey !== lastFitKey.current) {
      lastFitKey.current = fitKey;
      map.current.invalidateSize();
      const points = providers.slice(0, 25).map((item) => [item.lat, item.lon]);
      if (origin) points.push([origin.lat, origin.lon]);
      suppressMove.current = true;
      if (points.length > 1) map.current.fitBounds(points, { padding: [40, 40], maxZoom: 15 });
      else if (points.length === 1) map.current.setView(points[0], 14);
    }
  }, [providers, origin, onSelect]);

  // Highlight and reveal the selected provider.
  useEffect(() => {
    markers.current.forEach((marker, id) => {
      const provider = providers.find((item) => item.id === id);
      if (!provider) return;
      marker.setIcon(providerIcon(provider, id === selectedId));
      marker.setZIndexOffset(id === selectedId ? 500 : 0);
    });
    const selected = providers.find((item) => item.id === selectedId);
    // Only pan once the map has a view (a zoom level); the compact preview is already framed by fitBounds.
    if (selected && map.current && !compact && map.current._loaded) {
      suppressMove.current = true;
      map.current.panTo([selected.lat, selected.lon], { animate: true, duration: 0.5 });
    }
  }, [selectedId, providers, compact]);

  // Road route line, framed when the destination changes.
  const routeEnd = route?.length ? route[route.length - 1].join(',') : '';
  useEffect(() => {
    if (!map.current) return;
    if (!route?.length) { routeLine.current?.remove(); routeLine.current = null; return; }
    if (routeLine.current) routeLine.current.setLatLngs(route);
    else routeLine.current = L.polyline(route, { className: 'map-route', interactive: false }).addTo(map.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route]);
  useEffect(() => {
    if (!map.current || !routeLine.current) return;
    suppressMove.current = true;
    map.current.fitBounds(routeLine.current.getBounds(), { padding: [46, 46], maxZoom: 16 });
  }, [routeEnd]);

  return <div ref={container} className={`provider-map ${compact ? 'compact' : ''}`} role="region" aria-label={label} />;
}
