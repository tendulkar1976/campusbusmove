import { useState, useEffect, useMemo } from "react";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { db, secondaryAuth, logActivity, rtdb } from "../firebase";
import { ref, onValue } from "firebase/database";
import { createUserWithEmailAndPassword, signOut } from "firebase/auth";
import { 
  collection, 
  getDocs, 
  getDoc,
  doc, 
  setDoc, 
  updateDoc, 
  deleteDoc,
  onSnapshot
} from "firebase/firestore";

const PLANS = {
  basic: {
    id: "basic",
    name: "Basic",
    emoji: "🚌",
    color: "#FF5A1F",
    monthly: 5000,
    yearly: 54000,
    limits: { routes: 5, students: 200 }
  },
  premium: {
    id: "premium",
    name: "Premium",
    emoji: "🚀",
    color: "#8B5CF6",
    monthly: 12000,
    yearly: 129600,
    limits: { routes: Infinity, students: Infinity }
  }
};

export default function SuperadminDashboard() {
  const { user, logout } = useAuth();
  const { dark, toggle, t } = useTheme();

  // Tab state
  const [tab, setTab] = useState("overview");

  // Global state loaded from Firestore
  const [campuses, setCampuses] = useState([]);
  const [usersList, setUsersList] = useState([]);
  const [paymentsList, setPaymentsList] = useState([]);
  const [loading, setLoading] = useState(true);

  // Search & filter state
  const [userSearch, setUserSearch] = useState("");
  const [userRoleFilter, setUserRoleFilter] = useState("all");
  const [userCampusFilter, setUserCampusFilter] = useState("all");

  // Modals state
  const [editingCampus, setEditingCampus] = useState(null);
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  
  // Forms local state for plan override
  const [overridePlan, setOverridePlan] = useState("basic");
  const [overrideBilling, setOverrideBilling] = useState("monthly");
  const [overrideStatus, setOverrideStatus] = useState("active");
  const [overrideMonths, setOverrideMonths] = useState(1);
  const [overrideSaving, setOverrideSaving] = useState(false);

  // State for creating new admin
  const [newAdmin, setNewAdmin] = useState({
    name: "",
    email: "",
    password: "",
    role: "admin",
    campusId: ""
  });
  const [adminCreating, setAdminCreating] = useState(false);
  const [adminCreateError, setAdminCreateError] = useState("");
  const [adminCreateSuccess, setAdminCreateSuccess] = useState("");

  // Announcement state
  const [announcement, setAnnouncement] = useState({
    message: "",
    type: "info",
    active: false,
    updatedAt: 0
  });
  const [savingAnnouncement, setSavingAnnouncement] = useState(false);
  const [announcementSuccess, setAnnouncementSuccess] = useState("");
  const [logsList, setLogsList] = useState([]);
  const [globalAnnouncement, setGlobalAnnouncement] = useState(null);
  const [announcementDismissed, setAnnouncementDismissed] = useState(false);
  const [liveRoutes, setLiveRoutes] = useState({});
  const [routesList, setRoutesList] = useState([]);

  useEffect(() => {
    loadData();
    const unsubAnn = onSnapshot(doc(db, "settings", "global_announcement"), snap => {
      if (snap.exists()) {
        const data = snap.data();
        setGlobalAnnouncement(data);
        const dismissedTime = localStorage.getItem("cm_dismissed_announcement");
        if (dismissedTime && Number(dismissedTime) >= data.updatedAt) {
          setAnnouncementDismissed(true);
        } else {
          setAnnouncementDismissed(false);
        }
      }
    });

    const r = ref(rtdb, "routes");
    const unsubRtdb = onValue(r, snap => {
      if (snap.exists()) {
        setLiveRoutes(snap.val());
      } else {
        setLiveRoutes({});
      }
    });

    return () => {
      unsubAnn();
      unsubRtdb();
    };
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      // 1. Get subscriptions (campuses list)
      const subSnap = await getDocs(collection(db, "subscriptions"));
      const subs = subSnap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setCampuses(subs);

      // 2. Get global users list
      const userSnap = await getDocs(collection(db, "users"));
      const users = userSnap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setUsersList(users);

      // 3. Get global transaction records
      const paySnap = await getDocs(collection(db, "payments"));
      const payments = paySnap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })).sort((a, b) => b.timestamp - a.timestamp);
      setPaymentsList(payments);

      // 4. Get global announcement settings
      try {
        const annSnap = await getDoc(doc(db, "settings", "global_announcement"));
        if (annSnap.exists()) {
          setAnnouncement(annSnap.data());
        }
      } catch (annErr) {
        console.error("Failed to load global announcement:", annErr);
      }

      // 5. Get activity logs
      try {
        const logSnap = await getDocs(collection(db, "logs"));
        const logs = logSnap.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })).sort((a, b) => b.timestamp - a.timestamp);
        setLogsList(logs);
      } catch (logErr) {
        console.error("Failed to load activity logs:", logErr);
      }

      // 6. Get all routes mapping
      try {
        const routeSnap = await getDocs(collection(db, "routes"));
        const routes = routeSnap.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setRoutesList(routes);
      } catch (routeErr) {
        console.error("Failed to load routes:", routeErr);
      }

    } catch (err) {
      console.error("Failed to load Superadmin data:", err);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateAdmin(e) {
    e.preventDefault();
    setAdminCreateError("");
    setAdminCreateSuccess("");

    if (!newAdmin.name.trim()) return setAdminCreateError("Please enter full name.");
    if (!newAdmin.email.trim() || !newAdmin.email.includes("@")) return setAdminCreateError("Please enter a valid email address.");
    if (newAdmin.password.length < 6) return setAdminCreateError("Password must be at least 6 characters.");
    if (newAdmin.role === "admin" && !newAdmin.campusId.trim()) return setAdminCreateError("Please assign a Campus ID for the Admin role.");

    setAdminCreating(true);
    try {
      const cred = await createUserWithEmailAndPassword(secondaryAuth, newAdmin.email.trim().toLowerCase(), newAdmin.password);
      
      const profile = {
        name: newAdmin.name.trim(),
        email: newAdmin.email.trim().toLowerCase(),
        role: newAdmin.role,
        campusId: newAdmin.role === "superadmin" ? "alliance-bangalore" : newAdmin.campusId.trim(),
        blocked: false,
        createdAt: Date.now()
      };

      await setDoc(doc(db, "users", cred.user.uid), profile);
      await signOut(secondaryAuth);

      await logActivity(
        "Admin Account Created", 
        `Created ${newAdmin.role === "superadmin" ? "Superadmin" : "Campus Admin"} account for ${newAdmin.name} (${newAdmin.email.toLowerCase()})`,
        newAdmin.role === "superadmin" ? "global" : newAdmin.campusId
      );

      setAdminCreateSuccess(`Administrator account for ${newAdmin.name} created successfully!`);
      setNewAdmin({ name: "", email: "", password: "", role: "admin", campusId: "" });
      loadData();
    } catch (err) {
      console.error("Admin creation failed:", err);
      const c = err.code;
      if (c === "auth/email-already-in-use") {
        setAdminCreateError("This email address is already registered.");
      } else if (c === "auth/weak-password") {
        setAdminCreateError("Password must be at least 6 characters.");
      } else {
        setAdminCreateError(err.message);
      }
    } finally {
      setAdminCreating(false);
    }
  }

  async function handleSaveAnnouncement(e) {
    e.preventDefault();
    setAnnouncementSuccess("");
    setSavingAnnouncement(true);
    try {
      const data = {
        ...announcement,
        updatedAt: Date.now()
      };
      await setDoc(doc(db, "settings", "global_announcement"), data);
      
      await logActivity(
        "Broadcast Updated",
        `Updated global announcement: "${announcement.message.substring(0, 50)}${announcement.message.length > 50 ? "..." : ""}" (Active: ${announcement.active ? "Yes" : "No"})`,
        "global"
      );

      setAnnouncementSuccess("Global announcement broadcast settings saved successfully!");
    } catch (err) {
      console.error("Failed to save global announcement:", err);
      alert("Error saving announcement: " + err.message);
    } finally {
      setSavingAnnouncement(false);
    }
  }

  // Edit / Override Subscription
  function handleOpenOverride(campus) {
    setEditingCampus(campus);
    setOverridePlan(campus.plan || "basic");
    setOverrideBilling(campus.billing || "monthly");
    setOverrideStatus(campus.status || "active");
    setOverrideMonths(1);
  }

  async function handleSaveOverride() {
    if (!editingCampus) return;
    setOverrideSaving(true);
    try {
      const durationMs = overrideMonths * 30 * 24 * 60 * 60 * 1000;
      const amount = overridePlan === "basic" 
        ? (overrideBilling === "yearly" ? PLANS.basic.yearly : PLANS.basic.monthly)
        : (overrideBilling === "yearly" ? PLANS.premium.yearly : PLANS.premium.monthly);

      const updatedSub = {
        ...editingCampus,
        plan: overridePlan,
        billing: overrideBilling,
        status: overrideStatus,
        expiryDate: Date.now() + durationMs,
        amount,
        updatedAt: Date.now()
      };

      await setDoc(doc(db, "subscriptions", editingCampus.id), updatedSub);
      setCampuses(prev => prev.map(c => c.id === editingCampus.id ? updatedSub : c));
      
      // Also log a mock override transaction
      const overrideLog = {
        paymentId: `admin_override_${Date.now()}`,
        planId: overridePlan,
        billing: overrideBilling,
        amount,
        timestamp: Date.now(),
        campusId: editingCampus.id,
        status: "success",
        customerName: "Superadmin Override",
        customerEmail: user?.email || ""
      };
      await setDoc(doc(db, "payments", overrideLog.paymentId), overrideLog);
      setPaymentsList(prev => [overrideLog, ...prev]);

      await logActivity(
        "Subscription Override",
        `Manual override: Updated plan for ${editingCampus.id} to ${overridePlan.toUpperCase()} (${overrideBilling}) for ${overrideMonths} month(s)`,
        editingCampus.id
      );

      setEditingCampus(null);
    } catch (err) {
      console.error("Failed to override plan:", err);
      alert("Error saving manual override: " + err.message);
    } finally {
      setOverrideSaving(false);
    }
  }

  // Toggle user block status
  async function toggleBlockUser(uid, currentBlocked) {
    try {
      const updatedBlocked = !currentBlocked;
      await updateDoc(doc(db, "users", uid), { blocked: updatedBlocked });
      setUsersList(prev => prev.map(u => u.id === uid ? { ...u, blocked: updatedBlocked } : u));
    } catch (err) {
      alert("Error blocking user: " + err.message);
    }
  }

  // Change user role
  async function handleRoleChange(uid, newRole) {
    try {
      await updateDoc(doc(db, "users", uid), { role: newRole });
      setUsersList(prev => prev.map(u => u.id === uid ? { ...u, role: newRole } : u));
    } catch (err) {
      alert("Error changing role: " + err.message);
    }
  }

  // Statistics summaries
  const totalRevenue = paymentsList.reduce((sum, p) => sum + (p.amount || 0), 0);
  const activeCampusesCount = campuses.filter(c => (c.expiryDate || 0) > Date.now() && c.status === "active").length;
  const expiredCampusesCount = campuses.length - activeCampusesCount;
  const globalUsersCount = usersList.length;

  // Filtered Users list
  const filteredUsers = usersList.filter(u => {
    // Restrict to admins only
    if (u.role !== "admin" && u.role !== "superadmin") return false;

    const query = userSearch.toLowerCase();
    const matchesSearch = 
      (u.name || "").toLowerCase().includes(query) ||
      (u.email || "").toLowerCase().includes(query) ||
      (u.phone || "").includes(query);
    
    const matchesRole = userRoleFilter === "all" || u.role === userRoleFilter;
    const matchesCampus = userCampusFilter === "all" || u.campusId === userCampusFilter;
    
    return matchesSearch && matchesRole && matchesCampus;
  });

  // Group statistics per campus dynamically
  const campusStats = useMemo(() => {
    const stats = {};
    
    // Initialize stats
    campuses.forEach(c => {
      stats[c.id] = {
        id: c.id,
        name: c.name || c.id,
        plan: c.plan || "basic",
        billing: c.billing || "monthly",
        status: c.status || "active",
        expiryDate: c.expiryDate || 0,
        students: 0,
        teachers: 0,
        drivers: 0,
        activeBuses: 0
      };
    });

    // Aggregate users per campus
    usersList.forEach(u => {
      const cid = u.campusId;
      if (cid && stats[cid]) {
        if (u.role === "student") stats[cid].students++;
        else if (u.role === "teacher") stats[cid].teachers++;
        else if (u.role === "driver") stats[cid].drivers++;
      }
    });

    // Count active buses from liveRoutes
    const routeToCampus = {};
    routesList.forEach(r => {
      routeToCampus[r.id] = r.campusId;
    });

    Object.entries(liveRoutes).forEach(([rid, rData]) => {
      if (rData && rData.live && rData.live.active) {
        const cid = routeToCampus[rid];
        if (cid && stats[cid]) {
          stats[cid].activeBuses++;
        }
      }
    });

    return Object.values(stats);
  }, [campuses, usersList, routesList, liveRoutes]);

  const [hoveredChartIndex, setHoveredChartIndex] = useState(null);

  // Aggregate monthly revenue dynamically
  const revenueChartData = useMemo(() => {
    const monthlyTotals = {};
    const monthlySubscribers = {};

    // Get last 6 months prefilled
    const monthsToShow = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const label = d.toLocaleString("en-US", { month: "short", year: "numeric" });
      monthsToShow.push(label);
      monthlyTotals[label] = 0;
      monthlySubscribers[label] = 0;
    }

    paymentsList.forEach(p => {
      if (p.status === "success" && p.amount) {
        const d = new Date(p.timestamp);
        const label = d.toLocaleString("en-US", { month: "short", year: "numeric" });
        
        if (monthlyTotals[label] !== undefined) {
          monthlyTotals[label] += p.amount;
        }
        if (monthlySubscribers[label] !== undefined) {
          monthlySubscribers[label]++;
        }
      }
    });

    return monthsToShow.map(label => ({
      label,
      revenue: monthlyTotals[label],
      subscribers: monthlySubscribers[label]
    }));
  }, [paymentsList]);

  // Theme-based Styles
  const S = {
    container: {
      minHeight: "100vh",
      background: t.bg,
      color: t.text,
      fontFamily: "'Inter', sans-serif",
      padding: "24px",
      transition: "background 0.25s, color 0.25s"
    },
    header: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: "28px",
      flexWrap: "wrap",
      gap: "16px"
    },
    card: {
      background: t.bgCard,
      border: `1.5px solid ${t.border}`,
      borderRadius: "14px",
      boxShadow: dark ? "0 4px 20px rgba(0,0,0,0.3)" : "0 8px 30px rgba(0,0,0,0.03)",
      overflow: "hidden",
      transition: "all 0.25s ease"
    },
    tabButton: (active) => ({
      padding: "10px 18px",
      borderRadius: "10px",
      border: "none",
      background: active ? t.accent : "transparent",
      color: active ? "#fff" : t.textMuted,
      fontWeight: 700,
      fontSize: "13px",
      cursor: "pointer",
      fontFamily: "'Inter', sans-serif",
      transition: "all 0.2s"
    }),
    badge: (type) => {
      let bg = "#F3F4F6";
      let color = "#374151";
      if (type === "active") { bg = "#D1FAE5"; color = "#065F46"; }
      if (type === "expired") { bg = "#FEE2E2"; color = "#991B1B"; }
      if (type === "trial") { bg = "#FEF3C7"; color = "#92400E"; }
      return {
        display: "inline-block",
        padding: "3px 8px",
        borderRadius: "6px",
        fontSize: "10px",
        fontWeight: 800,
        textTransform: "uppercase",
        background: bg,
        color: color
      };
    }
  };

  return (
    <div style={S.container}>
      {/* Header bar */}
      <div style={S.header}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 26 }}>🛠️</span>
            <h1 style={{ fontSize: "22px", fontWeight: 900, margin: 0, letterSpacing: "-0.5px" }}>CampusMove Superadmin</h1>
          </div>
          <div style={{ fontSize: "12px", color: t.textMuted, marginTop: "4px" }}>System-wide control & central transaction overview</div>
        </div>
        
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <button 
            onClick={toggle}
            style={{
              background: dark ? "#333" : "#f0f0f0",
              border: "none",
              borderRadius: "10px",
              padding: "10px 14px",
              cursor: "pointer",
              fontSize: "14px"
            }}
          >
            {dark ? "☀️ Light" : "🌙 Dark"}
          </button>
          
          <button 
            onClick={logout}
            style={{
              background: "#EF4444",
              border: "none",
              borderRadius: "10px",
              padding: "10px 18px",
              color: "#fff",
              fontWeight: 800,
              fontSize: "13px",
              cursor: "pointer",
              fontFamily: "'Inter', sans-serif"
            }}
          >
            Log Out
          </button>
        </div>
      </div>

      {/* Tabs selectors */}
      <div style={{ display: "flex", gap: "8px", background: dark ? t.inputBg : t.bgCard2, border: `1.5px solid ${t.border}`, borderRadius: "12px", padding: "4px", marginBottom: "24px", width: "fit-content" }}>
        {[
          ["overview", "📈 Overview"],
          ["campuses", "🏫 Campuses & Plans"],
          ["users", "👥 Global Users"],
          ["announcements", "📢 Broadcast"],
          ["logs", "📜 System Logs"],
          ["payments", "💰 Transactions"]
        ].map(([id, label]) => (
          <button 
            key={id} 
            onClick={() => setTab(id)} 
            style={S.tabButton(tab === id)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Global Announcement Banner */}
      {globalAnnouncement && globalAnnouncement.active && !announcementDismissed && (
        <div style={{
          background: globalAnnouncement.type === "warning" ? "#FFFBEB" : globalAnnouncement.type === "success" ? "#ECFDF5" : "#EFF6FF",
          border: `1.5px solid ${globalAnnouncement.type === "warning" ? "#FDE68A" : globalAnnouncement.type === "success" ? "#A7F3D0" : "#BFDBFE"}`,
          borderRadius: "12px",
          padding: "14px 20px",
          marginBottom: "20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          boxShadow: "0 4px 12px rgba(0,0,0,0.02)"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "18px" }}>
              {globalAnnouncement.type === "warning" ? "⚠️" : globalAnnouncement.type === "success" ? "📢" : "ℹ️"}
            </span>
            <span style={{ 
              color: globalAnnouncement.type === "warning" ? "#92400E" : globalAnnouncement.type === "success" ? "#065F46" : "#1E40AF",
              fontSize: "13px",
              fontWeight: 700,
              lineHeight: 1.5
            }}>
              {globalAnnouncement.message}
            </span>
          </div>
          <button 
            onClick={() => {
              localStorage.setItem("cm_dismissed_announcement", String(globalAnnouncement.updatedAt));
              setAnnouncementDismissed(true);
            }}
            style={{
              background: "none",
              border: "none",
              color: globalAnnouncement.type === "warning" ? "#B45309" : globalAnnouncement.type === "success" ? "#047857" : "#1D4ED8",
              fontSize: "16px",
              cursor: "pointer",
              fontWeight: 800,
              padding: "4px"
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Loader */}
      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", padding: "80px 0" }}>
          <div style={{ width: 36, height: 36, border: `3.5px solid ${t.border}`, borderTopColor: "#FF5A1F", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      ) : (
        <>
          {/* TAB 1: OVERVIEW */}
          {tab === "overview" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
              {/* KPI Cards Grid */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "16px", alignItems: "start" }}>
                <div style={{ ...S.card, padding: "20px" }}>
                  <div style={{ fontSize: "11px", color: t.textMuted, fontWeight: 800, textTransform: "uppercase" }}>Total platform earnings</div>
                  <div style={{ fontSize: "28px", fontWeight: 900, marginTop: "8px", color: "#10B981" }}>₹{totalRevenue.toLocaleString("en-IN")}</div>
                  <div style={{ fontSize: "11px", color: t.textMuted, marginTop: "4px" }}>Cumulative sum of all invoices</div>
                </div>
                
                <div style={{ ...S.card, padding: "20px" }}>
                  <div style={{ fontSize: "11px", color: t.textMuted, fontWeight: 800, textTransform: "uppercase" }}>Active Subscriptions</div>
                  <div style={{ fontSize: "28px", fontWeight: 900, marginTop: "8px", color: t.accent }}>{activeCampusesCount}</div>
                  <div style={{ fontSize: "11px", color: t.textMuted, marginTop: "4px", marginBottom: 12 }}>Campuses with active premium/basic access</div>
                  
                  {campuses.filter(c => (c.expiryDate || 0) > Date.now() && c.status === "active").map(c => {
                    const days = Math.max(0, Math.ceil((c.expiryDate - Date.now()) / (24 * 60 * 60 * 1000)));
                    const start = new Date(c.updatedAt || (c.expiryDate - (c.billing === "yearly" ? 365 : 30) * 24 * 60 * 60 * 1000)).toLocaleDateString("en-IN");
                    const end = new Date(c.expiryDate).toLocaleDateString("en-IN");
                    return (
                      <div key={c.id} style={{ marginTop: 10, borderTop: `1.5px solid ${t.border}`, paddingTop: 10, fontSize: 11 }}>
                        <div style={{ fontWeight: 800, color: t.text }}>🏫 {c.id}</div>
                        <div style={{ color: t.textSub, marginTop: 2 }}>Period: {start} to {end}</div>
                        <div style={{ color: days <= 7 ? "#EF4444" : "#10B981", fontWeight: 700, marginTop: 2 }}>⏱️ {days} days remaining</div>
                      </div>
                    );
                  })}
                </div>
                
                <div style={{ ...S.card, padding: "20px" }}>
                  <div style={{ fontSize: "11px", color: t.textMuted, fontWeight: 800, textTransform: "uppercase" }}>Expired campuses</div>
                  <div style={{ fontSize: "28px", fontWeight: 900, marginTop: "8px", color: "#EF4444" }}>{expiredCampusesCount}</div>
                  <div style={{ fontSize: "11px", color: t.textMuted, marginTop: "4px", marginBottom: 12 }}>Campuses needing billing renew</div>

                  {campuses.filter(c => (c.expiryDate || 0) <= Date.now() || c.status === "expired").map(c => (
                    <div key={c.id} style={{ marginTop: 10, borderTop: `1.5px solid ${t.border}`, paddingTop: 10, fontSize: 11 }}>
                      <div style={{ fontWeight: 800, color: "#EF4444" }}>🏫 {c.id}</div>
                      <div style={{ color: t.textSub, marginTop: 2 }}>Expired: {new Date(c.expiryDate || 0).toLocaleDateString("en-IN")}</div>
                    </div>
                  ))}
                </div>
                
                <div style={{ ...S.card, padding: "20px" }}>
                  <div style={{ fontSize: "11px", color: t.textMuted, fontWeight: 800, textTransform: "uppercase" }}>Global platform users</div>
                  <div style={{ fontSize: "28px", fontWeight: 900, marginTop: "8px" }}>{globalUsersCount}</div>
                  <div style={{ fontSize: "11px", color: t.textMuted, marginTop: "4px", marginBottom: 12 }}>Total members using this currently</div>

                  <div style={{ marginTop: 10, borderTop: `1.5px solid ${t.border}`, paddingTop: 10, fontSize: 11, display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", color: t.textSub }}>
                      <span>🎓 Students:</span>
                      <span style={{ fontWeight: 700 }}>{usersList.filter(u => u.role === "student").length}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", color: t.textSub }}>
                      <span>🧑‍🏫 Faculty:</span>
                      <span style={{ fontWeight: 700 }}>{usersList.filter(u => u.role === "teacher").length}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", color: t.textSub }}>
                      <span>🚌 Drivers:</span>
                      <span style={{ fontWeight: 700 }}>{usersList.filter(u => u.role === "driver").length}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Interactive Revenue Chart */}
              {(() => {
                const maxRevenue = Math.max(...revenueChartData.map(d => d.revenue), 10000);
                const maxSubs = Math.max(...revenueChartData.map(d => d.subscribers), 5);
                const points = revenueChartData.map((d, i) => ({
                  x: 50 + i * 76,
                  y: 130 - (maxRevenue > 0 ? (d.revenue / maxRevenue) * 90 : 0)
                }));
                const areaPath = points.length > 0
                  ? "M " + points.map(p => `${p.x} ${p.y}`).join(" L ") + ` L ${points[points.length - 1].x} 140 L ${points[0].x} 140 Z`
                  : "";
                const linePath = points.length > 0
                  ? "M " + points.map(p => `${p.x} ${p.y}`).join(" L ")
                  : "";

                const subPoints = revenueChartData.map((d, i) => ({
                  x: 50 + i * 76,
                  y: 130 - (maxSubs > 0 ? (d.subscribers / maxSubs) * 90 : 0)
                }));
                const subLinePath = subPoints.length > 0
                  ? "M " + subPoints.map(p => `${p.x} ${p.y}`).join(" L ")
                  : "";

                const activeHover = hoveredChartIndex !== null ? revenueChartData[hoveredChartIndex] : revenueChartData[revenueChartData.length - 1];

                return (
                  <div style={{ ...S.card, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", overflow: "hidden" }}>
                    {/* Left: The SVG Chart */}
                    <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: "10px", borderRight: `1.5px solid ${t.border}` }}>
                      <span style={{ fontSize: "12px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "1.5px", color: t.textMuted }}>💸 Platform Revenue & Subscription Trends</span>
                      
                      <div style={{ position: "relative", flex: 1, minHeight: "150px", marginTop: "14px" }}>
                        <svg viewBox="0 0 460 160" style={{ width: "100%", height: "100%", overflow: "visible" }}>
                          <defs>
                            <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#10B981" stopOpacity="0.25" />
                              <stop offset="100%" stopColor="#10B981" stopOpacity="0.0" />
                            </linearGradient>
                          </defs>

                          {/* Grid Lines */}
                          {[20, 50, 80, 110, 140].map((yVal, i) => (
                            <line 
                              key={i} 
                              x1="30" 
                              y1={yVal} 
                              x2="430" 
                              y2={yVal} 
                              stroke={t.border} 
                              strokeWidth="1" 
                              strokeDasharray="4 4" 
                            />
                          ))}

                          {/* Area Fill */}
                          {areaPath && (
                            <path d={areaPath} fill="url(#areaGrad)" />
                          )}

                          {/* Revenue Line */}
                          {linePath && (
                            <path d={linePath} fill="none" stroke="#10B981" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                          )}

                          {/* Subscription Dotted Line */}
                          {subLinePath && (
                            <path d={subLinePath} fill="none" stroke={t.accent} strokeWidth="2.5" strokeDasharray="6 4" strokeLinecap="round" strokeLinejoin="round" />
                          )}

                          {/* Data points */}
                          {points.map((p, idx) => (
                            <g key={idx}>
                              <circle 
                                cx={p.x} 
                                cy={p.y} 
                                r="4.5" 
                                fill={hoveredChartIndex === idx ? "#10B981" : t.bgCard} 
                                stroke="#10B981" 
                                strokeWidth="2.5" 
                                style={{ transition: "all 0.15s" }}
                              />
                              <circle 
                                cx={p.x} 
                                cy={p.y} 
                                r="16" 
                                fill="transparent" 
                                style={{ cursor: "pointer" }}
                                onMouseEnter={() => setHoveredChartIndex(idx)}
                                onMouseLeave={() => setHoveredChartIndex(null)}
                              />
                            </g>
                          ))}

                          {/* X Axis Labels */}
                          {revenueChartData.map((d, idx) => (
                            <text 
                              key={idx} 
                              x={50 + idx * 76} 
                              y="158" 
                              textAnchor="middle" 
                              fill={t.textMuted} 
                              fontSize="9.5" 
                              fontWeight="700"
                            >
                              {d.label.split(" ")[0]}
                            </text>
                          ))}
                        </svg>
                      </div>
                    </div>

                    {/* Right: Legend and Info summary */}
                    <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", justifyContent: "center", background: dark ? "rgba(255,255,255,0.01)" : "rgba(0,0,0,0.01)", gap: "16px" }}>
                      <div>
                        <div style={{ fontSize: "11px", color: t.textMuted, fontWeight: 800, textTransform: "uppercase" }}>Selected Month</div>
                        <div style={{ fontSize: "18px", fontWeight: 800, color: t.text, marginTop: "4px" }}>{activeHover ? activeHover.label : "N/A"}</div>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                        <div style={{ padding: "10px", background: t.bgCard, border: `1.5px solid ${t.border}`, borderRadius: "10px" }}>
                          <span style={{ fontSize: "10px", color: t.textMuted, fontWeight: 700, textTransform: "uppercase", display: "block" }}>Revenue</span>
                          <span style={{ fontSize: "16px", fontWeight: 900, color: "#10B981", marginTop: "4px", display: "block" }}>
                            ₹{activeHover ? activeHover.revenue.toLocaleString("en-IN") : "0"}
                          </span>
                        </div>
                        
                        <div style={{ padding: "10px", background: t.bgCard, border: `1.5px solid ${t.border}`, borderRadius: "10px" }}>
                          <span style={{ fontSize: "10px", color: t.textMuted, fontWeight: 700, textTransform: "uppercase", display: "block" }}>Subscriptions</span>
                          <span style={{ fontSize: "16px", fontWeight: 900, color: t.accent, marginTop: "4px", display: "block" }}>
                            {activeHover ? activeHover.subscribers : "0"} bills
                          </span>
                        </div>
                      </div>

                      <div style={{ borderTop: `1.5px solid ${t.border}`, paddingTop: "12px", fontSize: "10.5px", color: t.textMuted, lineHeight: "1.4" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#10B981", display: "inline-block" }} />
                          <span>Green line indicates monthly recurring revenue.</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <span style={{ width: 8, height: 8, borderRadius: "50%", background: t.accent, display: "inline-block" }} />
                          <span>Blue dashed line indicates billing transactions.</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Campus Usage & Engagement Stats Card */}
              <div style={S.card}>
                <div style={{ padding: "18px 20px", borderBottom: `1.5px solid ${t.border}` }}>
                  <span style={{ fontSize: "13px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "1.5px" }}>🏫 Campus Engagement & Usage Metrics</span>
                </div>
                <div style={{ padding: "10px 20px", overflowX: "auto" }}>
                  {campusStats.length === 0 ? (
                    <div style={{ padding: "30px 0", textAlign: "center", color: t.textMuted }}>No campus records available.</div>
                  ) : (
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                      <thead>
                        <tr style={{ borderBottom: `1.5px solid ${t.border}`, color: t.textMuted }}>
                          <th style={{ padding: "12px 8px", textAlign: "left" }}>Campus ID</th>
                          <th style={{ padding: "12px 8px", textAlign: "left" }}>Active Plan</th>
                          <th style={{ padding: "12px 8px", textAlign: "center" }}>Students</th>
                          <th style={{ padding: "12px 8px", textAlign: "center" }}>Faculty</th>
                          <th style={{ padding: "12px 8px", textAlign: "center" }}>Drivers</th>
                          <th style={{ padding: "12px 8px", textAlign: "center" }}>Active Buses</th>
                          <th style={{ padding: "12px 8px", textAlign: "right" }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {campusStats.map((stat, i) => {
                          const isActive = stat.status === "active" && (stat.expiryDate || 0) > Date.now();
                          return (
                            <tr key={i} style={{ borderBottom: `1px solid ${t.border}` }}>
                              <td style={{ padding: "12px 8px", fontWeight: 700, color: t.text }}>{stat.id}</td>
                              <td style={{ padding: "12px 8px", textTransform: "uppercase", fontWeight: 800, color: stat.plan === "premium" ? "#8B5CF6" : "#FF5A1F" }}>
                                {stat.plan === "premium" ? "🚀 Premium" : "🚌 Basic"}
                              </td>
                              <td style={{ padding: "12px 8px", textAlign: "center" }}>{stat.students}</td>
                              <td style={{ padding: "12px 8px", textAlign: "center" }}>{stat.teachers}</td>
                              <td style={{ padding: "12px 8px", textAlign: "center" }}>{stat.drivers}</td>
                              <td style={{ padding: "12px 8px", textAlign: "center" }}>
                                {stat.activeBuses > 0 ? (
                                  <span style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 6,
                                    padding: "2px 8px",
                                    borderRadius: 12,
                                    fontSize: "11px",
                                    fontWeight: 800,
                                    background: "#D1FAE5",
                                    color: "#065F46"
                                  }}>
                                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#10B981", display: "inline-block", animation: "pulsePill 1.5s infinite" }} />
                                    {stat.activeBuses} Live
                                  </span>
                                ) : (
                                  <span style={{ color: t.textHint }}>0</span>
                                )}
                              </td>
                              <td style={{ padding: "12px 8px", textAlign: "right" }}>
                                <span style={{
                                  display: "inline-block",
                                  padding: "2px 6px",
                                  borderRadius: "4px",
                                  fontSize: "10px",
                                  fontWeight: 800,
                                  background: isActive ? "#D1FAE5" : "#FEE2E2",
                                  color: isActive ? "#065F46" : "#991B1B"
                                }}>
                                  {isActive ? "ACTIVE" : "EXPIRED"}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              {/* Recent activity card */}
              <div style={{ ...S.card }}>
                <div style={{ padding: "18px 20px", borderBottom: `1.5px solid ${t.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "13px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "1.5px" }}>💸 Recent Transactions</span>
                  <button onClick={() => setTab("payments")} style={{ background: "none", border: "none", color: t.accent, fontWeight: 800, fontSize: "12px", cursor: "pointer" }}>View All →</button>
                </div>
                <div style={{ padding: "10px 20px" }}>
                  {paymentsList.length === 0 ? (
                    <div style={{ padding: "30px 0", textAlign: "center", color: t.textMuted, fontSize: "13px" }}>No transactions logged yet.</div>
                  ) : (
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                      <thead>
                        <tr style={{ borderBottom: `1.5px solid ${t.border}`, color: t.textMuted }}>
                          <th style={{ padding: "12px 8px", textAlign: "left" }}>Date</th>
                          <th style={{ padding: "12px 8px", textAlign: "left" }}>Campus</th>
                          <th style={{ padding: "12px 8px", textAlign: "left" }}>Plan</th>
                          <th style={{ padding: "12px 8px", textAlign: "left" }}>Amount</th>
                          <th style={{ padding: "12px 8px", textAlign: "right" }}>Payment ID</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paymentsList.slice(0, 5).map((pay, i) => (
                          <tr key={i} style={{ borderBottom: `1px solid ${t.border}` }}>
                            <td style={{ padding: "12px 8px" }}>{new Date(pay.timestamp).toLocaleDateString("en-IN")}</td>
                            <td style={{ padding: "12px 8px", fontWeight: 700 }}>{pay.campusId}</td>
                            <td style={{ padding: "12px 8px" }}><span style={{ textTransform: "capitalize" }}>{pay.planId}</span> ({pay.billing})</td>
                            <td style={{ padding: "12px 8px", fontWeight: 700 }}>₹{pay.amount?.toLocaleString("en-IN")}</td>
                            <td style={{ padding: "12px 8px", textAlign: "right", color: t.textMuted }}>{pay.paymentId}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: CAMPUSES */}
          {tab === "campuses" && (
            <div style={S.card}>
              <div style={{ padding: "18px 20px", borderBottom: `1.5px solid ${t.border}` }}>
                <span style={{ fontSize: "13px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "1.5px" }}>🏫 Campuses Directory</span>
              </div>
              <div style={{ padding: "10px 20px", overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                  <thead>
                    <tr style={{ borderBottom: `1.5px solid ${t.border}`, color: t.textMuted }}>
                      <th style={{ padding: "12px 8px", textAlign: "left" }}>Campus ID</th>
                      <th style={{ padding: "12px 8px", textAlign: "left" }}>Active Plan</th>
                      <th style={{ padding: "12px 8px", textAlign: "left" }}>Billing Cycle</th>
                      <th style={{ padding: "12px 8px", textAlign: "left" }}>Expiry Date</th>
                      <th style={{ padding: "12px 8px", textAlign: "left" }}>License Status</th>
                      <th style={{ padding: "12px 8px", textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campuses.map((c, i) => {
                      const expired = (c.expiryDate || 0) <= Date.now();
                      const statusType = c.status === "trial" ? "trial" : (expired ? "expired" : "active");
                      return (
                        <tr key={i} style={{ borderBottom: `1px solid ${t.border}` }}>
                          <td style={{ padding: "12px 8px", fontWeight: 800 }}>{c.id}</td>
                          <td style={{ padding: "12px 8px" }}>
                            {PLANS[c.plan]?.emoji} <span style={{ fontWeight: 700, textTransform: "capitalize" }}>{c.plan || "None"}</span>
                          </td>
                          <td style={{ padding: "12px 8px", textTransform: "capitalize" }}>{c.billing || "monthly"}</td>
                          <td style={{ padding: "12px 8px" }}>{new Date(c.expiryDate || 0).toLocaleDateString("en-IN")}</td>
                          <td style={{ padding: "12px 8px" }}>
                            <span style={S.badge(statusType)}>{statusType}</span>
                          </td>
                          <td style={{ padding: "12px 8px", textAlign: "right" }}>
                            <button 
                              onClick={() => handleOpenOverride(c)}
                              style={{
                                background: t.accent,
                                border: "none",
                                borderRadius: "8px",
                                padding: "6px 12px",
                                color: "#fff",
                                fontWeight: 800,
                                fontSize: "11px",
                                cursor: "pointer",
                                fontFamily: "'Inter', sans-serif"
                              }}
                            >
                              Modify Subscription
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 3: USERS */}
          {tab === "users" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {/* Filters bar */}
              <div style={{ ...S.card, padding: "16px", display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
                <input 
                  type="text" 
                  value={userSearch}
                  onChange={e => setUserSearch(e.target.value)}
                  placeholder="Search user name, email, or phone..."
                  style={{
                    flex: 2,
                    background: dark ? t.inputBg : "#f7f7f7",
                    border: `1.5px solid ${t.border}`,
                    borderRadius: "10px",
                    padding: "10px 14px",
                    color: t.text,
                    outline: "none",
                    minWidth: "200px"
                  }}
                />
                
                <select
                  value={userRoleFilter}
                  onChange={e => setUserRoleFilter(e.target.value)}
                  style={{
                    flex: 1,
                    background: dark ? t.inputBg : "#f7f7f7",
                    border: `1.5px solid ${t.border}`,
                    borderRadius: "10px",
                    padding: "10px 14px",
                    color: t.text,
                    outline: "none"
                  }}
                >
                  <option value="all">All Admin Roles</option>
                  <option value="admin">Campus Admins</option>
                  <option value="superadmin">Superadmins</option>
                </select>

                <select
                  value={userCampusFilter}
                  onChange={e => setUserCampusFilter(e.target.value)}
                  style={{
                    flex: 1,
                    background: dark ? t.inputBg : "#f7f7f7",
                    border: `1.5px solid ${t.border}`,
                    borderRadius: "10px",
                    padding: "10px 14px",
                    color: t.text,
                    outline: "none"
                  }}
                >
                  <option value="all">All Campuses</option>
                  {Array.from(new Set(usersList.map(u => u.campusId).filter(Boolean))).map(cid => (
                    <option key={cid} value={cid}>{cid}</option>
                  ))}
                </select>
              </div>

              {/* Users table */}
              <div style={S.card}>
                <div style={{ padding: "18px 20px", borderBottom: `1.5px solid ${t.border}` }}>
                  <span style={{ fontSize: "13px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "1.5px" }}>👥 Users Registry ({filteredUsers.length})</span>
                </div>
                <div style={{ padding: "10px 20px", overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                    <thead>
                      <tr style={{ borderBottom: `1.5px solid ${t.border}`, color: t.textMuted }}>
                        <th style={{ padding: "12px 8px", textAlign: "left" }}>Name</th>
                        <th style={{ padding: "12px 8px", textAlign: "left" }}>Email</th>
                        <th style={{ padding: "12px 8px", textAlign: "left" }}>Campus</th>
                        <th style={{ padding: "12px 8px", textAlign: "left" }}>Role</th>
                        <th style={{ padding: "12px 8px", textAlign: "left" }}>Status</th>
                        <th style={{ padding: "12px 8px", textAlign: "right" }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredUsers.map((u, i) => (
                        <tr key={i} style={{ borderBottom: `1px solid ${t.border}` }}>
                          <td style={{ padding: "12px 8px", fontWeight: 700 }}>{u.name || u.displayName || "No Name"}</td>
                          <td style={{ padding: "12px 8px" }}>{u.email}</td>
                          <td style={{ padding: "12px 8px", fontWeight: 700, color: t.textSub }}>{u.campusId || "System Global"}</td>
                          <td style={{ padding: "12px 8px" }}>
                            <select 
                              value={u.role || "student"}
                              onChange={e => handleRoleChange(u.id, e.target.value)}
                              style={{
                                background: "transparent",
                                border: `1.5px solid ${t.border}`,
                                borderRadius: "6px",
                                color: t.text,
                                fontSize: "12px",
                                padding: "4px 8px"
                              }}
                            >
                              <option value="admin">Admin</option>
                              <option value="superadmin">Superadmin</option>
                            </select>
                          </td>
                          <td style={{ padding: "12px 8px" }}>
                            <span style={{
                              display: "inline-block",
                              padding: "2px 6px",
                              borderRadius: "4px",
                              fontSize: "10px",
                              fontWeight: 800,
                              background: u.blocked ? "#FEE2E2" : "#D1FAE5",
                              color: u.blocked ? "#991B1B" : "#065F46"
                            }}>
                              {u.blocked ? "BLOCKED" : "ACTIVE"}
                            </span>
                          </td>
                          <td style={{ padding: "12px 8px", textAlign: "right" }}>
                            <button
                              onClick={() => toggleBlockUser(u.id, u.blocked)}
                              style={{
                                background: u.blocked ? "#10B981" : "#EF4444",
                                border: "none",
                                borderRadius: "8px",
                                padding: "6px 12px",
                                color: "#fff",
                                fontWeight: 800,
                                fontSize: "11px",
                                cursor: "pointer",
                                fontFamily: "'Inter', sans-serif"
                              }}
                            >
                              {u.blocked ? "Unblock Account" : "Block User"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Add New Administrator Card */}
              <div style={S.card}>
                <div style={{ padding: "18px 20px", borderBottom: `1.5px solid ${t.border}` }}>
                  <span style={{ fontSize: "13px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "1.5px" }}>➕ Create New Administrator</span>
                </div>
                
                <form onSubmit={handleCreateAdmin} style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <label style={{ fontSize: "11px", fontWeight: 700, color: t.textMuted, textTransform: "uppercase" }}>Full Name</label>
                      <input 
                        type="text" 
                        value={newAdmin.name} 
                        onChange={e => setNewAdmin({ ...newAdmin, name: e.target.value })}
                        placeholder="e.g. Prof. Nair"
                        style={{
                          background: dark ? t.inputBg : "#f7f7f7",
                          border: `1.5px solid ${t.border}`,
                          borderRadius: "8px",
                          padding: "10px 12px",
                          color: t.text,
                          outline: "none",
                          fontSize: "13px"
                        }}
                      />
                    </div>
                    
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <label style={{ fontSize: "11px", fontWeight: 700, color: t.textMuted, textTransform: "uppercase" }}>Email Address</label>
                      <input 
                        type="email" 
                        value={newAdmin.email} 
                        onChange={e => setNewAdmin({ ...newAdmin, email: e.target.value })}
                        placeholder="e.g. nair@campusmove.com"
                        style={{
                          background: dark ? t.inputBg : "#f7f7f7",
                          border: `1.5px solid ${t.border}`,
                          borderRadius: "8px",
                          padding: "10px 12px",
                          color: t.text,
                          outline: "none",
                          fontSize: "13px"
                        }}
                      />
                    </div>
                    
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <label style={{ fontSize: "11px", fontWeight: 700, color: t.textMuted, textTransform: "uppercase" }}>Password</label>
                      <input 
                        type="password" 
                        value={newAdmin.password} 
                        onChange={e => setNewAdmin({ ...newAdmin, password: e.target.value })}
                        placeholder="Min 6 characters"
                        style={{
                          background: dark ? t.inputBg : "#f7f7f7",
                          border: `1.5px solid ${t.border}`,
                          borderRadius: "8px",
                          padding: "10px 12px",
                          color: t.text,
                          outline: "none",
                          fontSize: "13px"
                        }}
                      />
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <label style={{ fontSize: "11px", fontWeight: 700, color: t.textMuted, textTransform: "uppercase" }}>Role Type</label>
                      <select 
                        value={newAdmin.role} 
                        onChange={e => setNewAdmin({ ...newAdmin, role: e.target.value, campusId: e.target.value === "superadmin" ? "alliance-bangalore" : newAdmin.campusId })}
                        style={{
                          background: dark ? t.inputBg : "#f7f7f7",
                          border: `1.5px solid ${t.border}`,
                          borderRadius: "8px",
                          padding: "10px 12px",
                          color: t.text,
                          outline: "none",
                          fontSize: "13px",
                          cursor: "pointer"
                        }}
                      >
                        <option value="admin">Campus Admin</option>
                        <option value="superadmin">Superadmin</option>
                      </select>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <label style={{ fontSize: "11px", fontWeight: 700, color: t.textMuted, textTransform: "uppercase" }}>Campus Association</label>
                      {newAdmin.role === "superadmin" ? (
                        <input 
                          type="text" 
                          value="System Global" 
                          disabled
                          style={{
                            background: dark ? "#222" : "#e0e0e0",
                            border: `1.5px solid ${t.border}`,
                            borderRadius: "8px",
                            padding: "10px 12px",
                            color: t.textMuted,
                            fontSize: "13px",
                            cursor: "not-allowed"
                          }}
                        />
                      ) : (
                        <select 
                          value={newAdmin.campusId} 
                          onChange={e => setNewAdmin({ ...newAdmin, campusId: e.target.value })}
                          style={{
                            background: dark ? t.inputBg : "#f7f7f7",
                            border: `1.5px solid ${t.border}`,
                            borderRadius: "8px",
                            padding: "10px 12px",
                            color: t.text,
                            outline: "none",
                            fontSize: "13px",
                            cursor: "pointer"
                          }}
                        >
                          <option value="">Select Campus</option>
                          {campuses.map(c => (
                            <option key={c.id} value={c.id}>{c.id}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>

                  {adminCreateError && (
                    <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, padding: 10, color: "#DC2626", fontSize: 12, fontWeight: 600 }}>
                      ⚠️ {adminCreateError}
                    </div>
                  )}

                  {adminCreateSuccess && (
                    <div style={{ background: "#ECFDF5", border: "1px solid #A7F3D0", borderRadius: 8, padding: 10, color: "#047857", fontSize: 12, fontWeight: 600 }}>
                      ✓ {adminCreateSuccess}
                    </div>
                  )}

                  <button 
                    type="submit" 
                    disabled={adminCreating}
                    style={{
                      background: t.accent,
                      border: "none",
                      borderRadius: "10px",
                      padding: "12px 24px",
                      color: "#fff",
                      fontWeight: 800,
                      fontSize: "13px",
                      cursor: adminCreating ? "not-allowed" : "pointer",
                      fontFamily: "'Inter', sans-serif",
                      boxShadow: "0 2px 10px rgba(0,0,0,0.05)",
                      marginTop: "10px",
                      alignSelf: "flex-start"
                    }}
                  >
                    {adminCreating ? "Creating Administrator..." : "+ Create Administrator"}
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* TAB 4: PAYMENTS */}
          {tab === "payments" && (
            <div style={S.card}>
              <div style={{ padding: "18px 20px", borderBottom: `1.5px solid ${t.border}` }}>
                <span style={{ fontSize: "13px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "1.5px" }}>💸 Platform Transaction Ledger</span>
              </div>
              <div style={{ padding: "10px 20px", overflowX: "auto" }}>
                {paymentsList.length === 0 ? (
                  <div style={{ padding: "40px 0", textAlign: "center", color: t.textMuted }}>No transaction records registered.</div>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                    <thead>
                      <tr style={{ borderBottom: `1.5px solid ${t.border}`, color: t.textMuted }}>
                        <th style={{ padding: "12px 8px", textAlign: "left" }}>Date</th>
                        <th style={{ padding: "12px 8px", textAlign: "left" }}>Payer Name</th>
                        <th style={{ padding: "12px 8px", textAlign: "left" }}>Campus</th>
                        <th style={{ padding: "12px 8px", textAlign: "left" }}>Plan Details</th>
                        <th style={{ padding: "12px 8px", textAlign: "left" }}>Amount</th>
                        <th style={{ padding: "12px 8px", textAlign: "left" }}>Payment ID</th>
                        <th style={{ padding: "12px 8px", textAlign: "right" }}>Receipt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paymentsList.map((pay, i) => (
                        <tr key={i} style={{ borderBottom: `1px solid ${t.border}` }}>
                          <td style={{ padding: "12px 8px" }}>{new Date(pay.timestamp).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</td>
                          <td style={{ padding: "12px 8px", fontWeight: 700 }}>{pay.customerName || "Razorpay User"}</td>
                          <td style={{ padding: "12px 8px", fontWeight: 800 }}>{pay.campusId}</td>
                          <td style={{ padding: "12px 8px" }}><span style={{ textTransform: "capitalize", fontWeight: 700 }}>{pay.planId}</span> ({pay.billing})</td>
                          <td style={{ padding: "12px 8px", fontWeight: 900 }}>₹{pay.amount?.toLocaleString("en-IN")}</td>
                          <td style={{ padding: "12px 8px", color: t.textMuted }}>{pay.paymentId}</td>
                          <td style={{ padding: "12px 8px", textAlign: "right" }}>
                            <button
                              onClick={() => setSelectedInvoice(pay)}
                              style={{
                                background: dark ? "#333" : "#f5f5f5",
                                border: `1px solid ${t.border}`,
                                borderRadius: "8px",
                                padding: "5px 10px",
                                color: t.text,
                                fontSize: "11px",
                                fontWeight: 700,
                                cursor: "pointer"
                              }}
                            >
                              Invoice
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* TAB: ANNOUNCEMENTS */}
          {tab === "announcements" && (
            <div style={S.card}>
              <div style={{ padding: "18px 20px", borderBottom: `1.5px solid ${t.border}` }}>
                <span style={{ fontSize: "13px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "1.5px" }}>📢 Global Announcement Broadcast</span>
              </div>
              <form onSubmit={handleSaveAnnouncement} style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <label style={{ fontSize: "11px", fontWeight: 700, color: t.textMuted, textTransform: "uppercase" }}>Broadcast Message</label>
                  <textarea 
                    value={announcement.message}
                    onChange={e => setAnnouncement({ ...announcement, message: e.target.value })}
                    placeholder="Enter broadcast message here..."
                    rows={4}
                    style={{
                      background: dark ? t.inputBg : "#f7f7f7",
                      border: `1.5px solid ${t.border}`,
                      borderRadius: "8px",
                      padding: "10px 12px",
                      color: t.text,
                      outline: "none",
                      fontSize: "13px",
                      fontFamily: "inherit",
                      resize: "vertical"
                    }}
                  />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "16px" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <label style={{ fontSize: "11px", fontWeight: 700, color: t.textMuted, textTransform: "uppercase" }}>Alert Type Style</label>
                    <select 
                      value={announcement.type}
                      onChange={e => setAnnouncement({ ...announcement, type: e.target.value })}
                      style={{
                        background: dark ? t.inputBg : "#f7f7f7",
                        border: `1.5px solid ${t.border}`,
                        borderRadius: "8px",
                        padding: "10px 12px",
                        color: t.text,
                        outline: "none",
                        fontSize: "13px",
                        cursor: "pointer"
                      }}
                    >
                      <option value="info">🔵 Information (Blue)</option>
                      <option value="warning">🟡 Warning (Amber)</option>
                      <option value="success">🟢 Success (Green)</option>
                    </select>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <label style={{ fontSize: "11px", fontWeight: 700, color: t.textMuted, textTransform: "uppercase" }}>Broadcast Status</label>
                    <select 
                      value={announcement.active ? "true" : "false"}
                      onChange={e => setAnnouncement({ ...announcement, active: e.target.value === "true" })}
                      style={{
                        background: dark ? t.inputBg : "#f7f7f7",
                        border: `1.5px solid ${t.border}`,
                        borderRadius: "8px",
                        padding: "10px 12px",
                        color: t.text,
                        outline: "none",
                        fontSize: "13px",
                        cursor: "pointer"
                      }}
                    >
                      <option value="false">❌ Draft (Hidden)</option>
                      <option value="true">🟢 Active (Live Announcement)</option>
                    </select>
                  </div>
                </div>

                {announcementSuccess && (
                  <div style={{ background: "#ECFDF5", border: "1px solid #A7F3D0", borderRadius: 8, padding: 10, color: "#047857", fontSize: 12, fontWeight: 600 }}>
                    ✓ {announcementSuccess}
                  </div>
                )}

                <button 
                  type="submit" 
                  disabled={savingAnnouncement}
                  style={{
                    background: t.accent,
                    border: "none",
                    borderRadius: "10px",
                    padding: "12px 24px",
                    color: "#fff",
                    fontWeight: 800,
                    fontSize: "13px",
                    cursor: savingAnnouncement ? "not-allowed" : "pointer",
                    fontFamily: "'Inter', sans-serif",
                    marginTop: "10px",
                    alignSelf: "flex-start"
                  }}
                >
                  {savingAnnouncement ? "Saving Broadcast Settings..." : "Save Announcement Settings"}
                </button>
              </form>
            </div>
          )}

          {/* TAB: SYSTEM LOGS */}
          {tab === "logs" && (
            <div style={S.card}>
              <div style={{ padding: "18px 20px", borderBottom: `1.5px solid ${t.border}` }}>
                <span style={{ fontSize: "13px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "1.5px" }}>📜 Global Activity Logs</span>
              </div>
              <div style={{ padding: "10px 20px", overflowX: "auto" }}>
                {logsList.length === 0 ? (
                  <div style={{ padding: "40px 0", textAlign: "center", color: t.textMuted }}>No system logs registered. Perform administrative actions to test logs.</div>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                    <thead>
                      <tr style={{ borderBottom: `1.5px solid ${t.border}`, color: t.textMuted }}>
                        <th style={{ padding: "12px 8px", textAlign: "left" }}>Timestamp</th>
                        <th style={{ padding: "12px 8px", textAlign: "left" }}>Campus</th>
                        <th style={{ padding: "12px 8px", textAlign: "left" }}>Action</th>
                        <th style={{ padding: "12px 8px", textAlign: "left" }}>Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logsList.map((log, i) => (
                        <tr key={i} style={{ borderBottom: `1px solid ${t.border}` }}>
                          <td style={{ padding: "12px 8px", color: t.textHint }}>{new Date(log.timestamp).toLocaleString()}</td>
                          <td style={{ padding: "12px 8px", fontWeight: 700, color: t.textSub }}>{log.campusId.toUpperCase()}</td>
                          <td style={{ padding: "12px 8px" }}>
                            <span style={{
                              display: "inline-block",
                              padding: "2px 6px",
                              borderRadius: "4px",
                              fontSize: "10px",
                              fontWeight: 800,
                              background: log.action.includes("Error") || log.action.includes("Failed") || log.action.includes("Terminated") ? "#FEE2E2" : "#E0F2FE",
                              color: log.action.includes("Error") || log.action.includes("Failed") || log.action.includes("Terminated") ? "#991B1B" : "#0369A1"
                            }}>
                              {log.action}
                            </span>
                          </td>
                          <td style={{ padding: "12px 8px", color: t.text }}>{log.details}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* MODAL 1: PLAN OVERRIDE */}
      {editingCampus && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(0,0,0,0.6)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 9999,
          padding: 20,
          backdropFilter: "blur(4px)"
        }}>
          <div style={{
            background: dark ? "#1E1E24" : "#FFFFFF",
            border: `1.5px solid ${t.border}`,
            borderRadius: "16px",
            width: "100%",
            maxWidth: "460px",
            boxShadow: "0 20px 50px rgba(0,0,0,0.3)",
            overflow: "hidden"
          }}>
            <div style={{ padding: "20px 24px", borderBottom: `1.5px solid ${t.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "15px", fontWeight: 800 }}>🛠️ Modify Subscription ({editingCampus.id})</span>
              <button onClick={() => setEditingCampus(null)} style={{ background: "none", border: "none", color: t.textMuted, fontSize: "18px", cursor: "pointer" }}>✕</button>
            </div>
            
            <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "16px" }}>
              {/* Select Plan */}
              <div>
                <label style={{ display: "block", fontSize: "11px", fontWeight: 800, textTransform: "uppercase", color: t.textMuted, marginBottom: "6px" }}>Plan Level</label>
                <select 
                  value={overridePlan} 
                  onChange={e => setOverridePlan(e.target.value)}
                  style={{
                    width: "100%",
                    background: dark ? t.inputBg : "#f7f7f7",
                    border: `1.5px solid ${t.border}`,
                    borderRadius: "10px",
                    padding: "10px 14px",
                    color: t.text
                  }}
                >
                  <option value="basic">Basic (🚌 ₹5,000 / mo)</option>
                  <option value="premium">Premium (🚀 ₹12,000 / mo)</option>
                </select>
              </div>

              {/* Select Billing */}
              <div>
                <label style={{ display: "block", fontSize: "11px", fontWeight: 800, textTransform: "uppercase", color: t.textMuted, marginBottom: "6px" }}>Billing Cycle</label>
                <select 
                  value={overrideBilling} 
                  onChange={e => setOverrideBilling(e.target.value)}
                  style={{
                    width: "100%",
                    background: dark ? t.inputBg : "#f7f7f7",
                    border: `1.5px solid ${t.border}`,
                    borderRadius: "10px",
                    padding: "10px 14px",
                    color: t.text
                  }}
                >
                  <option value="monthly">Monthly Cycle</option>
                  <option value="yearly">Yearly Cycle</option>
                </select>
              </div>

              {/* Select Status */}
              <div>
                <label style={{ display: "block", fontSize: "11px", fontWeight: 800, textTransform: "uppercase", color: t.textMuted, marginBottom: "6px" }}>Access Status</label>
                <select 
                  value={overrideStatus} 
                  onChange={e => setOverrideStatus(e.target.value)}
                  style={{
                    width: "100%",
                    background: dark ? t.inputBg : "#f7f7f7",
                    border: `1.5px solid ${t.border}`,
                    borderRadius: "10px",
                    padding: "10px 14px",
                    color: t.text
                  }}
                >
                  <option value="active">Active Access</option>
                  <option value="trial">Free Trial Mode</option>
                  <option value="expired">Expired</option>
                </select>
              </div>

              {/* Set months duration */}
              <div>
                <label style={{ display: "block", fontSize: "11px", fontWeight: 800, textTransform: "uppercase", color: t.textMuted, marginBottom: "6px" }}>Subscription Extension (Months)</label>
                <input 
                  type="number" 
                  value={overrideMonths} 
                  onChange={e => setOverrideMonths(parseInt(e.target.value, 10) || 1)}
                  min="1"
                  max="60"
                  style={{
                    width: "100%",
                    background: dark ? t.inputBg : "#f7f7f7",
                    border: `1.5px solid ${t.border}`,
                    borderRadius: "10px",
                    padding: "10px 14px",
                    color: t.text,
                    boxSizing: "border-box"
                  }}
                />
              </div>

              {/* Action Buttons */}
              <div style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
                <button
                  onClick={() => setEditingCampus(null)}
                  style={{
                    flex: 1,
                    background: "transparent",
                    border: `1.5px solid ${t.border}`,
                    borderRadius: "10px",
                    padding: "12px 0",
                    color: t.text,
                    fontWeight: 700,
                    cursor: "pointer"
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveOverride}
                  disabled={overrideSaving}
                  style={{
                    flex: 1,
                    background: PLANS[overridePlan]?.color || t.accent,
                    border: "none",
                    borderRadius: "10px",
                    padding: "12px 0",
                    color: "#fff",
                    fontWeight: 800,
                    cursor: "pointer"
                  }}
                >
                  {overrideSaving ? "Saving..." : "Save Override"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: VIEW INVOICE */}
      {selectedInvoice && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(0,0,0,0.6)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 9999,
          padding: 20,
          backdropFilter: "blur(4px)"
        }}>
          <div style={{
            background: dark ? "#1E1E24" : "#FFFFFF",
            border: `1.5px solid ${t.border}`,
            borderRadius: 16,
            width: "100%",
            maxWidth: 500,
            boxShadow: "0 20px 50px rgba(0,0,0,0.3)",
            overflow: "hidden"
          }}>
            {/* Header */}
            <div style={{
              background: `linear-gradient(135deg, ${PLANS[selectedInvoice.planId]?.color || t.accent}, ${dark ? "#111" : "#FF7B47"})`,
              padding: "24px",
              color: "#fff",
              position: "relative"
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: "-0.5px" }}>CampusMove Platform Invoice</div>
                  <div style={{ fontSize: 11, opacity: 0.8, marginTop: 4 }}>ID: {selectedInvoice.paymentId}</div>
                </div>
                <button 
                  onClick={() => setSelectedInvoice(null)}
                  style={{
                    background: "rgba(255,255,255,0.2)",
                    border: "none",
                    borderRadius: "50%",
                    width: 32,
                    height: 32,
                    color: "#fff",
                    fontSize: 16,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center"
                  }}
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Invoice Details */}
            <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: 18 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, borderBottom: `1.5px solid ${t.border}`, paddingBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 10, color: t.textMuted, fontWeight: 700, textTransform: "uppercase" }}>Campus Client</div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: t.text, marginTop: 4 }}>{selectedInvoice.campusId}</div>
                  <div style={{ fontSize: 11, color: t.textSub, marginTop: 2 }}>Payer: {selectedInvoice.customerName}</div>
                  <div style={{ fontSize: 11, color: t.textMuted }}>{selectedInvoice.customerEmail}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 10, color: t.textMuted, fontWeight: 700, textTransform: "uppercase" }}>Date Settled</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: t.text, marginTop: 4 }}>
                    {new Date(selectedInvoice.timestamp).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </div>
                  <div style={{ display: "inline-block", fontSize: 10, background: "#D1FAE5", color: "#065F46", fontWeight: 800, padding: "2px 8px", borderRadius: 6, marginTop: 6 }}>
                    SETTLED SUCCESS ✓
                  </div>
                </div>
              </div>

              {/* Itemized */}
              <div>
                <div style={{ fontSize: 10, color: t.textMuted, fontWeight: 700, textTransform: "uppercase", marginBottom: 8 }}>Details</div>
                <div style={{ background: dark ? t.inputBg : t.bgCard2, border: `1.5px solid ${t.border}`, borderRadius: 10, padding: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: t.text, fontWeight: 700 }}>
                    <span>{PLANS[selectedInvoice.planId]?.name || selectedInvoice.planId} Subscription</span>
                    <span>₹{selectedInvoice.amount?.toLocaleString("en-IN")}</span>
                  </div>
                  <div style={{ fontSize: 11, color: t.textMuted, marginTop: 4 }}>
                    Cycle: {selectedInvoice.billing === "yearly" ? "Yearly billing" : "Monthly billing"}
                  </div>
                </div>
              </div>

              {/* Total calculation */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: `1.5px solid ${t.border}`, paddingTop: 16, marginTop: 10 }}>
                <span style={{ fontSize: 14, fontWeight: 800, color: t.text }}>Grand Total</span>
                <span style={{ fontSize: 20, fontWeight: 900, color: PLANS[selectedInvoice.planId]?.color || t.accent }}>₹{selectedInvoice.amount?.toLocaleString("en-IN")}</span>
              </div>

              {/* Action buttons */}
              <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
                <button 
                  onClick={() => window.print()}
                  style={{
                    flex: 1,
                    background: "transparent",
                    border: `1.5px solid ${t.border}`,
                    borderRadius: 10,
                    padding: "12px 0",
                    color: t.text,
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "'Inter',sans-serif"
                  }}
                >
                  🖨 Print Invoice
                </button>
                <button 
                  onClick={() => setSelectedInvoice(null)}
                  style={{
                    flex: 1,
                    background: PLANS[selectedInvoice.planId]?.color || t.accent,
                    border: "none",
                    borderRadius: 10,
                    padding: "12px 0",
                    color: "#fff",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "'Inter',sans-serif"
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
