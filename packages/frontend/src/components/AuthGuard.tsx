import React, { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { UserRole } from '@sams/shared';
import type { UserRole as UserRoleType } from '@sams/shared';
import { redirectToSuperAdminPortal } from '../utils/superAdminPortal';

interface AuthGuardProps {
  allowedRoles?: UserRoleType[];
}

/**
 * Route guard that checks authentication and optionally restricts by role.
 * When used without props (as a layout route element), it only checks isAuthenticated.
 * When allowedRoles is provided, it also verifies the user's role is in the list.
 */
const AuthGuard: React.FC<AuthGuardProps> = ({ allowedRoles }) => {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const refreshProfile = useAuthStore((s) => s.refreshProfile);
  const location = useLocation();

  useEffect(() => {
    if (isAuthenticated) {
      void refreshProfile();
    }
  }, [isAuthenticated, refreshProfile]);

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (user?.role === UserRole.SUPER_ADMIN) {
    redirectToSuperAdminPortal();
    return (
      <div className="min-h-screen flex items-center justify-center bg-canvas text-ink-muted p-6 text-center">
        <p>Redirecting to the Super Admin portal…</p>
      </div>
    );
  }

  if (allowedRoles && user && !allowedRoles.includes(user.role)) {
    // User is authenticated but doesn't have the required role — redirect to dashboard
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
};

export default AuthGuard;
