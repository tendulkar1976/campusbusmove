import { useEffect, useState } from "react";
import { collection, getDocs, addDoc, deleteDoc, doc, updateDoc, setDoc, getDoc } from "firebase/firestore";
import { ref, onValue } from "firebase/database";
import { db, rtdb } from "../firebase";
import { useAuth } from "../context/AuthContext";

const PRESET_ROUTES = [
  { id: "route-1", name: "Route 1", label: "North Gate Loop" },
  { id: "route-2", name: "Route 2", label: "South Campus Loop" },
  { id: "route-3", name: "Route 3", label: "East Wing Loop" },
  { id: "route-3a", name: "Route 3A", label: "Express Loop" },
];

const PLANS = {
  basic: {
    id: "basic",
    name: "Basic",
    emoji: "🚌",
    monthly: 5000,
    yearly: 54000,
    color: "#60A5FA",
    features: [
      "Live GPS tracking",
      "Student dashboard",
      "3 routes max",
      "50 students max",
      "Basic admin panel",
    ],
    limits: { routes: 3, students: 50 },
  },
  premium: {
    id: "premium",
    name: "Premium",
    emoji: "⚡",
    monthly: 12000,
    yearly: 108000,
    color: "#FF5A1F",
    features: [
      "Everything in Basic",
      "Unlimited routes",
      "Unlimited students & drivers",
      "Auto attendance",
      "Analytics dashboard",
      "Priority support",
    ],
    limits: { routes: Infinity, students: Infinity },
  },
};

// ── Billing helpers ──
function getDaysLeft(expiryTs) {
  if (!expiryTs) return 0;
  return Math.max(0, Math.ceil((expiryTs - Date.now()) / (1000 * 60 * 60 * 24)));
}

