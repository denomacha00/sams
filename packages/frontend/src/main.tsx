import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import './index.css';
import { UserRole } from '@sams/shared';

import AuthGuard from './components/AuthGuard';
import AISAMSWidget from './components/AISAMSWidget';
import FloatingAI from './components/FloatingAI';
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

// Admin pages
import AdminDashboardPage from './pages/admin/AdminDashboardPage';
import UserManagementPage from './pages/admin/UserManagementPage';
import RegistrationLinksPage from './pages/admin/RegistrationLinksPage';
import TimetablePage from './pages/admin/TimetablePage';
import DepartmentsPage from './pages/admin/DepartmentsPage';

import { useAuthStore } from './store/authStore';
import { registerServiceWorker } from './workers/swRegistration';

// Register service worker
registerServiceWorker();

/** Conditionally renders the AI-SAMS widget only on authenticated pages */
const AISAMSWidgetGuard: React.FC = () => {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const location = useLocation();

  const publicPaths = ['/login', '/activate', '/register'];
  const isPublicPage = publicPaths.some((p) => location.pathname.startsWith(p));

  if (!isAuthenticated || isPublicPage) return null;
  return <AISAMSWidget />;
};

/** Conditionally renders the FloatingAI chat button only when authenticated */
const FloatingAIGuard: React.FC = () => {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (!isAuthenticated) return null;
  return <FloatingAI />;
};

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <AISAMSWidgetGuard />
      <FloatingAIGuard />
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/activate" element={<ActivationPage />} />
        <Route path="/register/:token" element={<RegisterPage />} />

        {/* Protected routes — any authenticated user */}
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

        {/* Admin routes — restricted to SCHOOL_ADMIN and HOD roles */}
        <Route element={<AuthGuard allowedRoles={[UserRole.SCHOOL_ADMIN, UserRole.HOD]} />}>
          <Route path="/admin" element={<AdminDashboardPage />} />
          <Route path="/admin/users" element={<UserManagementPage />} />
          <Route path="/admin/links" element={<RegistrationLinksPage />} />
          <Route path="/admin/timetable" element={<TimetablePage />} />
          <Route path="/admin/departments" element={<DepartmentsPage />} />
        </Route>

        {/* Default redirect */}
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
