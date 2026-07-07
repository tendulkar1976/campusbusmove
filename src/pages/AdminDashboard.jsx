import { useEffect, useState, useMemo, useRef } from "react";
import { collection, getDocs, addDoc, deleteDoc, doc, updateDoc, setDoc, getDoc } from "firebase/firestore";
import { ref, onValue, set } from "firebase/database";
import { db, rtdb, secondaryAuth } from "../firebase";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { createUserWithEmailAndPassword, signOut, signInWithEmailAndPassword } from "firebase/auth";

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
  const { dark, toggle, t } = useTheme();
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
  const [showCreatePwd, setShowCreatePwd] = useState(false);

  // ── Billing state ──
  const [subscription, setSubscription] = useState(null);
  const [showPlans, setShowPlans] = useState(false);
  const [billingCycle, setBillingCycle] = useState("monthly");
  const [planSaving, setPlanSaving] = useState(false);
  const [showBillingSuccess, setShowBillingSuccess] = useState(false);

  // ── Search & Filters state ──
  const [userSearch, setUserSearch] = useState("");
  const [routeSearch, setRouteSearch] = useState("");

  // Override control refs & states
  const overrideIntervalsRef = useRef({});
  const overrideStateRef = useRef({});
  const liveStatusRef = useRef({});
  const [overrideModalRoute, setOverrideModalRoute] = useState(null);

  useEffect(() => {
    liveStatusRef.current = liveStatus;
  }, [liveStatus]);
  const [overrideType, setOverrideType] = useState("simulation");
  const [selectedStopIndex, setSelectedStopIndex] = useState(-1);
  const [selectedDriverUid, setSelectedDriverUid] = useState("");
  const [attendanceLogs, setAttendanceLogs] = useState([]);
  const [selectedFilterRouteId, setSelectedFilterRouteId] = useState("all");
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  const [calYear, setCalYear] = useState(new Date().getFullYear());
  const [selectedDateStr, setSelectedDateStr] = useState(
    `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,"0")}-${String(new Date().getDate()).padStart(2,"0")}`
  );

  // Driver Change Alerts state
  const [driverAlerts, setDriverAlerts] = useState([]);
  const [alertRouteId, setAlertRouteId] = useState("");
  const [alertDriverUid, setAlertDriverUid] = useState("");
  const [alertCustomDriverName, setAlertCustomDriverName] = useState("");
  const [alertCustomDriverPhone, setAlertCustomDriverPhone] = useState("");
  const [alertMessage, setAlertMessage] = useState("");
  const [alertPublishing, setAlertPublishing] = useState(false);

  useEffect(() => {
    return () => {
      Object.values(overrideIntervalsRef.current).forEach(clearInterval);
    };
  }, []);

  useEffect(() => {
    if (tab !== "attendance") return;
    getDocs(collection(db, "attendance")).then(snap => {
      const logs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
        .sort((a, b) => b.timestamp - a.timestamp);
      setAttendanceLogs(logs);
    }).catch(err => console.error("Error fetching attendance logs:", err));
  }, [tab]);

  // Load driver alerts
  useEffect(() => {
    if (tab !== "alerts") return;
    getDocs(collection(db, "driver_alerts")).then(snap => {
      const alerts = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
        .sort((a, b) => b.timestamp - a.timestamp);
      setDriverAlerts(alerts);
    }).catch(err => console.error("Error fetching driver alerts:", err));
  }, [tab]);

  function openOverrideModal(prId) {
    const routeObj = routes.find(r => r.id === prId) || PRESET_ROUTES.find(r => r.id === prId);
    setOverrideModalRoute(routeObj);
    setOverrideType("driver");
    setSelectedStopIndex(-1);
    setSelectedDriverUid("");
  }

  async function publishDriverAlert(e) {
    if (e) e.preventDefault();
    if (!alertRouteId) return alert("Please select a route.");
    if (!alertDriverUid) return alert("Please select a driver.");
    if (alertDriverUid === "custom_temp") {
      if (!alertCustomDriverName.trim()) return alert("Please enter the custom driver's name.");
      if (!alertCustomDriverPhone.trim()) return alert("Please enter the custom driver's phone number.");
    }
    if (!alertMessage.trim()) return alert("Please enter an alert message.");

    setAlertPublishing(true);
    try {
      const driverName = alertDriverUid === "custom_temp" ? alertCustomDriverName.trim() : (users.find(u => u.id === alertDriverUid)?.name || "Driver");
      const driverPhone = alertDriverUid === "custom_temp" ? alertCustomDriverPhone.trim() : (users.find(u => u.id === alertDriverUid)?.phone || users.find(u => u.id === alertDriverUid)?.identifier || "");
      
      const docRef = await addDoc(collection(db, "driver_alerts"), {
        routeId: alertRouteId,
        driverUid: alertDriverUid,
        customDriverName: alertDriverUid === "custom_temp" ? driverName : null,
        customDriverPhone: alertDriverUid === "custom_temp" ? driverPhone : null,
        message: alertMessage.trim(),
        timestamp: Date.now(),
        active: true
      });
      const newAlert = {
        id: docRef.id,
        routeId: alertRouteId,
        driverUid: alertDriverUid,
        customDriverName: alertDriverUid === "custom_temp" ? driverName : null,
        customDriverPhone: alertDriverUid === "custom_temp" ? driverPhone : null,
        message: alertMessage.trim(),
        timestamp: Date.now(),
        active: true
      };
      setDriverAlerts(prev => [newAlert, ...prev]);
      setAlertRouteId("");
      setAlertDriverUid("");
      setAlertCustomDriverName("");
      setAlertCustomDriverPhone("");
      setAlertMessage("");
      alert("Alert published successfully!");
    } catch (err) {
      console.error("Failed to publish alert:", err);
      alert("Failed to publish alert. Try again.");
    } finally {
      setAlertPublishing(false);
    }
  }

  async function deleteDriverAlert(id) {
    if (!window.confirm("Are you sure you want to delete this alert?")) return;
    try {
      await deleteDoc(doc(db, "driver_alerts", id));
      setDriverAlerts(prev => prev.filter(a => a.id !== id));
    } catch (err) {
      console.error("Failed to delete alert:", err);
      alert("Failed to delete alert.");
    }
  }

  function getRoutePathFallback(routeId) {
    const lat = 12.8258;
    const lng = 77.7665;
    const numPoints = 24;
    const radius = 0.005; // ~500m
    const points = [];
    for (let i = 0; i < numPoints; i++) {
      const angle = (i / numPoints) * 2 * Math.PI;
      points.push({
        lat: lat + radius * Math.sin(angle),
        lng: lng + radius * Math.cos(angle)
      });
    }
    return points;
  }

  function startOverride(routeId, config) {
    if (overrideIntervalsRef.current[routeId]) {
      clearInterval(overrideIntervalsRef.current[routeId]);
    }

    const routeObj = routes.find(r => r.id === routeId) || PRESET_ROUTES.find(r => r.id === routeId);
    let pathPoints = [];
    if (config.type === "simulation" || config.type === "driver") {
      if (routeObj && routeObj.path && routeObj.path.length > 0) {
        pathPoints = routeObj.path;
      } else if (routeObj && routeObj.stops && routeObj.stops.length > 0) {
        pathPoints = routeObj.stops;
      } else {
        pathPoints = getRoutePathFallback(routeId);
      }
    }

    overrideStateRef.current[routeId] = {
      type: config.type,
      path: pathPoints,
      currentIndex: 0,
      stop: config.stop || null,
      driverUid: config.driverUid || "admin-override",
      tripId: config.tripId || null,
      adminStarted: config.adminStarted || false
    };

    const updateLocation = () => {
      const state = overrideStateRef.current[routeId];
      if (!state) return;

      const currentLive = liveStatusRef.current[routeId]?.live;

      // If the trip was stopped externally (active is false), clear the simulation interval
      if (state.type === "driver" && state.tripId && currentLive && currentLive.tripId === state.tripId && currentLive.active === false) {
        console.log("Trip was stopped externally. Clearing admin interval.");
        if (overrideIntervalsRef.current[routeId]) {
          clearInterval(overrideIntervalsRef.current[routeId]);
          delete overrideIntervalsRef.current[routeId];
        }
        delete overrideStateRef.current[routeId];
        return;
      }

      // If the driver is online and actively streaming real GPS coordinates, stop the admin simulation to prevent conflict
      if (state.type === "driver" && state.tripId && currentLive && currentLive.tripId === state.tripId && currentLive.active === true && currentLive.source === "driver-gps") {
        console.log("Driver GPS is active. Suspending admin simulation loop to prevent coordinates conflict.");
        if (overrideIntervalsRef.current[routeId]) {
          clearInterval(overrideIntervalsRef.current[routeId]);
          delete overrideIntervalsRef.current[routeId];
        }
        return;
      }

      let lat = 12.8258;
      let lng = 77.7665;
      let speed = 0;

      if (state.type === "simulation" || state.type === "driver") {
        const point = state.path[state.currentIndex];
        if (point) {
          lat = Number(point.lat || point[0] || 12.8258);
          lng = Number(point.lng || point[1] || 77.7665);
        }
        speed = 25;
        state.currentIndex = (state.currentIndex + 1) % state.path.length;
      } else {
        if (state.stop) {
          lat = Number(state.stop.lat || 12.8258);
          lng = Number(state.stop.lng || 77.7665);
        }
        speed = 0;
      }

      set(ref(rtdb, `routes/${routeId}/live`), {
        routeId,
        driverUid: state.driverUid,
        active: true,
        speed,
        heading: 0,
        lat,
        lng,
        updatedAt: Date.now(),
        adminStarted: state.adminStarted,
        tripId: state.tripId,
        source: "admin-simulation"
      }).catch(err => console.error("Admin RTDB write failed:", err));
    };

    updateLocation();

    if (config.type === "simulation" || config.type === "driver") {
      overrideIntervalsRef.current[routeId] = setInterval(updateLocation, 4000);
    }
  }

  function stopOverride(routeId) {
    if (overrideIntervalsRef.current[routeId]) {
      clearInterval(overrideIntervalsRef.current[routeId]);
      delete overrideIntervalsRef.current[routeId];
    }
    delete overrideStateRef.current[routeId];

    set(ref(rtdb, `routes/${routeId}/live`), {
      active: false,
      updatedAt: Date.now()
    }).catch(err => console.error("Admin RTDB stop failed:", err));
  }

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
    if (role === "student" || role === "teacher") return clean + "@campusmove.user";
    if (role === "driver") return clean + "@campusmove.driver";
    return clean;
  }

  async function handleCreateUser(e) {
    e.preventDefault();
    setUserCreateError("");
    setUserCreateSuccess("");
    if (!newUser.name.trim()) return setUserCreateError("Please enter full name.");
    if (!newUser.identifier.trim()) return setUserCreateError("Please enter username, phone, or email.");
    
    if (newUser.role === "student" || newUser.role === "teacher") {
      const id = newUser.identifier.trim().toLowerCase();
      if (id.includes("..") || id.startsWith(".") || id.endsWith(".") || /[^a-z0-9.]/.test(id)) {
        return setUserCreateError("Invalid username format. Username can only contain lowercase letters, numbers, and single dots (no spaces or consecutive/leading/trailing dots).");
      }
    }
    
    if (newUser.role === "driver" && newUser.identifier.trim().length !== 10) {
      return setUserCreateError("Driver phone number must be exactly 10 digits.");
    }
    if (newUser.password.length < 6) return setUserCreateError("Password must be at least 6 characters.");

    setUserCreating(true);
    const email = getVirtualEmail(newUser.identifier, newUser.role);
    try {
      let cred;
      try {
        cred = await createUserWithEmailAndPassword(secondaryAuth, email, newUser.password);
      } catch (err) {
        if (err.code === "auth/email-already-in-use") {
          console.log("User already exists in Auth. Attempting to heal Firestore entry by signing in...");
          cred = await signInWithEmailAndPassword(secondaryAuth, email, newUser.password);
        } else {
          throw err;
        }
      }
      
      const profile = {
        name: newUser.name.trim(),
        role: newUser.role,
        campusId: "alliance-bangalore",
        blocked: false,
        createdAt: Date.now()
      };
      if (newUser.role === "student" || newUser.role === "teacher") {
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
      } else if (c === "auth/email-already-in-use") {
        setUserCreateError("This username, phone number, or email is already registered.");
      } else if (c === "auth/wrong-password" || c === "auth/invalid-credential") {
        setUserCreateError("This account is already registered with a different password.");
      } else if (c === "auth/weak-password") {
        setUserCreateError("Password must be at least 6 characters.");
      } else {
        setUserCreateError(err.message.replace("Firebase:", "").trim());
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
  const teacherCount = users.filter(u => u.role === "teacher").length;
  const commuterCount = studentCount + teacherCount;
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
    screen: { minHeight: "100vh", background: t.bg, fontFamily: "'Inter', sans-serif", color: t.text, display: "flex", flexDirection: "column", transition: "background 0.25s, color 0.25s" },
    sidebar: { background: t.bgCard, borderRight: `1.5px solid ${t.border}`, flexDirection: "column", padding: "28px 24px", width: "260px", flexShrink: 0 },
    topbar: { background: t.bgCard, borderBottom: `1.5px solid ${t.border}`, alignItems: "center", justifyContent: "space-between", padding: "16px 20px", height: "64px" },
    content: { flex: 1, padding: "24px 20px 60px", maxWidth: "960px", margin: "0 auto", width: "100%", boxSizing: "border-box" },
    tabBtn: (active) => ({ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "12px 16px", border: "none", borderRadius: 12, background: active ? (dark ? "#1F2937" : "#EFF6FF") : "transparent", cursor: "pointer", color: active ? t.accent : t.textMuted, fontSize: 14, fontWeight: active ? 700 : 500, textAlign: "left", transition: "all 0.2s ease-in-out", borderLeft: active ? `3px solid ${t.accent}` : "3px solid transparent", fontFamily: "'Inter', sans-serif" }),
    badge: { background: dark ? "#251206" : "#FFF7ED", border: `1px solid ${dark ? "#4D260B" : "#FDBA74"}`, borderRadius: 8, padding: "4px 8px", color: "#FF5A1F", fontSize: 10, fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase" },
    card: { background: t.bgCard, border: `1.5px solid ${t.border}`, borderRadius: 12, overflow: "hidden", marginBottom: 18, boxShadow: dark ? "0 4px 20px rgba(0,0,0,0.3)" : "0 8px 30px rgba(0,0,0,0.03)" },
    cardHead: { padding: "16px 20px", borderBottom: `1.5px solid ${t.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" },
    cardLabel: { fontSize: 10, color: t.textMuted, fontWeight: 800, textTransform: "uppercase", letterSpacing: "1.5px" },
    row: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: `1.5px solid ${t.border}`, transition: "background 0.2s", color: t.text },
    input: { width: "100%", background: dark ? t.inputBg : t.bgCard2, border: `1.5px solid ${t.border}`, borderRadius: 10, padding: "13px 16px", color: t.text, fontSize: 14, outline: "none", boxSizing: "border-box", fontFamily: "'Inter', sans-serif", marginBottom: 10, transition: "border-color 0.15s" },
    addBtn: { width: "100%", background: t.accent, border: "none", borderRadius: 10, padding: "14px 0", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "'Inter', sans-serif", transition: "all 0.2s", boxShadow: `0 4px 12px ${t.accent}33` },
    delBtn: { background: "none", border: `1px solid ${dark ? "#5D1010" : "#FCA5A5"}`, borderRadius: 8, padding: "6px 12px", color: "#EF4444", fontSize: 11, cursor: "pointer", fontFamily: "'Inter', sans-serif", transition: "all 0.15s" },
    liveDot: (active, type) => {
      let bg = active ? "#10B981" : (dark ? "#374151" : "#D1D5DB");
      let shadow = active ? "0 0 8px #10B981" : "none";
      if (type === "override") {
        bg = "#F59E0B";
        shadow = "0 0 8px #F59E0B";
      }
      return { width: 8, height: 8, borderRadius: "50%", background: bg, display: "inline-block", marginRight: 8, boxShadow: shadow };
    },
    routePill: (active, type) => {
      let bg = active ? (dark ? "#0D2012" : "#ECFDF5") : (dark ? "#1F2937" : "#F3F4F6");
      let color = active ? "#10B981" : t.textMuted;
      let border = `1.5px solid ${active ? (dark ? "#1E4D2B" : "#A7F3D0") : t.border}`;
      if (type === "override") {
        bg = dark ? "#2A1D08" : "#FEF3C7";
        color = "#D97706";
        border = `1.5px solid ${dark ? "#5D3E10" : "#FDE68A"}`;
      }
      return { fontSize: 11, padding: "4px 10px", borderRadius: 20, background: bg, color, border };
    },
    rolePill: (role) => {
      const isAdm = role === "admin";
      const isDrv = role === "driver";
      const isTea = role === "teacher";
      return {
        fontSize: 11,
        padding: "4px 10px",
        borderRadius: 8,
        background: isAdm ? (dark ? "#1e1b4b" : "#e0e7ff") : isDrv ? (dark ? "#064e3b" : "#d1fae5") : isTea ? (dark ? "#0d2a1c" : "#e8f5e9") : (dark ? "#1a2e3b" : "#e0f2fe"),
        color: isAdm ? (dark ? "#818cf8" : "#4338ca") : isDrv ? (dark ? "#34d399" : "#065f46") : isTea ? (dark ? "#4ade80" : "#1b5e20") : (dark ? "#38bdf8" : "#0284c7"),
        border: `1px solid ${isAdm ? (dark ? "#312e81" : "#c7d2fe") : isDrv ? (dark ? "#064e3b" : "#a7f3d0") : isTea ? (dark ? "#1b4d2b" : "#a5d6a7") : (dark ? "#0c4a6e" : "#bae6fd")}`
      };
    },
    blockBtn: (blocked) => ({ background: "none", border: `1px solid ${blocked ? (dark ? "#1E4D2B" : "#A7F3D0") : (dark ? "#5D3E10" : "#FDBA74")}`, borderRadius: 8, padding: "6px 12px", color: blocked ? "#10B981" : "#F59E0B", fontSize: 11, cursor: "pointer", fontFamily: "'Inter', sans-serif", transition: "all 0.15s" }),
  };

  const navItems = [
    {
      id: "overview",
      label: "Overview Panel",
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
      id: "routes",
      label: "Manage Routes",
      icon: (color) => (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "stroke 0.2s" }}>
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
          <circle cx="12" cy="10" r="3"></circle>
        </svg>
      )
    },
    {
      id: "users",
      label: "Manage Users",
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
      id: "billing",
      label: "SaaS Billing",
      icon: (color) => (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "stroke 0.2s" }}>
          <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
          <line x1="1" y1="10" x2="23" y2="10"></line>
        </svg>
      )
    },
    {
      id: "attendance",
      label: "Attendance Logs",
      icon: (color) => (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "stroke 0.2s" }}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
      )
    },
    {
      id: "alerts",
      label: "Driver Alerts",
      icon: (color) => (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "stroke 0.2s" }}>
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
      )
    }
  ];

  return (
    <div style={S.screen}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
        input:focus, select:focus { border-color:${t.accent} !important; box-shadow:0 0 0 3px ${t.accent}15 !important; }
        .add-btn:active { transform: scale(0.98); }
        .custom-row:hover { background: ${dark ? "#1F293744" : "#F8F9FA"}; }
        
        /* Sidebar Responsive Layout */
        .admin-desktop-container {
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
        
        /* Responsive Grids */
        .metrics-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 12px;
          margin-bottom: 18px;
          width: 100%;
        }
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 10px;
          margin-bottom: 16px;
          width: 100%;
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
          .metrics-grid, .stats-grid {
            grid-template-columns: repeat(2, 1fr) !important;
          }
        }
      `}</style>

      {/* ── ALERTS / WARNING BANNERS ── */}
      {isExpired && (
        <div style={{ background: dark ? "#2A0808" : "#FEF2F2", borderBottom: `1.5px solid ${dark ? "#5D1010" : "#FCA5A5"}`, padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", zIndex: 30 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 18 }}>🔒</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#EF4444" }}>Institutional Subscription Expired</div>
              <div style={{ fontSize: 11, color: t.textSub, marginTop: 2 }}>Renew plan to restore standard GPS operations.</div>
            </div>
          </div>
          <button onClick={() => { setTab("billing"); setShowPlans(true); }} style={{ background: "#EF4444", border: "none", borderRadius: 8, padding: "8px 16px", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'Inter',sans-serif", boxShadow: "0 2px 10px rgba(239,68,68,0.3)" }}>
            Renew Portal
          </button>
        </div>
      )}

      {!isExpired && isWarning && (
        <div style={{ background: dark ? "#2A1F0C" : "#FFF7ED", borderBottom: `1.5px solid ${dark ? "#5D3E10" : "#FDBA74"}`, padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", zIndex: 30 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 18 }}>⚠️</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#F59E0B" }}>{daysLeft} days remaining on subscription</div>
              <div style={{ fontSize: 11, color: t.textSub, marginTop: 2 }}>Upgrade or renew now to prevent service interruption.</div>
            </div>
          </div>
          <button onClick={() => { setTab("billing"); setShowPlans(true); }} style={{ background: "#F59E0B", border: "none", borderRadius: 8, padding: "8px 16px", color: "#000", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'Inter',sans-serif", boxShadow: "0 2px 10px rgba(245,158,11,0.3)" }}>
            Renew Now
          </button>
        </div>
      )}

      {subscription?.status === "trial" && (
        <div style={{ background: dark ? "#0F172A" : "#EFF6FF", borderBottom: `1.5px solid ${dark ? "#1E3A8A" : "#BFDBFE"}`, padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", zIndex: 30 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 18 }}>🎯</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: t.accent }}>14-day Institutional Trial Active — {daysLeft} days left</div>
              <div style={{ fontSize: 11, color: t.textSub, marginTop: 2 }}>Unlock unlimited routes, attendance automation, and analytics.</div>
            </div>
          </div>
          <button onClick={() => { setTab("billing"); setShowPlans(true); }} style={{ background: t.accent, border: "none", borderRadius: 8, padding: "8px 16px", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'Inter',sans-serif", boxShadow: `0 2px 10px ${t.accent}44` }}>
            Upgrade Now
          </button>
        </div>
      )}

      {showBillingSuccess && (
        <div style={{ background: dark ? "#0D2012" : "#ECFDF5", borderBottom: `1.5px solid ${dark ? "#1E4D2B" : "#A7F3D0"}`, padding: "14px 20px", display: "flex", alignItems: "center", gap: 10, zIndex: 30 }}>
          <span>✅</span>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#10B981" }}>Subscription updated to CampusMove {currentPlan.name}!</div>
        </div>
      )}

      <div className="admin-desktop-container">
        {/* ── DESKTOP SIDEBAR ── */}
        <div className="sidebar-panel" style={S.sidebar}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 32 }}>
            <div style={{ width: 34, height: 34, background: "#FF5A1F", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🚌</div>
            <div>
              <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: "-0.5px", color: t.text }}>CampusMove</span>
              <div style={{ fontSize: 9, color: t.textMuted, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", marginTop: 2 }}>Alliance University</div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
            {navItems.map(item => {
              const active = tab === item.id;
              const currentColor = active ? t.accent : t.textMuted;
              return (
                <button key={item.id} style={S.tabBtn(active)} onClick={() => { setTab(item.id); setShowPlans(false); }}>
                  {item.icon(currentColor)}
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          <div style={{ borderTop: `1.5px solid ${t.border}`, paddingTop: 20, marginTop: 20 }}>
            {subscription && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: dark ? t.inputBg : t.bgCard2, padding: "10px 14px", borderRadius: 10, border: `1.5px solid ${t.border}`, marginBottom: 14 }}>
                <span style={{ fontSize: 11, color: t.textSub, fontWeight: 600 }}>{currentPlan.emoji} {currentPlan.name}</span>
                <span style={S.badge}>{subscription.status === "trial" ? "Trial" : "Paid"}</span>
              </div>
            )}
            
            {/* Desktop Theme Switcher */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, padding: "0 4px" }}>
              <span style={{ fontSize: 12, color: t.textSub, fontWeight: 600 }}>Theme Mode</span>
              <button onClick={toggle} style={{ width: 34, height: 34, borderRadius: 10, border: `1.5px solid ${t.border}`, background: t.bgCard, cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s" }}>
                {dark ? "☀️" : "🌙"}
              </button>
            </div>

            <button onClick={logout} style={{ ...S.addBtn, background: "transparent", border: `1.5px solid ${t.border}`, padding: "10px 0", fontSize: 12, color: t.textSub, boxShadow: "none" }}>
              ↩ Sign Out
            </button>
          </div>
        </div>

        {/* ── MOBILE HEADER (HIDDEN ON DESKTOP) ── */}
        <div className="topbar-panel" style={S.topbar}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 28, height: 28, background: "#FF5A1F", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>🚌</div>
            <span style={{ fontSize: 14, fontWeight: 800, color: t.text }}>CampusMove</span>
            <span style={{ ...S.badge, padding: "2px 6px", fontSize: 9 }}>Admin</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={toggle} style={{ width: 30, height: 30, borderRadius: 8, border: `1.5px solid ${t.border}`, background: t.bgCard, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s" }}>
              {dark ? "☀️" : "🌙"}
            </button>
            <button onClick={logout} style={{ background: "none", border: `1.5px solid ${t.border}`, borderRadius: 8, padding: "4px 10px", color: t.textSub, fontSize: 11, cursor: "pointer", fontFamily: "'Inter', sans-serif" }}>
              Sign Out
            </button>
          </div>
        </div>

        {/* ── MOBILE TABS (HIDDEN ON DESKTOP) ── */}
        <div className="topbar-panel" style={{ background: t.bgCard, borderBottom: `1.5px solid ${t.border}`, padding: "8px 12px" }}>
          <div style={{ display: "flex", gap: 4, width: "100%" }}>
            {navItems.map(item => {
              const active = tab === item.id;
              return (
                <button key={item.id} style={{
                  flex: 1,
                  padding: "8px 0",
                  border: "none",
                  borderRadius: 8,
                  background: active ? (dark ? "#1F2937" : "#EFF6FF") : "transparent",
                  color: active ? t.accent : t.textMuted,
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "'Inter', sans-serif",
                  transition: "all 0.2s"
                }} onClick={() => { setTab(item.id); setShowPlans(false); }}>
                  {item.label.split(" ")[0]}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── CONTENT CONTAINER ── */}
        <div className="admin-content" style={S.content}>

          {/* ══════════════ OVERVIEW TAB ══════════════ */}
          {tab === "overview" && (
            <>
              {/* Metric widgets grid */}
              <div className="metrics-grid">
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
                <div style={{ ...S.card, border: `1.5px solid ${currentPlan.color}33` }}>
                  <div style={{ padding: "18px 20px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyBetween: "center", justifyContent: "space-between", marginBottom: 16 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 24 }}>{currentPlan.emoji}</span>
                        <div>
                          <div style={{ fontSize: 15, fontWeight: 800, color: currentPlan.color }}>{currentPlan.name} Plan</div>
                          <div style={{ fontSize: 12, color: t.textMuted, marginTop: 2 }}>
                            {subscription.status === "trial" ? "Trial License" : `₹${(subscription.billing === "yearly" ? currentPlan.yearly : currentPlan.monthly).toLocaleString("en-IN")}/${subscription.billing === "yearly" ? "year" : "month"}`}
                          </div>
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 10, color: t.textMuted, fontWeight: 700, textTransform: "uppercase" }}>Expires</div>
                        <div style={{ fontSize: 13, color: daysLeft <= 7 ? "#F59E0B" : t.textSub, fontWeight: 700, marginTop: 4 }}>{formatDate(subscription.expiryDate)}</div>
                      </div>
                    </div>

                    {/* Progress tracking bars */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 12, borderTop: `1.5px solid ${t.border}`, paddingTop: 16 }}>
                      <div>
                        <div style={{ display: "flex", justifyBetween: "center", justifyContent: "space-between", marginBottom: 6 }}>
                          <span style={{ fontSize: 12, color: t.textMuted, fontWeight: 500 }}>Routes quota</span>
                          <span style={{ fontSize: 12, color: t.textSub, fontWeight: 700 }}>{totalRoutes} / {currentPlan.limits.routes === Infinity ? "Unlimited" : currentPlan.limits.routes}</span>
                        </div>
                        <div style={{ height: 4, background: dark ? t.inputBg : t.bgCard2, borderRadius: 2 }}>
                          <div style={{ height: 4, background: currentPlan.color, borderRadius: 2, width: currentPlan.limits.routes === Infinity ? "40%" : `${Math.min(100, (totalRoutes / currentPlan.limits.routes) * 100)}%`, transition: "width 0.4s" }}/>
                        </div>
                      </div>
                      <div>
                        <div style={{ display: "flex", justifyBetween: "center", justifyContent: "space-between", marginBottom: 6 }}>
                          <span style={{ fontSize: 12, color: t.textMuted, fontWeight: 500 }}>Students capacity</span>
                          <span style={{ fontSize: 12, color: t.textSub, fontWeight: 700 }}>{commuterCount} / {currentPlan.limits.students === Infinity ? "Unlimited" : currentPlan.limits.students}</span>
                        </div>
                        <div style={{ height: 4, background: dark ? t.inputBg : t.bgCard2, borderRadius: 2 }}>
                          <div style={{ height: 4, background: currentPlan.color, borderRadius: 2, width: currentPlan.limits.students === Infinity ? "20%" : `${Math.min(100, (commuterCount / currentPlan.limits.students) * 100)}%`, transition: "width 0.4s" }}/>
                        </div>
                      </div>
                    </div>

                    <button onClick={() => { setTab("billing"); setShowPlans(true); }} style={{ marginTop: 18, width: "100%", background: "transparent", border: `1.5px solid ${currentPlan.color}44`, borderRadius: 10, padding: "12px 0", color: currentPlan.color, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "'Inter',sans-serif", transition: "all 0.2s" }}>
                      {subscription.plan === "basic" ? "⚡ Upgrade to Premium Features" : "Manage billing licenses"}
                    </button>
                  </div>
                </div>
              )}

              {/* Live telemetry list */}
              <div style={S.card}>
                <div style={S.cardHead}><span style={S.cardLabel}>Real-time Bus telemetry</span></div>
                {(() => {
                  const allVisibleRoutes = [
                    ...PRESET_ROUTES.filter(pr => !hiddenPresets.includes(pr.id)).map(r => ({ ...r, isPreset: true })),
                    ...routes.map(r => ({ ...r, isPreset: false }))
                  ];
                  if (allVisibleRoutes.length === 0) {
                    return (
                      <div style={{ padding: 24, textAlign: "center", color: t.textMuted, fontSize: 13 }}>
                        No routes configured. Please add routes under the Manage Routes tab.
                      </div>
                    );
                  }
                  return allVisibleRoutes.map(pr => {
                    const liveData = liveStatus[pr.id]?.live;
                    const active = liveData?.active;
                    const override = pr.isPreset ? (presetOverrides[pr.id] || {}) : {};
                    const displayRoute = { ...pr, ...override };
                    const driverUid = liveData?.driverUid;
                    const driverUser = users.find(u => u.id === driverUid);
                    const driverName = driverUser?.name || (driverUid ? "Driver" : null);
                    const speed = liveData?.speed || 0;
                    return (
                      <div key={pr.id} className="custom-row" style={S.row}>
                        <div>
                          <div style={{ fontSize: 14, color: t.text, fontWeight: 700 }}>{displayRoute.name}</div>
                          <div style={{ fontSize: 12, color: t.textMuted, marginTop: 4 }}>{displayRoute.label}</div>
                          {active && driverName && <div style={{ fontSize: 11, color: t.accent, fontWeight: 600, marginTop: 6 }}>🚌 {driverName} · {speed} km/h</div>}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          {active ? (
                            <>
                              {driverUid === "admin-override" ? (
                                <span style={S.routePill(true, "override")}>
                                  <span style={S.liveDot(true, "override")} />Admin Override
                                </span>
                              ) : (
                                <span style={S.routePill(true)}>
                                  <span style={S.liveDot(true)} />Live (Driver)
                                </span>
                              )}
                              <button
                                onClick={() => stopOverride(pr.id)}
                                style={{
                                  background: "#FEF2F2", border: "1px solid #FCA5A5", borderRadius: 8,
                                  padding: "6px 12px", color: "#B91C1C", fontSize: 11, fontWeight: 600,
                                  cursor: "pointer", fontFamily: "'Inter', sans-serif"
                                }}
                              >
                                Stop
                              </button>
                            </>
                          ) : (
                            <>
                              <span style={S.routePill(false)}>
                                <span style={S.liveDot(false)} />Offline
                              </span>
                              <button
                                onClick={() => openOverrideModal(pr.id)}
                                style={{
                                  background: dark ? "#3F2810" : "#FFF7ED", border: `1.5px solid ${t.border}`, borderRadius: 8,
                                  padding: "6px 12px", color: t.accent, fontSize: 11, fontWeight: 700,
                                  cursor: "pointer", fontFamily: "'Inter', sans-serif"
                                }}
                              >
                                Override
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  });
                })()}
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
                              <button onClick={saveEditRoute} disabled={editSaving} className="add-btn" style={{ flex: 1, background: t.accent, border: "none", borderRadius: 10, padding: "10px 0", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'Inter', sans-serif" }}>{editSaving ? "Saving..." : "Save Changes"}</button>
                              <button onClick={() => setEditingRoute(null)} style={{ flex: 1, background: "none", border: `1.5px solid ${t.border}`, borderRadius: 10, padding: "10px 0", color: t.textSub, fontSize: 12, cursor: "pointer", fontFamily: "'Inter', sans-serif" }}>Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <div style={{ display: "flex", width: "100%", alignItems: "center", justifyBetween: "center", justifyContent: "space-between" }}>
                            <div>
                              <div style={{ fontSize: 14, color: t.text, fontWeight: 700 }}>{displayRoute.name}</div>
                              <div style={{ fontSize: 12, color: t.textMuted, marginTop: 4 }}>{displayRoute.label}</div>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <span style={S.routePill(active)}><span style={S.liveDot(active)} />{active ? "Live" : "Offline"}</span>
                              <button onClick={() => setEditingRoute({ id: pr.id, name: displayRoute.name, label: displayRoute.label, description: displayRoute.description || "", isPreset: true })} style={{ background: "none", border: `1.5px solid ${t.border}`, borderRadius: 8, padding: "6px 12px", color: t.textSub, fontSize: 11, cursor: "pointer", fontFamily: "'Inter', sans-serif" }}>Edit</button>
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
                  <div style={{ padding: 16, color: t.textMuted, fontSize: 12, textAlign: "center" }}>No matching custom routes</div>
                ) : (
                  filteredCustomRoutes.map(route => (
                    <div key={route.id} className="custom-row" style={{ ...S.row, flexDirection: "column", alignItems: "flex-start", gap: 10 }}>
                      {editingRoute?.id === route.id ? (
                        <div style={{ width: "100%" }}>
                          <input value={editingRoute.name} onChange={e => setEditingRoute({...editingRoute, name: e.target.value})} style={S.input} placeholder="Route name" />
                          <input value={editingRoute.label} onChange={e => setEditingRoute({...editingRoute, label: e.target.value})} style={S.input} placeholder="Label" />
                          <input value={editingRoute.description || ""} onChange={e => setEditingRoute({...editingRoute, description: e.target.value})} style={{...S.input, marginBottom: 12}} placeholder="Description" />
                          <div style={{ display: "flex", gap: 8 }}>
                            <button onClick={saveEditRoute} disabled={editSaving} className="add-btn" style={{ flex: 1, background: t.accent, border: "none", borderRadius: 10, padding: "10px 0", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'Inter', sans-serif" }}>{editSaving ? "Saving..." : "Save Changes"}</button>
                            <button onClick={() => setEditingRoute(null)} style={{ flex: 1, background: "none", border: `1.5px solid ${t.border}`, borderRadius: 10, padding: "10px 0", color: t.textSub, fontSize: 12, cursor: "pointer", fontFamily: "'Inter', sans-serif" }}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: "flex", width: "100%", alignItems: "center", justifyBetween: "center", justifyContent: "space-between" }}>
                          <div>
                            <div style={{ fontSize: 14, color: t.text, fontWeight: 700 }}>{route.name}</div>
                            <div style={{ fontSize: 12, color: t.textMuted, marginTop: 4 }}>{route.label}</div>
                          </div>
                          <div style={{ display: "flex", gap: 8 }}>
                            <button onClick={() => setEditingRoute({ id: route.id, name: route.name, label: route.label, description: route.description || "" })} style={{ background: "none", border: `1.5px solid ${t.border}`, borderRadius: 8, padding: "6px 12px", color: t.textSub, fontSize: 11, cursor: "pointer", fontFamily: "'Inter', sans-serif" }}>Edit</button>
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
              <div className="stats-grid">
                {[["Total Users", users.length, t.text], ["Students", studentCount, "#60A5FA"], ["Faculty", teacherCount, "#10B981"], ["Drivers", driverCount, "#A78BFA"], ["Blocked", blockedCount, "#EF4444"]].map(([l, v, c]) => (
                  <div key={l} style={{ background: t.bgCard, border: `1.5px solid ${t.border}`, borderRadius: 12, padding: "14px 10px", textAlign: "center", boxShadow: dark ? "0 4px 20px rgba(0,0,0,0.3)" : "0 8px 30px rgba(0,0,0,0.03)" }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: c, letterSpacing: "-0.5px", fontFamily: "'Inter', sans-serif" }}>{v}</div>
                    <div style={{ fontSize: 9, color: t.textMuted, marginTop: 4, textTransform: "uppercase", letterSpacing: "0.8px", fontWeight: 700 }}>{l}</div>
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
                  ? <div style={{ padding: 24, color: t.textMuted, fontSize: 13, textAlign: "center" }}>No matching accounts found</div>
                  : filteredUsers.map(u => (
                    <div key={u.id} className="custom-row" style={{ ...S.row, flexDirection: "column", alignItems: "flex-start", gap: 12, background: u.blocked ? (dark ? "#2A080811" : "#FEF2F233") : "transparent" }}>
                      <div style={{ display: "flex", width: "100%", alignItems: "center", justifyBetween: "center", justifyContent: "space-between" }}>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <div style={{ fontSize: 14, color: u.blocked ? t.textMuted : t.text, fontWeight: 700, textDecoration: u.blocked ? "line-through" : "none" }}>{u.name || "—"}</div>
                            {u.blocked && <span style={{ fontSize: 9, color: "#EF4444", background: dark ? "#2A0808" : "#FEF2F2", border: `1px solid ${dark ? "#5D1010" : "#FCA5A5"}`, borderRadius: 6, padding: "2px 6px", fontWeight: 700, textTransform: "uppercase" }}>Blocked</span>}
                          </div>
                          <div style={{ fontSize: 12, color: t.textMuted, marginTop: 4, fontFamily: "monospace" }}>
                            {u.username ? `username: ${u.username}` : u.phone ? `phone: ${u.phone}` : u.email}
                          </div>
                        </div>
                        <span style={S.rolePill(u.role)}>{u.role}</span>
                      </div>

                      {u.id !== user?.uid && (
                        <div style={{ display: "flex", gap: 8, width: "100%", borderTop: `1.5px solid ${t.border}`, paddingTop: 10 }}>
                          <button onClick={() => u.blocked ? unblockUser(u.id) : setConfirmId({ id: u.id, action: "block" })} style={S.blockBtn(u.blocked)}>
                            {u.blocked ? "✓ Unblock" : "⊘ Block User"}
                          </button>
                          <select value={u.role} onChange={e => changeRole(u.id, e.target.value)}
                            style={{ flex: 1, background: dark ? t.inputBg : t.bgCard2, border: `1.5px solid ${t.border}`, borderRadius: 8, padding: "4px 10px", color: t.textSub, fontSize: 11, fontFamily: "'Inter', sans-serif", cursor: "pointer" }}>
                            <option value="student">Student</option>
                            <option value="teacher">Faculty / Teacher</option>
                            <option value="driver">Driver</option>
                            <option value="admin">Admin</option>
                          </select>
                          <button onClick={() => setConfirmId({ id: u.id, action: "delete" })} style={S.delBtn}>🗑 Delete</button>
                        </div>
                      )}

                      {confirmId?.id === u.id && (
                        <div style={{ width: "100%", background: dark ? "#2A0808" : "#FEF2F2", border: `1.5px solid ${dark ? "#5D1010" : "#FCA5A5"}`, borderRadius: 12, padding: "14px", marginTop: 4 }}>
                          <p style={{ fontSize: 13, color: "#EF4444", margin: "0 0 12px", fontWeight: 600 }}>
                            {confirmId.action === "delete" ? `⚠ Delete ${u.name || u.email}? This action is irreversible.` : `⊘ Block ${u.name || u.email}? Access will be immediately revoked.`}
                          </p>
                          <div style={{ display: "flex", gap: 8 }}>
                            <button onClick={() => confirmId.action === "delete" ? deleteUser(u.id) : blockUser(u.id)}
                              style={{ flex: 1, background: "#EF4444", border: "none", borderRadius: 10, padding: "10px 0", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'Inter', sans-serif" }}>
                              {confirmId.action === "delete" ? "Yes, Delete" : "Yes, Block"}
                            </button>
                            <button onClick={() => setConfirmId(null)}
                              style={{ flex: 1, background: "none", border: `1.5px solid ${t.border}`, borderRadius: 10, padding: "10px 0", color: t.textSub, fontSize: 12, cursor: "pointer", fontFamily: "'Inter', sans-serif" }}>
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
                <form onSubmit={handleCreateUser} style={{ padding: 24 }}>
                  <div style={{ marginBottom: 14 }}>
                    <label style={{ fontSize: 11, fontWeight: 700, color: t.textMuted, letterSpacing: "0.5px", display: "block", marginBottom: 6, textTransform: "uppercase" }}>Role Type</label>
                    <select
                      value={newUser.role}
                      onChange={e => setNewUser({ ...newUser, role: e.target.value, identifier: "" })}
                      style={{ ...S.input, height: 46, padding: "0 16px", marginBottom: 0, cursor: "pointer" }}
                    >
                      <option value="student">Student</option>
                      <option value="teacher">Faculty / Teacher</option>
                      <option value="driver">Driver</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                  <div style={{ marginBottom: 14 }}>
                    <label style={{ fontSize: 11, fontWeight: 700, color: t.textMuted, letterSpacing: "0.5px", display: "block", marginBottom: 6, textTransform: "uppercase" }}>Full Name</label>
                    <input
                      value={newUser.name}
                      onChange={e => setNewUser({ ...newUser, name: e.target.value })}
                      placeholder="e.g. John Doe"
                      style={{ ...S.input, marginBottom: 0 }}
                    />
                  </div>
                  <div style={{ marginBottom: 14 }}>
                    <label style={{ fontSize: 11, fontWeight: 700, color: t.textMuted, letterSpacing: "0.5px", display: "block", marginBottom: 6, textTransform: "uppercase" }}>
                      {(newUser.role === "student" || newUser.role === "teacher") ? "Username" : newUser.role === "driver" ? "Phone Number (10 digits)" : "Email Address"}
                    </label>
                    <input
                      value={newUser.identifier}
                      onChange={e => setNewUser({ ...newUser, identifier: e.target.value })}
                      placeholder={(newUser.role === "student" || newUser.role === "teacher") ? "e.g. john123 or prof.nair" : newUser.role === "driver" ? "e.g. 9876543210" : "e.g. admin@test.com"}
                      maxLength={newUser.role === "driver" ? 10 : undefined}
                      style={{ ...S.input, marginBottom: 0 }}
                    />
                  </div>
                  <div style={{ marginBottom: 20 }}>
                    <label style={{ fontSize: 11, fontWeight: 700, color: t.textMuted, letterSpacing: "0.5px", display: "block", marginBottom: 6, textTransform: "uppercase" }}>Password</label>
                    <div style={{ position: "relative" }}>
                      <input
                        type={showCreatePwd ? "text" : "password"}
                        value={newUser.password}
                        onChange={e => setNewUser({ ...newUser, password: e.target.value })}
                        placeholder="Min 6 characters"
                        style={{ ...S.input, marginBottom: 0, paddingRight: 44 }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowCreatePwd(p => !p)}
                        style={{
                          position: "absolute",
                          right: 12,
                          top: "50%",
                          transform: "translateY(-50%)",
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          fontSize: 14,
                          color: "#9CA3AF",
                          padding: 0
                        }}
                      >
                        {showCreatePwd ? "🙈" : "👁"}
                      </button>
                    </div>
                  </div>

                  {userCreateError && (
                    <div style={{ background: dark ? "#250A0A" : "#FEF2F2", border: `1.5px solid ${dark ? "#5D1515" : "#FCA5A5"}`, borderRadius: 10, padding: "12px 14px", marginBottom: 14 }}>
                      <p style={{ color: "#EF4444", fontSize: 12, margin: 0, fontWeight: 600 }}>⚠️ {userCreateError}</p>
                    </div>
                  )}

                  {userCreateSuccess && (
                    <div style={{ background: dark ? "#0D2012" : "#ECFDF5", border: `1.5px solid ${dark ? "#1E4D2B" : "#A7F3D0"}`, borderRadius: 10, padding: "12px 14px", marginBottom: 14 }}>
                      <p style={{ color: "#10B981", fontSize: 12, margin: 0, fontWeight: 600 }}>✅ {userCreateSuccess}</p>
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
                          {subscription.status === "trial" ? "Trial License" : `₹${(subscription.billing === "yearly" ? currentPlan.yearly : currentPlan.monthly).toLocaleString("en-IN")} / ${subscription.billing === "yearly" ? "year" : "month"}`}
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
                        <div key={l} style={{ background: dark ? t.inputBg : t.bgCard2, borderRadius: 10, padding: "12px 14px", border: `1.5px solid ${t.border}` }}>
                          <div style={{ fontSize: 9, color: t.textMuted, textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: 6, fontWeight: 700 }}>{l}</div>
                          <div style={{ fontSize: 13, color: t.textSub, fontWeight: 700 }}>{v}</div>
                        </div>
                      ))}
                    </div>

                    <div style={{ marginBottom: 20 }}>
                      <div style={{ fontSize: 10, color: t.textMuted, marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.8px", fontWeight: 700 }}>Included plan privileges</div>
                      {currentPlan.features.map((f, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                          <span style={{ color: currentPlan.color, fontSize: 14 }}>✓</span>
                          <span style={{ fontSize: 13, color: t.textSub }}>{f}</span>
                        </div>
                      ))}
                    </div>

                    <button onClick={() => setShowPlans(true)} className="add-btn" style={{ width: "100%", background: currentPlan.id === "basic" ? t.accent : "transparent", border: `1.5px solid ${currentPlan.id === "basic" ? t.accent : t.border}`, borderRadius: 10, padding: "14px 0", color: currentPlan.id === "basic" ? "#fff" : t.textSub, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "'Inter',sans-serif", transition: "all 0.2s" }}>
                      {currentPlan.id === "basic" ? "⚡ Upgrade to Enterprise Premium" : "Change subscription plan"}
                    </button>
                  </div>
                </div>
              )}

              {/* Plan comparison selector */}
              {showPlans && (
                <>
                  <div style={{ display: "flex", alignItems: "center", justifyBetween: "center", justifyContent: "space-between", marginBottom: 20 }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: t.text, letterSpacing: "-0.5px" }}>Choose Institutional Plan</div>
                    <button onClick={() => setShowPlans(false)} style={{ background: "none", border: `1.5px solid ${t.border}`, borderRadius: 10, padding: "6px 14px", color: t.textSub, fontSize: 12, cursor: "pointer", fontFamily: "'Inter',sans-serif" }}>← Back</button>
                  </div>

                  {/* Toggle Billing billing cycle */}
                  <div style={{ display: "flex", background: dark ? t.inputBg : t.bgCard2, borderRadius: 12, padding: 4, marginBottom: 20, border: `1.5px solid ${t.border}` }}>
                    {[["monthly", "Monthly cycle"], ["yearly", "Yearly billing"]].map(([v, l]) => (
                      <button key={v} onClick={() => setBillingCycle(v)} style={{ flex: 1, padding: "10px 0", border: "none", borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "'Inter',sans-serif", background: billingCycle === v ? t.accent : "transparent", color: billingCycle === v ? "#fff" : t.textMuted, transition: "all 0.2s" }}>
                        {l} {v === "yearly" && <span style={{ fontSize: 9, background: "#fff2", borderRadius: 6, padding: "2px 6px", marginLeft: 6, fontWeight: 800 }}>10% OFF</span>}
                      </button>
                    ))}
                  </div>

                  {/* Pricing grid */}
                  {Object.values(PLANS).map(plan => {
                    const price = billingCycle === "yearly" ? plan.yearly : plan.monthly;
                    const isCurrent = subscription?.plan === plan.id && subscription?.billing === billingCycle;
                    return (
                      <div key={plan.id} style={{ background: t.bgCard, border: `2px solid ${isCurrent ? plan.color : t.border}`, borderRadius: 12, padding: "24px", marginBottom: 16, position: "relative", boxShadow: dark ? "0 4px 20px rgba(0,0,0,0.3)" : "0 8px 30px rgba(0,0,0,0.03)" }}>
                        {plan.id === "premium" && (
                          <div style={{ position: "absolute", top: -10, right: 20, background: "#FF5A1F", borderRadius: 6, padding: "3px 12px", fontSize: 10, fontWeight: 800, color: "#fff", letterSpacing: "0.5px" }}>POPULAR</div>
                        )}
                        {isCurrent && (
                          <div style={{ position: "absolute", top: -10, left: 20, background: plan.color, borderRadius: 6, padding: "3px 12px", fontSize: 10, fontWeight: 800, color: "#000", letterSpacing: "0.5px" }}>CURRENT PLAN</div>
                        )}
                        
                        <div style={{ display: "flex", alignItems: "center", justifyBetween: "center", justifyContent: "space-between", marginBottom: 18, borderBottom: `1.5px solid ${t.border}`, paddingBottom: 16 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            <span style={{ fontSize: 28 }}>{plan.emoji}</span>
                            <div>
                              <div style={{ fontSize: 16, fontWeight: 800, color: plan.color }}>{plan.name}</div>
                              <div style={{ fontSize: 11, color: t.textMuted, marginTop: 4 }}>{plan.id === "basic" ? "Basic Tracking" : "Institutes & Colleges"}</div>
                            </div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            {billingCycle === "yearly" && (
                              <div style={{ fontSize: 13, textDecoration: "line-through", color: t.textMuted, marginBottom: 2 }}>
                                ₹{(plan.monthly * 12).toLocaleString("en-IN")}
                              </div>
                            )}
                            <div style={{ fontSize: 24, fontWeight: 800, color: t.text, letterSpacing: "-1px" }}>₹{price.toLocaleString("en-IN")}</div>
                            <div style={{ fontSize: 11, color: t.textMuted, marginTop: 2 }}>/{billingCycle === "yearly" ? "year" : "month"}</div>
                          </div>
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
                          {plan.features.map((f, i) => (
                            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <span style={{ color: plan.color, fontSize: 12 }}>✓</span>
                              <span style={{ fontSize: 13, color: t.textSub }}>{f}</span>
                            </div>
                          ))}
                        </div>

                        <button
                          onClick={() => selectPlan(plan.id)}
                          disabled={planSaving || isCurrent}
                          className="add-btn"
                          style={{ width: "100%", background: isCurrent ? (dark ? t.inputBg : t.bgCard2) : plan.color, border: "none", borderRadius: 10, padding: "14px 0", color: isCurrent ? t.textMuted : "#fff", fontSize: 13, fontWeight: 700, cursor: isCurrent ? "not-allowed" : "pointer", fontFamily: "'Inter',sans-serif" }}>
                          {planSaving ? "Activating License..." : isCurrent ? "Active Plan" : `Select ${plan.name}`}
                        </button>

                        {!isCurrent && (
                          <div style={{ textAlign: "center", marginTop: 10, fontSize: 11, color: t.textMuted }}>
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



          {/* ══════════════ ATTENDANCE LOGS TAB ══════════════ */}
          {tab === "attendance" && (
            <div style={S.card}>
              <div style={S.cardHead}>
                <span style={S.cardLabel}>Boarding & Attendance History</span>
                <span style={{ fontSize: 11, color: t.textMuted, fontWeight: 600 }}>Individual Bus Check-Ins</span>
              </div>
              <div style={{ padding: 20 }}>
                {/* Route filter dropdown */}
                <div style={{ marginBottom: 20 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: t.textMuted, textTransform: "uppercase", display: "block", marginBottom: 6 }}>
                    Filter by Bus Route
                  </label>
                  <select
                    value={selectedFilterRouteId}
                    onChange={e => setSelectedFilterRouteId(e.target.value)}
                    style={{ ...S.input, marginBottom: 0, height: 44, padding: "0 14px" }}
                  >
                    <option value="all">All Routes / Buses</option>
                    {[
                      ...PRESET_ROUTES.filter(pr => !hiddenPresets.includes(pr.id)).map(r => ({ ...r, isPreset: true })),
                      ...routes.map(r => ({ ...r, isPreset: false }))
                    ].map(r => (
                      <option key={r.id} value={r.id}>{r.name} ({r.label || "No Label"})</option>
                    ))}
                  </select>
                </div>

                {/* Logs list */}
                {(() => {
                  const filteredLogs = selectedFilterRouteId === "all"
                    ? attendanceLogs
                    : attendanceLogs.filter(log => log.routeId === selectedFilterRouteId);

                  const getDaysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
                  const firstDay = new Date(calYear, calMonth, 1).getDay();
                  const daysInMonth = getDaysInMonth(calYear, calMonth);
                  const monthName = new Date(calYear, calMonth).toLocaleString("default", { month: "long" });

                  const cells = [];
                  for (let i = 0; i < firstDay; i++) cells.push(null);
                  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

                  const getDayLogs = (dateStr) => {
                    return filteredLogs.filter(log => {
                      const logDate = new Date(log.timestamp);
                      const logDateStr = `${logDate.getFullYear()}-${String(logDate.getMonth() + 1).padStart(2, "0")}-${String(logDate.getDate()).padStart(2, "0")}`;
                      return logDateStr === dateStr;
                    });
                  };

                  const getDayCounts = (dateStr) => {
                    const dayLogs = getDayLogs(dateStr);
                    const students = dayLogs.filter(log => {
                      const u = users.find(usr => usr.id === log.studentId);
                      return (u?.role || "student") === "student";
                    }).length;
                    const faculty = dayLogs.filter(log => {
                      const u = users.find(usr => usr.id === log.studentId);
                      return u?.role === "teacher";
                    }).length;
                    return { students, faculty, total: students + faculty };
                  };

                  const getMonthlyTotal = () => {
                    return filteredLogs.filter(log => {
                      const logDate = new Date(log.timestamp);
                      return logDate.getMonth() === calMonth && logDate.getFullYear() === calYear;
                    }).length;
                  };

                  const selectedLogs = getDayLogs(selectedDateStr);
                  const selectedCounts = getDayCounts(selectedDateStr);

                  const formattedSelectedDate = new Date(selectedDateStr).toLocaleDateString("en-IN", {
                    day: "numeric", month: "long", year: "numeric"
                  });

                  return (
                    <>
                      {/* Calendar View */}
                      <div style={{ background: t.bgCard, border: `1.5px solid ${t.border}`, borderRadius: 12, overflow: "hidden", marginBottom: 20 }}>
                        <div style={{ padding: "12px 16px", borderBottom: `1px solid ${t.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <button
                            onClick={() => {
                              if (calMonth === 0) {
                                setCalMonth(11);
                                setCalYear(y => y - 1);
                              } else {
                                setCalMonth(m => m - 1);
                              }
                            }}
                            style={{ background: "none", border: `1.5px solid ${t.border}`, color: t.textSub, cursor: "pointer", fontSize: 18, width: 32, height: 32, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}
                          >
                            ‹
                          </button>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span style={{ fontSize: 14, fontWeight: 800, color: t.text }}>{monthName} {calYear}</span>
                            <span style={{
                              fontSize: 10, fontWeight: 700, padding: "2.5px 8px", borderRadius: 6,
                              background: dark ? "#1a2e3b" : "#e0f2fe", color: dark ? "#38bdf8" : "#0284c7"
                            }}>
                              {getMonthlyTotal()} Total Check-ins
                            </span>
                          </div>
                          <button
                            onClick={() => {
                              if (calMonth === 11) {
                                setCalMonth(0);
                                setCalYear(y => y + 1);
                              } else {
                                setCalMonth(m => m + 1);
                              }
                            }}
                            style={{ background: "none", border: `1.5px solid ${t.border}`, color: t.textSub, cursor: "pointer", fontSize: 18, width: 32, height: 32, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}
                          >
                            ›
                          </button>
                        </div>
                        <div style={{ padding: 12 }}>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 8 }}>
                            {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d, i) => (
                              <div key={i} style={{ textAlign: "center", fontSize: 10, color: t.textMuted, fontWeight: 700, textTransform: "uppercase" }}>
                                {d}
                              </div>
                            ))}
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
                            {cells.map((d, i) => {
                              if (!d) return <div key={i} />;
                              const ds = `${calYear}-${String(calMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
                              const counts = getDayCounts(ds);
                              const isSelected = selectedDateStr === ds;
                              const isToday = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-${String(new Date().getDate()).padStart(2, "0")}` === ds;

                              let bg = "transparent";
                              let color = t.textSub;
                              let border = "none";

                              if (isSelected) {
                                bg = t.accent;
                                color = "#fff";
                              } else if (counts.total > 0) {
                                bg = dark ? "#112B1B" : "#ECFDF5";
                                color = "#10B981";
                                border = `1px solid ${dark ? "#1E4D2B" : "#A7F3D0"}`;
                              } else if (isToday) {
                                border = `1px solid ${t.accent}`;
                                color = t.accent;
                              }

                              return (
                                <button
                                  key={i}
                                  onClick={() => setSelectedDateStr(ds)}
                                  style={{
                                    aspectRatio: "1",
                                    borderRadius: 8,
                                    border,
                                    background: bg,
                                    color,
                                    display: "flex",
                                    flexDirection: "column",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    cursor: "pointer",
                                    padding: 2,
                                    outline: "none",
                                    fontFamily: "'Inter', sans-serif"
                                  }}
                                >
                                  <span style={{ fontSize: 11, fontWeight: isToday || isSelected ? 800 : 500 }}>{d}</span>
                                  {counts.total > 0 && !isSelected && (
                                    <span style={{ fontSize: 8, fontWeight: 700, marginTop: 2, color: "#10B981" }}>
                                      {counts.total}
                                    </span>
                                  )}
                                  {counts.total > 0 && isSelected && (
                                    <span style={{ fontSize: 8, fontWeight: 700, marginTop: 2, color: "#fff" }}>
                                      {counts.total}
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      {/* Selected Day Stats & List */}
                      <div style={{ borderTop: `1.5px solid ${t.border}`, paddingTop: 16 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                          <span style={{ fontSize: 13, fontWeight: 800, color: t.text }}>
                            Check-ins: {formattedSelectedDate}
                          </span>
                          <div style={{ display: "flex", gap: 8, fontSize: 11, color: t.textSub, fontWeight: 700 }}>
                            <span style={{ background: dark ? t.inputBg : t.bgCard2, border: `1.5px solid ${t.border}`, borderRadius: 6, padding: "2px 6px" }}>
                              🎓 {selectedCounts.students} Students
                            </span>
                            <span style={{ background: dark ? t.inputBg : t.bgCard2, border: `1.5px solid ${t.border}`, borderRadius: 6, padding: "2px 6px" }}>
                              💼 {selectedCounts.faculty} Faculty
                            </span>
                          </div>
                        </div>

                        {selectedLogs.length === 0 ? (
                          <div style={{ textAlign: "center", color: t.textMuted, padding: "30px 0", background: dark ? t.inputBg : t.bgCard2, border: `1.5px solid ${t.border}`, borderRadius: 12 }}>
                            No boarding check-ins recorded for this date.
                          </div>
                        ) : (
                          <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: "40vh", overflowY: "auto", paddingRight: 4 }}>
                            {selectedLogs.map(log => {
                              const userObj = users.find(u => u.id === log.studentId);
                              const routeObj = routes.find(r => r.id === log.routeId) || PRESET_ROUTES.find(r => r.id === log.routeId);
                              
                              const isTeacher = userObj?.role === "teacher";
                              const roleBadgeColor = isTeacher ? (dark ? "#1b4d2b" : "#e8f5e9") : (dark ? "#0c4a6e" : "#e0f2fe");
                              const roleTextColor = isTeacher ? (dark ? "#a5d6a7" : "#2e7d32") : (dark ? "#38bdf8" : "#0369a1");
                              
                              const timeStr = new Date(log.timestamp).toLocaleTimeString("en-IN", {
                                hour: "2-digit", minute: "2-digit", hour12: true
                              });

                              return (
                                <div key={log.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: 14, background: dark ? t.inputBg : t.bgCard2, border: `1.5px solid ${t.border}`, borderRadius: 12 }}>
                                  <div>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                      <span style={{ fontSize: 14, fontWeight: 700, color: t.text }}>{userObj?.name || "Unknown User"}</span>
                                      {userObj?.username && <span style={{ fontSize: 11, color: t.textMuted }}>@{userObj.username}</span>}
                                    </div>
                                    <div style={{ fontSize: 12, color: t.textMuted, marginTop: 4 }}>
                                      🚌 <strong>{routeObj?.name || log.routeId}</strong> · Boarded at {timeStr}
                                    </div>
                                  </div>
                                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <span style={{
                                      fontSize: 10, fontWeight: 700, padding: "4px 8px", borderRadius: 8,
                                      background: roleBadgeColor, color: roleTextColor, textTransform: "uppercase"
                                    }}>
                                      {isTeacher ? "Faculty" : "Student"}
                                    </span>
                                    <span style={{
                                      fontSize: 10, fontWeight: 700, padding: "4px 8px", borderRadius: 8,
                                      background: dark ? "#112B1B" : "#ECFDF5", color: "#10B981", border: `1px solid ${dark ? "#1E4D2B" : "#A7F3D0"}`
                                    }}>
                                      Present
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          )}

          {/* ══════════════ DRIVER ALERTS TAB ══════════════ */}
          {tab === "alerts" && (
            <>
              {/* Alert Creation Card */}
              <div style={S.card}>
                <div style={S.cardHead}>
                  <span style={S.cardLabel}>Publish Driver Alert</span>
                </div>
                <form onSubmit={publishDriverAlert} style={{ padding: 20 }}>
                  <div style={{ marginBottom: 14 }}>
                    <label style={{ fontSize: 11, fontWeight: 700, color: t.textMuted, textTransform: "uppercase", display: "block", marginBottom: 6 }}>
                      Select Route / Bus
                    </label>
                    <select
                      value={alertRouteId}
                      onChange={e => {
                        const rid = e.target.value;
                        setAlertRouteId(rid);
                        const rObj = routes.find(r => r.id === rid) || PRESET_ROUTES.find(r => r.id === rid);
                        if (rObj && alertDriverUid) {
                          if (alertDriverUid === "custom_temp") {
                            setAlertMessage(`Driver Assignment Update: ${alertCustomDriverName || "New Driver"} (${alertCustomDriverPhone || "No Phone"}) is the newly assigned driver for ${rObj.name}.`);
                          } else {
                            const dObj = users.find(u => u.id === alertDriverUid);
                            if (dObj) {
                              setAlertMessage(`Driver Assignment Update: ${dObj.name} (${dObj.phone || dObj.identifier || "No Phone"}) is the newly assigned driver for ${rObj.name}.`);
                            }
                          }
                        }
                      }}
                      style={S.input}
                    >
                      <option value="">Select a route...</option>
                      {[
                        ...PRESET_ROUTES.filter(pr => !hiddenPresets.includes(pr.id)).map(r => ({ ...r, isPreset: true })),
                        ...routes.map(r => ({ ...r, isPreset: false }))
                      ].map(r => (
                        <option key={r.id} value={r.id}>{r.name} ({r.label || "No Label"})</option>
                      ))}
                    </select>
                  </div>

                   <div style={{ marginBottom: 14 }}>
                    <label style={{ fontSize: 11, fontWeight: 700, color: t.textMuted, textTransform: "uppercase", display: "block", marginBottom: 6 }}>
                      Select New Driver
                    </label>
                    <select
                      value={alertDriverUid}
                      onChange={e => {
                        const duid = e.target.value;
                        setAlertDriverUid(duid);
                        if (duid === "custom_temp") {
                          setAlertCustomDriverName("");
                          setAlertCustomDriverPhone("");
                          if (alertRouteId) {
                            const rObj = routes.find(r => r.id === alertRouteId) || PRESET_ROUTES.find(r => r.id === alertRouteId);
                            setAlertMessage(`Driver Assignment Update: New Driver (No Phone) is the newly assigned driver for ${rObj ? rObj.name : "Route"}.`);
                          }
                        } else {
                          const dObj = users.find(u => u.id === duid);
                          if (alertRouteId && dObj) {
                            const rObj = routes.find(r => r.id === alertRouteId) || PRESET_ROUTES.find(r => r.id === alertRouteId);
                            setAlertMessage(`Driver Assignment Update: ${dObj.name} (${dObj.phone || dObj.identifier || "No Phone"}) is the newly assigned driver for ${rObj ? rObj.name : "Route"}.`);
                          }
                        }
                      }}
                      style={S.input}
                    >
                      <option value="">Select a driver...</option>
                      <option value="custom_temp">➕ temporary driver</option>
                      {users.filter(u => u.role === "driver" && !u.blocked).map(drv => (
                        <option key={drv.id} value={drv.id}>{drv.name} ({drv.phone || drv.identifier || "No Phone"})</option>
                      ))}
                    </select>
                  </div>

                  {alertDriverUid === "custom_temp" && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 700, color: t.textMuted, textTransform: "uppercase", display: "block", marginBottom: 6 }}>
                          Driver Name
                        </label>
                        <input
                          type="text"
                          value={alertCustomDriverName}
                          onChange={e => {
                            const name = e.target.value;
                            setAlertCustomDriverName(name);
                            if (alertRouteId) {
                              const rObj = routes.find(r => r.id === alertRouteId) || PRESET_ROUTES.find(r => r.id === alertRouteId);
                              setAlertMessage(`Driver Assignment Update: ${name || "New Driver"} (${alertCustomDriverPhone || "No Phone"}) is the newly assigned driver for ${rObj ? rObj.name : "Route"}.`);
                            }
                          }}
                          placeholder="e.g. Ramesh Kumar"
                          style={S.input}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 700, color: t.textMuted, textTransform: "uppercase", display: "block", marginBottom: 6 }}>
                          Driver Phone Number
                        </label>
                        <input
                          type="text"
                          value={alertCustomDriverPhone}
                          onChange={e => {
                            const phone = e.target.value.replace(/[^\d+]/g, "");
                            setAlertCustomDriverPhone(phone);
                            if (alertRouteId) {
                              const rObj = routes.find(r => r.id === alertRouteId) || PRESET_ROUTES.find(r => r.id === alertRouteId);
                              setAlertMessage(`Driver Assignment Update: ${alertCustomDriverName || "New Driver"} (${phone || "No Phone"}) is the newly assigned driver for ${rObj ? rObj.name : "Route"}.`);
                            }
                          }}
                          maxLength={alertCustomDriverPhone.startsWith("+") ? 13 : 12}
                          placeholder="e.g. 9876543210"
                          style={S.input}
                        />
                      </div>
                    </div>
                  )}

                  <div style={{ marginBottom: 20 }}>
                    <label style={{ fontSize: 11, fontWeight: 700, color: t.textMuted, textTransform: "uppercase", display: "block", marginBottom: 6 }}>
                      Alert Message
                    </label>
                    <textarea
                      value={alertMessage}
                      onChange={e => setAlertMessage(e.target.value)}
                      placeholder="e.g. Attention: John Doe is driving Route -3 today instead of D1."
                      style={{
                        ...S.input,
                        height: 90,
                        resize: "none",
                        padding: "12px 14px",
                        lineHeight: "1.5"
                      }}
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={alertPublishing}
                    className="add-btn"
                    style={S.addBtn}
                  >
                    {alertPublishing ? "Publishing Alert..." : "📢 Publish Alert to Dashboards"}
                  </button>
                </form>
              </div>

              {/* Active Alerts List */}
              <div style={S.card}>
                <div style={S.cardHead}>
                  <span style={S.cardLabel}>Active Dashboard Alerts</span>
                  <span style={{ fontSize: 11, color: t.textMuted, fontWeight: 600 }}>Displayed immediately on student/faculty dashboards</span>
                </div>
                <div style={{ padding: 20 }}>
                  {driverAlerts.length === 0 ? (
                    <div style={{ textAlign: "center", color: t.textMuted, padding: "30px 0" }}>
                      No active alerts found. Published alerts expire after deletion.
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {driverAlerts.map(alert => {
                        const routeObj = routes.find(r => r.id === alert.routeId) || PRESET_ROUTES.find(r => r.id === alert.routeId);
                        const dateStr = new Date(alert.timestamp).toLocaleDateString("en-IN", {
                          day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit"
                        });
                        return (
                          <div key={alert.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: 14, background: dark ? t.inputBg : t.bgCard2, border: `1.5px solid ${t.border}`, borderRadius: 12 }}>
                            <div style={{ flex: 1, paddingRight: 16 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                                <span style={{ fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 4, background: dark ? "#311005" : "#FFF7ED", color: "#FF5A1F", border: `1px solid ${dark ? "#5D2B05" : "#FDE68A"}` }}>
                                  {routeObj ? routeObj.name : alert.routeId}
                                </span>
                                <span style={{ fontSize: 11, color: t.textMuted }}>
                                  🕒 {dateStr}
                                </span>
                              </div>
                              <div style={{ fontSize: 13, color: t.text, fontWeight: 500, lineHeight: 1.4 }}>
                                {alert.message}
                              </div>
                            </div>
                            <button
                              onClick={() => deleteDriverAlert(alert.id)}
                              style={S.delBtn}
                            >
                              Delete
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

        </div>
      </div>
      {/* ══════════════ OVERRIDE MODAL ══════════════ */}
      {overrideModalRoute && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center",
          justifyContent: "center", zIndex: 1000, padding: 20, backdropFilter: "blur(4px)"
        }}>
          <div style={{
            background: t.bgCard, border: `1.5px solid ${t.border}`,
            borderRadius: 16, width: "100%", maxWidth: 440, padding: 24,
            boxShadow: "0 10px 30px rgba(0,0,0,0.15)", animation: "fadeUp 0.25s ease"
          }}>
            <h3 style={{ fontSize: 16, fontWeight: 800, color: t.text, margin: "0 0 8px" }}>
              Start Trip: {overrideModalRoute.name}
            </h3>
            <p style={{ fontSize: 12, color: t.textMuted, margin: "0 0 20px" }}>
              Select a driver to remotely initiate this bus trip on their behalf.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: t.textMuted, textTransform: "uppercase", display: "block", marginBottom: 6 }}>
                  Select Driver
                </label>
                <select
                  value={selectedDriverUid}
                  onChange={e => setSelectedDriverUid(e.target.value)}
                  style={{ ...S.input, marginBottom: 0, height: 44, padding: "0 14px" }}
                >
                  <option value="">Select a driver...</option>
                  {users.filter(u => u.role === "driver" && !u.blocked).map(drv => (
                    <option key={drv.id} value={drv.id}>{drv.name} ({drv.phone || "No phone"})</option>
                  ))}
                </select>
                <div style={{ fontSize: 11, color: t.textMuted, marginTop: 6, lineHeight: 1.4 }}>
                  ℹ️ If the driver's phone is online, their app will automatically start tracking and stream actual GPS coordinates. Otherwise, simulated coordinates will stream as a fallback.
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button
                  onClick={async () => {
                    if (!selectedDriverUid) {
                      alert("Please select a driver to start the trip.");
                      return;
                    }
                    
                    // 1. Create a trip document in Firestore
                    const tripDoc = await addDoc(collection(db, "trips"), {
                      driverUid: selectedDriverUid,
                      routeId: overrideModalRoute.id,
                      routeName: overrideModalRoute.name,
                      campusId: "alliance-bangalore",
                      startTime: Date.now(),
                      endTime: null,
                      status: "active",
                      adminStarted: true
                    });

                    // 2. Start override with driver config
                    const config = {
                      type: "driver",
                      driverUid: selectedDriverUid,
                      tripId: tripDoc.id,
                      adminStarted: true
                    };
                    
                    startOverride(overrideModalRoute.id, config);
                    setOverrideModalRoute(null);
                  }}
                  style={{
                    flex: 1, background: t.accent, color: "#fff", border: "none",
                    borderRadius: 10, padding: "12px 0", fontSize: 13, fontWeight: 700,
                    cursor: "pointer", fontFamily: "'Inter', sans-serif"
                  }}
                >
                  Start Driver Trip
                </button>
                <button
                  onClick={() => setOverrideModalRoute(null)}
                  style={{
                    flex: 1, background: "none", border: `1.5px solid ${t.border}`,
                    borderRadius: 10, padding: "12px 0", color: t.textSub, fontSize: 13,
                    cursor: "pointer", fontFamily: "'Inter', sans-serif"
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
