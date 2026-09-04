import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';

// Layouts
import PrivateLayout from './components/PrivateLayout';

// Public pages
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import FeaturesPage from './pages/FeaturesPage';
import AboutPage from './pages/AboutPage';

// User pages
import UserDashboard from './pages/UserDashboard';
import ScanManagement from './pages/ScanManagement';
import NewScanForm from './pages/NewScanForm';
import ScanDetails from './pages/ScanDetails';
import VulnerabilityDetails from './pages/VulnerabilityDetails';
import ReportsPage from './pages/ReportsPage';
import SettingsPage from './pages/SettingsPage';

// Admin pages
import AdminPanel from './pages/AdminPanel';
import UserManagement from './pages/UserManagement';
import ActivityLogViewer from './pages/ActivityLogViewer';

function RequireAuth({ role }: { role?: 'user' | 'admin' }) {
  const { isAuthenticated, user } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (role === 'admin' && user?.role !== 'admin') {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
}

function AppRoutes() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/features" element={<FeaturesPage />} />
      <Route path="/about" element={<AboutPage />} />

      {/* Authenticated user routes */}
      <Route element={<RequireAuth role="user" />}>
        <Route element={<PrivateLayout />}>
          <Route path="/dashboard" element={<UserDashboard />} />
          <Route path="/scans" element={<ScanManagement />} />
          <Route path="/scans/new" element={<NewScanForm />} />
          <Route path="/scans/:id" element={<ScanDetails />} />
          <Route path="/scans/:id/vulnerabilities/:vid" element={<VulnerabilityDetails />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Route>

      {/* Admin routes */}
      <Route element={<RequireAuth role="admin" />}>
        <Route element={<PrivateLayout />}>
          <Route path="/admin" element={<AdminPanel />} />
          <Route path="/admin/users" element={<UserManagement />} />
          <Route path="/admin/logs" element={<ActivityLogViewer />} />
        </Route>
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
