import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './index.css';
import { UserRole } from '@sams/shared';

import AuthGuard from './components/AuthGuard';
import FloatingAI from './components/FloatingAI';
import AppLayout from './components/AppLayout';
import LoginPage from './pages/LoginPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import ClassStudentsPage from './pages/ClassStudentsPage';
import ClassRosterPage from './pages/ClassRosterPage';
import ActivationPage from './pages/ActivationPage';
import RegisterPage from './pages/RegisterPage';
import DashboardPage from './pages/DashboardPage';
import SessionPage from './pages/SessionPage';
import QRScanPage from './pages/QRScanPage';
import ManualAttendancePage from './pages/ManualAttendancePage';
import BiometricEnrollPage from './pages/BiometricEnrollPage';
import BiometricAttendancePage from './pages/BiometricAttendancePage';
import FingerprintAttendancePage from './pages/FingerprintAttendancePage';
import ReportsPage from './pages/ReportsPage';
import RiskScorePage from './pages/RiskScorePage';
import AIAssistantPage from './pages/AIAssistantPage';
import SettingsPage from './pages/SettingsPage';
import ProfilePage from './pages/ProfilePage';
import NotificationsPage from './pages/NotificationsPage';
import TimetableViewPage from './pages/TimetableViewPage';
import LinkAttendancePage from './pages/LinkAttendancePage';

// HOD pages
import DepartmentManagementPage from './pages/hod/DepartmentManagementPage';

// Admin pages
import AdminDashboardPage from './pages/admin/AdminDashboardPage';
import UserManagementPage from './pages/admin/UserManagementPage';
import RegistrationLinksPage from './pages/admin/RegistrationLinksPage';
import TimetablePage from './pages/admin/TimetablePage';
import DepartmentsPage from './pages/admin/DepartmentsPage';
import KnowledgeManagementPage from './pages/admin/KnowledgeManagementPage';
import ExamsPage from './pages/admin/ExamsPage';
import GuardianManagementPage from './pages/admin/GuardianManagementPage';
import ParentDashboardPage from './pages/ParentDashboardPage';

import { registerServiceWorker } from './workers/swRegistration';

// Register service worker
registerServiceWorker();

/** Shows the FloatingAI chat button on all pages (including login for basic questions) */
const FloatingAIGuard: React.FC = () => {
  return <FloatingAI />;
};

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <FloatingAIGuard />
      <Routes>
        {/* Public routes — no sidebar layout */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/activate" element={<ActivationPage />} />
        <Route path="/register/:token" element={<RegisterPage />} />
        <Route path="/attend/:token" element={<LinkAttendancePage />} />

        {/* Protected routes — wrapped with sidebar + topbar layout */}
        <Route element={<AuthGuard />}>
          <Route element={<AppLayout />}>
            {/* Common routes */}
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/timetable" element={<TimetableViewPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/ai" element={<AIAssistantPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/biometric/enroll" element={<BiometricEnrollPage />} />

            {/* Teacher + HOD attendance routes */}
            <Route element={<AuthGuard allowedRoles={[UserRole.HOD, UserRole.TEACHER]} />}>
              <Route path="/sessions" element={<SessionPage />} />
              <Route path="/attendance" element={<ManualAttendancePage />} />
              <Route path="/biometric/attendance" element={<BiometricAttendancePage />} />
              <Route path="/fingerprint/attendance" element={<FingerprintAttendancePage />} />
            </Route>

            {/* Student workbench */}
            <Route element={<AuthGuard allowedRoles={[UserRole.SCHOOL_ADMIN, UserRole.HOD, UserRole.TEACHER]} />}>
              <Route path="/class/students" element={<ClassStudentsPage />} />
            </Route>

            {/* Class representatives roster */}
            <Route element={<AuthGuard allowedRoles={[UserRole.SCHOOL_ADMIN, UserRole.HOD, UserRole.TEACHER]} />}>
              <Route path="/class-roster" element={<ClassRosterPage />} />
            </Route>

            {/* Knowledge management */}
            <Route element={<AuthGuard allowedRoles={[UserRole.SCHOOL_ADMIN, UserRole.HOD, UserRole.TEACHER]} />}>
              <Route path="/admin/knowledge" element={<KnowledgeManagementPage />} />
            </Route>

            {/* Student-only routes */}
            <Route element={<AuthGuard allowedRoles={[UserRole.STUDENT]} />}>
              <Route path="/sessions/scan" element={<QRScanPage />} />
            </Route>

            {/* Admin routes */}
            <Route element={<AuthGuard allowedRoles={[UserRole.SCHOOL_ADMIN, UserRole.HOD]} />}>
              <Route path="/admin" element={<AdminDashboardPage />} />
              <Route path="/admin/users" element={<UserManagementPage />} />
              <Route path="/admin/timetable" element={<TimetablePage />} />
            </Route>

            {/* Risk scores */}
            <Route element={<AuthGuard allowedRoles={[UserRole.SCHOOL_ADMIN, UserRole.HOD, UserRole.TEACHER]} />}>
              <Route path="/risk-scores" element={<RiskScorePage />} />
            </Route>

            {/* School admin-only */}
            <Route element={<AuthGuard allowedRoles={[UserRole.SCHOOL_ADMIN]} />}>
              <Route path="/admin/departments" element={<DepartmentsPage />} />
              <Route path="/admin/guardians" element={<GuardianManagementPage />} />
            </Route>

            {/* Registration Links */}
            <Route element={<AuthGuard allowedRoles={[UserRole.SCHOOL_ADMIN, UserRole.HOD, UserRole.TEACHER]} />}>
              <Route path="/admin/links" element={<RegistrationLinksPage />} />
            </Route>

            {/* HOD-only */}
            <Route element={<AuthGuard allowedRoles={[UserRole.HOD]} />}>
              <Route path="/hod/department" element={<DepartmentManagementPage />} />
            </Route>

            {/* Exams & Grades */}
            <Route element={<AuthGuard allowedRoles={[UserRole.SCHOOL_ADMIN, UserRole.HOD, UserRole.TEACHER]} />}>
              <Route path="/admin/exams" element={<ExamsPage />} />
            </Route>

            {/* Parent / Guardian */}
            <Route element={<AuthGuard allowedRoles={[UserRole.GUARDIAN]} />}>
              <Route path="/parent" element={<ParentDashboardPage />} />
            </Route>
          </Route>
        </Route>

        {/* Default redirect */}
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
