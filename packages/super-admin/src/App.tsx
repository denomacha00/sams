import React from 'react';
import { Routes, Route, Link, useNavigate } from 'react-router-dom';
import AuthGuard from './components/AuthGuard';
import SuperAdminAI from './components/SuperAdminAI';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import LicenseGeneratorPage from './pages/LicenseGeneratorPage';
import SchoolsListPage from './pages/SchoolsListPage';
import RevenuePage from './pages/RevenuePage';
import AuditLogPage from './pages/AuditLogPage';
import KnowledgeBasePage from './pages/KnowledgeBasePage';
import NotificationsPage from './pages/NotificationsPage';
import SettingsPage from './pages/SettingsPage';
import PerformancePage from './pages/PerformancePage';
import SecurityDashboardPage from './pages/SecurityDashboardPage';
import BatchOperationsPage from './pages/BatchOperationsPage';
import FeatureFlagsPage from './pages/FeatureFlagsPage';
import DataExportPage from './pages/DataExportPage';
import RevenueForecastPage from './pages/RevenueForecastPage';
import SchoolAdminActivityPage from './pages/SchoolAdminActivityPage';
import LicenseExpiryPage from './pages/LicenseExpiryPage';
import BrandTemplatesPage from './pages/BrandTemplatesPage';
import ScheduledJobsPage from './pages/ScheduledJobsPage';
import { useAuthStore } from './store/authStore';

/** Sidebar nav link component matching main app style */
const SidebarLink: React.FC<{ to: string; icon: string; label: string }> = ({ to, icon, label }) => {
  return (
    <Link
      to={to}
      className="flex w-full items-center gap-3 px-3 py-2 rounded-lg no-underline text-ink-muted hover:text-ink hover:bg-surface-elevated transition-all duration-150"
    >
      <span className="w-5 h-5 flex items-center justify-center shrink-0 text-sm">{icon}</span>
      <span className="text-sm font-medium leading-none truncate">{label}</span>
    </Link>
  );
};

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-canvas text-ink flex">
      {/* Sidebar */}
      <aside className="w-64 bg-surface border-r border-line flex flex-col">
        <div className="p-6 border-b border-line">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-brand flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
            </div>
            <div>
              <h1 className="text-base font-bold text-ink tracking-tight">SAMS</h1>
              <p className="text-[10px] text-ink-muted">Super Admin</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          <SidebarLink to="/" icon="📊" label="Dashboard" />
          <SidebarLink to="/licenses" icon="🔑" label="License Management" />
          <SidebarLink to="/license-expiry" icon="🚨" label="License Expiry Engine" />
          <SidebarLink to="/schools" icon="🏫" label="Schools" />
          <SidebarLink to="/batch-operations" icon="⚡" label="Batch Operations" />
          <SidebarLink to="/feature-flags" icon="🧪" label="Feature Flags" />
          <SidebarLink to="/revenue" icon="📈" label="Revenue" />
          <SidebarLink to="/revenue-forecast" icon="📊" label="Revenue Forecast" />
          <SidebarLink to="/performance" icon="📊" label="Performance Monitor" />
          <SidebarLink to="/security" icon="🔐" label="Security Dashboard" />
          <SidebarLink to="/audit-logs" icon="📋" label="Audit Logs" />
          <SidebarLink to="/school-admin-activity" icon="🎯" label="Admin Activity" />
          <SidebarLink to="/brand-templates" icon="🏷️" label="Branding Templates" />
          <SidebarLink to="/data-export" icon="📦" label="Data Export" />
          <SidebarLink to="/scheduled-jobs" icon="📋" label="Scheduled Jobs" />
          <SidebarLink to="/notifications" icon="🔔" label="Notifications" />
          <SidebarLink to="/knowledge" icon="📚" label="Knowledge Base" />
          <SidebarLink to="/settings" icon="⚙️" label="Settings" />
        </nav>
        <div className="p-4 border-t border-line">
          <p className="text-xs text-ink-muted mb-2 truncate">{user?.fullName}</p>
          <button
            onClick={handleLogout}
            className="w-full px-3 py-1.5 text-xs text-red-400 hover:bg-red-900/30 rounded-lg transition-colors text-left"
          >
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-6 overflow-y-auto">
        {children}
      </main>

      {/* AI Assistant */}
      <SuperAdminAI />
    </div>
  );
};

function App(): React.ReactElement {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<AuthGuard />}>
        <Route
          path="/"
          element={
            <Layout>
              <DashboardPage />
            </Layout>
          }
        />
        <Route
          path="/licenses"
          element={
            <Layout>
              <LicenseGeneratorPage />
            </Layout>
          }
        />
        <Route
          path="/license-expiry"
          element={
            <Layout>
              <LicenseExpiryPage />
            </Layout>
          }
        />
        <Route
          path="/schools"
          element={
            <Layout>
              <SchoolsListPage />
            </Layout>
          }
        />
        <Route
          path="/batch-operations"
          element={
            <Layout>
              <BatchOperationsPage />
            </Layout>
          }
        />
        <Route
          path="/feature-flags"
          element={
            <Layout>
              <FeatureFlagsPage />
            </Layout>
          }
        />
        <Route
          path="/revenue"
          element={
            <Layout>
              <RevenuePage />
            </Layout>
          }
        />
        <Route
          path="/revenue-forecast"
          element={
            <Layout>
              <RevenueForecastPage />
            </Layout>
          }
        />
        <Route
          path="/performance"
          element={
            <Layout>
              <PerformancePage />
            </Layout>
          }
        />
        <Route
          path="/security"
          element={
            <Layout>
              <SecurityDashboardPage />
            </Layout>
          }
        />
        <Route
          path="/audit-logs"
          element={
            <Layout>
              <AuditLogPage />
            </Layout>
          }
        />
        <Route
          path="/school-admin-activity"
          element={
            <Layout>
              <SchoolAdminActivityPage />
            </Layout>
          }
        />
        <Route
          path="/brand-templates"
          element={
            <Layout>
              <BrandTemplatesPage />
            </Layout>
          }
        />
        <Route
          path="/data-export"
          element={
            <Layout>
              <DataExportPage />
            </Layout>
          }
        />
        <Route
          path="/scheduled-jobs"
          element={
            <Layout>
              <ScheduledJobsPage />
            </Layout>
          }
        />
        <Route
          path="/notifications"
          element={
            <Layout>
              <NotificationsPage />
            </Layout>
          }
        />
        <Route
          path="/knowledge"
          element={
            <Layout>
              <KnowledgeBasePage />
            </Layout>
          }
        />
        <Route
          path="/settings"
          element={
            <Layout>
              <SettingsPage />
            </Layout>
          }
        />
      </Route>
    </Routes>
  );
}

export default App;
