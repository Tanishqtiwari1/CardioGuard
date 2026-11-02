import { createContext, useContext, useEffect, useState } from 'react';
import { clearResults } from '../services/sos';
import { clearStoredToken, getCurrentUser, getStoredToken, loginUser, registerUser, storeToken } from '../services/api';

const AuthContext = createContext(null);
const USER_KEY = 'cardioguard_user';

// The last signed-in user is kept so the app (community screening especially) opens offline.
function cachedUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
}

function cacheUser(user) {
  try {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_KEY);
  } catch { /* storage blocked */ }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) { setChecking(false); return; }
    getCurrentUser().then((current) => { setUser(current); cacheUser(current); }).catch((error) => {
      // Only a rejected token logs the user out; no connection keeps the cached session.
      if (error.response) { clearStoredToken(); cacheUser(null); } else setUser(cachedUser());
    }).finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    const handleSessionExpired = () => { setUser(null); cacheUser(null); };
    window.addEventListener('cardioguard:session-expired', handleSessionExpired);
    return () => window.removeEventListener('cardioguard:session-expired', handleSessionExpired);
  }, []);

  const authenticate = (payload) => { storeToken(payload.access_token); setUser(payload.user); cacheUser(payload.user); return payload.user; };
  const login = async (credentials) => authenticate(await loginUser(credentials));
  const signup = async (data) => authenticate(await registerUser(data));
  // The account's results leave the ER card; the emergency profile stays until deleted on the SOS page.
  const logout = () => { clearStoredToken(); setUser(null); cacheUser(null); clearResults(); };

  return <AuthContext.Provider value={{ user, checking, login, signup, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() { return useContext(AuthContext); }