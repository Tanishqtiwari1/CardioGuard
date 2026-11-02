import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV
    ? 'http://localhost:8000/api/v1'
    : 'https://cardioguard-api-klo2.onrender.com/api/v1');
export const TOKEN_KEY = 'cardioguard_token';

export function getStoredToken() {
    const token = localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);
    if (token) localStorage.setItem(TOKEN_KEY, token);
    sessionStorage.removeItem(TOKEN_KEY);
    return token;
}

export function storeToken(token) {
    localStorage.setItem(TOKEN_KEY, token);
    sessionStorage.removeItem(TOKEN_KEY);
}

export function clearStoredToken() {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
}

export const api = axios.create({ baseURL: API_BASE_URL });

api.interceptors.request.use((config) => {
    const token = getStoredToken();
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
});

api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401 && getStoredToken()) {
            clearStoredToken();
            window.dispatchEvent(new Event('cardioguard:session-expired'));
        }
        return Promise.reject(error);
    },
);

export const submitAssessment = async (healthData, persist = true) => {
    const response = await api.post('/predict', healthData, { params: { persist } });
    return response.data;
};

export const registerUser = async (userData) => (await api.post('/auth/register', userData)).data;
export const loginUser = async (credentials) => (await api.post('/auth/login', credentials)).data;
export const requestPasswordReset = async (email) => (await api.post('/auth/forgot-password', { email })).data;
export const resetPassword = async (data) => (await api.post('/auth/reset-password', data)).data;
export const getCurrentUser = async () => (await api.get('/auth/me')).data;
export const getHistory = async () => (await api.get('/history')).data;
export const getModelInsights = async () => (await api.get('/model-insights')).data;
export const getScreeningModel = async () => (await api.get('/screening/model')).data;
export const getScreeningInsights = async () => (await api.get('/screening/model-insights')).data;
export const submitScreening = async (data, persist = true) => (await api.post('/screening/predict', data, { params: { persist } })).data;
export const getScreeningHistory = async () => (await api.get('/screening/history')).data;
export const syncCommunity = async (batch) => (await api.post('/community/sync', batch)).data;
export const getPatients = async () => (await api.get('/community/patients')).data;
export const getPatient = async (id) => (await api.get(`/community/patients/${id}`)).data;
export const updateReferral = async (screeningId, status) => (await api.patch(`/community/screenings/${screeningId}`, { referral_status: status })).data;

const sosRequest = { timeout: 20000 };
export const updateSosShare = async (id, key, data) => (await api.put(`/sos/${id}`, data, { ...sosRequest, headers: { 'X-SOS-Key': key } })).data;
export const readSosShare = async (id) => (await api.get(`/sos/${id}`, { timeout: 70000 })).data;
export const endSosShare = async (id, key) => api.delete(`/sos/${id}`, { ...sosRequest, headers: { 'X-SOS-Key': key } });
