import React from 'react';
import { Navigate } from 'react-router-dom';

/** Admin/HOD landing — tools live on the main dashboard to avoid duplicate nav. */
const AdminDashboardPage: React.FC = () => <Navigate to="/dashboard" replace />;

export default AdminDashboardPage;
