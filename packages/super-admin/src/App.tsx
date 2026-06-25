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

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-gray-900 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-gray-800 border-r border-gray-700 flex flex-col">
        <div className="p-6 border-b border-gray-700">
          <h1 className="text-xl font-bold text-white">SAMS</h1>
          <p className="text-xs text-gray-400 mt-1">Super Admin</p>
        </div>
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          <Link
            to="/"
            className="block px-4 py-2 text-gray-300 hover:bg-gray-700 hover:text-white rounded-lg transition-colors"
          >
            📊 Dashboard
          </Link>
          <Link
            to="/licenses"
            className="block px-4 py-2 text-gray-300 hover:bg-gray-700 hover:text-white rounded-lg transition-colors"
          >
            🔑 License Management
          </Link>
          <Link
            to="/license-expiry"
            className="block px-4 py-2 text-gray-300 hover:bg-gray-700 hover:text-white rounded-lg transition-colors"
          >
            🚨 License Expiry Engine
          </Link>
          <Link
            to="/schools"
            className="block px-4 py-2 text-gray-300 hover:bg-gray-700 hover:text-white rounded-lg transition-colors"
          >
            🏫 Schools
          </Link>
          <Link
            to="/batch-operations"
            className="block px-4 py-2 text-gray-300 hover:bg-gray-700 hover:text-white rounded-lg transition-colors"
          >
            ⚡ Batch Operations
          </Link>
          <Link
            to="/feature-flags"
            className="block px-4 py-2 text-gray-300 hover:bg-gray-700 hover:text-white rounded-lg transition-colors"
          >
            🧪 Feature Flags
          </Link>
          <Link
            to="/revenue"
            className="block px-4 py-2 text-gray-300 hover:bg-gray-700 hover:text-white rounded-lg transition-colors"
          >
            📈 Revenue
          </Link>
          <Link
            to="/revenue-forecast"
            className="block px-4 py-2 text-gray-300 hover:bg-gray-700 hover:text-white rounded-lg transition-colors"
          >
            📊 Revenue Forecast
          </Link>
          <Link
            to="/performance"
            className="block px-4 py-2 text-gray-300 hover:bg-gray-700 hover:text-white rounded-lg transition-colors"
          >
            📊 Performance Monitor
          </Link>
          <Link
            to="/security"
            className="block px-4 py-2 text-gray-300 hover:bg-gray-700 hover:text-white rounded-lg transition-colors"
          >
            🔐 Security Dashboard
          </Link>
          <Link
            to="/audit-logs"
            className="block px-4 py-2 text-gray-300 hover:bg-gray-700 hover:text-white rounded-lg transition-colors"
          >
            📋 Audit Logs
          </Link>
          <Link
            to="/school-admin-activity"
            className="block px-4 py-2 text-gray-300 hover:bg-gray-700 hover:text-white rounded-lg transition-colors"
          >
            🎯 Admin Activity Log
          </Link>
          <Link
            to="/brand-templates"
            className="block px-4 py-2 text-gray-300 hover:bg-gray-700 hover:text-white rounded-lg transition-colors"
          >
            🏷️ Branding Templates
          </Link>
          <Link
            to="/data-export"
            className="block px-4 py-2 text-gray-300 hover:bg-gray-700 hover:text-white rounded-lg transition-colors"
          >
            📦 Data Export & Backup
          </Link>
          <Link
            to="/scheduled-jobs"
            className="block px-4 py-2 text-gray-300 hover:bg-gray-700 hover:text-white rounded-lg transition-colors"
          >
            📋 Scheduled Jobs
          </Link>
          <Link
            to="/notifications"
            className="block px-4 py-2 text-gray-300 hover:bg-gray-700 hover:text-white rounded-lg transition-colors"
          >
            🔔 Notifications
          </Link>
          <Link
            to="/knowledge"
            className="block px-4 py-2 text-gray-300 hover:bg-gray-700 hover:text-white rounded-lg transition-colors"
          >
            📚 Knowledge Base
          </Link>
          <Link
            to="/settings"
            className="block px-4 py-2 text-gray-300 hover:bg-gray-700 hover:text-white rounded-lg transition-colors"
          >
            ⚙️ Settings
          </Link>
        </nav>
        <div className="p-4 border-t border-gray-700">
          <p className="text-sm text-gray-400 mb-2">{user?.fullName}</p>
          <button
            onClick={handleLogout}
            className="w-full px-4 py-2 text-sm text-red-400 hover:bg-red-900/30 rounded-lg transition-colors"
          >
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-8 overflow-y-auto">
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
