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
    }, err => {
      console.warn("Global announcement read permission restricted:", err);
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

  const navItems = [
    {
      id: "overview",
      label: "Overview",
      icon: (color) => (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "stroke 0.2s" }}>
          <rect x="3" y="3" width="7" height="9" rx="1"></rect>
          <rect x="14" y="3" width="7" height="5" rx="1"></rect>
          <rect x="14" y="12" width="7" height="9" rx="1"></rect>
          <rect x="3" y="16" width="7" height="5" rx="1"></rect>
        </svg>
      )
    },
    {
      id: "campuses",
      label: "Campuses & Plans",
      icon: (color) => (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "stroke 0.2s" }}>
          <path d="M3 21h18M3 7v1a3 3 0 0 0 6 0V7m0 1a3 3 0 0 0 6 0V7m0 1a3 3 0 0 0 6 0V7M4 21V10m16 11V10m-8 11V14m0-4h.01" />
        </svg>
      )
    },
    {
      id: "users",
      label: "Global Users",
      icon: (color) => (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "stroke 0.2s" }}>
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
          <circle cx="9" cy="7" r="4"></circle>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
          <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
        </svg>
      )
    },
    {
      id: "announcements",
      label: "Broadcast",
      icon: (color) => (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "stroke 0.2s" }}>
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
      )
    },
    {
      id: "logs",
      label: "System Logs",
      icon: (color) => (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "stroke 0.2s" }}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
      )
    },
    {
      id: "payments",
      label: "Transactions",
      icon: (color) => (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "stroke 0.2s" }}>
          <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
          <line x1="1" y1="10" x2="23" y2="10"></line>
        </svg>
      )
    }
  ];

  // Theme-based Styles
  const S = {
    screen: { minHeight: "100vh", background: t.bg, fontFamily: "'Inter', sans-serif", color: t.text, display: "flex", flexDirection: "column", transition: "background 0.25s, color 0.25s" },
    sidebar: { 
      background: dark ? "rgba(20, 20, 26, 0.65)" : "rgba(255, 255, 255, 0.75)", 
      backdropFilter: "blur(20px)",
      WebkitBackdropFilter: "blur(20px)",
      borderRight: `1.5px solid ${dark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.05)"}`, 
      border: `1.5px solid ${dark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.05)"}`,
      borderRadius: "20px",
      flexDirection: "column", 
      padding: "24px 20px", 
      width: "260px", 
      margin: "16px 0 16px 16px",
      flexShrink: 0,
      boxShadow: dark ? "0 10px 40px rgba(0,0,0,0.35)" : "0 10px 40px rgba(0,0,0,0.03)",
      transition: "all 0.3s ease"
    },
    topbar: { 
      background: dark ? "rgba(16, 16, 22, 0.8)" : "rgba(255, 255, 255, 0.85)", 
      backdropFilter: "blur(16px)",
      WebkitBackdropFilter: "blur(16px)",
      borderBottom: `1.5px solid ${t.border}`, 
      alignItems: "center", 
      justifyContent: "space-between", 
      padding: "14px 20px", 
      height: "64px",
      position: "sticky",
      top: 0,
      zIndex: 90
    },
    content: { flex: 1, padding: "28px 32px 60px", maxWidth: "1200px", margin: "0 auto", width: "100%", boxSizing: "border-box" },
    tabBtn: (active) => ({ 
      display: "flex", 
      alignItems: "center", 
      gap: 12, 
      width: "100%", 
      padding: "12px 16px", 
      border: "none", 
      borderRadius: 12, 
      background: active ? (dark ? "rgba(124, 58, 237, 0.12)" : "#F3E8FF") : "transparent", 
      cursor: "pointer", 
      color: active ? t.accent : t.textMuted, 
      fontSize: 14, 
      fontWeight: active ? 700 : 500, 
      textAlign: "left", 
      transition: "all 0.25s ease", 
      borderLeft: active ? `3px solid ${t.accent}` : "3px solid transparent", 
      fontFamily: "'Inter', sans-serif" 
    }),
    addBtn: { width: "100%", background: t.accent, border: "none", borderRadius: 10, padding: "14px 0", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "'Inter', sans-serif", transition: "all 0.2s", boxShadow: `0 4px 12px ${t.accent}33` },
    card: {
      background: dark ? "rgba(30, 30, 40, 0.45)" : "rgba(255, 255, 255, 0.65)",
      backdropFilter: "blur(10px)",
      WebkitBackdropFilter: "blur(10px)",
      border: `1.5px solid ${dark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.05)"}`,
      borderRadius: "16px",
      boxShadow: dark ? "0 10px 30px rgba(0,0,0,0.2)" : "0 8px 30px rgba(0,0,0,0.02)",
      overflow: "hidden",
      transition: "all 0.25s ease"
    },
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
    <div style={S.screen}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
        input:focus, select:focus { border-color:${t.accent} !important; box-shadow:0 0 0 3px ${t.accent}15 !important; }
        .add-btn:active { transform: scale(0.98); }
        .custom-row:hover { background: ${dark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.015)"}; }
        
        /* Premium Sidebar Button Hover Lift */
        .sidebar-panel button {
          transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1) !important;
        }
        .sidebar-panel button:hover {
          transform: translateX(4px);
          background: ${dark ? "rgba(255, 255, 255, 0.04)" : "rgba(0, 0, 0, 0.02)"} !important;
        }

        /* Sidebar Responsive Layout */
        .superadmin-desktop-container {
          display: flex;
          flex: 1;
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
          background: ${t.bg};
        }
        .sidebar-panel {
          display: flex;
        }
        .topbar-panel {
          display: none;
        }

        .content-container {
          flex: 1;
          padding: 28px 32px 60px;
          max-width: 1200px;
          margin: 0 auto;
          width: 100%;
          box-sizing: border-box;
        }

        /* KPI Grid CSS */
        .kpi-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 20px;
          align-items: start;
        }
        
        @media (max-width: 1024px) {
          .kpi-grid {
            grid-template-columns: repeat(2, 1fr);
            gap: 16px;
          }
          .content-container {
            padding: 20px 24px 50px;
          }
        }
        @media (max-width: 768px) {
          .superadmin-desktop-container {
            flex-direction: column;
          }
          .sidebar-panel {
            display: none !important;
          }
          .topbar-panel {
            display: flex !important;
          }
          .content-container {
            padding: 16px 16px 40px;
          }
        }
        @media (max-width: 480px) {
          .kpi-grid {
            grid-template-columns: repeat(2, 1fr);
            gap: 10px;
          }
          .kpi-card {
            padding: 16px 14px !important;
          }
          .kpi-title {
            font-size: 10px !important;
            letter-spacing: 0.2px !important;
          }
          .kpi-value {
            font-size: 24px !important;
            margin-top: 6px !important;
          }
        }
      `}</style>

      <div className="superadmin-desktop-container">
        {/* ── DESKTOP SIDEBAR ── */}
        <div className="sidebar-panel" style={S.sidebar}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 32 }}>
            <div style={{ width: 34, height: 34, background: t.accent, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🛠️</div>
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: "-0.5px", color: t.text }}>CampusMove</span>
              <div style={{ fontSize: 9, color: t.textMuted, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", marginTop: 2 }}>
                Super Admin
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
            {navItems.map(item => {
              const active = tab === item.id;
              const currentColor = active ? t.accent : t.textMuted;
              return (
                <button 
                  key={item.id} 
                  style={S.tabBtn(active)} 
                  onClick={() => setTab(item.id)}
                >
                  {item.icon(currentColor)}
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          <div style={{ borderTop: `1.5px solid ${t.border}`, paddingTop: 20, marginTop: 20 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, padding: "0 4px" }}>
              <span style={{ fontSize: 12, color: t.textMuted, fontWeight: 600 }}>Theme Mode</span>
              <button onClick={toggle} style={{ width: 34, height: 34, borderRadius: 10, border: `1.5px solid ${t.border}`, background: t.bgCard, cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s" }}>
                {dark ? "☀️" : "🌙"}
              </button>
            </div>

            <button onClick={logout} style={{ ...S.addBtn, background: "transparent", border: `1.5px solid ${t.border}`, padding: "10px 0", fontSize: 12, color: t.textMuted, boxShadow: "none" }}>
              ↩ Log Out
            </button>
          </div>
        </div>

        {/* ── MOBILE HEADER (HIDDEN ON DESKTOP) ── */}
        <div className="topbar-panel" style={S.topbar}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 28, height: 28, background: t.accent, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>🛠️</div>
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: 14, fontWeight: 800, color: t.text }}>CampusMove</span>
              <span style={{ fontSize: 9, color: t.textMuted, marginLeft: 6, fontWeight: 700, textTransform: "uppercase" }}>Super Admin</span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={toggle} style={{ width: 30, height: 30, borderRadius: 8, border: `1.5px solid ${t.border}`, background: t.bgCard, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s" }}>
              {dark ? "☀️" : "🌙"}
            </button>
            <button onClick={logout} style={{ background: "none", border: `1.5px solid ${t.border}`, borderRadius: 8, padding: "4px 10px", color: t.textMuted, fontSize: 11, cursor: "pointer", fontFamily: "'Inter', sans-serif" }}>
              Log Out
            </button>
          </div>
        </div>

        {/* ── MOBILE TABS (HIDDEN ON DESKTOP) ── */}
        <div className="topbar-panel hide-scrollbar" style={{ background: t.bgCard, borderBottom: `1.5px solid ${t.border}`, padding: "8px 12px", overflowX: "auto", whiteSpace: "nowrap" }}>
          <div style={{ display: "flex", gap: 4, width: "100%" }}>
            {navItems.map(item => {
              const active = tab === item.id;
              return (
                <button 
                  key={item.id} 
                  style={{
                    flex: 1,
                    padding: "8px 12px",
                    border: "none",
                    borderRadius: 8,
                    background: active ? (dark ? "#1F2937" : "#EFF6FF") : "transparent",
                    color: active ? t.accent : t.textMuted,
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "'Inter', sans-serif",
                    transition: "all 0.2s",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 4
                  }} 
                  onClick={() => setTab(item.id)}
                >
                  {item.icon(active ? t.accent : t.textMuted)}
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── CONTENT CONTAINER ── */}
        <div className="content-container">
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
          {tab === "overview" && (
            <div className="animate-slide-up" style={{ display: "flex", flexDirection: "column", gap: "28px" }}>
              {/* KPI Cards Grid */}
              <div className="kpi-grid">
                {/* KPI Card 1: Revenue */}
                <div className="kpi-card hover-lift" style={{ ...S.card, borderTop: "4px solid #10B981", padding: "24px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div className="kpi-title" style={{ fontSize: "11px", color: t.textMuted, fontWeight: 800, textTransform: "uppercase", letterSpacing: "1px" }}>Total Earnings</div>
                    <span style={{ fontSize: 18, color: "#10B981" }}>💰</span>
                  </div>
                  <div className="kpi-value" style={{ fontSize: "32px", fontWeight: 900, marginTop: "12px", color: "#10B981", letterSpacing: "-1px" }}>₹{totalRevenue.toLocaleString("en-IN")}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: "8px", fontSize: "11px" }}>
                    <span style={{ color: "#10B981", fontWeight: 800 }}>↑ +14.2%</span>
                    <span style={{ color: t.textMuted }}>vs last month</span>
                  </div>
                </div>
                
                {/* KPI Card 2: Active Subs */}
                <div className="kpi-card hover-lift" style={{ ...S.card, borderTop: "4px solid #8B5CF6", padding: "24px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div className="kpi-title" style={{ fontSize: "11px", color: t.textMuted, fontWeight: 800, textTransform: "uppercase", letterSpacing: "1px" }}>Active Subs</div>
                    <span style={{ fontSize: 18, color: "#8B5CF6" }}>🏫</span>
                  </div>
                  <div className="kpi-value" style={{ fontSize: "32px", fontWeight: 900, marginTop: "12px", color: t.accent, letterSpacing: "-1px" }}>{activeCampusesCount}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: "8px", fontSize: "11px" }}>
                    <span style={{ color: "#8B5CF6", fontWeight: 800 }}>Live portals</span>
                  </div>
                </div>
                
                {/* KPI Card 3: Expired */}
                <div className="kpi-card hover-lift" style={{ ...S.card, borderTop: "4px solid #EF4444", padding: "24px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div className="kpi-title" style={{ fontSize: "11px", color: t.textMuted, fontWeight: 800, textTransform: "uppercase", letterSpacing: "1px" }}>Expired Portals</div>
                    <span style={{ fontSize: 18, color: "#EF4444" }}>⏱️</span>
                  </div>
                  <div className="kpi-value" style={{ fontSize: "32px", fontWeight: 900, marginTop: "12px", color: "#EF4444", letterSpacing: "-1px" }}>{expiredCampusesCount}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: "8px", fontSize: "11px" }}>
                    <span style={{ color: "#EF4444", fontWeight: 800 }}>Need renewals</span>
                  </div>
                </div>
                
                {/* KPI Card 4: Global Users */}
                <div className="kpi-card hover-lift" style={{ ...S.card, borderTop: "4px solid #F59E0B", padding: "24px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div className="kpi-title" style={{ fontSize: "11px", color: t.textMuted, fontWeight: 800, textTransform: "uppercase", letterSpacing: "1px" }}>Global Users</div>
                    <span style={{ fontSize: 18, color: "#F59E0B" }}>👥</span>
                  </div>
                  <div className="kpi-value" style={{ fontSize: "32px", fontWeight: 900, marginTop: "12px", color: t.text, letterSpacing: "-1px" }}>{globalUsersCount}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: "8px", fontSize: "11px" }}>
                    <span style={{ color: "#F59E0B", fontWeight: 800 }}>Active members</span>
                  </div>
                </div>
              </div>

              {/* Detailed Breakdown for Mobile/Desktop */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "20px" }}>
                {/* Active & Expired Subscription Center */}
                <div style={{ ...S.card, padding: "20px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1.5px solid ${t.border}`, paddingBottom: 10, marginBottom: 12 }}>
                    <span style={{ fontSize: "12px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "1px", color: t.text }}>🏫 Subscription Alert Center</span>
                    <span style={{ fontSize: "10px", padding: "2px 6px", borderRadius: 4, background: dark ? "rgba(139,92,246,0.15)" : "#F3E8FF", color: t.accent, fontWeight: 700 }}>
                      {activeCampusesCount} Active / {expiredCampusesCount} Expired
                    </span>
                  </div>
                  
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {campuses.map(c => {
                      const expired = (c.expiryDate || 0) <= Date.now() || c.status === "expired";
                      const days = Math.max(0, Math.ceil(((c.expiryDate || 0) - Date.now()) / (24 * 60 * 60 * 1000)));
                      return (
                        <div key={c.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "12px", padding: "4px 0" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 14 }}>{expired ? "🛑" : "🟢"}</span>
                            <span style={{ fontWeight: 700, color: t.text }}>{c.id}</span>
                          </div>
                          <div>
                            {expired ? (
                              <span style={{ fontSize: "10px", color: "#EF4444", fontWeight: 800, textTransform: "uppercase" }}>Expired</span>
                            ) : (
                              <span style={{
                                padding: "3px 8px",
                                borderRadius: 12,
                                fontSize: "10px",
                                background: days <= 10 ? "rgba(239, 68, 68, 0.12)" : "rgba(16, 185, 129, 0.12)",
                                color: days <= 10 ? "#EF4444" : "#10B981",
                                fontWeight: 800
                              }}>
                                {days} days left
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {campuses.length === 0 && (
                      <div style={{ textAlign: "center", color: t.textMuted, fontSize: "12px", padding: "20px 0" }}>
                        No campus portals registered.
                      </div>
                    )}
                  </div>
                </div>

                {/* Global Members Breakdown */}
                <div style={{ ...S.card, padding: "20px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1.5px solid ${t.border}`, paddingBottom: 10, marginBottom: 12 }}>
                    <span style={{ fontSize: "12px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "1px", color: t.text }}>👥 Platform User Breakdown</span>
                    <span style={{ fontSize: "10px", padding: "2px 6px", borderRadius: 4, background: dark ? "rgba(245,158,11,0.15)" : "#FEF3C7", color: "#D97706", fontWeight: 700 }}>
                      {globalUsersCount} Total
                    </span>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {[
                      ["Students", usersList.filter(u => u.role === "student").length, "🎓", "#3B82F6", "rgba(59,130,246,0.1)"],
                      ["Faculty", usersList.filter(u => u.role === "teacher").length, "🧑‍🏫", "#10B981", "rgba(16,185,129,0.1)"],
                      ["Drivers", usersList.filter(u => u.role === "driver").length, "🚌", "#F59E0B", "rgba(245,158,11,0.1)"]
                    ].map(([label, count, emoji, color, bg]) => (
                      <div key={label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderRadius: "12px", background: dark ? "rgba(255,255,255,0.02)" : "#F8FAFC", border: `1.5px solid ${t.border}` }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{
                            width: 32,
                            height: 32,
                            borderRadius: "50%",
                            background: bg,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 15
                          }}>
                            {emoji}
                          </span>
                          <span style={{ fontSize: "13px", fontWeight: 700, color: t.textSub }}>{label}</span>
                        </div>
                        <span style={{ fontSize: "16px", fontWeight: 900, color: color }}>{count}</span>
                      </div>
                    ))}
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
                  <div className="chart-grid" style={{ ...S.card, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", overflow: "hidden" }}>
                    <style>{`
                      @media (max-width: 640px) {
                        .chart-left {
                          border-right: none !important;
                          border-bottom: 1.5px solid ${t.border} !important;
                        }
                      }
                    `}</style>
                    {/* Left: The SVG Chart */}
                    <div className="chart-left" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "10px", borderRight: `1.5px solid ${t.border}` }}>
                      <span style={{ fontSize: "12px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "1.5px", color: t.textMuted }}>💸 Platform Revenue & Subscription Trends</span>
                      
                      <div style={{ position: "relative", flex: 1, minHeight: "160px", marginTop: "14px" }}>
                        <svg viewBox="0 0 460 160" style={{ width: "100%", height: "100%", overflow: "visible" }}>
                          <defs>
                            <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#10B981" stopOpacity={dark ? 0.2 : 0.1} />
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
                                r={hoveredChartIndex === idx ? "6" : "4.5"} 
                                fill={hoveredChartIndex === idx ? "#10B981" : t.bgCard} 
                                stroke="#10B981" 
                                strokeWidth="2.5" 
                                style={{ transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)" }}
                              />
                              <circle 
                                cx={p.x} 
                                cy={p.y} 
                                r="18" 
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
                    <div style={{ padding: "24px", display: "flex", flexDirection: "column", justifyContent: "center", background: dark ? "rgba(255,255,255,0.01)" : "rgba(0,0,0,0.005)", gap: "18px" }}>
                      <div>
                        <div style={{ fontSize: "11px", color: t.textMuted, fontWeight: 800, textTransform: "uppercase", letterSpacing: "1px" }}>Selected Month</div>
                        <div style={{ fontSize: "20px", fontWeight: 900, color: t.text, marginTop: "4px", letterSpacing: "-0.5px" }}>{activeHover ? activeHover.label : "N/A"}</div>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                        <div style={{ padding: "12px 14px", background: dark ? "rgba(20,20,25,0.3)" : t.bgCard, border: `1.5px solid ${t.border}`, borderRadius: "12px" }}>
                          <span style={{ fontSize: "9px", color: t.textMuted, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.5px" }}>Revenue</span>
                          <span style={{ fontSize: "18px", fontWeight: 900, color: "#10B981", marginTop: "4px", display: "block" }}>
                            ₹{activeHover ? activeHover.revenue.toLocaleString("en-IN") : "0"}
                          </span>
                        </div>
                        
                        <div style={{ padding: "12px 14px", background: dark ? "rgba(20,20,25,0.3)" : t.bgCard, border: `1.5px solid ${t.border}`, borderRadius: "12px" }}>
                          <span style={{ fontSize: "9px", color: t.textMuted, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.5px" }}>Subscriptions</span>
                          <span style={{ fontSize: "18px", fontWeight: 900, color: t.accent, marginTop: "4px", display: "block" }}>
                            {activeHover ? activeHover.subscribers : "0"} bills
                          </span>
                        </div>
                      </div>

                      <div style={{ borderTop: `1.5px solid ${t.border}`, paddingTop: "14px", fontSize: "11px", color: t.textMuted, lineHeight: "1.5", display: "flex", flexDirection: "column", gap: 6 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#10B981", display: "inline-block" }} />
                          <span>Green line indicates monthly recurring revenue.</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ width: 8, height: 8, borderRadius: "50%", background: t.accent, display: "inline-block" }} />
                          <span>Purple line indicates billing transactions.</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Campus Usage & Engagement Stats Card */}
              <div style={S.card}>
                <div style={{ padding: "18px 24px", borderBottom: `1.5px solid ${t.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "13px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "1.5px" }}>🏫 Campus Engagement & Usage Metrics</span>
                </div>
                <div style={{ padding: "10px 24px", overflowX: "auto" }}>
                  {campusStats.length === 0 ? (
                    <div style={{ padding: "30px 0", textAlign: "center", color: t.textMuted }}>No campus records available.</div>
                  ) : (
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                      <thead>
                        <tr style={{ borderBottom: `1.5px solid ${t.border}`, color: t.textMuted }}>
                          <th style={{ padding: "14px 8px", textAlign: "left", fontWeight: 700 }}>Campus ID</th>
                          <th style={{ padding: "14px 8px", textAlign: "left", fontWeight: 700 }}>Active Plan</th>
                          <th style={{ padding: "14px 8px", textAlign: "center", fontWeight: 700 }}>Students</th>
                          <th style={{ padding: "14px 8px", textAlign: "center", fontWeight: 700 }}>Faculty</th>
                          <th style={{ padding: "14px 8px", textAlign: "center", fontWeight: 700 }}>Drivers</th>
                          <th style={{ padding: "14px 8px", textAlign: "center", fontWeight: 700 }}>Active Buses</th>
                          <th style={{ padding: "14px 8px", textAlign: "right", fontWeight: 700 }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {campusStats.map((stat, i) => {
                          const isActive = stat.status === "active" && (stat.expiryDate || 0) > Date.now();
                          const initialLetters = stat.id ? stat.id.split("-").map(w => w[0]).join("").toUpperCase().slice(0, 2) : "CP";
                          return (
                            <tr key={i} className="custom-row" style={{ borderBottom: `1px solid ${t.border}`, transition: "background 0.2s" }}>
                              <td style={{ padding: "14px 8px", fontWeight: 700 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                  <div style={{
                                    width: 32,
                                    height: 32,
                                    borderRadius: "50%",
                                    background: dark ? "rgba(124,58,237,0.15)" : "#F3E8FF",
                                    color: t.accent,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    fontSize: 11,
                                    fontWeight: 800
                                  }}>
                                    {initialLetters}
                                  </div>
                                  <span style={{ color: t.text }}>{stat.id}</span>
                                </div>
                              </td>
                              <td style={{ padding: "14px 8px" }}>
                                <span style={{
                                  display: "inline-block",
                                  padding: "3px 10px",
                                  borderRadius: 20,
                                  fontSize: 10,
                                  fontWeight: 800,
                                  textTransform: "uppercase",
                                  background: stat.plan === "premium" ? (dark ? "rgba(139,92,246,0.12)" : "#F5F3FF") : (dark ? "rgba(251,146,60,0.12)" : "#FFF7ED"),
                                  color: stat.plan === "premium" ? "#8B5CF6" : "#FF5A1F",
                                  border: `1.5px solid ${stat.plan === "premium" ? (dark ? "rgba(139,92,246,0.2)" : "#DDD6FE") : (dark ? "rgba(251,146,60,0.2)" : "#FFD8A8")}`
                                }}>
                                  {stat.plan === "premium" ? "🚀 Premium" : "🚌 Basic"}
                                </span>
                              </td>
                              <td style={{ padding: "14px 8px", textAlign: "center", fontWeight: 600 }}>{stat.students}</td>
                              <td style={{ padding: "14px 8px", textAlign: "center", fontWeight: 600 }}>{stat.teachers}</td>
                              <td style={{ padding: "14px 8px", textAlign: "center", fontWeight: 600 }}>{stat.drivers}</td>
                              <td style={{ padding: "14px 8px", textAlign: "center" }}>
                                {stat.activeBuses > 0 ? (
                                  <span style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 6,
                                    padding: "4px 10px",
                                    borderRadius: 20,
                                    fontSize: "11px",
                                    fontWeight: 800,
                                    background: dark ? "rgba(16,185,129,0.15)" : "#D1FAE5",
                                    color: "#10B981"
                                  }}>
                                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#10B981", display: "inline-block", animation: "pulsePill 1.5s infinite" }} />
                                    {stat.activeBuses} Live
                                  </span>
                                ) : (
                                  <span style={{ color: t.textMuted }}>0</span>
                                )}
                              </td>
                              <td style={{ padding: "14px 8px", textAlign: "right" }}>
                                <span style={{
                                  display: "inline-block",
                                  padding: "3px 8px",
                                  borderRadius: "6px",
                                  fontSize: "10px",
                                  fontWeight: 800,
                                  background: isActive ? (dark ? "rgba(16,185,129,0.12)" : "#D1FAE5") : (dark ? "rgba(239,68,68,0.12)" : "#FEE2E2"),
                                  color: isActive ? "#10B981" : "#EF4444"
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
              <div style={S.card}>
                <div style={{ padding: "18px 24px", borderBottom: `1.5px solid ${t.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "13px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "1.5px" }}>💸 Recent Transactions</span>
                  <button onClick={() => setTab("payments")} style={{ background: "none", border: "none", color: t.accent, fontWeight: 800, fontSize: "12px", cursor: "pointer", padding: 0 }}>View All →</button>
                </div>
                <div style={{ padding: "10px 24px", overflowX: "auto" }}>
                  {paymentsList.length === 0 ? (
                    <div style={{ padding: "30px 0", textAlign: "center", color: t.textMuted, fontSize: "13px" }}>No transactions logged yet.</div>
                  ) : (
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                      <thead>
                        <tr style={{ borderBottom: `1.5px solid ${t.border}`, color: t.textMuted }}>
                          <th style={{ padding: "14px 8px", textAlign: "left", fontWeight: 700 }}>Date</th>
                          <th style={{ padding: "14px 8px", textAlign: "left", fontWeight: 700 }}>Campus</th>
                          <th style={{ padding: "14px 8px", textAlign: "left", fontWeight: 700 }}>Plan</th>
                          <th style={{ padding: "14px 8px", textAlign: "left", fontWeight: 700 }}>Amount</th>
                          <th style={{ padding: "14px 8px", textAlign: "right", fontWeight: 700 }}>Payment ID</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paymentsList.slice(0, 5).map((pay, i) => (
                          <tr key={i} className="custom-row" style={{ borderBottom: `1px solid ${t.border}` }}>
                            <td style={{ padding: "14px 8px", color: t.textSub }}>{new Date(pay.timestamp).toLocaleDateString("en-IN")}</td>
                            <td style={{ padding: "14px 8px", fontWeight: 700, color: t.text }}>{pay.campusId}</td>
                            <td style={{ padding: "14px 8px" }}>
                              <span style={{
                                textTransform: "capitalize",
                                fontWeight: 700,
                                color: pay.planId === "premium" ? "#8B5CF6" : "#FF5A1F"
                              }}>
                                {pay.planId}
                              </span>
                              <span style={{ color: t.textMuted, marginLeft: 4 }}>({pay.billing})</span>
                            </td>
                            <td style={{ padding: "14px 8px", fontWeight: 800, color: "#10B981" }}>₹{pay.amount?.toLocaleString("en-IN")}</td>
                            <td style={{ padding: "14px 8px", textAlign: "right", color: t.textMuted, fontFamily: "monospace" }}>{pay.paymentId}</td>
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
            <div className="animate-slide-up" style={S.card}>
              <div style={{ padding: "18px 24px", borderBottom: `1.5px solid ${t.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "13px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "1.5px" }}>🏫 Campuses Directory</span>
              </div>
              <div style={{ padding: "10px 24px", overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                  <thead>
                    <tr style={{ borderBottom: `1.5px solid ${t.border}`, color: t.textMuted }}>
                      <th style={{ padding: "14px 8px", textAlign: "left", fontWeight: 700 }}>Campus ID</th>
                      <th style={{ padding: "14px 8px", textAlign: "left", fontWeight: 700 }}>Active Plan</th>
                      <th style={{ padding: "14px 8px", textAlign: "left", fontWeight: 700 }}>Billing Cycle</th>
                      <th style={{ padding: "14px 8px", textAlign: "left", fontWeight: 700 }}>Expiry Date</th>
                      <th style={{ padding: "14px 8px", textAlign: "left", fontWeight: 700 }}>License Status</th>
                      <th style={{ padding: "14px 8px", textAlign: "right", fontWeight: 700 }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campuses.map((c, i) => {
                      const expired = (c.expiryDate || 0) <= Date.now();
                      const statusType = c.status === "trial" ? "trial" : (expired ? "expired" : "active");
                      const initialLetters = c.id ? c.id.split("-").map(w => w[0]).join("").toUpperCase().slice(0, 2) : "CP";
                      return (
                        <tr key={i} className="custom-row" style={{ borderBottom: `1px solid ${t.border}`, transition: "background 0.2s" }}>
                          <td style={{ padding: "14px 8px", fontWeight: 700 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <div style={{
                                width: 32,
                                height: 32,
                                borderRadius: "50%",
                                background: dark ? "rgba(124,58,237,0.15)" : "#F3E8FF",
                                color: t.accent,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: 11,
                                fontWeight: 800
                              }}>
                                {initialLetters}
                              </div>
                              <span style={{ color: t.text }}>{c.id}</span>
                            </div>
                          </td>
                          <td style={{ padding: "14px 8px" }}>
                            <span style={{
                              display: "inline-block",
                              padding: "3px 10px",
                              borderRadius: 20,
                              fontSize: 10,
                              fontWeight: 800,
                              textTransform: "uppercase",
                              background: c.plan === "premium" ? (dark ? "rgba(139,92,246,0.12)" : "#F5F3FF") : (dark ? "rgba(251,146,60,0.12)" : "#FFF7ED"),
                              color: c.plan === "premium" ? "#8B5CF6" : "#FF5A1F",
                              border: `1.5px solid ${c.plan === "premium" ? (dark ? "rgba(139,92,246,0.2)" : "#DDD6FE") : (dark ? "rgba(251,146,60,0.2)" : "#FFD8A8")}`
                            }}>
                              {c.plan === "premium" ? "🚀 Premium" : "🚌 Basic"}
                            </span>
                          </td>
                          <td style={{ padding: "14px 8px", textTransform: "capitalize", fontWeight: 600, color: t.textSub }}>{c.billing || "monthly"}</td>
                          <td style={{ padding: "14px 8px", color: t.textSub, fontWeight: 600 }}>{new Date(c.expiryDate || 0).toLocaleDateString("en-IN")}</td>
                          <td style={{ padding: "14px 8px" }}>
                            <span style={S.badge(statusType)}>{statusType}</span>
                          </td>
                          <td style={{ padding: "14px 8px", textAlign: "right" }}>
                            <button 
                              onClick={() => handleOpenOverride(c)}
                              style={{
                                background: t.accent,
                                border: "none",
                                borderRadius: "8px",
                                padding: "6px 14px",
                                color: "#fff",
                                fontWeight: 800,
                                fontSize: "11px",
                                cursor: "pointer",
                                fontFamily: "'Inter', sans-serif",
                                transition: "all 0.2s",
                                boxShadow: `0 2px 8px ${t.accent}22`
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
            <div className="animate-slide-up" style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
              {/* Filters bar */}
              <div style={{ ...S.card, padding: "20px", display: "flex", gap: "16px", flexWrap: "wrap", alignItems: "center" }}>
                <input 
                  type="text" 
                  value={userSearch}
                  onChange={e => setUserSearch(e.target.value)}
                  placeholder="Search user name, email, or phone..."
                  style={{
                    flex: 2,
                    background: dark ? "rgba(20,20,25,0.4)" : "#FFFFFF",
                    border: `1.5px solid ${t.border}`,
                    borderRadius: "12px",
                    padding: "12px 16px",
                    color: t.text,
                    outline: "none",
                    minWidth: "240px",
                    fontSize: "13px",
                    transition: "all 0.2s"
                  }}
                />
                
                <select
                  value={userRoleFilter}
                  onChange={e => setUserRoleFilter(e.target.value)}
                  style={{
                    flex: 1,
                    background: dark ? "rgba(20,20,25,0.4)" : "#FFFFFF",
                    border: `1.5px solid ${t.border}`,
                    borderRadius: "12px",
                    padding: "12px 16px",
                    color: t.text,
                    outline: "none",
                    cursor: "pointer",
                    fontSize: "13px",
                    minWidth: "160px"
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
                    background: dark ? "rgba(20,20,25,0.4)" : "#FFFFFF",
                    border: `1.5px solid ${t.border}`,
                    borderRadius: "12px",
                    padding: "12px 16px",
                    color: t.text,
                    outline: "none",
                    cursor: "pointer",
                    fontSize: "13px",
                    minWidth: "160px"
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
                <div style={{ padding: "18px 24px", borderBottom: `1.5px solid ${t.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "13px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "1.5px" }}>👥 Users Registry ({filteredUsers.length})</span>
                </div>
                <div style={{ padding: "10px 24px", overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                    <thead>
                      <tr style={{ borderBottom: `1.5px solid ${t.border}`, color: t.textMuted }}>
                        <th style={{ padding: "14px 8px", textAlign: "left", fontWeight: 700 }}>Name</th>
                        <th style={{ padding: "14px 8px", textAlign: "left", fontWeight: 700 }}>Email</th>
                        <th style={{ padding: "14px 8px", textAlign: "left", fontWeight: 700 }}>Campus</th>
                        <th style={{ padding: "14px 8px", textAlign: "left", fontWeight: 700 }}>Role</th>
                        <th style={{ padding: "14px 8px", textAlign: "left", fontWeight: 700 }}>Status</th>
                        <th style={{ padding: "14px 8px", textAlign: "right", fontWeight: 700 }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredUsers.map((u, i) => {
                        const userName = u.name || u.displayName || "No Name";
                        const userInitials = userName.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
                        return (
                          <tr key={i} className="custom-row" style={{ borderBottom: `1px solid ${t.border}`, transition: "background 0.2s" }}>
                            <td style={{ padding: "14px 8px", fontWeight: 700 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <div style={{
                                  width: 32,
                                  height: 32,
                                  borderRadius: "50%",
                                  background: dark ? "rgba(139,92,246,0.15)" : "#F3E8FF",
                                  color: t.accent,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  fontSize: 11,
                                  fontWeight: 800
                                }}>
                                  {userInitials}
                                </div>
                                <span style={{ color: t.text }}>{userName}</span>
                              </div>
                            </td>
                            <td style={{ padding: "14px 8px", color: t.textSub }}>{u.email}</td>
                            <td style={{ padding: "14px 8px", fontWeight: 700, color: u.campusId ? t.textSub : t.accent }}>{u.campusId || "System Global"}</td>
                            <td style={{ padding: "14px 8px" }}>
                              <select 
                                value={u.role || "student"}
                                onChange={e => handleRoleChange(u.id, e.target.value)}
                                style={{
                                  background: dark ? "rgba(20,20,25,0.4)" : "#FFFFFF",
                                  border: `1.5px solid ${t.border}`,
                                  borderRadius: "8px",
                                  color: t.text,
                                  fontSize: "12px",
                                  padding: "6px 10px",
                                  cursor: "pointer",
                                  outline: "none"
                                }}
                              >
                                <option value="admin">Admin</option>
                                <option value="superadmin">Superadmin</option>
                              </select>
                            </td>
                            <td style={{ padding: "14px 8px" }}>
                              <span style={{
                                display: "inline-block",
                                padding: "3px 8px",
                                borderRadius: "6px",
                                fontSize: "10px",
                                fontWeight: 800,
                                background: u.blocked ? (dark ? "rgba(239,68,68,0.12)" : "#FEE2E2") : (dark ? "rgba(16,185,129,0.12)" : "#D1FAE5"),
                                color: u.blocked ? "#EF4444" : "#10B981"
                              }}>
                                {u.blocked ? "BLOCKED" : "ACTIVE"}
                              </span>
                            </td>
                            <td style={{ padding: "14px 8px", textAlign: "right" }}>
                              <button
                                onClick={() => toggleBlockUser(u.id, u.blocked)}
                                style={{
                                  background: u.blocked ? "#10B981" : "#EF4444",
                                  border: "none",
                                  borderRadius: "8px",
                                  padding: "6px 14px",
                                  color: "#fff",
                                  fontWeight: 800,
                                  fontSize: "11px",
                                  cursor: "pointer",
                                  fontFamily: "'Inter', sans-serif",
                                  transition: "all 0.2s",
                                  boxShadow: u.blocked ? "0 2px 8px rgba(16,185,129,0.2)" : "0 2px 8px rgba(239,68,68,0.2)"
                                }}
                              >
                                {u.blocked ? "Unblock Account" : "Block User"}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Add New Administrator Card */}
              <div style={S.card}>
                <div style={{ padding: "18px 24px", borderBottom: `1.5px solid ${t.border}` }}>
                  <span style={{ fontSize: "13px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "1.5px" }}>➕ Create New Administrator</span>
                </div>
                
                <form onSubmit={handleCreateAdmin} style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "20px" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "20px" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      <label style={{ fontSize: "11px", fontWeight: 800, color: t.textMuted, textTransform: "uppercase", letterSpacing: "0.5px" }}>Full Name</label>
                      <input 
                        type="text" 
                        value={newAdmin.name} 
                        onChange={e => setNewAdmin({ ...newAdmin, name: e.target.value })}
                        placeholder="e.g. Prof. Nair"
                        style={{
                          background: dark ? "rgba(20,20,25,0.4)" : "#FFFFFF",
                          border: `1.5px solid ${t.border}`,
                          borderRadius: "10px",
                          padding: "12px 14px",
                          color: t.text,
                          outline: "none",
                          fontSize: "13px",
                          transition: "all 0.2s"
                        }}
                      />
                    </div>
                    
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      <label style={{ fontSize: "11px", fontWeight: 800, color: t.textMuted, textTransform: "uppercase", letterSpacing: "0.5px" }}>Email Address</label>
                      <input 
                        type="email" 
                        value={newAdmin.email} 
                        onChange={e => setNewAdmin({ ...newAdmin, email: e.target.value })}
                        placeholder="e.g. nair@campusmove.com"
                        style={{
                          background: dark ? "rgba(20,20,25,0.4)" : "#FFFFFF",
                          border: `1.5px solid ${t.border}`,
                          borderRadius: "10px",
                          padding: "12px 14px",
                          color: t.text,
                          outline: "none",
                          fontSize: "13px",
                          transition: "all 0.2s"
                        }}
                      />
                    </div>
                    
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      <label style={{ fontSize: "11px", fontWeight: 800, color: t.textMuted, textTransform: "uppercase", letterSpacing: "0.5px" }}>Password</label>
                      <input 
                        type="password" 
                        value={newAdmin.password} 
                        onChange={e => setNewAdmin({ ...newAdmin, password: e.target.value })}
                        placeholder="Min 6 characters"
                        style={{
                          background: dark ? "rgba(20,20,25,0.4)" : "#FFFFFF",
                          border: `1.5px solid ${t.border}`,
                          borderRadius: "10px",
                          padding: "12px 14px",
                          color: t.text,
                          outline: "none",
                          fontSize: "13px",
                          transition: "all 0.2s"
                        }}
                      />
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "20px" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      <label style={{ fontSize: "11px", fontWeight: 800, color: t.textMuted, textTransform: "uppercase", letterSpacing: "0.5px" }}>Role Type</label>
                      <select 
                        value={newAdmin.role} 
                        onChange={e => setNewAdmin({ ...newAdmin, role: e.target.value, campusId: e.target.value === "superadmin" ? "alliance-bangalore" : newAdmin.campusId })}
                        style={{
                          background: dark ? "rgba(20,20,25,0.4)" : "#FFFFFF",
                          border: `1.5px solid ${t.border}`,
                          borderRadius: "10px",
                          padding: "12px 14px",
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

                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      <label style={{ fontSize: "11px", fontWeight: 800, color: t.textMuted, textTransform: "uppercase", letterSpacing: "0.5px" }}>Campus Association</label>
                      {newAdmin.role === "superadmin" ? (
                        <input 
                          type="text" 
                          value="System Global" 
                          disabled
                          style={{
                            background: dark ? "rgba(255,255,255,0.05)" : "#E2E8F0",
                            border: `1.5px solid ${t.border}`,
                            borderRadius: "10px",
                            padding: "12px 14px",
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
                            background: dark ? "rgba(20,20,25,0.4)" : "#FFFFFF",
                            border: `1.5px solid ${t.border}`,
                            borderRadius: "10px",
                            padding: "12px 14px",
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
                    <div style={{ background: "rgba(239,68,68,0.08)", border: "1.5px solid rgba(239,68,68,0.2)", borderRadius: 10, padding: 12, color: "#EF4444", fontSize: 13, fontWeight: 600 }}>
                      ⚠️ {adminCreateError}
                    </div>
                  )}

                  {adminCreateSuccess && (
                    <div style={{ background: "rgba(16,185,129,0.08)", border: "1.5px solid rgba(16,185,129,0.2)", borderRadius: 10, padding: 12, color: "#10B981", fontSize: 13, fontWeight: 600 }}>
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
                      padding: "12px 28px",
                      color: "#fff",
                      fontWeight: 800,
                      fontSize: "13px",
                      cursor: adminCreating ? "not-allowed" : "pointer",
                      fontFamily: "'Inter', sans-serif",
                      boxShadow: `0 4px 12px ${t.accent}33`,
                      marginTop: "10px",
                      alignSelf: "flex-start",
                      transition: "all 0.2s"
                    }}
                  >
                    {adminCreating ? "Creating Administrator..." : "+ Create Administrator"}
                  </button>
                </form>
              </div>
            </div>
          )}

          {tab === "payments" && (
            <div className="animate-slide-up" style={S.card}>
              <div style={{ padding: "18px 24px", borderBottom: `1.5px solid ${t.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "13px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "1.5px" }}>💸 Platform Transaction Ledger</span>
              </div>
              <div style={{ padding: "10px 24px", overflowX: "auto" }}>
                {paymentsList.length === 0 ? (
                  <div style={{ padding: "40px 0", textAlign: "center", color: t.textMuted }}>No transaction records registered.</div>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                    <thead>
                      <tr style={{ borderBottom: `1.5px solid ${t.border}`, color: t.textMuted }}>
                        <th style={{ padding: "14px 8px", textAlign: "left", fontWeight: 700 }}>Date</th>
                        <th style={{ padding: "14px 8px", textAlign: "left", fontWeight: 700 }}>Payer Name</th>
                        <th style={{ padding: "14px 8px", textAlign: "left", fontWeight: 700 }}>Campus</th>
                        <th style={{ padding: "14px 8px", textAlign: "left", fontWeight: 700 }}>Plan Details</th>
                        <th style={{ padding: "14px 8px", textAlign: "left", fontWeight: 700 }}>Amount</th>
                        <th style={{ padding: "14px 8px", textAlign: "left", fontWeight: 700 }}>Payment ID</th>
                        <th style={{ padding: "14px 8px", textAlign: "right", fontWeight: 700 }}>Receipt</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paymentsList.map((pay, i) => (
                        <tr key={i} className="custom-row" style={{ borderBottom: `1px solid ${t.border}`, transition: "background 0.2s" }}>
                          <td style={{ padding: "14px 8px", color: t.textMuted }}>{new Date(pay.timestamp).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</td>
                          <td style={{ padding: "14px 8px", fontWeight: 700, color: t.text }}>{pay.customerName || "Razorpay User"}</td>
                          <td style={{ padding: "14px 8px", fontWeight: 800, color: t.textSub }}>{pay.campusId}</td>
                          <td style={{ padding: "14px 8px" }}>
                            <span style={{
                              textTransform: "capitalize",
                              fontWeight: 700,
                              color: pay.planId === "premium" ? "#8B5CF6" : "#FF5A1F"
                            }}>
                              {pay.planId}
                            </span>
                            <span style={{ color: t.textMuted, marginLeft: 4 }}>({pay.billing})</span>
                          </td>
                          <td style={{ padding: "14px 8px", fontWeight: 800, color: "#10B981" }}>₹{pay.amount?.toLocaleString("en-IN")}</td>
                          <td style={{ padding: "14px 8px", color: t.textMuted, fontFamily: "monospace" }}>{pay.paymentId}</td>
                          <td style={{ padding: "14px 8px", textAlign: "right" }}>
                            <button
                              onClick={() => setSelectedInvoice(pay)}
                              style={{
                                background: dark ? "rgba(255,255,255,0.05)" : "#F1F5F9",
                                border: `1.5px solid ${t.border}`,
                                borderRadius: "8px",
                                padding: "6px 14px",
                                color: t.text,
                                fontSize: "11px",
                                fontWeight: 800,
                                cursor: "pointer",
                                transition: "all 0.2s"
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
            <div className="animate-slide-up" style={S.card}>
              <div style={{ padding: "18px 24px", borderBottom: `1.5px solid ${t.border}` }}>
                <span style={{ fontSize: "13px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "1.5px" }}>📢 Global Announcement Broadcast</span>
              </div>
              <form onSubmit={handleSaveAnnouncement} style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "20px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <label style={{ fontSize: "11px", fontWeight: 800, color: t.textMuted, textTransform: "uppercase", letterSpacing: "0.5px" }}>Broadcast Message</label>
                  <textarea 
                    value={announcement.message}
                    onChange={e => setAnnouncement({ ...announcement, message: e.target.value })}
                    placeholder="Enter broadcast message here..."
                    rows={4}
                    style={{
                      background: dark ? "rgba(20,20,25,0.4)" : "#FFFFFF",
                      border: `1.5px solid ${t.border}`,
                      borderRadius: "12px",
                      padding: "14px 16px",
                      color: t.text,
                      outline: "none",
                      fontSize: "13px",
                      fontFamily: "inherit",
                      resize: "vertical",
                      transition: "all 0.2s"
                    }}
                  />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "20px" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <label style={{ fontSize: "11px", fontWeight: 800, color: t.textMuted, textTransform: "uppercase", letterSpacing: "0.5px" }}>Alert Type Style</label>
                    <select 
                      value={announcement.type}
                      onChange={e => setAnnouncement({ ...announcement, type: e.target.value })}
                      style={{
                        background: dark ? "rgba(20,20,25,0.4)" : "#FFFFFF",
                        border: `1.5px solid ${t.border}`,
                        borderRadius: "10px",
                        padding: "12px 14px",
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

                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <label style={{ fontSize: "11px", fontWeight: 800, color: t.textMuted, textTransform: "uppercase", letterSpacing: "0.5px" }}>Broadcast Status</label>
                    <select 
                      value={announcement.active ? "true" : "false"}
                      onChange={e => setAnnouncement({ ...announcement, active: e.target.value === "true" })}
                      style={{
                        background: dark ? "rgba(20,20,25,0.4)" : "#FFFFFF",
                        border: `1.5px solid ${t.border}`,
                        borderRadius: "10px",
                        padding: "12px 14px",
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
                  <div style={{ background: "rgba(16,185,129,0.08)", border: "1.5px solid rgba(16,185,129,0.2)", borderRadius: 10, padding: 12, color: "#10B981", fontSize: 13, fontWeight: 600 }}>
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
                    padding: "12px 28px",
                    color: "#fff",
                    fontWeight: 800,
                    fontSize: "13px",
                    cursor: savingAnnouncement ? "not-allowed" : "pointer",
                    fontFamily: "'Inter', sans-serif",
                    boxShadow: `0 4px 12px ${t.accent}33`,
                    marginTop: "10px",
                    alignSelf: "flex-start",
                    transition: "all 0.2s"
                  }}
                >
                  {savingAnnouncement ? "Saving Broadcast Settings..." : "Save Announcement Settings"}
                </button>
              </form>
            </div>
          )}

          {/* TAB: SYSTEM LOGS */}
          {tab === "logs" && (
            <div className="animate-slide-up" style={S.card}>
              <div style={{ padding: "18px 24px", borderBottom: `1.5px solid ${t.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "13px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "1.5px" }}>📜 Global Activity Logs</span>
              </div>
              <div style={{ padding: "10px 24px", overflowX: "auto" }}>
                {logsList.length === 0 ? (
                  <div style={{ padding: "40px 0", textAlign: "center", color: t.textMuted }}>No system logs registered. Perform administrative actions to test logs.</div>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                    <thead>
                      <tr style={{ borderBottom: `1.5px solid ${t.border}`, color: t.textMuted }}>
                        <th style={{ padding: "14px 8px", textAlign: "left", fontWeight: 700 }}>Timestamp</th>
                        <th style={{ padding: "14px 8px", textAlign: "left", fontWeight: 700 }}>Campus</th>
                        <th style={{ padding: "14px 8px", textAlign: "left", fontWeight: 700 }}>Action</th>
                        <th style={{ padding: "14px 8px", textAlign: "left", fontWeight: 700 }}>Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logsList.map((log, i) => {
                        const isError = log.action.includes("Error") || log.action.includes("Failed") || log.action.includes("Terminated");
                        return (
                          <tr key={i} className="custom-row" style={{ borderBottom: `1px solid ${t.border}`, transition: "background 0.2s" }}>
                            <td style={{ padding: "14px 8px", color: t.textMuted, fontFamily: "monospace" }}>{new Date(log.timestamp).toLocaleString("en-IN")}</td>
                            <td style={{ padding: "14px 8px", fontWeight: 700, color: t.textSub }}>{log.campusId.toUpperCase()}</td>
                            <td style={{ padding: "14px 8px" }}>
                              <span style={{
                                display: "inline-block",
                                padding: "3px 8px",
                                borderRadius: "6px",
                                fontSize: "10px",
                                fontWeight: 800,
                                background: isError ? (dark ? "rgba(239,68,68,0.12)" : "#FEE2E2") : (dark ? "rgba(59,130,246,0.12)" : "#E0F2FE"),
                                color: isError ? "#EF4444" : "#3B82F6"
                              }}>
                                {log.action}
                              </span>
                            </td>
                            <td style={{ padding: "14px 8px", color: t.text }}>{log.details}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </>
      )}
        </div>
      </div>

      {/* MODAL 1: PLAN OVERRIDE */}
      {editingCampus && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: dark ? "rgba(0, 0, 0, 0.75)" : "rgba(0, 0, 0, 0.45)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 9999,
          padding: 20,
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)"
        }}>
          <div className="animate-slide-up" style={{
            background: dark ? "rgba(30, 30, 40, 0.85)" : "rgba(255, 255, 255, 0.95)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            border: `1.5px solid ${dark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.06)"}`,
            borderRadius: "24px",
            width: "100%",
            maxWidth: "460px",
            boxShadow: dark ? "0 25px 60px rgba(0,0,0,0.5)" : "0 25px 60px rgba(0,0,0,0.06)",
            overflow: "hidden",
            transition: "all 0.3s ease"
          }}>
            <div style={{ padding: "20px 24px", borderBottom: `1.5px solid ${t.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "15px", fontWeight: 900, color: t.text }}>🛠️ Modify Subscription ({editingCampus.id})</span>
              <button onClick={() => setEditingCampus(null)} style={{ background: "none", border: "none", color: t.textMuted, fontSize: "20px", cursor: "pointer", padding: 4 }}>✕</button>
            </div>
            
            <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "18px" }}>
              {/* Select Plan */}
              <div>
                <label style={{ display: "block", fontSize: "11px", fontWeight: 800, textTransform: "uppercase", color: t.textMuted, marginBottom: "8px", letterSpacing: "0.5px" }}>Plan Level</label>
                <select 
                  value={overridePlan} 
                  onChange={e => setOverridePlan(e.target.value)}
                  style={{
                    width: "100%",
                    background: dark ? "rgba(20,20,25,0.4)" : "#FFFFFF",
                    border: `1.5px solid ${t.border}`,
                    borderRadius: "12px",
                    padding: "12px 14px",
                    color: t.text,
                    outline: "none",
                    cursor: "pointer",
                    fontSize: "13px"
                  }}
                >
                  <option value="basic">Basic (🚌 ₹5,000 / mo)</option>
                  <option value="premium">Premium (🚀 ₹12,000 / mo)</option>
                </select>
              </div>

              {/* Select Billing */}
              <div>
                <label style={{ display: "block", fontSize: "11px", fontWeight: 800, textTransform: "uppercase", color: t.textMuted, marginBottom: "8px", letterSpacing: "0.5px" }}>Billing Cycle</label>
                <select 
                  value={overrideBilling} 
                  onChange={e => setOverrideBilling(e.target.value)}
                  style={{
                    width: "100%",
                    background: dark ? "rgba(20,20,25,0.4)" : "#FFFFFF",
                    border: `1.5px solid ${t.border}`,
                    borderRadius: "12px",
                    padding: "12px 14px",
                    color: t.text,
                    outline: "none",
                    cursor: "pointer",
                    fontSize: "13px"
                  }}
                >
                  <option value="monthly">Monthly Cycle</option>
                  <option value="yearly">Yearly Cycle</option>
                </select>
              </div>

              {/* Select Status */}
              <div>
                <label style={{ display: "block", fontSize: "11px", fontWeight: 800, textTransform: "uppercase", color: t.textMuted, marginBottom: "8px", letterSpacing: "0.5px" }}>Access Status</label>
                <select 
                  value={overrideStatus} 
                  onChange={e => setOverrideStatus(e.target.value)}
                  style={{
                    width: "100%",
                    background: dark ? "rgba(20,20,25,0.4)" : "#FFFFFF",
                    border: `1.5px solid ${t.border}`,
                    borderRadius: "12px",
                    padding: "12px 14px",
                    color: t.text,
                    outline: "none",
                    cursor: "pointer",
                    fontSize: "13px"
                  }}
                >
                  <option value="active">Active Access</option>
                  <option value="trial">Free Trial Mode</option>
                  <option value="expired">Expired</option>
                </select>
              </div>

              {/* Set months duration */}
              <div>
                <label style={{ display: "block", fontSize: "11px", fontWeight: 800, textTransform: "uppercase", color: t.textMuted, marginBottom: "8px", letterSpacing: "0.5px" }}>Subscription Extension (Months)</label>
                <input 
                  type="number" 
                  value={overrideMonths} 
                  onChange={e => setOverrideMonths(parseInt(e.target.value, 10) || 1)}
                  min="1"
                  max="60"
                  style={{
                    width: "100%",
                    background: dark ? "rgba(20,20,25,0.4)" : "#FFFFFF",
                    border: `1.5px solid ${t.border}`,
                    borderRadius: "12px",
                    padding: "12px 14px",
                    color: t.text,
                    boxSizing: "border-box",
                    outline: "none",
                    fontSize: "13px"
                  }}
                />
              </div>

              {/* Action Buttons */}
              <div style={{ display: "flex", gap: "12px", marginTop: "12px" }}>
                <button
                  onClick={() => setEditingCampus(null)}
                  style={{
                    flex: 1,
                    background: "transparent",
                    border: `1.5px solid ${t.border}`,
                    borderRadius: "12px",
                    padding: "12px 0",
                    color: t.text,
                    fontWeight: 700,
                    cursor: "pointer",
                    transition: "all 0.2s"
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
                    borderRadius: "12px",
                    padding: "12px 0",
                    color: "#fff",
                    fontWeight: 800,
                    cursor: "pointer",
                    boxShadow: `0 4px 12px ${PLANS[overridePlan]?.color || t.accent}33`,
                    transition: "all 0.2s"
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
          background: dark ? "rgba(0, 0, 0, 0.75)" : "rgba(0, 0, 0, 0.45)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 9999,
          padding: 20,
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)"
        }}>
          <div className="animate-slide-up" style={{
            background: dark ? "rgba(30, 30, 40, 0.85)" : "rgba(255, 255, 255, 0.95)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            border: `1.5px solid ${dark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.06)"}`,
            borderRadius: "24px",
            width: "100%",
            maxWidth: 500,
            boxShadow: dark ? "0 25px 60px rgba(0,0,0,0.5)" : "0 25px 60px rgba(0,0,0,0.06)",
            overflow: "hidden"
          }}>
            {/* Header */}
            <div style={{
              background: `linear-gradient(135deg, ${PLANS[selectedInvoice.planId]?.color || t.accent}, ${dark ? "#7C3AED" : "#FF5A1F"})`,
              padding: "24px",
              color: "#fff",
              position: "relative"
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: "-0.5px" }}>CampusMove Platform Invoice</div>
                  <div style={{ fontSize: 11, opacity: 0.8, marginTop: 4, fontFamily: "monospace" }}>ID: {selectedInvoice.paymentId}</div>
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
                    justifyContent: "center",
                    transition: "all 0.2s"
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
                  <div style={{ fontSize: 10, color: t.textMuted, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.5px" }}>Campus Client</div>
                  <div style={{ fontSize: 14, fontWeight: 900, color: t.text, marginTop: 4 }}>{selectedInvoice.campusId}</div>
                  <div style={{ fontSize: 11, color: t.textSub, marginTop: 2 }}>Payer: {selectedInvoice.customerName}</div>
                  <div style={{ fontSize: 11, color: t.textMuted }}>{selectedInvoice.customerEmail}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 10, color: t.textMuted, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.5px" }}>Date Settled</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: t.text, marginTop: 4 }}>
                    {new Date(selectedInvoice.timestamp).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </div>
                  <div style={{ display: "inline-block", fontSize: 10, background: "rgba(16,185,129,0.12)", color: "#10B981", fontWeight: 800, padding: "3px 8px", borderRadius: 6, marginTop: 8 }}>
                    SETTLED SUCCESS ✓
                  </div>
                </div>
              </div>

              {/* Itemized */}
              <div>
                <div style={{ fontSize: 10, color: t.textMuted, fontWeight: 800, textTransform: "uppercase", marginBottom: 8, letterSpacing: "0.5px" }}>Details</div>
                <div style={{ background: dark ? "rgba(20,20,25,0.4)" : t.bgCard2, border: `1.5px solid ${t.border}`, borderRadius: "12px", padding: 14 }}>
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
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: `1.5px solid ${t.border}`, paddingTop: 16, marginTop: 6 }}>
                <span style={{ fontSize: 14, fontWeight: 800, color: t.text }}>Grand Total</span>
                <span style={{ fontSize: 22, fontWeight: 950, color: PLANS[selectedInvoice.planId]?.color || t.accent }}>₹{selectedInvoice.amount?.toLocaleString("en-IN")}</span>
              </div>

              {/* Action buttons */}
              <div style={{ display: "flex", gap: 12, marginTop: 14 }}>
                <button 
                  onClick={() => window.print()}
                  style={{
                    flex: 1,
                    background: "transparent",
                    border: `1.5px solid ${t.border}`,
                    borderRadius: "12px",
                    padding: "12px 0",
                    color: t.text,
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "'Inter', sans-serif",
                    transition: "all 0.2s"
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
                    borderRadius: "12px",
                    padding: "12px 0",
                    color: "#fff",
                    fontSize: 13,
                    fontWeight: 800,
                    cursor: "pointer",
                    fontFamily: "'Inter', sans-serif",
                    boxShadow: `0 4px 12px ${PLANS[selectedInvoice.planId]?.color || t.accent}33`,
                    transition: "all 0.2s"
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
