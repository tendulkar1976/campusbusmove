import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";

export default function ProtectedRoute({ children, allowedRoles }) {
  const { user, role, loading } = useAuth();
  const { t } = useTheme();

  if (loading) return (
    <div style={{ minHeight: "100vh", background: t.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", transition: "background 0.25s" }}>
      <div style={{ width: 36, height: 36, border: `3.5px solid ${t.border}`, borderTopColor: "#FF5A1F", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );

  if (!user) return <Navigate to="/login" />;
  if (allowedRoles && !allowedRoles.includes(role)) return <Navigate to="/login" />;

  return children;
}
