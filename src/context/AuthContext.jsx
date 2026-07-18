import { createContext, useContext, useEffect, useState } from "react";
import { auth, db } from "../firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(() => localStorage.getItem("cm_user_role"));
  const [campusId, setCampusId] = useState(() => localStorage.getItem("cm_campus_id"));
  const [blocked, setBlocked] = useState(false);
  const [loading, setLoading] = useState(!localStorage.getItem("cm_user_role"));

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      setLoading(true);
      if (firebaseUser) {
        const snap = await getDoc(doc(db, "users", firebaseUser.uid));
        if (snap.exists()) {
          const data = snap.data();
          // If blocked — sign out immediately
          if (data.blocked) {
            await signOut(auth);
            setUser(null); setRole(null); setCampusId(null); setBlocked(true);
            localStorage.removeItem("cm_user_role");
            localStorage.removeItem("cm_campus_id");
            setLoading(false);
            return;
          }
          setRole(data.role);
          setCampusId(data.campusId);
          localStorage.setItem("cm_user_role", data.role);
          localStorage.setItem("cm_campus_id", data.campusId);
          setBlocked(false);
        } else {
          // Fallback if user doc doesn't exist yet
          if (firebaseUser.email === "gamethunder83@gmail.com") {
            setRole("admin");
            localStorage.setItem("cm_user_role", "admin");
            setBlocked(false);
          } else if (firebaseUser.email === "superadmin@campusmove.com") {
            setRole("superadmin");
            localStorage.setItem("cm_user_role", "superadmin");
            setBlocked(false);
          } else {
            setRole(null);
            localStorage.removeItem("cm_user_role");
          }
        }
        setUser(firebaseUser);
      } else {
        setUser(null); setRole(null); setCampusId(null);
        localStorage.removeItem("cm_user_role");
        localStorage.removeItem("cm_campus_id");
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  async function logout() {
    await signOut(auth);
    localStorage.removeItem("cm_user_role");
    localStorage.removeItem("cm_campus_id");
  }

  return (
    <AuthContext.Provider value={{ user, role, campusId, blocked, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() { return useContext(AuthContext); }
