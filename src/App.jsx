import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import PermissionsGate from "./components/PermissionsGate";
import { AuthProvider, useAuth } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import Login from "./pages/Login";
import StudentDashboard from "./pages/StudentDashboard";
import DriverDashboard from "./pages/DriverDashboard";
import AdminDashboard from "./pages/AdminDashboard";

function RoleRedirect() {
  const { role, loading } = useAuth();
  if (loading) return null;
  if (role === "admin") return <Navigate to="/admin" replace />;
  if (role === "driver") return <Navigate to="/driver" replace />;
  return <Navigate to="/student" replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <PermissionsGate>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<RoleRedirect />} />
          <Route
            path="/student"
            element={
              <ProtectedRoute allowedRoles={["student", "teacher"]}>
                <StudentDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/driver"
            element={
              <ProtectedRoute allowedRoles={["driver"]}>
                <DriverDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <AdminDashboard />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      </PermissionsGate>
    </AuthProvider>
  );
}
