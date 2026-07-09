import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { db } from "../firebase";
import { 
  collection, 
  getDocs, 
  doc, 
  setDoc, 
  updateDoc, 
  deleteDoc 
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

  useEffect(() => {
    loadData();
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

    } catch (err) {
      console.error("Failed to load Superadmin data:", err);
    } finally {
      setLoading(false);
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
    const query = userSearch.toLowerCase();
    const matchesSearch = 
      (u.name || "").toLowerCase().includes(query) ||
      (u.email || "").toLowerCase().includes(query) ||
      (u.phone || "").includes(query);
    
    const matchesRole = userRoleFilter === "all" || u.role === userRoleFilter;
    const matchesCampus = userCampusFilter === "all" || u.campusId === userCampusFilter;
    
    return matchesSearch && matchesRole && matchesCampus;
  });

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
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px" }}>
                <div style={{ ...S.card, padding: "20px" }}>
                  <div style={{ fontSize: "11px", color: t.textMuted, fontWeight: 800, textTransform: "uppercase" }}>Total platform earnings</div>
                  <div style={{ fontSize: "28px", fontWeight: 900, marginTop: "8px", color: "#10B981" }}>₹{totalRevenue.toLocaleString("en-IN")}</div>
                  <div style={{ fontSize: "11px", color: t.textMuted, marginTop: "4px" }}>Cumulative sum of all invoices</div>
                </div>
                
                <div style={{ ...S.card, padding: "20px" }}>
                  <div style={{ fontSize: "11px", color: t.textMuted, fontWeight: 800, textTransform: "uppercase" }}>Active Subscriptions</div>
                  <div style={{ fontSize: "28px", fontWeight: 900, marginTop: "8px", color: t.accent }}>{activeCampusesCount}</div>
                  <div style={{ fontSize: "11px", color: t.textMuted, marginTop: "4px" }}>Campuses with active premium/basic access</div>
                </div>
                
                <div style={{ ...S.card, padding: "20px" }}>
                  <div style={{ fontSize: "11px", color: t.textMuted, fontWeight: 800, textTransform: "uppercase" }}>Expired campuses</div>
                  <div style={{ fontSize: "28px", fontWeight: 900, marginTop: "8px", color: "#EF4444" }}>{expiredCampusesCount}</div>
                  <div style={{ fontSize: "11px", color: t.textMuted, marginTop: "4px" }}>Campuses needing billing renew</div>
                </div>
                
                <div style={{ ...S.card, padding: "20px" }}>
                  <div style={{ fontSize: "11px", color: t.textMuted, fontWeight: 800, textTransform: "uppercase" }}>Global platform users</div>
                  <div style={{ fontSize: "28px", fontWeight: 900, marginTop: "8px" }}>{globalUsersCount}</div>
                  <div style={{ fontSize: "11px", color: t.textMuted, marginTop: "4px" }}>Total admins, drivers & students</div>
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
                  <option value="all">All Roles</option>
                  <option value="admin">Admins Only</option>
                  <option value="driver">Drivers Only</option>
                  <option value="student">Students Only</option>
                  <option value="superadmin">Superadmins Only</option>
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
                              <option value="student">Student</option>
                              <option value="driver">Driver</option>
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
