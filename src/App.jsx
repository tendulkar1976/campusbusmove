import { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import PermissionsGate from "./components/PermissionsGate";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ThemeProvider, useTheme } from "./context/ThemeContext";
import ProtectedRoute from "./components/ProtectedRoute";

// Lazy load every dashboard — login renders instantly, dashboards load in parallel
const Login           = lazy(() => import("./pages/Login"));
const StudentDashboard = lazy(() => import("./pages/StudentDashboard"));
const DriverDashboard  = lazy(() => import("./pages/DriverDashboard"));
const AdminDashboard   = lazy(() => import("./pages/AdminDashboard"));

function Spinner() {
  const { t } = useTheme();
  return (
    <div style={{ minHeight: "100vh", background: t.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", transition: "background 0.25s" }}>
      <div style={{ width: 36, height: 36, border: `3.5px solid ${t.border}`, borderTopColor: "#FF5A1F", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

function RoleRedirect() {
  const { role, loading } = useAuth();
  if (loading) return <Spinner />;
  if (role === "admin" || role === "superadmin")  return <Navigate to="/admin"   replace />;
  if (role === "driver") return <Navigate to="/driver"  replace />;
  return <Navigate to="/student" replace />;
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <PermissionsGate>
          <BrowserRouter>
            <Suspense fallback={<Spinner />}>
              <Routes>
                <Route path="/login"   element={<Login />} />
                <Route path="/"        element={<RoleRedirect />} />
                <Route path="/student" element={
                  <ProtectedRoute allowedRoles={["student", "teacher"]}>
                    <StudentDashboard />
                  </ProtectedRoute>
                }/>
                <Route path="/driver"  element={
                  <ProtectedRoute allowedRoles={["driver"]}>
                    <DriverDashboard />
                  </ProtectedRoute>
                }/>
                <Route path="/admin"   element={
                  <ProtectedRoute allowedRoles={["admin", "superadmin"]}>
                    <AdminDashboard />
                  </ProtectedRoute>
                }/>
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </PermissionsGate>
      </AuthProvider>
    </ThemeProvider>
  );
}
