import { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import PermissionsGate from "./components/PermissionsGate";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import ProtectedRoute from "./components/ProtectedRoute";

// Lazy load every dashboard — login renders instantly, dashboards load in parallel
const Login           = lazy(() => import("./pages/Login"));
const StudentDashboard = lazy(() => import("./pages/StudentDashboard"));
const DriverDashboard  = lazy(() => import("./pages/DriverDashboard"));
const AdminDashboard   = lazy(() => import("./pages/AdminDashboard"));

function Spinner() {
  return (
    <div style={{ minHeight: "100vh", background: "#0A0A0A", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{ fontSize: 32 }}>🚌</div>
      <div style={{ width: 120, height: 3, background: "#1A1A1A", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ height: "100%", width: "40%", background: "#FF5A1F", borderRadius: 2, animation: "slide 1s ease-in-out infinite alternate" }} />
      </div>
      <style>{`@keyframes slide{from{transform:translateX(0)}to{transform:translateX(200%)}}`}</style>
    </div>
  );
}

function RoleRedirect() {
  const { role, loading } = useAuth();
  if (loading) return <Spinner />;
  if (role === "admin")  return <Navigate to="/admin"   replace />;
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
                  <ProtectedRoute allowedRoles={["admin"]}>
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
