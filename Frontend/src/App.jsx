import React, { lazy, Suspense } from 'react';
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import AppShell from './components/layout/AppShell';
import Landing from './pages/Landing';
import Login from './pages/Login';
import ForgotPassword, { ResetPassword } from './pages/ForgotPassword';
import Signup from './pages/Signup';
import Assessment from './pages/Assessment';
import Dashboard from './pages/Dashboard';
import Simulator from './pages/Simulator';
import History from './pages/History';
import Insights from './pages/Insights';
import Reports from './pages/Reports';
import Profile from './pages/Profile';
import Settings from './pages/Settings';
import ModelInsights from './pages/ModelInsights';
import ProtectedRoute from './components/auth/ProtectedRoute';
import Emergency from './pages/Emergency';
import HomeScreening from './pages/HomeScreening';
import Community from './pages/Community';
import { LanguageProvider } from './i18n';
// The map library is large, so this page is downloaded only when opened.
const Specialists = lazy(() => import('./pages/Specialists'));
const loadSos = () => import('./pages/Sos');
const Sos = lazy(loadSos);
const SosTrack = lazy(() => import('./pages/SosTrack'));
const ErCardPage = lazy(() => import('./pages/ErCardPage'));
const pageFallback = <div className="auth-loading"><div className="loading-spinner" /><span>Loading…</span></div>;

// Fetch the SOS page in the background so it is cached for offline use before it is needed.
if (typeof window !== 'undefined') {
  window.addEventListener('load', () => (window.requestIdleCallback || setTimeout)(() => loadSos().catch(() => {})));
}
import { ToastProvider } from './ui/toast';

function App() {
  return (
    <Router>
      <LanguageProvider>
      <ToastProvider>
      <AuthProvider>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/emergency" element={<Emergency />} />
        <Route path="/sos" element={<Suspense fallback={pageFallback}><Sos /></Suspense>} />
        <Route path="/track/:shareId" element={<Suspense fallback={pageFallback}><SosTrack /></Suspense>} />
        <Route path="/er/:data" element={<Suspense fallback={pageFallback}><ErCardPage /></Suspense>} />
        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
          <Route path="/assessment" element={<Assessment />} />
          <Route path="/home-screening" element={<HomeScreening />} />
          <Route path="/community" element={<Community />} />
          <Route path="/specialists" element={<Suspense fallback={<div className="auth-loading"><div className="loading-spinner" /><span>Loading the map…</span></div>}><Specialists /></Suspense>} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/simulator" element={<Simulator />} />
          <Route path="/history" element={<History />} />
          <Route path="/insights" element={<Insights />} />
          <Route path="/model-insights" element={<ModelInsights />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/settings" element={<Settings />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </AuthProvider>
      </ToastProvider>
      </LanguageProvider>
    </Router>
  );
}

export default App;