import { useEffect, useState, useMemo } from "react";
import { collection, getDocs, addDoc, deleteDoc, doc, updateDoc, setDoc, getDoc } from "firebase/firestore";
import { ref, onValue } from "firebase/database";
import { db, rtdb, secondaryAuth } from "../firebase";
import { useAuth } from "../context/AuthContext";
import { createUserWithEmailAndPassword, signOut } from "firebase/auth";

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
    monthly: 3000,
    yearly: 32400,   // 3000 * 12 * 0.9 (10% off)
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
    monthly: 9000,
    yearly: 97200,   // 9000 * 12 * 0.9 (10% off)
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
  expiryDate: Date.now() + 14 * 24 * 60 * 60 * 1000, 
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

  const [newUser, setNewUser] = useState({ name: "", identifier: "", password: "", role: "student" });
  const [userCreating, setUserCreating] = useState(false);
  const [userCreateError, setUserCreateError] = useState("");
  const [userCreateSuccess, setUserCreateSuccess] = useState("");

  // ── Billing state ──
  const [subscription, setSubscription] = useState(null);
  const [showPlans, setShowPlans] = useState(false);
  const [billingCycle, setBillingCycle] = useState("monthly");
  const [planSaving, setPlanSaving] = useState(false);
  const [showBillingSuccess, setShowBillingSuccess] = useState(false);

  // ── Search & Filters state ──
  const [userSearch, setUserSearch] = useState("");
  const [routeSearch, setRouteSearch] = useState("");

  // ── Load subscription ──
  useEffect(() => {
    getDoc(doc(db, "subscriptions", "alliance-bangalore")).then(snap => {
      if (snap.exists()) {
        setSubscription(snap.data());
      } else {
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

  function getVirtualEmail(identifier, role) {
    const clean = identifier.trim().toLowerCase();
    if (role === "student") return clean + "@campusmove.user";
    if (role === "driver") return clean + "@campusmove.driver";
    return clean;
  }

  async function handleCreateUser(e) {
    e.preventDefault();
    setUserCreateError("");
    setUserCreateSuccess("");
    if (!newUser.name.trim()) return setUserCreateError("Please enter full name.");
    if (!newUser.identifier.trim()) return setUserCreateError("Please enter username, phone, or email.");
    
    if (newUser.role === "student") {
      const id = newUser.identifier.trim().toLowerCase();
      if (id.includes("..") || id.startsWith(".") || id.endsWith(".") || /[^a-z0-9.]/.test(id)) {
        return setUserCreateError("Invalid username format. Student username can only contain lowercase letters, numbers, and single dots (no spaces or consecutive/leading/trailing dots).");
      }
    }
    
    if (newUser.role === "driver" && newUser.identifier.trim().length !== 10) {
      return setUserCreateError("Driver phone number must be exactly 10 digits.");
    }
    if (newUser.password.length < 6) return setUserCreateError("Password must be at least 6 characters.");

    setUserCreating(true);
    const email = getVirtualEmail(newUser.identifier, newUser.role);
    try {
      const cred = await createUserWithEmailAndPassword(secondaryAuth, email, newUser.password);
      
      const profile = {
        name: newUser.name.trim(),
        role: newUser.role,
        campusId: "alliance-bangalore",
        blocked: false,
        createdAt: Date.now()
      };
      if (newUser.role === "student") {
        profile.username = newUser.identifier.trim().toLowerCase();
      } else if (newUser.role === "driver") {
        profile.phone = "+91" + newUser.identifier.trim();
      } else {
        profile.email = newUser.identifier.trim().toLowerCase();
      }

      await setDoc(doc(db, "users", cred.user.uid), profile);
      await signOut(secondaryAuth);

      setUserCreateSuccess(`Account for ${newUser.name} created successfully!`);
      setNewUser({ name: "", identifier: "", password: "", role: "student" });
      loadUsers();
    } catch (err) {
      console.error("User creation failed:", err);
      const c = err.code;
      if (c === "auth/invalid-email") {
        setUserCreateError("Invalid identifier format. Please check the username or email.");
      } else {
        setUserCreateError(err.message.replace("Firebase:", "").replace(/\(auth.*\)/, "").trim());
      }
    } finally {
      setUserCreating(false);
    }
  }

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
        await setDoc(doc(db, "settings", "deletedPresets"), { ids: [...hiddenPresets, id] }, { merge: true });
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

  // ── Derived values ──
  const daysLeft = subscription ? getDaysLeft(subscription.expiryDate) : 0;
  const isExpired = subscription && daysLeft === 0 && subscription.status !== "trial";
  const isWarning = daysLeft <= 7 && daysLeft > 0;
  const currentPlan = PLANS[subscription?.plan || "basic"];
  const activeBuses = Object.values(liveStatus).filter(r => r?.live?.active).length;
  const studentCount = users.filter(u => u.role === "student").length;
  const driverCount = users.filter(u => u.role === "driver").length;
  const blockedCount = users.filter(u => u.blocked).length;
  const totalRoutes = PRESET_ROUTES.filter(pr => !hiddenPresets.includes(pr.id)).length + routes.length;

  // Filters logic
  const filteredUsers = useMemo(() => {
    if (!userSearch.trim()) return users;
    const q = userSearch.toLowerCase();
    return users.filter(u => 
      (u.name && u.name.toLowerCase().includes(q)) || 
      (u.username && u.username.toLowerCase().includes(q)) ||
      (u.email && u.email.toLowerCase().includes(q)) ||
      (u.phone && u.phone.includes(q))
    );
  }, [users, userSearch]);

  const filteredPresetRoutes = useMemo(() => {
    const prs = PRESET_ROUTES.filter(pr => !hiddenPresets.includes(pr.id));
    if (!routeSearch.trim()) return prs;
    const q = routeSearch.toLowerCase();
    return prs.filter(pr => 
      pr.name.toLowerCase().includes(q) || 
      pr.label.toLowerCase().includes(q)
    );
  }, [hiddenPresets, routeSearch]);

  const filteredCustomRoutes = useMemo(() => {
    if (!routeSearch.trim()) return routes;
    const q = routeSearch.toLowerCase();
    return routes.filter(r => 
      r.name.toLowerCase().includes(q) || 
      r.label.toLowerCase().includes(q) ||
      (r.description && r.description.toLowerCase().includes(q))
    );
  }, [routes, routeSearch]);

  const S = {
    screen: { minHeight: "100vh", background: "#0A0A0A", fontFamily: "'DM Sans', sans-serif", color: "#fff", display: "flex", flexDirection: "column" },
    sidebar: { background: "#0F0F0F", borderRight: "1px solid #1A1A1A", display: "flex", flexDirection: "column", padding: "28px 24px", width: "260px", flexShrink: 0 },
    topbar: { background: "#0F0F0F", borderBottom: "1px solid #1A1A1A", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", height: "64px" },
    content: { flex: 1, padding: "24px 20px 60px", maxWidth: "960px", margin: "0 auto", width: "100%" },
    tabBtn: (active) => ({ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "12px 16px", border: "none", borderRadius: 12, background: active ? "#1D1D1D" : "transparent", cursor: "pointer", color: active ? "#FFFFFF" : "#888888", fontSize: 14, fontWeight: active ? 700 : 500, textAlign: "left", transition: "all 0.2s ease-in-out", borderLeft: active ? "3px solid #FF5A1F" : "3px solid transparent" }),
    badge: { background: "#251206", border: "1px solid #4D260B", borderRadius: 8, padding: "4px 8px", color: "#FF5A1F", fontSize: 10, fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase" },
    card: { background: "#0E0E0E", border: "1px solid #1E1E1E", borderRadius: 20, overflow: "hidden", marginBottom: 18, boxShadow: "0 4px 24px rgba(0,0,0,0.4)" },
    cardHead: { padding: "16px 20px", borderBottom: "1px solid #1E1E1E", display: "flex", alignItems: "center", justifyContent: "space-between" },
    cardLabel: { fontSize: 10, color: "#888", fontWeight: 800, textTransform: "uppercase", letterSpacing: "1.5px" },
    row: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid #141414", transition: "background 0.2s" },
    input: { width: "100%", background: "#0A0A0A", border: "1px solid #222", borderRadius: 12, padding: "12px 16px", color: "#fff", fontSize: 13, outline: "none", boxSizing: "border-box", fontFamily: "'DM Sans', sans-serif", marginBottom: 10, transition: "border-color 0.2s" },
    addBtn: { width: "100%", background: "#FF5A1F", border: "none", borderRadius: 12, padding: "14px 0", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", transition: "filter 0.15s, transform 0.1s" },
    delBtn: { background: "none", border: "1px solid #2D1414", borderRadius: 8, padding: "6px 12px", color: "#F87171", fontSize: 11, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", transition: "all 0.15s" },
    liveDot: (active) => ({ width: 8, height: 8, borderRadius: "50%", background: active ? "#4ADE80" : "#222", display: "inline-block", marginRight: 8, boxShadow: active ? "0 0 8px #4ADE80" : "none" }),
    routePill: (active) => ({ fontSize: 11, padding: "4px 10px", borderRadius: 20, background: active ? "#0D2012" : "#141414", color: active ? "#4ADE80" : "#555", border: `1px solid ${active ? "#1E4D2B" : "#222"}` }),
    rolePill: (role) => ({ fontSize: 11, padding: "4px 10px", borderRadius: 8, background: role === "admin" ? "#21153D" : role === "driver" ? "#0D182E" : "#141414", color: role === "admin" ? "#C084FC" : role === "driver" ? "#60A5FA" : "#888", border: `1px solid ${role === "admin" ? "#3B2773" : role === "driver" ? "#1E3A8A" : "#222"}` }),
    blockBtn: (blocked) => ({ background: "none", border: `1px solid ${blocked ? "#1E3E26" : "#3E3012"}`, borderRadius: 8, padding: "6px 12px", color: blocked ? "#4ADE80" : "#FBBF24", fontSize: 11, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", transition: "all 0.15s" }),
  };

  const navItems = [
    { id: "overview", label: "Overview Panel", icon: "📊" },
    { id: "routes", label: "Manage Routes", icon: "🗺️" },
    { id: "users", label: "Manage Users", icon: "👥" },
    { id: "billing", label: "SaaS Billing", icon: "💳" }
  ];

  return (
    <div style={S.screen}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700;800&display=swap');
        input:focus, select:focus { border-color:#FF5A1F !important; }
        .add-btn:active { transform: scale(0.98); }
        .custom-row:hover { background: #111111; }
        
        /* Sidebar Responsive Layout */
        .admin-desktop-container {
          display: flex;
          flex: 1;
        }
        .sidebar-panel {
          display: flex;
        }
        .topbar-panel {
          display: none;
        }
        @media (max-width: 768px) {
          .admin-desktop-container {
            flex-direction: column;
          }
          .sidebar-panel {
            display: none !important;
          }
          .topbar-panel {
            display: flex !important;
          }
        }
      `}</style>

      {/* ── ALERTS / WARNING BANNERS ── */}
      {isExpired && (
        <div style={{ background: "#2D0A0A", borderBottom: "1px solid #5D1515", padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", zIndex: 30 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 18 }}>🔒</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#F87171" }}>Institutional Subscription Expired</div>
              <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>Renew plan to restore standard GPS operations.</div>
            </div>
          </div>
          <button onClick={() => { setTab("billing"); setShowPlans(true); }} style={{ background: "#F87171", border: "none", borderRadius: 8, padding: "8px 16px", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans',sans-serif", boxShadow: "0 2px 10px rgba(248,113,113,0.3)" }}>
            Renew Portal
          </button>
        </div>
      )}

      {!isExpired && isWarning && (
        <div style={{ background: "#2A1F0C", borderBottom: "1px solid #5C3D12", padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", zIndex: 30 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 18 }}>⚠️</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#FBBF24" }}>{daysLeft} days remaining on subscription</div>
              <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>Upgrade or renew now to prevent service interruption.</div>
            </div>
          </div>
          <button onClick={() => { setTab("billing"); setShowPlans(true); }} style={{ background: "#FBBF24", border: "none", borderRadius: 8, padding: "8px 16px", color: "#000", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans',sans-serif", boxShadow: "0 2px 10px rgba(251,191,36,0.3)" }}>
            Renew Now
          </button>
        </div>
      )}

      {subscription?.status === "trial" && (
        <div style={{ background: "#0D1B2D", borderBottom: "1px solid #1E3A8A", padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", zIndex: 30 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 18 }}>🎯</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#60A5FA" }}>14-day Institutional Trial Active — {daysLeft} days left</div>
              <div style={{ fontSize: 11, color: "#aaa", marginTop: 2 }}>Unlock unlimited routes, attendance automation, and analytics.</div>
            </div>
          </div>
          <button onClick={() => { setTab("billing"); setShowPlans(true); }} style={{ background: "#3B82F6", border: "none", borderRadius: 8, padding: "8px 16px", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans',sans-serif", boxShadow: "0 2px 10px rgba(59,130,246,0.3)" }}>
            Upgrade Now
          </button>
        </div>
      )}

      {showBillingSuccess && (
        <div style={{ background: "#0D2012", borderBottom: "1px solid #1E4D2B", padding: "14px 20px", display: "flex", alignItems: "center", gap: 10, zIndex: 30 }}>
          <span>✅</span>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#4ADE80" }}>Subscription updated to CampusMove {currentPlan.name}!</div>
        </div>
      )}

      <div className="admin-desktop-container">
        {/* ── DESKTOP SIDEBAR ── */}
        <div className="sidebar-panel" style={S.sidebar}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 32 }}>
            <div style={{ width: 34, height: 34, background: "#FF5A1F", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🚌</div>
            <div>
              <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: "-0.5px" }}>CampusMove</span>
              <div style={{ fontSize: 9, color: "#888", fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", marginTop: 2 }}>Alliance University</div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
            {navItems.map(item => (
              <button key={item.id} style={S.tabBtn(tab === item.id)} onClick={() => { setTab(item.id); setShowPlans(false); }}>
                <span>{item.icon}</span> {item.label}
              </button>
            ))}
          </div>

          <div style={{ borderTop: "1px solid #1E1E1E", paddingTop: 20, marginTop: 20 }}>
            {subscription && (
              <div style={{ display: "flex", alignItems: "center", justifyBetween: "center", justifyContent: "space-between", background: "#141414", padding: "10px 14px", borderRadius: 12, border: "1px solid #222", marginBottom: 14 }}>
                <span style={{ fontSize: 11, color: "#aaa", fontWeight: 600 }}>{currentPlan.emoji} {currentPlan.name}</span>
                <span style={S.badge}>{subscription.status === "trial" ? "Trial" : "Paid"}</span>
              </div>
            )}
            <button onClick={logout} style={{ ...S.addBtn, background: "transparent", border: "1px solid #222", padding: "10px 0", fontSize: 12, color: "#888" }}>
              ↩ Sign Out
            </button>
          </div>
        </div>

        {/* ── MOBILE HEADER (HIDDEN ON DESKTOP) ── */}
        <div className="topbar-panel" style={S.topbar}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 28, height: 28, background: "#FF5A1F", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>🚌</div>
            <span style={{ fontSize: 14, fontWeight: 800 }}>CampusMove</span>
            <span style={{ ...S.badge, padding: "2px 6px", fontSize: 9 }}>Admin</span>
          </div>
          <button onClick={logout} style={{ background: "none", border: "1px solid #222", borderRadius: 8, padding: "4px 10px", color: "#aaa", fontSize: 11 }}>
            Sign Out
          </button>
        </div>

        {/* ── MOBILE TABS (HIDDEN ON DESKTOP) ── */}
        <div className="topbar-panel" style={{ display: "flex", background: "#0F0F0F", borderBottom: "1px solid #1A1A1A", padding: "8px 12px" }}>
          <div style={{ display: "flex", gap: 4, width: "100%" }}>
            {navItems.map(item => (
              <button key={item.id} style={{
                flex: 1,
                padding: "8px 0",
                border: "none",
                borderRadius: 8,
                background: tab === item.id ? "#1D1D1D" : "transparent",
                color: tab === item.id ? "#fff" : "#666",
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer"
              }} onClick={() => { setTab(item.id); setShowPlans(false); }}>
                {item.label.split(" ")[0]}
              </button>
            ))}
          </div>
        </div>

        {/* ── CONTENT CONTAINER ── */}
        <div className="admin-content" style={S.content}>

          {/* ══════════════ OVERVIEW TAB ══════════════ */}
          {tab === "overview" && (
            <>
              {/* Metric widgets grid */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12, marginBottom: 18 }}>
                {[
                  ["Active Buses", activeBuses, "#4ADE80", "🚌"],
                  ["Total Routes", totalRoutes, "#A1A1AA", "🗺️"],
                  ["Students Registered", studentCount, "#60A5FA", "🎓"],
                  ["Drivers Assigned", driverCount, "#A78BFA", "💼"]
                ].map(([label, val, color, icon]) => (
                  <div key={label} style={{ ...S.card, marginBottom: 0, padding: 18 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyBetween: "center", justifyContent: "space-between" }}>
                      <span style={S.cardLabel}>{label}</span>
                      <span style={{ fontSize: 16 }}>{icon}</span>
                    </div>
                    <div style={{ fontSize: 32, fontWeight: 800, color, letterSpacing: "-1.5px", marginTop: 10 }}>{val || 0}</div>
                  </div>
                ))}
              </div>

              {/* Usage & Plan overview card */}
              {subscription && (
                <div style={{ ...S.card, border: `1px solid ${currentPlan.color}22` }}>
                  <div style={{ padding: "18px 20px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyBetween: "center", justifyContent: "space-between", marginBottom: 16 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 24 }}>{currentPlan.emoji}</span>
                        <div>
                          <div style={{ fontSize: 15, fontWeight: 800, color: currentPlan.color }}>{currentPlan.name} Plan</div>
                          <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>
                            {subscription.status === "trial" ? "Trial License" : `₹${subscription.amount?.toLocaleString("en-IN")}/${subscription.billing === "yearly" ? "year" : "month"}`}
                          </div>
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 10, color: "#555", fontWeight: 700, textTransform: "uppercase" }}>Expires</div>
                        <div style={{ fontSize: 13, color: daysLeft <= 7 ? "#FBBF24" : "#ccc", fontWeight: 700, marginTop: 4 }}>{formatDate(subscription.expiryDate)}</div>
                      </div>
                    </div>

                    {/* Progress tracking bars */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 12, borderTop: "1px solid #1E1E1E", paddingTop: 16 }}>
                      <div>
                        <div style={{ display: "flex", justifyBetween: "center", justifyContent: "space-between", marginBottom: 6 }}>
                          <span style={{ fontSize: 12, color: "#888", fontWeight: 500 }}>Routes quota</span>
                          <span style={{ fontSize: 12, color: "#ccc", fontWeight: 700 }}>{totalRoutes} / {currentPlan.limits.routes === Infinity ? "Unlimited" : currentPlan.limits.routes}</span>
                        </div>
                        <div style={{ height: 4, background: "#141414", borderRadius: 2 }}>
                          <div style={{ height: 4, background: currentPlan.color, borderRadius: 2, width: currentPlan.limits.routes === Infinity ? "40%" : `${Math.min(100, (totalRoutes / currentPlan.limits.routes) * 100)}%`, transition: "width 0.4s" }}/>
                        </div>
                      </div>
                      <div>
                        <div style={{ display: "flex", justifyBetween: "center", justifyContent: "space-between", marginBottom: 6 }}>
                          <span style={{ fontSize: 12, color: "#888", fontWeight: 500 }}>Students capacity</span>
                          <span style={{ fontSize: 12, color: "#ccc", fontWeight: 700 }}>{studentCount} / {currentPlan.limits.students === Infinity ? "Unlimited" : currentPlan.limits.students}</span>
                        </div>
                        <div style={{ height: 4, background: "#141414", borderRadius: 2 }}>
                          <div style={{ height: 4, background: currentPlan.color, borderRadius: 2, width: currentPlan.limits.students === Infinity ? "20%" : `${Math.min(100, (studentCount / currentPlan.limits.students) * 100)}%`, transition: "width 0.4s" }}/>
                        </div>
                      </div>
                    </div>

                    <button onClick={() => { setTab("billing"); setShowPlans(true); }} style={{ marginTop: 18, width: "100%", background: "transparent", border: `1px solid ${currentPlan.color}44`, borderRadius: 12, padding: "12px 0", color: currentPlan.color, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans',sans-serif", transition: "all 0.2s" }}>
                      {subscription.plan === "basic" ? "⚡ Upgrade to Premium Features" : "Manage billing licenses"}
                    </button>
                  </div>
                </div>
              )}

              {/* Live telemetry list */}
              <div style={S.card}>
                <div style={S.cardHead}><span style={S.cardLabel}>Real-time Bus telemetry</span></div>
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
                    <div key={pr.id} className="custom-row" style={S.row}>
                      <div>
                        <div style={{ fontSize: 14, color: "#fff", fontWeight: 700 }}>{displayRoute.name}</div>
                        <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>{displayRoute.label}</div>
                        {active && driverName && <div style={{ fontSize: 11, color: "#FF5A1F", fontWeight: 600, marginTop: 6 }}>🚌 {driverName} · {speed} km/h</div>}
                      </div>
                      <span style={S.routePill(active)}><span style={S.liveDot(active)} />{active ? "Live" : "Offline"}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* ══════════════ ROUTES TAB ══════════════ */}
          {tab === "routes" && (
            <>
              {/* Search filter */}
              <div style={{ marginBottom: 14 }}>
                <input
                  value={routeSearch}
                  onChange={e => setRouteSearch(e.target.value)}
                  placeholder="🔍 Search routes by name or label..."
                  style={{ ...S.input, marginBottom: 0 }}
                />
              </div>

              {/* Preset list card */}
              <div style={S.card}>
                <div style={S.cardHead}><span style={S.cardLabel}>Preset Loops ({filteredPresetRoutes.length})</span></div>
                {filteredPresetRoutes.length === 0 ? (
                  <div style={{ padding: 16, color: "#555", fontSize: 12, textAlign: "center" }}>No matching preset loops</div>
                ) : (
                  filteredPresetRoutes.map(pr => {
                    const active = liveStatus[pr.id]?.live?.active;
                    const override = presetOverrides[pr.id] || {};
                    const displayRoute = { ...pr, ...override };
                    return (
                      <div key={pr.id} className="custom-row" style={{ ...S.row, flexDirection: "column", alignItems: "flex-start", gap: 10 }}>
                        {editingRoute?.id === pr.id ? (
                          <div style={{ width: "100%" }}>
                            <input value={editingRoute.name} onChange={e => setEditingRoute({...editingRoute, name: e.target.value})} style={S.input} placeholder="Route name" />
                            <input value={editingRoute.label} onChange={e => setEditingRoute({...editingRoute, label: e.target.value})} style={S.input} placeholder="Label" />
                            <input value={editingRoute.description || ""} onChange={e => setEditingRoute({...editingRoute, description: e.target.value})} style={{...S.input, marginBottom: 12}} placeholder="Description" />
                            <div style={{ display: "flex", gap: 8 }}>
                              <button onClick={saveEditRoute} disabled={editSaving} className="add-btn" style={{ flex: 1, background: "#FF5A1F", border: "none", borderRadius: 10, padding: "10px 0", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>{editSaving ? "Saving..." : "Save Changes"}</button>
                              <button onClick={() => setEditingRoute(null)} style={{ flex: 1, background: "none", border: "1px solid #222", borderRadius: 10, padding: "10px 0", color: "#888", fontSize: 12, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ display: "flex", width: "100%", alignItems: "center", justifyBetween: "center", justifyContent: "space-between" }}>
                            <div>
                              <div style={{ fontSize: 14, color: "#fff", fontWeight: 700 }}>{displayRoute.name}</div>
                              <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>{displayRoute.label}</div>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <span style={S.routePill(active)}><span style={S.liveDot(active)} />{active ? "Live" : "Offline"}</span>
                              <button onClick={() => setEditingRoute({ id: pr.id, name: displayRoute.name, label: displayRoute.label, description: displayRoute.description || "", isPreset: true })} style={{ background: "none", border: "1px solid #222", borderRadius: 8, padding: "6px 12px", color: "#aaa", fontSize: 11, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>Edit</button>
                              <button onClick={() => deleteRoute(pr.id, true)} style={S.delBtn}>Hide</button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Custom list card */}
              <div style={S.card}>
                <div style={S.cardHead}><span style={S.cardLabel}>Custom routes ({filteredCustomRoutes.length})</span></div>
                {filteredCustomRoutes.length === 0 ? (
                  <div style={{ padding: 16, color: "#555", fontSize: 12, textAlign: "center" }}>No matching custom routes</div>
                ) : (
                  filteredCustomRoutes.map(route => (
                    <div key={route.id} className="custom-row" style={{ ...S.row, flexDirection: "column", alignItems: "flex-start", gap: 10 }}>
                      {editingRoute?.id === route.id ? (
                        <div style={{ width: "100%" }}>
                          <input value={editingRoute.name} onChange={e => setEditingRoute({...editingRoute, name: e.target.value})} style={S.input} placeholder="Route name" />
                          <input value={editingRoute.label} onChange={e => setEditingRoute({...editingRoute, label: e.target.value})} style={S.input} placeholder="Label" />
                          <input value={editingRoute.description || ""} onChange={e => setEditingRoute({...editingRoute, description: e.target.value})} style={{...S.input, marginBottom: 12}} placeholder="Description" />
                          <div style={{ display: "flex", gap: 8 }}>
                            <button onClick={saveEditRoute} disabled={editSaving} className="add-btn" style={{ flex: 1, background: "#FF5A1F", border: "none", borderRadius: 10, padding: "10px 0", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>{editSaving ? "Saving..." : "Save Changes"}</button>
                            <button onClick={() => setEditingRoute(null)} style={{ flex: 1, background: "none", border: "1px solid #222", borderRadius: 10, padding: "10px 0", color: "#888", fontSize: 12, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: "flex", width: "100%", alignItems: "center", justifyBetween: "center", justifyContent: "space-between" }}>
                          <div>
                            <div style={{ fontSize: 14, color: "#fff", fontWeight: 700 }}>{route.name}</div>
                            <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>{route.label}</div>
                          </div>
                          <div style={{ display: "flex", gap: 8 }}>
                            <button onClick={() => setEditingRoute({ id: route.id, name: route.name, label: route.label, description: route.description || "" })} style={{ background: "none", border: "1px solid #222", borderRadius: 8, padding: "6px 12px", color: "#aaa", fontSize: 11, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>Edit</button>
                            <button onClick={() => deleteRoute(route.id, false)} style={S.delBtn}>Delete</button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>

              {/* Add form card */}
              <div style={S.card}>
                <div style={S.cardHead}><span style={S.cardLabel}>Add Custom Loop</span></div>
                <div style={{ padding: 18 }}>
                  <input value={newRoute.name} onChange={e => setNewRoute({ ...newRoute, name: e.target.value })} placeholder="Loop name (e.g. Route 4)" style={S.input} />
                  <input value={newRoute.label} onChange={e => setNewRoute({ ...newRoute, label: e.target.value })} placeholder="Label/Area (e.g. Central Gate Loop)" style={S.input} />
                  <input value={newRoute.description} onChange={e => setNewRoute({ ...newRoute, description: e.target.value })} placeholder="Short description (optional)" style={{ ...S.input, marginBottom: 14 }} />
                  <button onClick={addRoute} disabled={saving} className="add-btn" style={S.addBtn}>{saving ? "Saving Loop..." : "+ Create Route"}</button>
                </div>
              </div>
            </>
          )}

          {/* ══════════════ USERS TAB ══════════════ */}
          {tab === "users" && (
            <>
              {/* User stats widget */}
              <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
                {[["Total Users", users.length, "#fff"], ["Students", studentCount, "#60A5FA"], ["Drivers", driverCount, "#A78BFA"], ["Blocked", blockedCount, "#F87171"]].map(([l, v, c]) => (
                  <div key={l} style={{ flex: 1, background: "#0E0E0E", border: "1px solid #1E1E1E", borderRadius: 14, padding: "14px 10px", textAlign: "center" }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: c, letterSpacing: "-0.5px" }}>{v}</div>
                    <div style={{ fontSize: 9, color: "#666", marginTop: 4, textTransform: "uppercase", letterSpacing: "0.8px", fontWeight: 700 }}>{l}</div>
                  </div>
                ))}
              </div>

              {/* Search bar */}
              <div style={{ marginBottom: 14 }}>
                <input
                  value={userSearch}
                  onChange={e => setUserSearch(e.target.value)}
                  placeholder="🔍 Search users by name, username, email, phone..."
                  style={{ ...S.input, marginBottom: 0 }}
                />
              </div>

              {/* Users list card */}
              <div style={S.card}>
                <div style={S.cardHead}><span style={S.cardLabel}>Registered Accounts ({filteredUsers.length})</span></div>
                {filteredUsers.length === 0
                  ? <div style={{ padding: 24, color: "#555", fontSize: 13, textAlign: "center" }}>No matching accounts found</div>
                  : filteredUsers.map(u => (
                    <div key={u.id} className="custom-row" style={{ ...S.row, flexDirection: "column", alignItems: "flex-start", gap: 12, background: u.blocked ? "#1A080822" : "transparent" }}>
                      <div style={{ display: "flex", width: "100%", alignItems: "center", justifyBetween: "center", justifyContent: "space-between" }}>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <div style={{ fontSize: 14, color: u.blocked ? "#555" : "#fff", fontWeight: 700, textDecoration: u.blocked ? "line-through" : "none" }}>{u.name || "—"}</div>
                            {u.blocked && <span style={{ fontSize: 9, color: "#F87171", background: "#250A0A", border: "1px solid #5D1515", borderRadius: 6, padding: "2px 6px", fontWeight: 700, textTransform: "uppercase" }}>Blocked</span>}
                          </div>
                          <div style={{ fontSize: 12, color: "#555", marginTop: 4, fontFamily: "monospace" }}>
                            {u.username ? `username: ${u.username}` : u.phone ? `phone: ${u.phone}` : u.email}
                          </div>
                        </div>
                        <span style={S.rolePill(u.role)}>{u.role}</span>
                      </div>

                      {u.id !== user?.uid && (
                        <div style={{ display: "flex", gap: 8, width: "100%", borderTop: "1px solid #1E1E1E", paddingTop: 10 }}>
                          <button onClick={() => u.blocked ? unblockUser(u.id) : setConfirmId({ id: u.id, action: "block" })} style={S.blockBtn(u.blocked)}>
                            {u.blocked ? "✓ Unblock" : "⊘ Block User"}
                          </button>
                          <select value={u.role} onChange={e => changeRole(u.id, e.target.value)}
                            style={{ flex: 1, background: "#0A0A0A", border: "1px solid #222", borderRadius: 8, padding: "4px 10px", color: "#aaa", fontSize: 11, fontFamily: "'DM Sans', sans-serif", cursor: "pointer" }}>
                            <option value="student">Student / Faculty</option>
                            <option value="driver">Driver</option>
                            <option value="admin">Admin</option>
                          </select>
                          <button onClick={() => setConfirmId({ id: u.id, action: "delete" })} style={S.delBtn}>🗑 Delete</button>
                        </div>
                      )}

                      {confirmId?.id === u.id && (
                        <div style={{ width: "100%", background: "#1A0808", border: "1px solid #5D1010", borderRadius: 12, padding: "14px", marginTop: 4 }}>
                          <p style={{ fontSize: 13, color: "#F87171", margin: "0 0 12px", fontWeight: 600 }}>
                            {confirmId.action === "delete" ? `⚠ Delete ${u.name || u.email}? This action is irreversible.` : `⊘ Block ${u.name || u.email}? Access will be immediately revoked.`}
                          </p>
                          <div style={{ display: "flex", gap: 8 }}>
                            <button onClick={() => confirmId.action === "delete" ? deleteUser(u.id) : blockUser(u.id)}
                              style={{ flex: 1, background: "#F87171", border: "none", borderRadius: 10, padding: "10px 0", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>
                              {confirmId.action === "delete" ? "Yes, Delete" : "Yes, Block"}
                            </button>
                            <button onClick={() => setConfirmId(null)}
                              style={{ flex: 1, background: "none", border: "1px solid #333", borderRadius: 10, padding: "10px 0", color: "#aaa", fontSize: 12, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                }
              </div>

              {/* Create User Form */}
              <div style={S.card}>
                <div style={S.cardHead}><span style={S.cardLabel}>Create Student or Driver Account</span></div>
                <form onSubmit={handleCreateUser} style={{ padding: 16 }}>
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ fontSize: 11, fontWeight: 700, color: "#888", letterSpacing: "0.5px", display: "block", marginBottom: 6, textTransform: "uppercase" }}>Role Type</label>
                    <select
                      value={newUser.role}
                      onChange={e => setNewUser({ ...newUser, role: e.target.value, identifier: "" })}
                      style={{ ...S.input, marginBottom: 0, cursor: "pointer" }}
                    >
                      <option value="student">Student / Faculty</option>
                      <option value="driver">Driver</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ fontSize: 11, fontWeight: 700, color: "#888", letterSpacing: "0.5px", display: "block", marginBottom: 6, textTransform: "uppercase" }}>Full Name</label>
                    <input
                      value={newUser.name}
                      onChange={e => setNewUser({ ...newUser, name: e.target.value })}
                      placeholder="e.g. John Doe"
                      style={{ ...S.input, marginBottom: 0 }}
                    />
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ fontSize: 11, fontWeight: 700, color: "#888", letterSpacing: "0.5px", display: "block", marginBottom: 6, textTransform: "uppercase" }}>
                      {newUser.role === "student" ? "Username" : newUser.role === "driver" ? "Phone Number (10 digits)" : "Email Address"}
                    </label>
                    <input
                      value={newUser.identifier}
                      onChange={e => setNewUser({ ...newUser, identifier: e.target.value })}
                      placeholder={newUser.role === "student" ? "e.g. john123" : newUser.role === "driver" ? "e.g. 9876543210" : "e.g. admin@test.com"}
                      maxLength={newUser.role === "driver" ? 10 : undefined}
                      style={{ ...S.input, marginBottom: 0 }}
                    />
                  </div>
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ fontSize: 11, fontWeight: 700, color: "#888", letterSpacing: "0.5px", display: "block", marginBottom: 6, textTransform: "uppercase" }}>Password</label>
                    <input
                      type="password"
                      value={newUser.password}
                      onChange={e => setNewUser({ ...newUser, password: e.target.value })}
                      placeholder="Min 6 characters"
                      style={{ ...S.input, marginBottom: 0 }}
                    />
                  </div>

                  {userCreateError && (
                    <div style={{ background: "#250A0A", border: "1px solid #5D1515", borderRadius: 10, padding: "12px 14px", marginBottom: 14 }}>
                      <p style={{ color: "#F87171", fontSize: 12, margin: 0, fontWeight: 600 }}>⚠️ {userCreateError}</p>
                    </div>
                  )}

                  {userCreateSuccess && (
                    <div style={{ background: "#0D2012", border: "1px solid #1E4D2B", borderRadius: 10, padding: "12px 14px", marginBottom: 14 }}>
                      <p style={{ color: "#4ADE80", fontSize: 12, margin: 0, fontWeight: 600 }}>✅ {userCreateSuccess}</p>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={userCreating}
                    className="add-btn"
                    style={S.addBtn}
                  >
                    {userCreating ? "Generating Authentication..." : "+ Create Account"}
                  </button>
                </form>
              </div>
            </>
          )}

          {/* ══════════════ BILLING TAB ══════════════ */}
          {tab === "billing" && (
            <>
              {/* Current plan metrics */}
              {subscription && !showPlans && (
                <div style={{ ...S.card, border: `1px solid ${currentPlan.color}33` }}>
                  <div style={{ padding: "20px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
                      <div style={{ width: 48, height: 48, background: `${currentPlan.color}15`, borderRadius: 14, display: "flex", alignItems: "center", justifyBetween: "center", justifyContent: "center", fontSize: 24 }}>{currentPlan.emoji}</div>
                      <div>
                        <div style={{ fontSize: 16, fontWeight: 800, color: currentPlan.color }}>{currentPlan.name} Plan</div>
                        <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>
                          {subscription.status === "trial" ? "Trial License" : `₹${subscription.amount?.toLocaleString("en-IN")} / ${subscription.billing === "yearly" ? "year" : "month"}`}
                        </div>
                      </div>
                      <div style={{ marginLeft: "auto", textAlign: "right" }}>
                        <div style={{ fontSize: 10, color: "#555", fontWeight: 700, textTransform: "uppercase" }}>License status</div>
                        <div style={{ fontSize: 13, fontWeight: 800, color: isExpired ? "#F87171" : isWarning ? "#FBBF24" : "#4ADE80", marginTop: 4 }}>
                          {isExpired ? "Expired" : subscription.status === "trial" ? "Trial Active" : "Active"}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
                      {[
                        ["Authorized on", formatDate(subscription.startDate)],
                        ["Expiry date", formatDate(subscription.expiryDate)],
                        ["Days remaining", isExpired ? "Expired" : `${daysLeft} days`],
                        ["Billing cycle", subscription.billing === "yearly" ? "Yearly (10% off)" : "Monthly"],
                      ].map(([l, v]) => (
                        <div key={l} style={{ background: "#111", borderRadius: 12, padding: "12px 14px", border: "1px solid #1E1E1E" }}>
                          <div style={{ fontSize: 9, color: "#555", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: 6, fontWeight: 700 }}>{l}</div>
                          <div style={{ fontSize: 13, color: "#ccc", fontWeight: 700 }}>{v}</div>
                        </div>
                      ))}
                    </div>

                    <div style={{ marginBottom: 20 }}>
                      <div style={{ fontSize: 10, color: "#555", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.8px", fontWeight: 700 }}>Included plan privileges</div>
                      {currentPlan.features.map((f, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                          <span style={{ color: currentPlan.color, fontSize: 14 }}>✓</span>
                          <span style={{ fontSize: 13, color: "#888" }}>{f}</span>
                        </div>
                      ))}
                    </div>

                    <button onClick={() => setShowPlans(true)} className="add-btn" style={{ width: "100%", background: currentPlan.id === "basic" ? "#FF5A1F" : "transparent", border: `1px solid ${currentPlan.id === "basic" ? "#FF5A1F" : "#222"}`, borderRadius: 12, padding: "14px 0", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans',sans-serif", transition: "all 0.2s" }}>
                      {currentPlan.id === "basic" ? "⚡ Upgrade to Enterprise Premium" : "Change subscription plan"}
                    </button>
                  </div>
                </div>
              )}

              {/* Plan comparison selector */}
              {showPlans && (
                <>
                  <div style={{ display: "flex", alignItems: "center", justifyBetween: "center", justifyContent: "space-between", marginBottom: 20 }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: "#fff", letterSpacing: "-0.5px" }}>Choose Institutional Plan</div>
                    <button onClick={() => setShowPlans(false)} style={{ background: "none", border: "1px solid #222", borderRadius: 10, padding: "6px 14px", color: "#888", fontSize: 12, cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}>← Back</button>
                  </div>

                  {/* Toggle Billing billing cycle */}
                  <div style={{ display: "flex", background: "#111", borderRadius: 14, padding: 4, marginBottom: 20, border: "1px solid #1E1E1E" }}>
                    {[["monthly", "Monthly cycle"], ["yearly", "Yearly billing"]].map(([v, l]) => (
                      <button key={v} onClick={() => setBillingCycle(v)} style={{ flex: 1, padding: "10px 0", border: "none", borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "'DM Sans',sans-serif", background: billingCycle === v ? "#FF5A1F" : "transparent", color: billingCycle === v ? "#fff" : "#666", transition: "all 0.2s" }}>
                        {l} {v === "yearly" && <span style={{ fontSize: 9, background: "#fff2", borderRadius: 6, padding: "2px 6px", marginLeft: 6, fontWeight: 800 }}>10% OFF</span>}
                      </button>
                    ))}
                  </div>

                  {/* Pricing grid */}
                  {Object.values(PLANS).map(plan => {
                    const price = billingCycle === "yearly" ? plan.yearly : plan.monthly;
                    const isCurrent = subscription?.plan === plan.id;
                    return (
                      <div key={plan.id} style={{ background: "#0E0E0E", border: `2px solid ${isCurrent ? plan.color : "#1E1E1E"}`, borderRadius: 20, padding: "24px", marginBottom: 16, position: "relative", boxShadow: "0 6px 24px rgba(0,0,0,0.4)" }}>
                        {plan.id === "premium" && (
                          <div style={{ position: "absolute", top: -10, right: 20, background: "#FF5A1F", borderRadius: 6, padding: "3px 12px", fontSize: 10, fontWeight: 800, color: "#fff", letterSpacing: "0.5px" }}>POPULAR</div>
                        )}
                        {isCurrent && (
                          <div style={{ position: "absolute", top: -10, left: 20, background: plan.color, borderRadius: 6, padding: "3px 12px", fontSize: 10, fontWeight: 800, color: "#000", letterSpacing: "0.5px" }}>CURRENT PLAN</div>
                        )}
                        
                        <div style={{ display: "flex", alignItems: "center", justifyBetween: "center", justifyContent: "space-between", marginBottom: 18, borderBottom: "1px solid #1E1E1E", paddingBottom: 16 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            <span style={{ fontSize: 28 }}>{plan.emoji}</span>
                            <div>
                              <div style={{ fontSize: 16, fontWeight: 800, color: plan.color }}>{plan.name}</div>
                              <div style={{ fontSize: 11, color: "#555", marginTop: 4 }}>{plan.id === "basic" ? "Basic Tracking" : "Institutes & Colleges"}</div>
                            </div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontSize: 24, fontWeight: 800, color: "#fff", letterSpacing: "-1px" }}>₹{price.toLocaleString("en-IN")}</div>
                            <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>/{billingCycle === "yearly" ? "year" : "month"}</div>
                          </div>
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
                          {plan.features.map((f, i) => (
                            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <span style={{ color: plan.color, fontSize: 12 }}>✓</span>
                              <span style={{ fontSize: 13, color: "#888" }}>{f}</span>
                            </div>
                          ))}
                        </div>

                        <button
                          onClick={() => selectPlan(plan.id)}
                          disabled={planSaving || isCurrent}
                          className="add-btn"
                          style={{ width: "100%", background: isCurrent ? "#141414" : plan.color, border: "none", borderRadius: 12, padding: "14px 0", color: isCurrent ? "#555" : "#fff", fontSize: 13, fontWeight: 700, cursor: isCurrent ? "not-allowed" : "pointer", fontFamily: "'DM Sans',sans-serif" }}>
                          {planSaving ? "Activating License..." : isCurrent ? "Active Plan" : `Select ${plan.name}`}
                        </button>

                        {!isCurrent && (
                          <div style={{ textAlign: "center", marginTop: 10, fontSize: 11, color: "#444" }}>
                            ⚡ Instant activation (Razorpay payment integration pending)
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
    </div>
  );
}
