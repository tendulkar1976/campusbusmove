import { useEffect, useState } from "react";
import { collection, getDocs, addDoc, deleteDoc, doc } from "firebase/firestore";
import { ref, onValue } from "firebase/database";
import { db, rtdb } from "../firebase";
import { useAuth } from "../context/AuthContext";

const PRESET_ROUTES = [
  { id: "route-1", name: "Route 1", label: "North Gate Loop" },
  { id: "route-2", name: "Route 2", label: "South Campus Loop" },
  { id: "route-3", name: "Route 3", label: "East Wing Loop" },
  { id: "route-3a", name: "Route 3A", label: "Express Loop" },
];

export default function AdminDashboard() {
  const { logout } = useAuth();
  const [tab, setTab] = useState("overview");
  const [liveStatus, setLiveStatus] = useState({});
  const [routes, setRoutes] = useState([]);
  const [users, setUsers] = useState([]);
  const [newRoute, setNewRoute] = useState({ name: "", label: "", description: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const r = ref(rtdb, "routes");
    const unsub = onValue(r, snap => { if (snap.exists()) setLiveStatus(snap.val()); });
    return () => unsub();
  }, []);

  function loadRoutes() {
    getDocs(collection(db, "routes")).then(snap => setRoutes(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
  }

  useEffect(() => { loadRoutes(); }, []);

  useEffect(() => {
    if (tab !== "users") return;
    getDocs(collection(db, "users")).then(snap => setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
  }, [tab]);

  async function addRoute() {
    if (!newRoute.name || !newRoute.label) return;
    setSaving(true);
    await addDoc(collection(db, "routes"), { ...newRoute, campusId: "alliance-bangalore", path: [], stops: [], createdAt: Date.now() });
    setSaving(false);
    setNewRoute({ name: "", label: "", description: "" });
    loadRoutes();
  }

  async function deleteRoute(id) {
    await deleteDoc(doc(db, "routes", id));
    setRoutes(r => r.filter(x => x.id !== id));
  }

  const activeBuses = Object.values(liveStatus).filter(r => r?.live?.active).length;

  const S = {
    screen: { minHeight: "100vh", background: "#0A0A0A", fontFamily: "'DM Sans', sans-serif", color: "#fff" },
    header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 20px 14px", borderBottom: "1px solid #141414", position: "sticky", top: 0, background: "#0A0A0A", zIndex: 10 },
    logo: { width: 30, height: 30, background: "#FF5A1F", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 },
    badge: { background: "#1A0F2A", border: "1px solid #3D2A6A", borderRadius: 6, padding: "3px 8px", color: "#A78BFA", fontSize: 11, fontWeight: 600 },
    signOut: { background: "none", border: "1px solid #1E1E1E", borderRadius: 8, padding: "6px 14px", color: "#555", fontSize: 12, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" },
    tabs: { display: "flex", borderBottom: "1px solid #141414", padding: "0 16px" },
    tabBtn: (a) => ({ padding: "12px 16px", border: "none", background: "none", cursor: "pointer", fontSize: 13, fontWeight: 500, color: a ? "#FF5A1F" : "#444", borderBottom: a ? "2px solid #FF5A1F" : "2px solid transparent", fontFamily: "'DM Sans', sans-serif" }),
    body: { padding: "16px 16px 40px", maxWidth: 560, margin: "0 auto" },
    grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 },
    statCard: { background: "#0F0F0F", border: "1px solid #1A1A1A", borderRadius: 14, padding: "16px" },
    statVal: (c) => ({ fontSize: 30, fontWeight: 700, color: c, letterSpacing: "-1px", margin: "4px 0 0" }),
    statLabel: { fontSize: 10, color: "#333", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.8px" },
    card: { background: "#0F0F0F", border: "1px solid #1A1A1A", borderRadius: 14, overflow: "hidden", marginBottom: 14 },
    cardHead: { padding: "12px 16px", borderBottom: "1px solid #141414" },
    cardLabel: { fontSize: 10, color: "#333", fontWeight: 600, textTransform: "uppercase", letterSpacing: "1px" },
    row: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid #0D0D0D" },
    input: { width: "100%", background: "#111", border: "1px solid #1E1E1E", borderRadius: 10, padding: "12px 14px", color: "#fff", fontSize: 13, outline: "none", boxSizing: "border-box", fontFamily: "'DM Sans', sans-serif", marginBottom: 8 },
    addBtn: { width: "100%", background: "#FF5A1F", border: "none", borderRadius: 10, padding: "13px 0", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", marginTop: 4 },
    delBtn: { background: "none", border: "1px solid #2A1010", borderRadius: 6, padding: "4px 10px", color: "#F87171", fontSize: 11, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" },
    liveDot: (a) => ({ width: 6, height: 6, borderRadius: "50%", background: a ? "#4ADE80" : "#2A2A2A", display: "inline-block", marginRight: 6, boxShadow: a ? "0 0 6px #4ADE80" : "none" }),
    routePill: (a) => ({ fontSize: 10, padding: "3px 8px", borderRadius: 20, background: a ? "#0D1F12" : "#111", color: a ? "#4ADE80" : "#333", border: `1px solid ${a ? "#1E4D2B" : "#1A1A1A"}` }),
    rolePill: (r) => ({ fontSize: 11, padding: "3px 8px", borderRadius: 6, background: r === "admin" ? "#1A0F2A" : r === "driver" ? "#0A1020" : "#111", color: r === "admin" ? "#A78BFA" : r === "driver" ? "#60A5FA" : "#444", border: `1px solid ${r === "admin" ? "#3D2A6A" : r === "driver" ? "#1A3060" : "#1A1A1A"}` }),
  };

  return (
    <div style={S.screen}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet" />

      <div style={S.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={S.logo}>🚌</div>
          <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.3px" }}>CampusMove</span>
          <span style={S.badge}>Admin</span>
        </div>
        <button onClick={logout} style={S.signOut}>Sign out</button>
      </div>

      <div style={S.tabs}>
        {[["overview","Overview"],["routes","Routes"],["users","Users"]].map(([t,l]) => (
          <button key={t} style={S.tabBtn(tab===t)} onClick={() => setTab(t)}>{l}</button>
        ))}
      </div>

      <div style={S.body}>

        {/* OVERVIEW */}
        {tab === "overview" && (
          <>
            <div style={S.grid}>
              <div style={S.statCard}><div style={S.statLabel}>Active Buses</div><div style={S.statVal("#4ADE80")}>{activeBuses}</div></div>
              <div style={S.statCard}><div style={S.statLabel}>Total Routes</div><div style={S.statVal("#FF5A1F")}>{routes.length}</div></div>
              <div style={S.statCard}><div style={S.statLabel}>Users</div><div style={S.statVal("#A78BFA")}>{users.length || "—"}</div></div>
              <div style={S.statCard}><div style={S.statLabel}>Campus</div><div style={S.statVal("#60A5FA")}>1</div></div>
            </div>

            <div style={S.card}>
              <div style={S.cardHead}><span style={S.cardLabel}>Live Bus Status</span></div>
              {PRESET_ROUTES.map(pr => {
                const live = liveStatus[pr.id]?.live;
                const active = live?.active;
                return (
                  <div key={pr.id} style={S.row}>
                    <div>
                      <div style={{ fontSize: 13, color: "#ccc", fontWeight: 500 }}>{pr.name}</div>
                      <div style={{ fontSize: 11, color: "#333", marginTop: 2 }}>{pr.label}</div>
                    </div>
                    <span style={S.routePill(active)}>
                      <span style={S.liveDot(active)} />{active ? "Live" : "Offline"}
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ROUTES */}
        {tab === "routes" && (
          <>
            {/* Preset routes always shown */}
            <div style={S.card}>
              <div style={S.cardHead}><span style={S.cardLabel}>Default Routes (4)</span></div>
              {PRESET_ROUTES.map(pr => {
                const active = liveStatus[pr.id]?.live?.active;
                return (
                  <div key={pr.id} style={S.row}>
                    <div>
                      <div style={{ fontSize: 13, color: "#ccc", fontWeight: 500 }}>{pr.name}</div>
                      <div style={{ fontSize: 11, color: "#333", marginTop: 2 }}>{pr.label}</div>
                    </div>
                    <span style={S.routePill(active)}>
                      <span style={S.liveDot(active)} />{active ? "Live" : "Offline"}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Custom routes from Firestore */}
            {routes.length > 0 && (
              <div style={S.card}>
                <div style={S.cardHead}><span style={S.cardLabel}>Custom Routes ({routes.length})</span></div>
                {routes.map(route => (
                  <div key={route.id} style={S.row}>
                    <div>
                      <div style={{ fontSize: 13, color: "#ccc", fontWeight: 500 }}>{route.name}</div>
                      <div style={{ fontSize: 11, color: "#333", marginTop: 2 }}>{route.label}</div>
                    </div>
                    <button onClick={() => deleteRoute(route.id)} style={S.delBtn}>Delete</button>
                  </div>
                ))}
              </div>
            )}

            {/* Add new route */}
            <div style={S.card}>
              <div style={S.cardHead}><span style={S.cardLabel}>Add Custom Route</span></div>
              <div style={{ padding: 16 }}>
                <input value={newRoute.name} onChange={e => setNewRoute({ ...newRoute, name: e.target.value })} placeholder="Route name (e.g. Route 4)" style={S.input} />
                <input value={newRoute.label} onChange={e => setNewRoute({ ...newRoute, label: e.target.value })} placeholder="Label (e.g. West Campus Loop)" style={S.input} />
                <input value={newRoute.description} onChange={e => setNewRoute({ ...newRoute, description: e.target.value })} placeholder="Description (optional)" style={{ ...S.input, marginBottom: 0 }} />
                <button onClick={addRoute} disabled={saving} style={S.addBtn}>{saving ? "Saving..." : "+ Add Route"}</button>
              </div>
            </div>
          </>
        )}

        {/* USERS */}
        {tab === "users" && (
          <div style={S.card}>
            <div style={S.cardHead}><span style={S.cardLabel}>All Users ({users.length})</span></div>
            {users.length === 0
              ? <div style={{ padding: 16, color: "#2A2A2A", fontSize: 13 }}>Loading...</div>
              : users.map(u => (
                <div key={u.id} style={S.row}>
                  <div>
                    <div style={{ fontSize: 13, color: "#ccc", fontWeight: 500 }}>{u.name || "—"}</div>
                    <div style={{ fontSize: 11, color: "#333", marginTop: 2 }}>{u.email}</div>
                  </div>
                  <span style={S.rolePill(u.role)}>{u.role}</span>
                </div>
              ))
            }
          </div>
        )}
      </div>
    </div>
  );
}
