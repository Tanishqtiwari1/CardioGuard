import { api } from './api';
import { buildCalendarFile } from './medicineCalendar';

const base = '/medicines';
const data = (request) => request.then((response) => response.data);

export const getCapabilities = () => data(api.get(`${base}/capabilities`));
export const getVocabulary = () => data(api.get(`${base}/vocabulary`));
export const searchReference = (q) => data(api.get(`${base}/reference/search`, { params: { q } }));
export const identifyMedicine = (body) => data(api.post(`${base}/identify`, body));
export const readImageWithAi = (file) => {
  const form = new FormData();
  form.append('file', file);
  return data(api.post(`${base}/read-image`, form, { timeout: 60000 }));
};

export const getCabinet = () => data(api.get(`${base}/cabinet`));
export const getMedicine = (id) => data(api.get(`${base}/cabinet/${id}`));
export const addMedicine = (body) => data(api.post(`${base}/cabinet`, body));
export const updateMedicine = (id, body) => data(api.patch(`${base}/cabinet/${id}`, body));
export const removeMedicine = (id) => api.delete(`${base}/cabinet/${id}`);
export const explainMedicine = (id, language) => data(api.post(`${base}/cabinet/${id}/explain`, { language }));

export const parsePrescription = (body) => data(api.post(`${base}/prescriptions`, body));
export const getPrescriptions = () => data(api.get(`${base}/prescriptions`));
export const savePrescription = (id, body) => data(api.put(`${base}/prescriptions/${id}`, body));
export const removePrescription = (id) => api.delete(`${base}/prescriptions/${id}`);

export const runFullCheck = () => data(api.get(`${base}/check`));
export const getHealthProfile = () => data(api.get(`${base}/profile`));
export const saveHealthProfile = (body) => data(api.put(`${base}/profile`, body));

export const createReminder = (body) => data(api.post(`${base}/reminders`, body));
export const setReminderActive = (id, active) => data(api.patch(`${base}/reminders/${id}`, { active }));
export const deleteReminder = (id) => api.delete(`${base}/reminders/${id}`);
export const getDoses = (day, days = 1) => data(api.get(`${base}/doses`, { params: { day, days } }));
export const logDose = (body) => data(api.post(`${base}/doses`, body));
export const getTimeline = () => data(api.get(`${base}/timeline`));

export const giveEmergencyConsent = () => data(api.post(`${base}/emergency-consent`));
export const withdrawEmergencyConsent = () => data(api.delete(`${base}/emergency-consent`));
export const getEmergencySummary = () => data(api.get(`${base}/emergency-summary`));

/** The patient's own calendar date. The server's clock may already be on a different day. */
export const localDate = (date = new Date()) => date.toLocaleDateString('en-CA');

export function medicineLabel(medicine) {
  return [medicine.brand_name || medicine.medicine_name, medicine.strength].filter(Boolean).join(' ');
}

export function downloadCalendarFile(reminder, title) {
  const url = URL.createObjectURL(new Blob([buildCalendarFile(reminder, title)], { type: 'text/calendar' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'cardioguard-reminder.ics';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function formatTime(value, locale) {
  const [hours, minutes] = value.split(':').map(Number);
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
}
