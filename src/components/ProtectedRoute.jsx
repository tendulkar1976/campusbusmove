import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function ProtectedRoute({ children, allowedRoles }) {
  const { user, role, loading } = useAuth();

  if (loading) return (
    <div className="flex items-center justify-center h-screen bg-gray-950">
      <div className="text-orange-400 text-lg animate-pulse">Loading...</div>
    </div>
  );

  if (!user) return <Navigate to="/login" />;
  if (allowedRoles && !allowedRoles.includes(role)) return <Navigate to="/login" />;

  return children;
}
