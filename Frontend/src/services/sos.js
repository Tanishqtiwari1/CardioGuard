// SOS helpers. The medical profile stays on this device. The ER card travels inside the part of
// the QR link after "#", which browsers never send to any server.
const PROFILE_KEY = 'cardioguard_er_profile';
const RESULTS_KEY = 'cardioguard_er_results';
const SESSION_KEY = 'cardioguard_sos_session';
const SESSION_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export const emptyProfile = { name: '', age: '', sex: '', medicines: '', allergies: '', conditions: '', contacts: [{ name: '', phone: '' }] };

function read(key, fallback, storage = globalThis.localStorage) {
  try { return JSON.parse(storage.getItem(key)) ?? fallback; } catch { return fallback; }
}

function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked */ }
}

export const loadProfile = () => ({ ...emptyProfile, ...read(PROFILE_KEY, {}) });
export const saveProfile = (profile) => write(PROFILE_KEY, profile);
export const deleteProfile = () => localStorage.removeItem(PROFILE_KEY);
export const loadResults = () => read(RESULTS_KEY, null);
export const saveResults = (results) => write(RESULTS_KEY, results);
export const clearResults = () => localStorage.removeItem(RESULTS_KEY);

function randomToken(bytes) {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...values)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function startSession(now = Date.now()) {
  const session = { shareId: randomToken(16), key: randomToken(32), sosAt: now, symptomAt: now, position: null, hospital: null };
  write(SESSION_KEY, session);
  return session;
}

export function loadSession(now = Date.now()) {
  const session = read(SESSION_KEY, null);
  if (!session) return null;
  if (now - session.sosAt > SESSION_MAX_AGE_MS) { clearSession(); return null; }
  return session;
}

export const saveSession = (session) => write(SESSION_KEY, session);
export const clearSession = () => localStorage.removeItem(SESSION_KEY);

// Indian 10-digit numbers get +91; anything else must already include a country code.
export function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '').replace(/^0+/, '');
  if (digits.length === 10) return `91${digits}`;
  return digits.length >= 11 && digits.length <= 15 ? digits : null;
}

export const whatsappUrl = (phone, text) => `https://wa.me/${phone || ''}?text=${encodeURIComponent(text)}`;
export const smsUrl = (phone, text) => `sms:+${phone}?&body=${encodeURIComponent(text)}`;
export const mapPinUrl = ({ lat, lon }) => `https://maps.google.com/?q=${lat.toFixed(6)},${lon.toFixed(6)}`;
export const appLink = (route, location = globalThis.location) => `${location.origin}${location.pathname}#${route}`;

const toBase64Url = (text) => {
  const binary = String.fromCharCode(...new TextEncoder().encode(text));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (text) => {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
};

export function encodeCard(profile, results, symptomAt) {
  const payload = {
    n: profile.name?.trim() || undefined,
    a: profile.age || undefined,
    s: profile.sex || undefined,
    m: profile.medicines?.trim() || undefined,
    l: profile.allergies?.trim() || undefined,
    c: profile.conditions?.trim() || undefined,
    t: symptomAt || undefined,
    r: results || undefined,
  };
  return toBase64Url(JSON.stringify(payload));
}

export function decodeCard(data) {
  try {
    const value = JSON.parse(fromBase64Url(data));
    if (!value || typeof value !== 'object') return null;
    return { name: value.n, age: value.a, sex: value.s, medicines: value.m, allergies: value.l, conditions: value.c, symptomAt: value.t, results: value.r };
  } catch {
    return null;
  }
}

export function latestResults(assessments = [], screenings = []) {
  const clinical = assessments[0];
  const home = screenings[0];
  if (!clinical && !home) return null;
  return {
    ...(clinical && { c: { p: clinical.risk_probability, b: clinical.risk_category, d: clinical.created_at } }),
    ...(home && { h: { p: home.risk_probability, b: home.risk_category, d: home.screened_at } }),
  };
}

export function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value) => String(value).padStart(2, '0');
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}
