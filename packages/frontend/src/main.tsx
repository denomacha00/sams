import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './index.css';

import AuthGuard from './components/AuthGuard';
import LoginPage from './pages/LoginPage';
import ActivationPage from './pages/ActivationPage';
import RegisterPage from './pages/RegisterPage';
import DashboardPage from './pages/DashboardPage';
import SessionPage from './pages/SessionPage';
import QRScanPage from './pages/QRScanPage';
import ManualAttendancePage from './pages/ManualAttendancePage';
import BiometricEnrollPage from './pages/BiometricEnrollPage';
import BiometricAttendancePage from './pages/BiometricAttendancePage';
import ReportsPage from './pages/ReportsPage';
import RiskScorePage from './pages/RiskScorePage';
import AIAssistantPage from './pages/AIAssistantPage';
import SettingsPage from './pages/SettingsPage';
import { registerServiceWorker } from './workers/swRegistration';

// Register service worker
registerServiceWorker();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/activate" element={<ActivationPage />} />
        <Route path="/register/:token" element={<RegisterPage />} />

        {/* Protected routes */}
        <Route element={<AuthGuard />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/sessions" element={<SessionPage />} />
          <Route path="/sessions/scan" element={<QRScanPage />} />
          <Route path="/attendance" element={<ManualAttendancePage />} />
          <Route path="/biometric/enroll" element={<BiometricEnrollPage />} />
          <Route path="/biometric/attendance" element={<BiometricAttendancePage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/risk-scores" element={<RiskScorePage />} />
          <Route path="/ai" element={<AIAssistantPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>

        {/* Default redirect */}
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
