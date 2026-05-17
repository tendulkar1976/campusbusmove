import { useEffect, useState } from "react";
import { collection, getDocs, addDoc, deleteDoc, doc } from "firebase/firestore";
import { ref, onValue } from "firebase/database";
import { db, rtdb } from "../firebase";
import { useAuth } from "../context/AuthContext";

export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState("overview");
  const [liveStatus, setLiveStatus] = useState({});
  const [routes, setRoutes] = useState([]);
  const [users, setUsers] = useState([]);
  const [newRoute, setNewRoute] = useState({ name: "", label: "", description: "", campusId: "alliance-bangalore" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const routesRef = ref(rtdb, "routes");
    const unsub = onValue(routesRef, (snap) => { if (snap.exists()) setLiveStatus(snap.val()); });
    return () => unsub();
  }, []);

  useEffect(() => {
    getDocs(collection(db, "routes")).then((snap) => setRoutes(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
  }, []);

  useEffect(() => {
    if (tab !== "users") return;
    getDocs(collection(db, "users")).then((snap) => setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
  }, [tab]);

  async function addRoute() {
    if (!newRoute.name || !newRoute.label) return;
    setSaving(true);
    await addDoc(collection(db, "routes"), { ...newRoute, path: [], stops: [], createdAt: Date.now() });
    setSaving(false);
    setNewRoute({ name: "", label: "", description: "", campusId: "alliance-bangalore" });
    getDocs(collection(db, "routes")).then((snap) => setRoutes(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
  }

  async function deleteRoute(id) {
    await deleteDoc(doc(db, "routes", id));
    setRoutes((r) => r.filter((x) => x.id !== id));
  }

  const activeBuses = Object.values(liveStatus).filter((r) => r?.live?.active).length;

  const S = {
    screen: { minHeight: "100vh", background: "#0A0A0A", fontFamily: "'DM Sans', sans-serif", color: "#fff" },
    header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 20px 16px", borderBottom: "1px solid #141414", position: "sticky", top: 0, background: "#0A0A0A", zIndex: 10 },
    brand: { display: "flex", alignItems: "center", gap: 10 },
    logo: { width: 32, height: 32, background: "#FF5A1F", borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 },
    badge: { background: "#1A0F0A", border: "1px solid #3D1F0A", borderRadius: 6, padding: "3px 8px", color: "#FF5A1F", fontSize: 11, fontWeight: 600 },
    signOut: { background: "none", border: "1px solid #1E1E1E", borderRadius: 8, padding: "6px 14px", color: "#555", fontSize: 12, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" },
    tabs: { display: "flex", borderBottom: "1px solid #141414", padding: "0 20px", gap: 4 },
    tab: (active) => ({ padding: "12px 16px", border: "none", background: "none", cursor: "pointer", fontSize: 13, fontWeight: 500, color: active ? "#FF5A1F" : "#444", borderBottom: active ? "2px solid #FF5A1F" : "2px solid transparent", fontFamily: "'DM Sans', sans-serif", transition: "all 0.15s" }),
    body: { padding: "20px 16px 40px", maxWidth: 560, margin: "0 auto" },
    grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 },
    statCard: { background: "#0F0F0F", border: "1px solid #1A1A1A", borderRadius: 14, padding: "16px" },
    statVal: (color) => ({ fontSize: 32, fontWeight: 700, color, letterSpacing: "-1px", margin: "4px 0 0" }),
    statLabel: { fontSize: 11, color: "#444", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.8px" },
    card: { background: "#0F0F0F", border: "1px solid #1A1A1A", borderRadius: 14, overflow: "hidden", marginBottom: 16 },
    cardHeader: { padding: "14px 16px", borderBottom: "1px solid #141414" },
    cardLabel: { fontSize: 10, color: "#333", fontWeight: 600, textTransform: "uppercase", letterSpacing: "1px" },
    row: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid #111" },
    input: { width: "100%", background: "#111", border: "1px solid #1E1E1E", borderRadius: 10, padding: "12px 14px", color: "#fff", fontSize: 13, outline: "none", boxSizing: "border-box", fontFamily: "'DM Sans', sans-serif", marginBottom: 8 },
    btn: { width: "100%", background: "#FF5A1F", border: "none", borderRadius: 10, padding: "13px 0", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" },
    deleteBtn: { background: "none", border: "none", color: "#3D1010", cursor: "pointer", fontSize: 12, fontFamily: "'DM Sans', sans-serif" },
    liveDot: (active) => ({ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: active ? "#4ADE80" : "#333", marginRight: 6 }),
  };

  return (
    <div style={S.screen}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet" />
      <div style={S.header}>
        <div style={S.brand}>
          <div style={S.logo}>🚌</div>
          <span style={{ color: "#fff", fontWeight: 600, fontSize: 15, letterSpacing: "-0.3px" }}>CampusMove</span>
          <span style={S.badge}>Admin</span>
        </div>
        <button onClick={logout} style={S.signOut}>Sign out</button>
      </div>

      <div style={S.tabs}>
        {["overview", "routes", "users"].map(t => (
          <button key={t} style={S.tab(tab === t)} onClick={() => setTab(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <div style={S.body}>
        {tab === "overview" && (
          <>
            <div style={S.grid}>
              <div style={S.statCard}><div style={S.statLabel}>Active Buses</div><div style={S.statVal("#4ADE80")}>{activeBuses}</div></div>
              <div style={S.statCard}><div style={S.statLabel}>Total Routes</div><div style={S.statVal("#FF5A1F")}>{routes.length}</div></div>
              <div style={S.statCard}><div style={S.statLabel}>Campuses</div><div style={S.statVal("#60A5FA")}>1</div></div>
              <div style={S.statCard}><div style={S.statLabel}>Users</div><div style={S.statVal("#A78BFA")}>{users.length || "—"}</div></div>
            </div>

            <div style={S.card}>
              <div style={S.cardHeader}><span style={S.cardLabel}>Live Bus Status</span></div>
              {Object.entries(liveStatus).length === 0
                ? <div style={{ padding: "16px", color: "#2A2A2A", fontSize: 13 }}>No buses broadcasting</div>
                : Object.entries(liveStatus).map(([routeId, data]) => (
                  <div key={routeId} style={S.row}>
                    <span style={{ fontSize: 13, color: "#888" }}>{data?.live?.routeName || routeId}</span>
                    <span style={{ fontSize: 11, color: data?.live?.active ? "#4ADE80" : "#333" }}>
                      <span style={S.liveDot(data?.live?.active)} />
                      {data?.live?.active ? "Live" : "Offline"}
                    </span>
                  </div>
                ))}
            </div>
          </>
        )}

        {tab === "routes" && (
          <>
            <div style={S.card}>
              <div style={S.cardHeader}><span style={S.cardLabel}>Add New Route</span></div>
              <div style={{ padding: 16 }}>
                <input value={newRoute.name} onChange={e => setNewRoute({ ...newRoute, name: e.target.value })} placeholder="Route name (e.g. Route 3)" style={S.input} />
                <input value={newRoute.label} onChange={e => setNewRoute({ ...newRoute, label: e.target.value })} placeholder="Label (e.g. West Campus Loop)" style={S.input} />
                <input value={newRoute.description} onChange={e => setNewRoute({ ...newRoute, description: e.target.value })} placeholder="Description (optional)" style={S.input} />
                <button onClick={addRoute} disabled={saving} style={S.btn}>{saving ? "Saving..." : "Add Route"}</button>
              </div>
            </div>

            <div style={S.card}>
              <div style={S.cardHeader}><span style={S.cardLabel}>All Routes ({routes.length})</span></div>
              {routes.length === 0
                ? <div style={{ padding: 16, color: "#2A2A2A", fontSize: 13 }}>No routes yet</div>
                : routes.map(route => (
                  <div key={route.id} style={S.row}>
                    <div>
                      <div style={{ fontSize: 13, color: "#ccc", fontWeight: 500 }}>{route.name}</div>
                      <div style={{ fontSize: 11, color: "#333", marginTop: 2 }}>{route.label}</div>
                    </div>
                    <button onClick={() => deleteRoute(route.id)} style={S.deleteBtn}>Delete</button>
                  </div>
                ))}
            </div>
          </>
        )}

        {tab === "users" && (
          <div style={S.card}>
            <div style={S.cardHeader}><span style={S.cardLabel}>Registered Users ({users.length})</span></div>
            {users.length === 0
              ? <div style={{ padding: 16, color: "#2A2A2A", fontSize: 13 }}>Loading...</div>
              : users.map(u => (
                <div key={u.id} style={S.row}>
                  <div>
                    <div style={{ fontSize: 13, color: "#ccc", fontWeight: 500 }}>{u.name || "—"}</div>
                    <div style={{ fontSize: 11, color: "#333", marginTop: 2 }}>{u.email}</div>
                  </div>
                  <span style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, background: u.role === "admin" ? "#1A0F2A" : u.role === "driver" ? "#0A1020" : "#111", color: u.role === "admin" ? "#A78BFA" : u.role === "driver" ? "#60A5FA" : "#444", border: `1px solid ${u.role === "admin" ? "#3D2A6A" : u.role === "driver" ? "#1A3060" : "#1A1A1A"}` }}>
                    {u.role}
                  </span>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}