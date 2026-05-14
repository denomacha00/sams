import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import type { UserRole } from '@sams/shared';

interface AuthGuardProps {
  allowedRoles?: UserRole[];
}

/**
 * Route guard that checks authentication and optionally restricts by role.
 * When used without props (as a layout route element), it only checks isAuthenticated.
 * When allowedRoles is provided, it also verifies the user's role is in the list.
 */
const AuthGuard: React.FC<AuthGuardProps> = ({ allowedRoles }) => {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (allowedRoles && user && !allowedRoles.includes(user.role)) {
    // User is authenticated but doesn't have the required role — redirect to dashboard
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
};

export default AuthGuard;