function formatDate(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

// ── Default subscription (trial) ──
const DEFAULT_SUB = {
  plan: "basic",
  billing: "monthly",
  status: "trial",
  startDate: Date.now(),
  expiryDate: Date.now() + 14 * 24 * 60 * 60 * 1000, // 14 day trial
  amount: 0,
  campusId: "alliance-bangalore",
};

export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState("overview");
  const [liveStatus, setLiveStatus] = useState({});
  const [routes, setRoutes] = useState([]);
  const [users, setUsers] = useState([]);
  const [newRoute, setNewRoute] = useState({ name: "", label: "", description: "" });
  const [hiddenPresets, setHiddenPresets] = useState([]);
  const [presetOverrides, setPresetOverrides] = useState({});
  const [presetsLoaded, setPresetsLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmId, setConfirmId] = useState(null);
  const [editingRoute, setEditingRoute] = useState(null);
  const [editSaving, setEditSaving] = useState(false);

  // ── Billing state ──
  const [subscription, setSubscription] = useState(null);
  const [showPlans, setShowPlans] = useState(false);
  const [billingCycle, setBillingCycle] = useState("monthly");
  const [planSaving, setPlanSaving] = useState(false);
  const [showBillingSuccess, setShowBillingSuccess] = useState(false);

  // ── Load subscription ──
  useEffect(() => {
    getDoc(doc(db, "subscriptions", "alliance-bangalore")).then(snap => {
      if (snap.exists()) {
        setSubscription(snap.data());
      } else {
        // First time — create trial subscription
        setDoc(doc(db, "subscriptions", "alliance-bangalore"), DEFAULT_SUB);
        setSubscription(DEFAULT_SUB);
      }
    }).catch(() => setSubscription(DEFAULT_SUB));
  }, []);

  useEffect(() => {
    const r = ref(rtdb, "routes");
    const unsub = onValue(r, snap => { if (snap.exists()) setLiveStatus(snap.val()); });
    return () => unsub();
  }, []);

  function loadRoutes() {
    getDocs(collection(db, "routes")).then(snap => setRoutes(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
  }

  function loadUsers() {
    getDocs(collection(db, "users")).then(snap => setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
  }

  useEffect(() => {
    loadRoutes();
    getDocs(collection(db, "routeOverrides")).then(snap => {
      const overrides = {};
      snap.docs.forEach(d => { overrides[d.id] = d.data(); });
      setPresetOverrides(overrides);
    }).catch(() => {});
    getDoc(doc(db, "settings", "deletedPresets")).then(snap => {
      if (snap.exists() && Array.isArray(snap.data()?.ids)) {
        setHiddenPresets(snap.data().ids);
      } else {
        setHiddenPresets([]);
      }
      setPresetsLoaded(true);
    }).catch(() => { setHiddenPresets([]); setPresetsLoaded(true); });
  }, []);

  useEffect(() => { loadUsers(); }, []);

  async function addRoute() {
    if (!newRoute.name || !newRoute.label) return;
    setSaving(true);
    await addDoc(collection(db, "routes"), { ...newRoute, campusId: "alliance-bangalore", path: [], stops: [], createdAt: Date.now() });
    setSaving(false);
    setNewRoute({ name: "", label: "", description: "" });
    loadRoutes();
  }

  async function deleteRoute(id, isPreset) {
    if (isPreset) {
      try {
        await setDoc(doc(db, "settings", "deletedPresets"),
          { ids: [...hiddenPresets, id] }, { merge: true });
      } catch(e) {}
      setHiddenPresets(h => [...h, id]);
    } else {
      await deleteDoc(doc(db, "routes", id));
      setRoutes(r => r.filter(x => x.id !== id));
    }
    setConfirmId(null);
  }

  async function saveEditRoute() {
    if (!editingRoute) return;
    setEditSaving(true);
    try {
      if (editingRoute.isPreset) {
        await setDoc(doc(db, "routeOverrides", editingRoute.id), {
          name: editingRoute.name,
          label: editingRoute.label,
          description: editingRoute.description,
          updatedAt: Date.now(),
        });
        setPresetOverrides(p => ({ ...p, [editingRoute.id]: editingRoute }));
      } else {
        await updateDoc(doc(db, "routes", editingRoute.id), {
          name: editingRoute.name,
          label: editingRoute.label,
          description: editingRoute.description,
        });
        setRoutes(r => r.map(x => x.id === editingRoute.id ? { ...x, ...editingRoute } : x));
      }
    } catch(e) { console.error(e); }
    setEditSaving(false);
    setEditingRoute(null);
  }

  async function blockUser(uid) {
    await updateDoc(doc(db, "users", uid), { blocked: true });
    setUsers(u => u.map(x => x.id === uid ? { ...x, blocked: true } : x));
    setConfirmId(null);
  }

  async function unblockUser(uid) {
    await updateDoc(doc(db, "users", uid), { blocked: false });
    setUsers(u => u.map(x => x.id === uid ? { ...x, blocked: false } : x));
  }

  async function deleteUser(uid) {
    await deleteDoc(doc(db, "users", uid));
    setUsers(u => u.filter(x => x.id !== uid));
    setConfirmId(null);
  }

  async function changeRole(uid, role) {
    await updateDoc(doc(db, "users", uid), { role });
    setUsers(u => u.map(x => x.id === uid ? { ...x, role } : x));
  }

  // ── Select plan (manual/demo — no real payment yet) ──
  async function selectPlan(planId) {
    setPlanSaving(true);
    const amount = billingCycle === "yearly" ? PLANS[planId].yearly : PLANS[planId].monthly;
    const durationMs = billingCycle === "yearly" ? 365 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
    const newSub = {
      plan: planId,
      billing: billingCycle,
      status: "active",
      startDate: Date.now(),
      expiryDate: Date.now() + durationMs,
      amount,
      campusId: "alliance-bangalore",
      updatedAt: Date.now(),
    };
    await setDoc(doc(db, "subscriptions", "alliance-bangalore"), newSub);
    setSubscription(newSub);
    setPlanSaving(false);
    setShowPlans(false);
    setShowBillingSuccess(true);
    setTimeout(() => setShowBillingSuccess(false), 4000);
  }

  // ── Derived billing values ──
  const daysLeft = subscription ? getDaysLeft(subscription.expiryDate) : 0;
  const isExpired = subscription && daysLeft === 0 && subscription.status !== "trial";
  const isWarning = daysLeft <= 7 && daysLeft > 0;
  const currentPlan = PLANS[subscription?.plan || "basic"];
  const activeBuses = Object.values(liveStatus).filter(r => r?.live?.active).length;
  const studentCount = users.filter(u => u.role === "student").length;
  const driverCount = users.filter(u => u.role === "driver").length;
  const blockedCount = users.filter(u => u.blocked).length;
  const totalRoutes = PRESET_ROUTES.filter(pr => !hiddenPresets.includes(pr.id)).length + routes.length;

  const S = {
    screen: { minHeight: "100vh", background: "#0A0A0A", fontFamily: "'DM Sans', sans-serif", color: "#fff" },
    header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 20px 14px", borderBottom: "1px solid #111", position: "sticky", top: 0, background: "#0A0A0A", zIndex: 10 },
    badge: { background: "#1A0F2A", border: "1px solid #2D1F55", borderRadius: 6, padding: "3px 8px", color: "#A78BFA", fontSize: 11, fontWeight: 600 },
    signOut: { background: "none", border: "1px solid #161616", borderRadius: 8, padding: "6px 14px", color: "#aaa", fontSize: 12, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" },
    tabs: { display: "flex", borderBottom: "1px solid #111", padding: "0 16px" },
    tabBtn: (a) => ({ padding: "12px 16px", border: "none", background: "none", cursor: "pointer", fontSize: 13, fontWeight: 500, color: a ? "#fff" : "#555", borderBottom: a ? "2px solid #FF5A1F" : "2px solid transparent", fontFamily: "'DM Sans', sans-serif", transition: "color 0.2s" }),
    body: { padding: "16px 16px 40px", maxWidth: 560, margin: "0 auto" },
    grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 },
    statCard: { background: "#0D0D0D", border: "1px solid #1A1A1A", borderRadius: 14, padding: "16px" },
    statVal: (c) => ({ fontSize: 30, fontWeight: 700, color: c, letterSpacing: "-1px", margin: "4px 0 0" }),
    statLabel: { fontSize: 10, color: "#555", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.8px" },
    card: { background: "#0D0D0D", border: "1px solid #1A1A1A", borderRadius: 14, overflow: "hidden", marginBottom: 14 },
    cardHead: { padding: "12px 16px", borderBottom: "1px solid #111" },
    cardLabel: { fontSize: 10, color: "#555", fontWeight: 600, textTransform: "uppercase", letterSpacing: "1px" },
    row: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid #0D0D0D" },
    input: { width: "100%", background: "#0A0A0A", border: "1px solid #1A1A1A", borderRadius: 10, padding: "12px 14px", color: "#fff", fontSize: 13, outline: "none", boxSizing: "border-box", fontFamily: "'DM Sans', sans-serif", marginBottom: 8 },
    addBtn: { width: "100%", background: "#FF5A1F", border: "none", borderRadius: 10, padding: "13px 0", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", marginTop: 4 },
    delBtn: { background: "none", border: "1px solid #1E1010", borderRadius: 6, padding: "4px 10px", color: "#F87171", fontSize: 11, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" },
    liveDot: (a) => ({ width: 6, height: 6, borderRadius: "50%", background: a ? "#4ADE80" : "#222", display: "inline-block", marginRight: 6, boxShadow: a ? "0 0 6px #4ADE80" : "none" }),
    routePill: (a) => ({ fontSize: 10, padding: "3px 8px", borderRadius: 20, background: a ? "#0A1A0D" : "#111", color: a ? "#4ADE80" : "#555", border: `1px solid ${a ? "#1A3D22" : "#1A1A1A"}` }),
    rolePill: (r) => ({ fontSize: 11, padding: "3px 8px", borderRadius: 6, background: r === "admin" ? "#1A0F2A" : r === "driver" ? "#0A1020" : "#111", color: r === "admin" ? "#A78BFA" : r === "driver" ? "#60A5FA" : "#555", border: `1px solid ${r === "admin" ? "#2D1F55" : r === "driver" ? "#1A2D55" : "#1A1A1A"}` }),
    blockBtn: (blocked) => ({ background: "none", border: `1px solid ${blocked ? "#1A3D22" : "#1E1A0A"}`, borderRadius: 6, padding: "4px 10px", color: blocked ? "#4ADE80" : "#FBBF24", fontSize: 11, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }),
  };

  return (
    <div style={S.screen}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap'); input:focus{border-color:#FF5A1F!important;} select{outline:none;}`}</style>

      {/* ── WARNING BANNER ── */}
      {isExpired && (
        <div style={{ background: "#1A0808", borderBottom: "1px solid #3D1010", padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 16 }}>🔒</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#F87171" }}>Subscription Expired</div>
              <div style={{ fontSize: 11, color: "#555" }}>Renew to restore full access</div>
            </div>
          </div>
          <button onClick={() => { setTab("billing"); setShowPlans(true); }} style={{ background: "#F87171", border: "none", borderRadius: 8, padding: "7px 14px", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}>
            Renew Now
          </button>
        </div>
      )}

      {!isExpired && isWarning && (
        <div style={{ background: "#1A1100", borderBottom: "1px solid #3D2A00", padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 16 }}>⚠️</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#FBBF24" }}>{daysLeft} day{daysLeft !== 1 ? "s" : ""} left on your plan</div>
              <div style={{ fontSize: 11, color: "#555" }}>Renew to avoid interruption</div>
            </div>
          </div>
          <button onClick={() => { setTab("billing"); setShowPlans(true); }} style={{ background: "#FBBF24", border: "none", borderRadius: 8, padding: "7px 14px", color: "#000", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}>
            Renew
          </button>
        </div>
      )}

      {subscription?.status === "trial" && (
        <div style={{ background: "#0A0F1A", borderBottom: "1px solid #1A2D55", padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 16 }}>🎯</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#60A5FA" }}>14-day free trial — {daysLeft} days left</div>
              <div style={{ fontSize: 11, color: "#555" }}>Upgrade anytime to unlock full features</div>
            </div>
          </div>
          <button onClick={() => { setTab("billing"); setShowPlans(true); }} style={{ background: "#60A5FA", border: "none", borderRadius: 8, padding: "7px 14px", color: "#000", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}>
            Upgrade
          </button>
        </div>
      )}

      {showBillingSuccess && (
        <div style={{ background: "#0A1A0D", borderBottom: "1px solid #1A3D22", padding: "12px 20px", display: "flex", alignItems: "center", gap: 10 }}>
          <span>✅</span>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#4ADE80" }}>Plan activated successfully! Enjoy CampusMove {currentPlan.name}.</div>
        </div>
      )}

      {/* HEADER */}
      <div style={S.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 30, height: 30, background: "#FF5A1F", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>🚌</div>
          <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.3px" }}>CampusMove</span>
          <span style={S.badge}>Admin</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {subscription && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#111", border: "1px solid #1A1A1A", borderRadius: 8, padding: "4px 10px" }}>
              <span style={{ fontSize: 12 }}>{currentPlan.emoji}</span>
              <span style={{ fontSize: 11, color: currentPlan.color, fontWeight: 700 }}>{currentPlan.name}</span>
            </div>
          )}
          <button onClick={logout} style={S.signOut}>Sign out</button>
        </div>
      </div>

      <div style={S.tabs}>
        {[["overview","Overview"],["routes","Routes"],["users","Users"],["billing","Billing"]].map(([t,l]) => (
          <button key={t} style={S.tabBtn(tab===t)} onClick={() => setTab(t)}>{l}</button>
        ))}
      </div>

      <div style={S.body}>

        {/* ══════════════ OVERVIEW ══════════════ */}
        {tab === "overview" && (
          <>
            <div style={S.grid}>
              <div style={S.statCard}><div style={S.statLabel}>Active Buses</div><div style={S.statVal("#4ADE80")}>{activeBuses}</div></div>
              <div style={S.statCard}><div style={S.statLabel}>Total Routes</div><div style={S.statVal("#aaa")}>{totalRoutes}</div></div>
              <div style={S.statCard}><div style={S.statLabel}>Students</div><div style={S.statVal("#60A5FA")}>{studentCount || "—"}</div></div>
              <div style={S.statCard}><div style={S.statLabel}>Drivers</div><div style={S.statVal("#A78BFA")}>{driverCount || "—"}</div></div>
            </div>

            {/* Plan usage card */}
            {subscription && (
              <div style={{ ...S.card, border: `1px solid ${currentPlan.color}22` }}>
                <div style={{ padding: "14px 16px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 20 }}>{currentPlan.emoji}</span>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: currentPlan.color }}>{currentPlan.name} Plan</div>
                        <div style={{ fontSize: 11, color: "#555" }}>
                          {subscription.status === "trial" ? "Free Trial" : `₹${subscription.amount?.toLocaleString("en-IN")}/${subscription.billing === "yearly" ? "yr" : "mo"}`}
                        </div>
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 11, color: "#555" }}>Expires</div>
                      <div style={{ fontSize: 12, color: daysLeft <= 7 ? "#FBBF24" : "#aaa", fontWeight: 600 }}>{formatDate(subscription.expiryDate)}</div>
                    </div>
                  </div>

                  {/* Usage bars */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <span style={{ fontSize: 11, color: "#555" }}>Routes used</span>
                        <span style={{ fontSize: 11, color: "#aaa" }}>{totalRoutes} / {currentPlan.limits.routes === Infinity ? "∞" : currentPlan.limits.routes}</span>
                      </div>
                      <div style={{ height: 4, background: "#111", borderRadius: 2 }}>
                        <div style={{ height: 4, background: currentPlan.color, borderRadius: 2, width: currentPlan.limits.routes === Infinity ? "30%" : `${Math.min(100, (totalRoutes / currentPlan.limits.routes) * 100)}%`, transition: "width 0.5s" }}/>
                      </div>
                    </div>
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <span style={{ fontSize: 11, color: "#555" }}>Students</span>
                        <span style={{ fontSize: 11, color: "#aaa" }}>{studentCount} / {currentPlan.limits.students === Infinity ? "∞" : currentPlan.limits.students}</span>
                      </div>
                      <div style={{ height: 4, background: "#111", borderRadius: 2 }}>
                        <div style={{ height: 4, background: currentPlan.color, borderRadius: 2, width: currentPlan.limits.students === Infinity ? "20%" : `${Math.min(100, (studentCount / currentPlan.limits.students) * 100)}%`, transition: "width 0.5s" }}/>
                      </div>
                    </div>
                  </div>

                  <button onClick={() => { setTab("billing"); setShowPlans(true); }} style={{ marginTop: 14, width: "100%", background: "transparent", border: `1px solid ${currentPlan.color}44`, borderRadius: 10, padding: "10px 0", color: currentPlan.color, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}>
                    {subscription.plan === "basic" ? "⚡ Upgrade to Premium" : "Manage Subscription"}
                  </button>
                </div>
              </div>
            )}

            <div style={S.card}>
              <div style={S.cardHead}><span style={S.cardLabel}>Live Bus Status</span></div>
              {PRESET_ROUTES.filter(pr => !hiddenPresets.includes(pr.id)).map(pr => {
                const liveData = liveStatus[pr.id]?.live;
                const active = liveData?.active;
                const override = presetOverrides[pr.id] || {};
                const displayRoute = { ...pr, ...override };
                const driverUid = liveData?.driverUid;
                const driverUser = users.find(u => u.id === driverUid);
                const driverName = driverUser?.name || (driverUid ? "Driver" : null);
                const speed = liveData?.speed || 0;
                return (
                  <div key={pr.id} style={S.row}>
                    <div>
                      <div style={{ fontSize: 13, color: "#bbb", fontWeight: 500 }}>{displayRoute.name}</div>
                      <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>{displayRoute.label}</div>
                      {active && driverName && <div style={{ fontSize: 11, color: "#555", marginTop: 3 }}>🚌 {driverName} · {speed} km/h</div>}
                      {!active && <div style={{ fontSize: 11, color: "#333", marginTop: 3 }}>No driver active</div>}
                    </div>
                    <span style={S.routePill(active)}><span style={S.liveDot(active)} />{active ? "Live" : "Offline"}</span>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ══════════════ ROUTES ══════════════ */}
        {tab === "routes" && (
          <>
            <div style={S.card}>
              <div style={S.cardHead}><span style={S.cardLabel}>Routes ({totalRoutes})</span></div>
              {PRESET_ROUTES.filter(pr => !hiddenPresets.includes(pr.id)).map(pr => {
                const active = liveStatus[pr.id]?.live?.active;
                const override = presetOverrides[pr.id] || {};
                const displayRoute = { ...pr, ...override };
                return (
                  <div key={pr.id} style={{ ...S.row, flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
                    {editingRoute?.id === pr.id ? (
                      <div style={{ width: "100%" }}>
                        <input value={editingRoute.name} onChange={e => setEditingRoute({...editingRoute, name: e.target.value})} style={S.input} placeholder="Route name" />
                        <input value={editingRoute.label} onChange={e => setEditingRoute({...editingRoute, label: e.target.value})} style={S.input} placeholder="Label" />
                        <input value={editingRoute.description || ""} onChange={e => setEditingRoute({...editingRoute, description: e.target.value})} style={{...S.input, marginBottom: 8}} placeholder="Description" />
                        <div style={{ display: "flex", gap: 8 }}>
                          <button onClick={saveEditRoute} disabled={editSaving} style={{ flex: 1, background: "#FF5A1F", border: "none", borderRadius: 8, padding: "8px 0", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>{editSaving ? "Saving..." : "Save"}</button>
                          <button onClick={() => setEditingRoute(null)} style={{ flex: 1, background: "none", border: "1px solid #1A1A1A", borderRadius: 8, padding: "8px 0", color: "#555", fontSize: 12, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between" }}>
                        <div>
                          <div style={{ fontSize: 13, color: "#bbb", fontWeight: 500 }}>{displayRoute.name}</div>
                          <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>{displayRoute.label}</div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={S.routePill(active)}><span style={S.liveDot(active)} />{active ? "Live" : "Offline"}</span>
                          <button onClick={() => setEditingRoute({ id: pr.id, name: displayRoute.name, label: displayRoute.label, description: displayRoute.description || "", isPreset: true })} style={{ background: "none", border: "1px solid #1A1A1A", borderRadius: 6, padding: "4px 10px", color: "#555", fontSize: 11, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>Edit</button>
                          <button onClick={() => deleteRoute(pr.id, true)} style={S.delBtn}>Delete</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {routes.length > 0 && (
              <div style={S.card}>
                <div style={S.cardHead}><span style={S.cardLabel}>Custom Routes</span></div>
                {routes.map(route => (
                  <div key={route.id} style={{ ...S.row, flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
                    {editingRoute?.id === route.id ? (
                      <div style={{ width: "100%" }}>
                        <input value={editingRoute.name} onChange={e => setEditingRoute({...editingRoute, name: e.target.value})} style={S.input} placeholder="Route name" />
                        <input value={editingRoute.label} onChange={e => setEditingRoute({...editingRoute, label: e.target.value})} style={S.input} placeholder="Label" />
                        <input value={editingRoute.description || ""} onChange={e => setEditingRoute({...editingRoute, description: e.target.value})} style={{...S.input, marginBottom: 8}} placeholder="Description" />
                        <div style={{ display: "flex", gap: 8 }}>
                          <button onClick={saveEditRoute} disabled={editSaving} style={{ flex: 1, background: "#FF5A1F", border: "none", borderRadius: 8, padding: "8px 0", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>{editSaving ? "Saving..." : "Save"}</button>
                          <button onClick={() => setEditingRoute(null)} style={{ flex: 1, background: "none", border: "1px solid #1A1A1A", borderRadius: 8, padding: "8px 0", color: "#555", fontSize: 12, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between" }}>
                        <div>
                          <div style={{ fontSize: 13, color: "#bbb", fontWeight: 500 }}>{route.name}</div>
                          <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>{route.label}</div>
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button onClick={() => setEditingRoute({ id: route.id, name: route.name, label: route.label, description: route.description || "" })} style={{ background: "none", border: "1px solid #1A1A1A", borderRadius: 6, padding: "4px 10px", color: "#555", fontSize: 11, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>Edit</button>
                          <button onClick={() => deleteRoute(route.id, false)} style={S.delBtn}>Delete</button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

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

        {/* ══════════════ USERS ══════════════ */}
        {tab === "users" && (
          <>
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              {[["Total", users.length, "#fff"], ["Students", studentCount, "#60A5FA"], ["Drivers", driverCount, "#A78BFA"], ["Blocked", blockedCount, "#F87171"]].map(([l, v, c]) => (
                <div key={l} style={{ flex: 1, background: "#0D0D0D", border: "1px solid #1A1A1A", borderRadius: 12, padding: "12px 8px", textAlign: "center" }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: c, letterSpacing: "-0.5px" }}>{v}</div>
                  <div style={{ fontSize: 10, color: "#555", marginTop: 2, textTransform: "uppercase", letterSpacing: "0.6px" }}>{l}</div>
                </div>
              ))}
            </div>

            <div style={S.card}>
              <div style={S.cardHead}><span style={S.cardLabel}>All Users ({users.length})</span></div>
              {users.length === 0
                ? <div style={{ padding: 16, color: "#333", fontSize: 13 }}>Loading...</div>
                : users.map(u => (
                  <div key={u.id} style={{ ...S.row, flexDirection: "column", alignItems: "flex-start", gap: 10, background: u.blocked ? "#0D0808" : "transparent" }}>
                    <div style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between" }}>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ fontSize: 13, color: u.blocked ? "#555" : "#bbb", fontWeight: 500, textDecoration: u.blocked ? "line-through" : "none" }}>{u.name || "—"}</div>
                          {u.blocked && <span style={{ fontSize: 10, color: "#F87171", background: "#1A0808", border: "1px solid #2A1010", borderRadius: 4, padding: "2px 6px" }}>Blocked</span>}
                        </div>
                        <div style={{ fontSize: 11, color: "#333", marginTop: 2 }}>{u.email}</div>
                      </div>
                      <span style={S.rolePill(u.role)}>{u.role}</span>
                    </div>

                    {u.id !== user?.uid && (
                      <div style={{ display: "flex", gap: 6, width: "100%" }}>
                        <button onClick={() => u.blocked ? unblockUser(u.id) : setConfirmId({ id: u.id, action: "block" })} style={S.blockBtn(u.blocked)}>
                          {u.blocked ? "✓ Unblock" : "⊘ Block"}
                        </button>
                        <select value={u.role} onChange={e => changeRole(u.id, e.target.value)}
                          style={{ flex: 1, background: "#0A0A0A", border: "1px solid #1A1A1A", borderRadius: 6, padding: "4px 8px", color: "#555", fontSize: 11, fontFamily: "'DM Sans', sans-serif", cursor: "pointer" }}>
                          <option value="student">Student</option>
                          <option value="driver">Driver</option>
                          <option value="admin">Admin</option>
                        </select>
                        <button onClick={() => setConfirmId({ id: u.id, action: "delete" })} style={S.delBtn}>🗑 Delete</button>
                      </div>
                    )}

                    {confirmId?.id === u.id && (
                      <div style={{ width: "100%", background: "#0F0808", border: "1px solid #2A1010", borderRadius: 10, padding: "12px 14px" }}>
                        <p style={{ fontSize: 12, color: "#F87171", margin: "0 0 10px" }}>
                          {confirmId.action === "delete" ? `⚠ Delete ${u.name || u.email}? Cannot be undone.` : `⊘ Block ${u.name || u.email}? They won't be able to sign in.`}
                        </p>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button onClick={() => confirmId.action === "delete" ? deleteUser(u.id) : blockUser(u.id)}
                            style={{ flex: 1, background: "#F87171", border: "none", borderRadius: 8, padding: "8px 0", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>
                            {confirmId.action === "delete" ? "Yes, Delete" : "Yes, Block"}
                          </button>
                          <button onClick={() => setConfirmId(null)}
                            style={{ flex: 1, background: "none", border: "1px solid #2A1010", borderRadius: 8, padding: "8px 0", color: "#555", fontSize: 12, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))
              }
            </div>
          </>
        )}

        {/* ══════════════ BILLING ══════════════ */}
        {tab === "billing" && (
          <>
            {/* Current plan summary */}
            {subscription && !showPlans && (
              <div style={{ ...S.card, border: `1px solid ${currentPlan.color}33` }}>
                <div style={{ padding: "18px 16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                    <div style={{ width: 44, height: 44, background: `${currentPlan.color}22`, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>{currentPlan.emoji}</div>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: currentPlan.color }}>{currentPlan.name} Plan</div>
                      <div style={{ fontSize: 12, color: "#555" }}>
                        {subscription.status === "trial" ? "Free Trial" :
                          `₹${subscription.amount?.toLocaleString("en-IN")} / ${subscription.billing === "yearly" ? "year" : "month"}`}
                      </div>
                    </div>
                    <div style={{ marginLeft: "auto", textAlign: "right" }}>
                      <div style={{ fontSize: 11, color: "#555" }}>Status</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: isExpired ? "#F87171" : isWarning ? "#FBBF24" : "#4ADE80" }}>
                        {isExpired ? "Expired" : subscription.status === "trial" ? "Trial" : "Active"}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
                    {[
                      ["Start Date", formatDate(subscription.startDate)],
                      ["Expiry Date", formatDate(subscription.expiryDate)],
                      ["Days Left", isExpired ? "Expired" : `${daysLeft} days`],
                      ["Billing", subscription.billing === "yearly" ? "Yearly" : "Monthly"],
                    ].map(([l, v]) => (
                      <div key={l} style={{ background: "#111", borderRadius: 10, padding: "10px 12px" }}>
                        <div style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: 4 }}>{l}</div>
                        <div style={{ fontSize: 13, color: "#bbb", fontWeight: 600 }}>{v}</div>
                      </div>
                    ))}
                  </div>

                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 11, color: "#555", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.8px" }}>Included features</div>
                    {currentPlan.features.map((f, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <span style={{ color: currentPlan.color, fontSize: 13 }}>✓</span>
                        <span style={{ fontSize: 13, color: "#aaa" }}>{f}</span>
                      </div>
                    ))}
                  </div>

                  <button onClick={() => setShowPlans(true)} style={{ width: "100%", background: currentPlan.id === "basic" ? "#FF5A1F" : "#111", border: `1px solid ${currentPlan.id === "basic" ? "#FF5A1F" : "#1A1A1A"}`, borderRadius: 12, padding: "13px 0", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}>
                    {currentPlan.id === "basic" ? "⚡ Upgrade to Premium" : "Change Plan"}
                  </button>
                </div>
              </div>
            )}

            {/* Plan picker */}
            {showPlans && (
              <>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>Choose a Plan</div>
                  <button onClick={() => setShowPlans(false)} style={{ background: "none", border: "1px solid #1A1A1A", borderRadius: 8, padding: "5px 12px", color: "#555", fontSize: 12, cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}>← Back</button>
                </div>

                {/* Billing toggle */}
                <div style={{ display: "flex", background: "#0D0D0D", borderRadius: 12, padding: 3, marginBottom: 16, border: "1px solid #1A1A1A" }}>
                  {[["monthly", "Monthly"], ["yearly", "Yearly"]].map(([v, l]) => (
                    <button key={v} onClick={() => setBillingCycle(v)} style={{ flex: 1, padding: "10px 0", border: "none", borderRadius: 9, cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "'DM Sans',sans-serif", background: billingCycle === v ? "#FF5A1F" : "transparent", color: billingCycle === v ? "#fff" : "#555", transition: "all 0.2s" }}>
                      {l} {v === "yearly" && <span style={{ fontSize: 10, background: "#fff2", borderRadius: 4, padding: "2px 5px", marginLeft: 4 }}>Save 25%</span>}
                    </button>
                  ))}
                </div>

                {/* Plan cards */}
                {Object.values(PLANS).map(plan => {
                  const price = billingCycle === "yearly" ? plan.yearly : plan.monthly;
                  const isCurrent = subscription?.plan === plan.id;
                  return (
                    <div key={plan.id} style={{ background: "#0D0D0D", border: `2px solid ${isCurrent ? plan.color : "#1A1A1A"}`, borderRadius: 16, padding: "20px", marginBottom: 12, position: "relative" }}>
                      {plan.id === "premium" && (
                        <div style={{ position: "absolute", top: -10, right: 16, background: "#FF5A1F", borderRadius: 6, padding: "3px 10px", fontSize: 11, fontWeight: 700, color: "#fff" }}>POPULAR</div>
                      )}
                      {isCurrent && (
                        <div style={{ position: "absolute", top: -10, left: 16, background: plan.color, borderRadius: 6, padding: "3px 10px", fontSize: 11, fontWeight: 700, color: "#000" }}>CURRENT</div>
                      )}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ fontSize: 24 }}>{plan.emoji}</span>
                          <div>
                            <div style={{ fontSize: 15, fontWeight: 700, color: plan.color }}>{plan.name}</div>
                            <div style={{ fontSize: 11, color: "#555" }}>{plan.id === "basic" ? "For small campuses" : "For large institutions"}</div>
                          </div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: 22, fontWeight: 700, color: "#fff", letterSpacing: "-1px" }}>₹{price.toLocaleString("en-IN")}</div>
                          <div style={{ fontSize: 11, color: "#555" }}>/{billingCycle === "yearly" ? "year" : "month"}</div>
                          {billingCycle === "yearly" && <div style={{ fontSize: 10, color: "#4ADE80" }}>Save ₹{((plan.monthly * 12) - plan.yearly).toLocaleString("en-IN")}</div>}
                        </div>
                      </div>

                      {plan.features.map((f, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                          <span style={{ color: plan.color, fontSize: 12 }}>✓</span>
                          <span style={{ fontSize: 12, color: "#aaa" }}>{f}</span>
                        </div>
                      ))}

                      <button
                        onClick={() => selectPlan(plan.id)}
                        disabled={planSaving || isCurrent}
                        style={{ marginTop: 16, width: "100%", background: isCurrent ? "#111" : plan.color, border: "none", borderRadius: 12, padding: "13px 0", color: isCurrent ? "#555" : "#fff", fontSize: 13, fontWeight: 700, cursor: isCurrent ? "not-allowed" : "pointer", fontFamily: "'DM Sans',sans-serif" }}>
                        {planSaving ? "Activating..." : isCurrent ? "Current Plan" : `Select ${plan.name}`}
                      </button>

                      {!isCurrent && (
                        <div style={{ textAlign: "center", marginTop: 8, fontSize: 11, color: "#333" }}>
                          ⚡ Razorpay payment coming soon · Manual activation for now
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </>
        )}

      </div>
    </div>
  );
}
