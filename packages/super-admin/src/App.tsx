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
        <nav className="flex-1 p-4 space-y-1">
          <Link
            to="/"
            className="block px-4 py-2 text-gray-300 hover:bg-gray-700 hover:text-white rounded-lg transition-colors"
          >
            Dashboard
          </Link>
          <Link
            to="/licenses"
            className="block px-4 py-2 text-gray-300 hover:bg-gray-700 hover:text-white rounded-lg transition-colors"
          >
            License Generator
          </Link>
          <Link
            to="/schools"
            className="block px-4 py-2 text-gray-300 hover:bg-gray-700 hover:text-white rounded-lg transition-colors"
          >
            Schools
          </Link>
          <Link
            to="/revenue"
            className="block px-4 py-2 text-gray-300 hover:bg-gray-700 hover:text-white rounded-lg transition-colors"
          >
            Revenue
          </Link>
          <Link
            to="/audit-logs"
            className="block px-4 py-2 text-gray-300 hover:bg-gray-700 hover:text-white rounded-lg transition-colors"
          >
            Audit Logs
          </Link>
          <Link
            to="/knowledge"
            className="block px-4 py-2 text-gray-300 hover:bg-gray-700 hover:text-white rounded-lg transition-colors"
          >
            Knowledge Base
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
          path="/schools"
          element={
            <Layout>
              <SchoolsListPage />
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
          path="/audit-logs"
          element={
            <Layout>
              <AuditLogPage />
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
      </Route>
    </Routes>
  );
}

export default App;
