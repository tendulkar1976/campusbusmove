import { createContext, useContext, useEffect, useState } from "react";
import { auth, db } from "../firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [campusId, setCampusId] = useState(null);
  const [blocked, setBlocked] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const snap = await getDoc(doc(db, "users", firebaseUser.uid));
        if (snap.exists()) {
          const data = snap.data();
          // If blocked — sign out immediately
          if (data.blocked) {
            await signOut(auth);
            setUser(null); setRole(null); setCampusId(null); setBlocked(true);
            setLoading(false);
            return;
          }
          setRole(data.role);
          setCampusId(data.campusId);
          setBlocked(false);
        }
        setUser(firebaseUser);
      } else {
        setUser(null); setRole(null); setCampusId(null);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  async function logout() { await signOut(auth); }

  return (
    <AuthContext.Provider value={{ user, role, campusId, blocked, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() { return useContext(AuthContext); }
