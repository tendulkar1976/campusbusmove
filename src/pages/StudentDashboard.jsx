import { useEffect, useState, useRef, useCallback, useMemo, memo } from "react";
import { ref, onValue } from "firebase/database";
import { collection, query, where, getDocs, addDoc, doc, getDoc, setDoc } from "firebase/firestore";
import { rtdb, db } from "../firebase";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import MapView from "../components/MapView";

// ── Pure helpers ──
function getDistanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000, dLat = (lat2-lat1)*Math.PI/180, dLng = (lng2-lng1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
function getETA(bLat, bLng, sLat, sLng, spd) {
  const dist = getDistanceMeters(bLat, bLng, sLat, sLng);
  return { dist: Math.round(dist), mins: Math.round((dist/1000)/(parseFloat(spd)||20)*60) };
}
function getDaysInMonth(y, m) { return new Date(y, m+1, 0).getDate(); }
function getTodayStr() { return new Date().toISOString().split("T")[0]; }
function getInitials(name) {
  if (!name) return "";
  const parts = name.trim().replace(/[^a-zA-Z\s]/g, "").split(/\s+/);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ── Route cache — avoids Firestore re-fetch on every mount ──
let routeCache = null;

// ── Memoized sub-components ──
const StatBox = memo(({ val, label, color, dark, showBorder, t }) => (
  <div style={{ flex: 1, textAlign: "center", padding: "4px 0", borderRight: showBorder ? `1px solid ${t.border}` : "none" }}>
    <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.5px", color: t.text, fontFamily: "'Inter', sans-serif" }}>{val}</div>
    <div style={{ fontSize: 10, color: t.textMuted, marginTop: 4, textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 700 }}>{label}</div>
  </div>
));

const AttendanceBadge = memo(({ status, dark }) => {
  if (status === "present") return (
    <div style={{
      background: dark?"#0D1F12":"#ECFDF5",
      border: `1.5px solid ${dark?"#1E4D2B":"#A7F3D0"}`,
      borderRadius: 12,
      padding: "16px 20px",
      display: "flex",
      alignItems: "center",
      gap: 12,
      marginBottom: 16,
      boxShadow: dark ? "0 4px 12px rgba(0,0,0,0.15)" : "0 4px 12px rgba(0,0,0,0.02)"
    }}>
      <span style={{ fontSize: 24 }}>✅</span>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color: dark?"#4ADE80":"#047857" }}>Auto-Attendance Verified</div>
        <div style={{ fontSize: 12, color: dark?"#888":"#6B7280", marginTop: 2 }}>System automatically marked you present</div>
      </div>
    </div>
  );
  if (status === "absent") return (
    <div style={{
      background: dark?"#1A0808":"#FEF2F2",
      border: `1.5px solid ${dark?"#3D1010":"#FEE2E2"}`,
      borderRadius: 12,
      padding: "16px 20px",
      display: "flex",
      alignItems: "center",
      gap: 12,
      marginBottom: 16,
      boxShadow: dark ? "0 4px 12px rgba(0,0,0,0.15)" : "0 4px 12px rgba(0,0,0,0.02)"
    }}>
      <span style={{ fontSize: 24 }}>❌</span>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color: dark?"#F87171":"#B91C1C" }}>Marked Absent</div>
        <div style={{ fontSize: 12, color: dark?"#888":"#6B7280", marginTop: 2 }}>Didn't respond to geofence check</div>
      </div>
    </div>
  );
  return null;
});

const TAB_ITEMS = [
  {
    id: "track",
    label: "Tracking",
    icon: (color) => (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "stroke 0.2s" }}>
        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
        <circle cx="12" cy="10" r="3"></circle>
      </svg>
    )
  },
  {
    id: "attendance",
    label: "Attendance",
    icon: (color) => (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "stroke 0.2s" }}>
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
        <line x1="16" y1="2" x2="16" y2="6"></line>
        <line x1="8" y1="2" x2="8" y2="6"></line>
        <line x1="3" y1="10" x2="21" y2="10"></line>
      </svg>
    )
  },
  {
    id: "profile",
    label: "Profile",
    icon: (color) => (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "stroke 0.2s" }}>
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
        <circle cx="12" cy="7" r="4"></circle>
      </svg>
    )
  }
];

export default function StudentDashboard() {
  const { user, role, campusId, logout } = useAuth();
  const { dark, toggle, t } = useTheme();

  const [subExpired, setSubExpired] = useState(false);
  const [checkingSub, setCheckingSub] = useState(true);

  // ── Verify subscription status ──
  useEffect(() => {
    if (campusId === "alliance-bangalore" || role === "superadmin" || role === "admin") {
      setSubExpired(false);
      setCheckingSub(false);
      return;
    }
    if (!campusId) {
      setCheckingSub(false);
      return;
    }
    setCheckingSub(true);
    getDoc(doc(db, "subscriptions", campusId)).then(snap => {
      if (snap.exists()) {
        const data = snap.data();
        const expiry = data.expiryDate || 0;
        const daysLeft = Math.max(0, Math.ceil((expiry - Date.now()) / (1000 * 60 * 60 * 24)));
        if (daysLeft === 0) {
          setSubExpired(true);
        } else {
          setSubExpired(false);
        }
      } else {
        setSubExpired(true);
      }
      setCheckingSub(false);
    }).catch(() => {
      setSubExpired(true);
      setCheckingSub(false);
    });
  }, [campusId]);

  const [tab, setTab]               = useState("track");
  const [myRoute, setMyRoute]       = useState(null);
  const [routes, setRoutes]         = useState([]);
  const [selected, setSelected]     = useState(null);
  const [activeBus, setActiveBus]   = useState(null);
  const [myLocation, setMyLocation] = useState(null);
  const [eta, setEta]               = useState(null);
  const [distance, setDistance]     = useState(null);
  const [attendanceLog, setAttendanceLog]       = useState({});
  const [attendanceStatus, setAttendanceStatus] = useState(null);
  const [inGeofence, setInGeofence] = useState(false);
  const [calMonth, setCalMonth]     = useState(new Date().getMonth());
  const [calYear, setCalYear]       = useState(new Date().getFullYear());
  const [loading, setLoading]       = useState(!routeCache);
  const [activeAlert, setActiveAlert] = useState(null);

  const geofenceTimerRef = useRef(null);
  const markedDateRef    = useRef(null);
  const gpsWatchRef      = useRef(null);
  const rtdbUnsubRef     = useRef(null);

  const markAttendance = useCallback(async status => {
    const today = getTodayStr();
    if (markedDateRef.current===today) return;
    markedDateRef.current=today;
    clearTimeout(geofenceTimerRef.current); geofenceTimerRef.current=null;
    setAttendanceStatus(status);
    await addDoc(collection(db,"attendance"),{studentId:user.uid,routeId:selected?.id,date:today,status,timestamp:Date.now(),campusId});
    setAttendanceLog(p=>({...p,[today]:status}));
  }, [user, selected, campusId]);

  // ── Load routes ──
  useEffect(() => {
    if (routeCache) { setRoutes(routeCache); setSelected(routeCache[0]); setLoading(false); return; }
    getDocs(collection(db, "routes")).then(snap => {
      const r = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      routeCache = r;
      setRoutes(r); if (r.length) setSelected(r[0]);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  // ── Assigned route ──
  useEffect(() => {
    if (!user || !routes.length) return;
    getDoc(doc(db, "users", user.uid)).then(snap => {
      if (snap.exists() && snap.data().routeId) {
        const r = routes.find(x => x.id === snap.data().routeId);
        if (r) { setMyRoute(r); setSelected(r); }
      }
    });
  }, [user, routes]);

  // ── RTDB listener — immediate updates, no debounce ──
  useEffect(() => {
    if (!selected?.id) { setActiveBus(null); return; }
    if (rtdbUnsubRef.current) { rtdbUnsubRef.current(); rtdbUnsubRef.current = null; }
    const unsub = onValue(ref(rtdb, `routes/${selected.id}/live`), snap => {
      console.log("RTDB snap:", snap.val());
      if (snap.exists() && snap.val().active === true) {
        setActiveBus({ ...snap.val() }); // spread = force re-render
      } else {
        setActiveBus(null);
      }
    });
    rtdbUnsubRef.current = unsub;
    return () => { unsub(); rtdbUnsubRef.current = null; };
  }, [selected?.id]);

  // ── Today's attendance check ──
  useEffect(() => {
    if (!user) return;
    const today = getTodayStr();
    getDocs(query(collection(db,"attendance"), where("studentId","==",user.uid), where("date","==",today))).then(snap => {
      if (!snap.empty) { const d=snap.docs[0].data(); markedDateRef.current=today; setAttendanceStatus(d.status); setAttendanceLog(p=>({...p,[today]:d.status})); }
    });
  }, [user]);

  // ── Listen for Driver Change alerts ──
  useEffect(() => {
    if (!user) return;
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    
    getDocs(collection(db, "driver_alerts")).then(snap => {
      const activeAlerts = snap.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(alert => alert.timestamp >= oneDayAgo)
        .sort((a, b) => b.timestamp - a.timestamp); // newest first
      
      if (activeAlerts.length > 0) {
        const latest = activeAlerts[0];
        const dismissed = JSON.parse(localStorage.getItem("dismissed_alerts") || "[]");
        if (!dismissed.includes(latest.id)) {
          setActiveAlert(latest);
        }
      }
    }).catch(err => console.error("Error checking driver alerts:", err));
  }, [user]);

  // ── GPS watch ──
  const onGpsSuccess = useCallback(pos => {
    setMyLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
  }, []);

  useEffect(() => {
    if (!navigator.geolocation) return;
    gpsWatchRef.current = navigator.geolocation.watchPosition(onGpsSuccess, ()=>{}, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
    return () => { if (gpsWatchRef.current) navigator.geolocation.clearWatch(gpsWatchRef.current); };
  }, [onGpsSuccess]);

  // ── Visibility check ──
  useEffect(() => {
    const handle = () => {
      if (document.hidden && gpsWatchRef.current) { navigator.geolocation.clearWatch(gpsWatchRef.current); gpsWatchRef.current=null; }
      else if (!document.hidden && !gpsWatchRef.current) gpsWatchRef.current=navigator.geolocation.watchPosition(onGpsSuccess,()=>{},{enableHighAccuracy:true,maximumAge:0,timeout:15000});
    };
    document.addEventListener("visibilitychange", handle);
    return () => document.removeEventListener("visibilitychange", handle);
  }, [onGpsSuccess]);

  // ── ETA + geofence ──
  useEffect(() => {
    if (!activeBus || activeBus.active!==true || typeof activeBus.lat !== "number" || isNaN(activeBus.lat) || typeof activeBus.lng !== "number" || isNaN(activeBus.lng) || !myLocation || !selected) {
      setEta(null); setDistance(null); setInGeofence(false); return;
    }

    if (selected.stops?.length) {
      const nearest = selected.stops.reduce((c,s)=>{
        const d=getDistanceMeters(myLocation.lat,myLocation.lng,s.lat,s.lng);
        return d<c.d?{stop:s,d}:c;
      },{stop:null,d:Infinity});
      if (nearest.stop) {
        const r=getETA(activeBus.lat,activeBus.lng,nearest.stop.lat,nearest.stop.lng,activeBus.speed);
        setEta(r.mins); setDistance(r.dist);
      } else {
        const r=getETA(activeBus.lat,activeBus.lng,myLocation.lat,myLocation.lng,activeBus.speed);
        setEta(r.mins); setDistance(r.dist);
      }
    } else {
      const r=getETA(activeBus.lat,activeBus.lng,myLocation.lat,myLocation.lng,activeBus.speed);
      setEta(r.mins); setDistance(r.dist);
    }

    const bd = getDistanceMeters(myLocation.lat, myLocation.lng, activeBus.lat, activeBus.lng);
    const inside = bd <= 150; // Auto-mark present when within 150m
    const approaching = bd <= 400; // Show approaching info within 400m
    setInGeofence(approaching);
    
    const today = getTodayStr();
    if (inside && markedDateRef.current!==today) {
      markAttendance("present");
    }
  }, [activeBus, myLocation, selected, attendanceStatus, markAttendance]);

  // ── Load attendance log ──
  useEffect(() => {
    if (!user||tab!=="attendance") return;
    getDocs(query(collection(db,"attendance"),where("studentId","==",user.uid))).then(snap=>{
      const log={}; snap.docs.forEach(d=>{const x=d.data();log[x.date]=x.status;}); setAttendanceLog(log);
    });
  }, [user, tab]);

  // ── Derived values ──
  const isActive     = useMemo(() => activeBus?.active===true, [activeBus]);
  const busMapLoc    = useMemo(() => {
    return (isActive && typeof activeBus.lat === "number" && !isNaN(activeBus.lat) && typeof activeBus.lng === "number" && !isNaN(activeBus.lng)) 
      ? { lat: activeBus.lat, lng: activeBus.lng } 
      : null;
  }, [isActive, activeBus]);
  const presentCount = useMemo(() => Object.values(attendanceLog).filter(v=>v==="present").length, [attendanceLog]);
  const totalCount   = useMemo(() => Object.values(attendanceLog).length, [attendanceLog]);
  const pct          = useMemo(() => totalCount>0?Math.round(presentCount/totalCount*100):0, [presentCount, totalCount]);

  const handleTabChange = useCallback(v => setTab(v), []);
  const handleRouteSelect = useCallback(r => setSelected(r), []);

  if (checkingSub) {
    return (
      <div style={{ minHeight: "100vh", background: t.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, fontFamily: "'Inter',sans-serif" }}>
        <div style={{ fontSize: 36 }}>🚌</div>
        <div style={{ width: 140, height: 3, background: t.border, borderRadius: 2, overflow: "hidden", position: "relative" }}>
          <div style={{ height: "100%", width: "40%", background: t.accent, borderRadius: 2, position: "absolute", animation: "loadingSwipe 1.2s ease-in-out infinite alternate" }} />
        </div>
        <style>{`
          @keyframes loadingSwipe { from{left:0%} to{left:60%} }
        `}</style>
        <div style={{ color: t.accent, fontSize: 12, fontWeight: 600, letterSpacing: "1px", textTransform: "uppercase" }}>Checking Subscription</div>
      </div>
    );
  }

  if (subExpired) {
    return (
      <div style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        minHeight: "100vh",
        background: dark ? "#0D0D11" : "#F3F4F6",
        color: t.text,
        fontFamily: "'Inter', sans-serif",
        padding: 24,
        textAlign: "center"
      }}>
        <div style={{
          background: dark ? "#1E1E24" : "#FFFFFF",
          border: `1.5px solid ${t.border}`,
          borderRadius: 20,
          padding: "40px 30px",
          maxWidth: 480,
          width: "100%",
          boxShadow: "0 10px 40px rgba(0,0,0,0.15)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 20
        }}>
          <div style={{ width: 64, height: 64, background: "#EF444415", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32 }}>
            🔒
          </div>
          <div>
            <h2 style={{ margin: "0 0 10px 0", fontSize: 20, fontWeight: 800, letterSpacing: "-0.5px" }}>Service Suspended</h2>
            <p style={{ margin: 0, fontSize: 13, color: t.textSub, lineHeight: 1.6 }}>
              The institutional subscription for your campus has expired. 
              Please contact your transport office or campus administrator to renew the plan and restore access.
            </p>
          </div>
          <button 
            onClick={logout} 
            style={{ 
              background: "#EF4444", 
              border: "none", 
              borderRadius: 10, 
              padding: "12px 24px", 
              color: "#fff", 
              fontWeight: 700, 
              fontSize: 13, 
              cursor: "pointer",
              marginTop: 10,
              width: "100%"
            }}
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  if (loading) return (
    <div style={{ minHeight:"100vh", background:t.bg, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:16, fontFamily:"'Inter',sans-serif" }}>
      <div style={{ fontSize:36 }}>🚌</div>
      <div style={{ width: 140, height: 3, background: t.border, borderRadius: 2, overflow: "hidden", position: "relative" }}>
        <div style={{ height: "100%", width: "40%", background: t.accent, borderRadius: 2, position: "absolute", animation: "loadingSwipe 1.2s ease-in-out infinite alternate" }} />
      </div>
      <style>{`
        @keyframes loadingSwipe { from{left:0%} to{left:60%} }
      `}</style>
      <div style={{ color:t.accent, fontSize:12, fontWeight: 600, letterSpacing: "1px", textTransform: "uppercase" }}>Loading Portal</div>
    </div>
  );

  return (
    <div style={{ minHeight:"100vh", background:t.bg, fontFamily:"'Inter',sans-serif", color:t.text, willChange:"background", transition:"background 0.25s,color 0.25s" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
        *{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
        .custom-scroll::-webkit-scrollbar { height: 4px; }
        .custom-scroll::-webkit-scrollbar-track { background: transparent; }
        .custom-scroll::-webkit-scrollbar-thumb { background: ${t.borderStrong}; border-radius: 2px; }
      `}</style>

      {/* HEADER */}
      <div style={{
        background: dark ? "#111827" : "#FFFFFF",
        borderBottom: `1px solid ${t.border}`,
        padding: "0 20px",
        height: 58,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        position: "sticky",
        top: 0,
        zIndex: 20,
        boxShadow: dark ? "none" : "0 1px 3px rgba(0,0,0,0.02)"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 32, height: 32, background: "#FF5A1F", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🚌</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: t.text, letterSpacing: "-0.3px" }}>CampusMove</div>
            <div style={{ fontSize: 9, color: "#FF5A1F", fontWeight: 700, letterSpacing: "0.8px", textTransform: "uppercase", lineHeight: 1 }}>Alliance University</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={toggle} style={{ width: 34, height: 34, borderRadius: 10, border: `1.5px solid ${t.border}`, background: t.bgCard, cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s" }}>
            {dark ? "☀️" : "🌙"}
          </button>
          <button onClick={logout} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", border: `1.5px solid ${t.border}`, borderRadius: 10, background: t.bgCard, color: t.textSub, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'Inter',sans-serif", transition: "all 0.2s" }}>
            <span>↩</span> Sign Out
          </button>
        </div>
      </div>

      {/* TABS CONTAINER */}
      <div style={{ display:"flex", padding:"12px 20px", background:t.bg, borderBottom:`1.5px solid ${t.border}` }}>
        <div style={{ display:"flex", background:dark ? "#1F2937" : "#E2E8F0", borderRadius:12, padding:4, gap:4 }}>
          {TAB_ITEMS.map((item) => {
            const isActive = tab === item.id;
            const currentColor = isActive ? t.text : t.textMuted;
            return (
              <button key={item.id} onClick={() => handleTabChange(item.id)} style={{
                padding:"8px 16px",
                border:"none",
                borderRadius:10,
                background:isActive ? (dark ? "#111827" : "#FFFFFF") : "transparent",
                cursor:"pointer",
                fontSize:13,
                fontWeight:700,
                color:currentColor,
                display:"flex",
                alignItems:"center",
                gap:8,
                boxShadow:isActive ? (dark ? "0 2px 8px rgba(0,0,0,0.3)" : "0 2px 8px rgba(0,0,0,0.05)") : "none",
                fontFamily:"'Inter',sans-serif",
                transition:"all 0.2s ease-in-out"
              }}>
                {item.icon(currentColor)}
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ padding:"20px 20px 80px", maxWidth:480, margin:"0 auto" }}>

        {tab==="track" && (
          <>
            {!routes.length ? (
              <div style={{ textAlign:"center", padding:"80px 0", color:t.textMuted, background: t.bgCard, border: `1.5px solid ${t.border}`, borderRadius: 12, boxShadow: dark ? "0 4px 20px rgba(0,0,0,0.3)" : "0 8px 30px rgba(0,0,0,0.03)" }}>
                <span style={{ fontSize: 44 }}>🚌</span>
                <div style={{ fontSize:15, fontWeight: 700, marginTop: 16, color: t.text }}>No Routes Available</div>
                <div style={{ fontSize:13, color:t.textMuted, marginTop: 6 }}>Please contact transport administration.</div>
              </div>
            ) : (
              <>
                {/* Route Selector */}
                <div style={{ marginBottom:18 }}>
                  <p style={{ fontSize:10, color:t.textMuted, fontWeight:800, textTransform:"uppercase", letterSpacing:"1.5px", marginBottom:10 }}>Select Active Route</p>
                  <div className="custom-scroll" style={{ display:"flex", gap:10, overflowX:"auto", paddingBottom:8 }}>
                    {routes.map(r => (
                      <button key={r.id} onClick={() => handleRouteSelect(r)} style={{
                        flex:"0 0 auto",
                        padding:"8px 14px",
                        border:`1.5px solid ${selected?.id===r.id ? t.accent : t.border}`,
                        borderRadius:10,
                        background:selected?.id===r.id ? t.accentSub : t.bgCard,
                        color:selected?.id===r.id ? t.accent : t.textSub,
                        fontSize:12,
                        fontWeight:700,
                        cursor:"pointer",
                        fontFamily:"'Inter',sans-serif",
                        whiteSpace:"nowrap",
                        transition:"all 0.25s",
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        boxShadow: selected?.id===r.id ? `0 4px 12px ${t.accent}15` : "none"
                      }}>
                        {selected?.id===r.id && (
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: t.accent }} />
                        )}
                        {r.name}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Status Pill Banner */}
                <div style={{ marginBottom:18 }}>
                  {isActive ? (
                    <div style={{ display:"inline-flex", alignItems:"center", gap:8, padding:"8px 14px", borderRadius:12, background:t.pill.activeBg, border:`1.5px solid ${t.pill.activeBorder}`, fontSize:12, color:t.pill.activeText, fontWeight:700, boxShadow: `0 4px 12px ${t.pill.activeBorder}15` }}>
                      <span style={{ width:8, height:8, borderRadius:"50%", background:"#10B981", display:"inline-block", boxShadow:"0 0 8px #10B981", animation: "pulse 1.4s infinite alternate" }}/>
                      {selected?.name} is Live · {activeBus.speed||0} km/h
                    </div>
                  ) : (
                    <div style={{ display:"inline-flex", alignItems:"center", gap:8, padding:"8px 14px", borderRadius:12, background:t.pill.inactiveBg, border:`1.5px solid ${t.pill.inactiveBorder}`, fontSize:12, color:t.pill.inactiveText, fontWeight:700 }}>
                      <span style={{ width:8, height:8, borderRadius:"50%", background:t.textHint, display:"inline-block" }}/>
                      Bus Offline
                    </div>
                  )}
                  <style>{`@keyframes pulse{from{transform:scale(1);opacity:0.8}to{transform:scale(1.2);opacity:1}}`}</style>
                </div>

                {/* Stats Widget */}
                {isActive && (
                  <div style={{
                    background:t.bgCard,
                    border:`1.5px solid ${t.border}`,
                    borderRadius:12,
                    padding:"16px",
                    display:"flex",
                    justifyContent:"space-between",
                    alignItems:"center",
                    marginBottom:16,
                    boxShadow: dark ? "0 4px 20px rgba(0,0,0,0.3)" : "0 8px 30px rgba(0,0,0,0.03)"
                  }}>
                    {[[eta!==null?`${eta} min`:"—","ETA to Stop"],[distance!==null?(distance>1000?`${(distance/1000).toFixed(1)} km`:`${distance} m`):"—","Distance"],[`${activeBus?.speed||0} km/h`,"Speed"]].map(([val,label],i) => (
                      <StatBox key={i} val={val} label={label} color={t.accent} dark={dark} showBorder={i < 2} t={t} />
                    ))}
                  </div>
                )}

                {/* Map View Frame */}
                <div style={{ background:t.bgCard, border:`1.5px solid ${t.border}`, borderRadius:12, overflow:"hidden", marginBottom:16, boxShadow: dark ? "0 4px 20px rgba(0,0,0,0.3)" : "0 8px 30px rgba(0,0,0,0.03)" }}>
                  <MapView busLocation={busMapLoc} busMoving={isActive&&activeBus.speed>0} routePath={selected?.path?.map(p=>[p.lat,p.lng])} center={busMapLoc ? null : (selected?.center ? [selected.center.lat,selected.center.lng] : null)} myLocation={myLocation} dark={dark}/>
                </div>

                {/* Vertical Timeline Stops Tracker */}
                {selected?.stops?.length > 0 && (
                  <div style={{
                    background: t.bgCard,
                    border: `1.5px solid ${t.border}`,
                    borderRadius: 12,
                    padding: "20px",
                    marginBottom: 16,
                    boxShadow: dark ? "0 4px 20px rgba(0,0,0,0.3)" : "0 8px 30px rgba(0,0,0,0.03)"
                  }}>
                    <p style={{ fontSize:10, color:t.textMuted, fontWeight:800, textTransform:"uppercase", letterSpacing:"1.5px", marginBottom:16 }}>Stops & Real-time ETA</p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 20, position: "relative", paddingLeft: 18 }}>
                      {/* Central Line */}
                      <div style={{ position: "absolute", left: 4, top: 8, bottom: 8, width: 2, background: dark ? t.border : t.borderStrong }} />
                      {selected.stops.map((stop, index) => {
                        const stopDist = activeBus && isActive && typeof activeBus.lat === "number" && !isNaN(activeBus.lat) && typeof activeBus.lng === "number" && !isNaN(activeBus.lng) ? getDistanceMeters(activeBus.lat, activeBus.lng, stop.lat, stop.lng) : null;
                        const isNear = stopDist !== null && stopDist <= 300;
                        const stopEta = activeBus && isActive && typeof activeBus.lat === "number" && !isNaN(activeBus.lat) && typeof activeBus.lng === "number" && !isNaN(activeBus.lng) ? getETA(activeBus.lat, activeBus.lng, stop.lat, stop.lng, activeBus.speed).mins : null;
                        
                        return (
                          <div key={index} style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", position: "relative" }}>
                            {/* Bullet Dot */}
                            <div style={{
                              position: "absolute",
                              left: -18,
                              top: 6,
                              width: 10,
                              height: 10,
                              borderRadius: "50%",
                              background: isNear ? "#10B981" : (dark ? "#374151" : "#CBD5E1"),
                              border: `2px solid ${isNear ? (dark ? "#111827" : "#fff") : t.bgCard}`,
                              boxShadow: isNear ? "0 0 8px rgba(16,185,129,0.6)" : "none",
                              zIndex: 1,
                              transition: "all 0.25s"
                            }} />
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 13, fontWeight: 700, color: isNear ? "#10B981" : t.text, transition: "color 0.25s" }}>{stop.name}</div>
                              {stopDist !== null && (
                                <div style={{ fontSize: 11, color: isNear ? "#10B981" : t.textMuted, marginTop: 4 }}>
                                  {isNear ? "Active stop now" : `${stopDist > 1000 ? `${(stopDist/1000).toFixed(1)} km` : `${Math.round(stopDist)} m`} away`}
                                </div>
                              )}
                            </div>
                            {stopEta !== null && !isNear && (
                              <div style={{ fontSize: 12, fontWeight: 700, color: t.accent, background: t.accentSub, padding: "3px 8px", borderRadius: 8, border: `1px solid ${t.accentBorder}` }}>
                                {stopEta} min
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Attendance Approaching Card */}
                {inGeofence && markedDateRef.current!==getTodayStr() && (
                  <div style={{
                    background: dark ? t.accentSub : "#EFF6FF",
                    border: `1.5px solid ${t.accentBorder}`,
                    borderRadius: 12,
                    padding: "18px",
                    marginBottom: 16,
                    boxShadow: dark ? "0 4px 20px rgba(0,0,0,0.3)" : "0 8px 30px rgba(0,0,0,0.03)"
                  }}>
                    <div style={{ fontSize:15, fontWeight:800, color: t.accent, marginBottom:6, display:"flex", alignItems:"center", gap:8 }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={t.accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1 .4-1 1v7c0 .6.4 1 1 1h1" />
                        <circle cx="8" cy="17" r="2" />
                        <circle cx="16" cy="17" r="2" />
                      </svg>
                      Bus is Approaching!
                    </div>
                    <div style={{ fontSize:13, color:t.textSub, margin:0, textAlign: "left", lineHeight: 1.5 }}>
                      The bus is currently {distance!==null ? `${distance} meters` : "nearby"} away. <strong>Auto-attendance</strong> will verify and mark you present when the bus arrives.
                    </div>
                  </div>
                )}

                <AttendanceBadge status={attendanceStatus} dark={dark}/>
              </>
            )}
          </>
        )}

        {/* ATTENDANCE CALENDAR TAB */}
        {tab==="attendance" && (
          <>
            <div style={{ display:"flex", gap:10, marginBottom:16 }}>
              {[[presentCount,"#10B981","Present"],[totalCount-presentCount,"#EF4444","Absent"],[`${pct}%`,pct>=75?"#10B981":"#EF4444","Rate"]].map(([val,color,label],i) => (
                <div key={i} style={{ flex:1, background:t.bgCard, border:`1.5px solid ${t.border}`, borderRadius:12, padding:"16px 12px", textAlign:"center", boxShadow: dark ? "0 4px 20px rgba(0,0,0,0.3)" : "0 8px 30px rgba(0,0,0,0.03)" }}>
                  <div style={{ fontSize:26, fontWeight:800, color, letterSpacing:"-0.5px", fontFamily: "'Inter', sans-serif" }}>{val}</div>
                  <div style={{ fontSize:10, color:t.textMuted, marginTop:4, textTransform:"uppercase", letterSpacing:"0.5px", fontWeight: 700 }}>{label}</div>
                </div>
              ))}
            </div>
            <CalendarView calYear={calYear} calMonth={calMonth} attendanceLog={attendanceLog} t={t} dark={dark} onPrev={()=>{if(calMonth===0){setCalMonth(11);setCalYear(y=>y-1);}else setCalMonth(m=>m-1);}} onNext={()=>{if(calMonth===11){setCalMonth(0);setCalYear(y=>y+1);}else setCalMonth(m=>m+1);}}/>
          </>
        )}

        {tab==="profile" && (
          <ProfileView user={user} routes={routes} t={t} dark={dark} />
        )}
      </div>

      {/* ══════════════ DRIVER CHANGE POPUP MODAL ══════════════ */}
      {activeAlert && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: dark ? "rgba(0, 0, 0, 0.7)" : "rgba(0, 0, 0, 0.45)",
          backdropFilter: "blur(8px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 9999,
          padding: 20
        }}>
          <div style={{
            background: t.bgCard,
            border: `1.5px solid ${t.border}`,
            borderRadius: 20,
            width: "100%",
            maxWidth: 400,
            padding: 24,
            textAlign: "center",
            boxShadow: dark ? "0 20px 50px rgba(0,0,0,0.5)" : "0 20px 50px rgba(0,0,0,0.15)",
            animation: "alertScaleUp 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)"
          }}>
            <style>{`
              @keyframes alertScaleUp {
                from { transform: scale(0.9); opacity: 0; }
                to { transform: scale(1); opacity: 1; }
              }
            `}</style>
            
            {/* Announcement Icon */}
            <div style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: dark ? "#311005" : "#FFF7ED",
              border: `1.5px solid ${dark ? "#5D2B05" : "#FDE68A"}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 16px"
            }}>
              <span style={{ fontSize: 28 }}>📢</span>
            </div>

            {/* Title */}
            <h3 style={{ fontSize: 16, fontWeight: 800, color: t.text, margin: "0 0 8px" }}>
              Driver Update Alert
            </h3>
            
            <p style={{ fontSize: 12, color: t.textMuted, margin: "0 0 16px" }}>
              The transport department has published a driver change alert:
            </p>

            {/* Alert Message Box */}
            {activeAlert.driverName ? (
              <div style={{
                background: dark ? t.inputBg : t.bgCard2,
                border: `1.5px solid ${t.border}`,
                borderRadius: 14,
                padding: "16px 18px",
                textAlign: "left",
                fontSize: 13,
                color: t.text,
                lineHeight: 1.6,
                marginBottom: 20
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", borderBottom: `1px solid ${t.border}`, paddingBottom: 8, marginBottom: 8 }}>
                  <span style={{ color: t.textMuted, fontWeight: 600 }}>New Driver:</span>
                  <span style={{ fontWeight: 800, color: t.text }}>{activeAlert.driverName}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", borderBottom: `1px solid ${t.border}`, paddingBottom: 8, marginBottom: 8 }}>
                  <span style={{ color: t.textMuted, fontWeight: 600 }}>Phone No:</span>
                  <span style={{ fontWeight: 800, color: t.accent }}>{activeAlert.driverPhone}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ color: t.textMuted, fontWeight: 600 }}>Assigned To:</span>
                  <span style={{
                    fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 6,
                    background: dark ? "#311005" : "#FFF7ED", color: "#FF5A1F", border: `1px solid ${dark ? "#5D2B05" : "#FDE68A"}`
                  }}>
                    {activeAlert.routeName || activeAlert.routeId}
                  </span>
                </div>
              </div>
            ) : (
              <div style={{
                background: dark ? t.inputBg : t.bgCard2,
                border: `1.5px solid ${t.border}`,
                borderRadius: 12,
                padding: "16px 14px",
                textAlign: "left",
                fontSize: 13,
                fontWeight: 600,
                color: t.text,
                lineHeight: 1.5,
                marginBottom: 20
              }}>
                {activeAlert.message}
              </div>
            )}

            {/* Action Button */}
            <button
              onClick={() => {
                const dismissed = JSON.parse(localStorage.getItem("dismissed_alerts") || "[]");
                if (!dismissed.includes(activeAlert.id)) {
                  dismissed.push(activeAlert.id);
                  localStorage.setItem("dismissed_alerts", JSON.stringify(dismissed));
                }
                setActiveAlert(null);
              }}
              style={{
                width: "100%",
                background: t.accent,
                color: "#fff",
                border: "none",
                borderRadius: 12,
                padding: "13px 0",
                fontSize: 14,
                fontWeight: 700,
                cursor: "pointer",
                boxShadow: `0 4px 14px ${t.accent}33`,
                transition: "all 0.2s"
              }}
              onMouseEnter={e => e.currentTarget.style.transform = "translateY(-1px)"}
              onMouseLeave={e => e.currentTarget.style.transform = "none"}
            >
              Got It, Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Memoized Calendar
const CalendarView = memo(function CalendarView({ calYear, calMonth, attendanceLog, t, dark, onPrev, onNext }) {
  const days     = getDaysInMonth(calYear, calMonth);
  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const monthName = new Date(calYear, calMonth).toLocaleString("default", { month: "long" });
  const cells = useMemo(() => {
    const c = []; for(let i=0;i<firstDay;i++)c.push(null); for(let d=1;d<=days;d++)c.push(d); return c;
  }, [calYear, calMonth, firstDay, days]);
  const today = getTodayStr();

  return (
    <div style={{ background:t.bgCard, border:`1.5px solid ${t.border}`, borderRadius:12, overflow:"hidden", boxShadow: dark ? "0 4px 20px rgba(0,0,0,0.3)" : "0 8px 30px rgba(0,0,0,0.03)" }}>
      <div style={{ padding:"16px 20px", borderBottom:`1px solid ${t.border}`, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <button onClick={onPrev} style={{ background:"none", border:`1px solid ${t.border}`, color:t.textSub, cursor:"pointer", fontSize:18, width:34, height:34, borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", transition:"all 0.2s" }}>‹</button>
        <span style={{ fontSize:15, fontWeight:800, color:t.text, fontFamily:"'Inter',sans-serif" }}>{monthName} {calYear}</span>
        <button onClick={onNext} style={{ background:"none", border:`1px solid ${t.border}`, color:t.textSub, cursor:"pointer", fontSize:18, width:34, height:34, borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", transition:"all 0.2s" }}>›</button>
      </div>
      <div style={{ padding:"16px" }}>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:6, marginBottom:10 }}>
          {["Su","Mo","Tu","We","Th","Fr","Sa"].map((d,i)=><div key={i} style={{ textAlign:"center", fontSize:11, color:t.textMuted, fontWeight:700, textTransform: "uppercase", letterSpacing: "0.5px", fontFamily:"'Inter',sans-serif" }}>{d}</div>)}
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:6 }}>
          {cells.map((d,i) => {
            if (!d) return <div key={i}/>;
            const ds = `${calYear}-${String(calMonth+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
            const st = attendanceLog[ds]; const isToday = today===ds;
            
            let cellBg = "transparent";
            let cellColor = t.textSub;
            let cellBorder = "none";
            
            if (st === "present") {
              cellBg = dark ? "#0D1F12" : "#ECFDF5";
              cellColor = "#10B981";
              cellBorder = `1px solid ${dark ? "#1E4D2B" : "#A7F3D0"}`;
            } else if (st === "absent") {
              cellBg = dark ? "#1A0808" : "#FEF2F2";
              cellColor = "#EF4444";
              cellBorder = `1px solid ${dark ? "#5D1010" : "#FCA5A5"}`;
            } else if (isToday) {
              cellBg = t.accentSub;
              cellColor = t.accent;
              cellBorder = `1px solid ${t.accent}`;
            }

            return (
              <div key={i} style={{
                aspectRatio:"1",
                borderRadius:8,
                display:"flex",
                alignItems:"center",
                justifyContent:"center",
                fontSize:12,
                fontWeight:isToday ? 800 : 600,
                background: cellBg,
                color: cellColor,
                border: cellBorder,
                fontFamily:"'Inter',sans-serif",
                transition: "all 0.2s"
              }}>{d}</div>
            );
          })}
        </div>
      </div>
      <div style={{ padding:"14px 20px", borderTop:`1px solid ${t.border}`, display:"flex", gap:20, background: dark ? "#111827" : "#F8FAFC" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}><div style={{ width:10, height:10, borderRadius:"50%", background:"#10B981", border:`1px solid ${dark?"#1E4D2B":"#A7F3D0"}` }}/><span style={{ fontSize:12, color:t.textSub, fontWeight: 600, fontFamily:"'Inter',sans-serif" }}>Present</span></div>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}><div style={{ width:10, height:10, borderRadius:"50%", background:"#EF4444", border:`1px solid ${dark?"#5D1010":"#FCA5A5"}` }}/><span style={{ fontSize:12, color:t.textSub, fontWeight: 600, fontFamily:"'Inter',sans-serif" }}>Absent</span></div>
      </div>
    </div>
  );
});

const ProfileView = memo(function ProfileView({ user, routes, t, dark }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    name: "",
    program: "",
    department: "",
    pickupPoint: "",
    validityMonth: "December",
    validityYear: new Date().getFullYear(),
    routeId: ""
  });

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    getDoc(doc(db, "users", user.uid)).then(snap => {
      if (snap.exists()) {
        const data = snap.data();
        setProfile(data);
        setForm({
          name: data.name || "",
          program: data.program || "",
          department: data.department || "",
          pickupPoint: data.pickupPoint || "",
          validityMonth: data.validityMonth || "December",
          validityYear: data.validityYear || new Date().getFullYear(),
          routeId: data.routeId || ""
        });
      }
      setLoading(false);
    }).catch(err => {
      console.error(err);
      setLoading(false);
    });
  }, [user]);

  function handleChange(e) {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
    setSuccess(false);
    setError("");
  }

  function getDaysUntilExpiry(validityMonth, validityYear) {
    const monthMap = {
      january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
      july: 6, august: 7, september: 8, october: 9, november: 10, december: 11
    };
    let m = typeof validityMonth === "string" ? monthMap[validityMonth.toLowerCase().trim()] : (validityMonth - 1);
    if (m === undefined || isNaN(m)) m = 11;
    const y = parseInt(validityYear) || new Date().getFullYear();
    const lastDay = new Date(y, m + 1, 0);
    const diffTime = lastDay.getTime() - new Date().getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.name.trim()) { setError("Name cannot be empty."); return; }
    
    setSaving(true);
    setSuccess(false);
    setError("");
    
    try {
      const updates = {
        name: form.name.trim()
      };

      if (profile.role === "student") {
        updates.program = form.program.trim();
        updates.pickupPoint = form.pickupPoint.trim();
        updates.validityMonth = form.validityMonth;
        updates.validityYear = parseInt(form.validityYear) || new Date().getFullYear();
        updates.routeId = form.routeId;
      } else if (profile.role === "teacher") {
        updates.department = form.department.trim();
        updates.pickupPoint = form.pickupPoint.trim();
      }

      await setDoc(doc(db, "users", user.uid), updates, { merge: true });
      setProfile(prev => ({ ...prev, ...updates }));
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      console.error("Failed to update profile:", err);
      setError("Failed to save changes. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return (
    <div style={{ textAlign: "center", padding: "40px 0", color: t.textMuted }}>
      <div style={{ fontSize: 24 }}>👤</div>
      <div style={{ fontSize: 12, marginTop: 8 }}>Loading profile...</div>
    </div>
  );

  const isTeacher = profile?.role === "teacher";
  const daysLeft = profile ? getDaysUntilExpiry(form.validityMonth, form.validityYear) : 0;
  const isExpired = daysLeft <= 0;
  const isNearExpiry = daysLeft > 0 && daysLeft <= 30;

  const inputStyle = {
    width: "100%",
    background: dark ? t.inputBg : t.bgCard2,
    border: `1.5px solid ${t.border}`,
    borderRadius: 10,
    padding: "13px 16px",
    color: t.text,
    fontSize: 14,
    outline: "none",
    fontFamily: "'Inter',sans-serif",
    marginTop: 6,
    boxSizing: "border-box",
    transition: "border-color 0.15s"
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* DIGITAL BUS PASS (STUDENTS ONLY) */}
      {!isTeacher && profile && (
        <div style={{
          width: "100%",
          background: dark 
            ? "linear-gradient(135deg, #0F172A 0%, #0F1E36 50%, #1E1B4B 100%)" 
            : "linear-gradient(135deg, #FFFFFF 0%, #FFFDFB 50%, #FFF5EE 100%)",
          border: `1.5px solid ${isExpired ? "#EF4444" : isNearExpiry ? "#F59E0B" : (dark ? "#1E293B" : "#FED7AA")}`,
          borderRadius: 16,
          padding: "20px 24px",
          boxShadow: dark ? "0 8px 32px rgba(99, 102, 241, 0.18)" : "0 8px 32px rgba(251, 146, 60, 0.15)",
          position: "relative",
          overflow: "hidden",
          transition: "all 0.25s ease"
        }}>
          {/* Card background watermarks/decorations */}
          <svg style={{ position: "absolute", right: "-20px", bottom: "-20px", opacity: dark ? 0.03 : 0.06, pointerEvents: "none", transform: "rotate(-15deg)" }} width="160" height="160" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1 .4-1 1v7c0 .6.4 1 1 1h1" />
            <circle cx="8" cy="17" r="2" />
            <circle cx="16" cy="17" r="2" />
          </svg>

          {/* Card Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1.5px solid ${dark ? "#1E293B" : "#FFEDD5"}`, paddingBottom: 12 }}>
            <div>
              <div style={{ fontSize: 9, color: t.textMuted, textTransform: "uppercase", fontWeight: 800, letterSpacing: 1.5 }}>Alliance University</div>
              <div style={{ fontSize: 13, fontWeight: 800, color: t.text, marginTop: 2 }}>STUDENT BUS PASS</div>
            </div>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={dark ? "#3B82F6" : "#FF5A1F"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1 .4-1 1v7c0 .6.4 1 1 1h1" />
              <circle cx="8" cy="17" r="2" />
              <circle cx="16" cy="17" r="2" />
            </svg>
          </div>

          {/* Card Body */}
          <div style={{ margin: "18px 0", display: "flex", gap: 14, alignItems: "center" }}>
            <div style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: dark ? "#1E293B" : "#FFF0E6",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 16,
              fontWeight: 700,
              color: dark ? "#3B82F6" : "#FF5A1F",
              border: `1.5px solid ${dark ? "#3B82F6" : "#FF5A1F"}`
            }}>
              {getInitials(profile.name)}
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: t.text }}>{profile.name}</div>
              {profile.username && (
                <div style={{ fontSize: 11, color: dark ? "#3B82F6" : "#FF5A1F", fontWeight: 600, marginTop: 2 }}>@{profile.username}</div>
              )}
              <div style={{ fontSize: 12, color: t.textSub, marginTop: 3 }}>{form.program || "Course details not set"}</div>
            </div>
          </div>

          {/* Card Meta details */}
          <div style={{ 
            display: "grid", 
            gridTemplateColumns: "1.2fr 1fr", 
            gap: 10, 
            background: dark ? "rgba(15, 23, 42, 0.6)" : "rgba(255, 255, 255, 0.8)", 
            padding: 12, 
            borderRadius: 12, 
            border: `1.5px solid ${dark ? "#1E293B" : "#FFEDD5"}` 
          }}>
            <div>
              <div style={{ fontSize: 8, color: t.textMuted, textTransform: "uppercase", fontWeight: 700, letterSpacing: 0.5 }}>Pick Up Stop</div>
              <div style={{ fontSize: 11, fontWeight: 800, color: t.text, marginTop: 2 }}>{form.pickupPoint || "Not configured"}</div>
            </div>
            <div>
              <div style={{ fontSize: 8, color: t.textMuted, textTransform: "uppercase", fontWeight: 700, letterSpacing: 0.5 }}>Expiry Date</div>
              <div style={{ fontSize: 11, fontWeight: 800, color: isExpired ? "#EF4444" : t.text, marginTop: 2 }}>{form.validityMonth} {form.validityYear}</div>
            </div>
          </div>

          {/* Card Expiry countdown badge */}
          <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 8, color: t.textMuted, textTransform: "uppercase", fontWeight: 700, letterSpacing: 0.5 }}>Pass Status:</span>
              <span style={{ fontSize: 10, color: isExpired ? "#EF4444" : isNearExpiry ? "#F59E0B" : t.textSub, fontWeight: 700 }}>
                ({isExpired ? "Expired" : `${daysLeft} days remaining`})
              </span>
            </div>
            <div style={{
              fontSize: 11, fontWeight: 800, borderRadius: 6, padding: "4px 8px",
              background: isExpired ? (dark ? "#2A0808" : "#FEF2F2") : isNearExpiry ? (dark ? "#2A1F0C" : "#FFF7ED") : (dark ? "#0D1F12" : "#ECFDF5"),
              color: isExpired ? "#EF4444" : isNearExpiry ? "#F59E0B" : "#10B981",
              border: `1px solid ${isExpired ? (dark ? "#5D1010" : "#FCA5A5") : isNearExpiry ? (dark ? "#5D3E10" : "#FDBA74") : (dark ? "#1E4D2B" : "#A7F3D0")}`
            }}>
              {isExpired ? "Expired" : isNearExpiry ? "Near Expiry" : "Active"}
            </div>
          </div>
        </div>
      )}

      {isTeacher && profile && (
        <div style={{
          width: "100%",
          background: dark 
            ? "linear-gradient(135deg, #0F172A 0%, #052E21 50%, #064E3B 100%)" 
            : "linear-gradient(135deg, #FFFFFF 0%, #ECFDF5 50%, #D1FAE5 100%)",
          border: `1.5px solid ${dark ? "#065F46" : "#A7F3D0"}`,
          borderRadius: 16,
          padding: "20px 24px",
          boxShadow: dark ? "0 8px 32px rgba(16, 185, 129, 0.18)" : "0 8px 32px rgba(16, 185, 129, 0.15)",
          position: "relative",
          overflow: "hidden",
          transition: "all 0.25s ease"
        }}>
          {/* Card background watermarks/decorations */}
          <svg style={{ position: "absolute", right: "-20px", bottom: "-20px", opacity: dark ? 0.03 : 0.06, pointerEvents: "none", transform: "rotate(-15deg)" }} width="160" height="160" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1 .4-1 1v7c0 .6.4 1 1 1h1" />
            <circle cx="8" cy="17" r="2" />
            <circle cx="16" cy="17" r="2" />
          </svg>

          {/* Card Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1.5px solid ${dark ? "#065F46" : "#A7F3D0"}`, paddingBottom: 12 }}>
            <div>
              <div style={{ fontSize: 9, color: t.textMuted, textTransform: "uppercase", fontWeight: 800, letterSpacing: 1.5 }}>Alliance University</div>
              <div style={{ fontSize: 13, fontWeight: 800, color: t.text, marginTop: 2 }}>FACULTY ID CARD</div>
            </div>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={dark ? "#10B981" : "#059669"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </div>

          {/* Card Body */}
          <div style={{ margin: "18px 0", display: "flex", gap: 14, alignItems: "center" }}>
            <div style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: dark ? "#064E3B" : "#D1FAE5",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 16,
              fontWeight: 700,
              color: dark ? "#10B981" : "#059669",
              border: `1.5px solid ${dark ? "#10B981" : "#059669"}`
            }}>
              {getInitials(profile.name)}
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: t.text }}>{profile.name}</div>
              {profile.username && (
                <div style={{ fontSize: 11, color: dark ? "#10B981" : "#059669", fontWeight: 600, marginTop: 2 }}>@{profile.username}</div>
              )}
              <div style={{ fontSize: 12, color: t.textSub, marginTop: 3 }}>{form.department || "Faculty Member"}</div>
            </div>
          </div>

          {/* Card Meta details */}
          <div style={{ 
            display: "grid", 
            gridTemplateColumns: "1.2fr 1fr", 
            gap: 10, 
            background: dark ? "rgba(15, 23, 42, 0.6)" : "rgba(255, 255, 255, 0.8)", 
            padding: 12, 
            borderRadius: 12, 
            border: `1.5px solid ${dark ? "#065F46" : "#A7F3D0"}` 
          }}>
            <div>
              <div style={{ fontSize: 8, color: t.textMuted, textTransform: "uppercase", fontWeight: 700, letterSpacing: 0.5 }}>Pick Up Stop</div>
              <div style={{ fontSize: 11, fontWeight: 800, color: t.text, marginTop: 2 }}>{form.pickupPoint || "Not configured"}</div>
            </div>
            <div>
              <div style={{ fontSize: 8, color: t.textMuted, textTransform: "uppercase", fontWeight: 700, letterSpacing: 0.5 }}>Access Status</div>
              <div style={{ fontSize: 11, fontWeight: 800, color: "#10B981", marginTop: 2 }}>Verified Staff</div>
            </div>
          </div>

          {/* Scanned ID card Image reference preview inside the card if present */}
          {profile.idCardPhoto && (
            <div style={{ marginTop: 14, borderTop: `1px dashed ${dark ? "#065F46" : "#A7F3D0"}`, paddingTop: 14 }}>
              <div style={{ fontSize: 8, color: t.textMuted, textTransform: "uppercase", fontWeight: 700, letterSpacing: 0.5, marginBottom: 6 }}>Scanned ID Card Photo</div>
              <div style={{ width: "100%", height: 120, borderRadius: 8, overflow: "hidden", border: `1px solid ${dark ? "#1E293B" : "#E2E8F0"}` }}>
                <img src={profile.idCardPhoto} style={{ width: "100%", height: "100%", objectFit: "contain", background: "#0F172A" }} alt="Scanned Faculty ID Card" />
              </div>
            </div>
          )}
        </div>
      )}

      {/* EDIT PROFILE FORM */}
      <form onSubmit={handleSave} style={{
        background: t.bgCard,
        border: `1.5px solid ${t.border}`,
        borderRadius: 12,
        padding: 24,
        boxShadow: dark ? "0 4px 20px rgba(0,0,0,0.3)" : "0 8px 30px rgba(0,0,0,0.03)"
      }}>
        <h3 style={{ fontSize: 14, fontWeight: 800, textTransform: "uppercase", letterSpacing: "1px", color: t.text, margin: "0 0 16px", fontFamily: "'Inter',sans-serif" }}>
          Edit Profile Details
        </h3>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {profile?.username && (
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: t.textSub, textTransform: "uppercase" }}>Login Username</label>
              <input value={profile.username} readOnly style={{ ...inputStyle, background: dark ? "#1E1E20" : "#E2E8F0", color: t.textSub, cursor: "not-allowed" }} />
            </div>
          )}
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: t.textSub, textTransform: "uppercase" }}>Full Name</label>
            <input name="name" value={form.name} onChange={handleChange} style={inputStyle} placeholder="Your name" />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: t.textSub, textTransform: "uppercase" }}>Pick Up Stop</label>
            <input name="pickupPoint" value={form.pickupPoint || ""} onChange={handleChange} style={inputStyle} placeholder="e.g. Silk Board Junction" />
          </div>

          {isTeacher ? (
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: t.textSub, textTransform: "uppercase" }}>Department / Designation</label>
              <input name="department" value={form.department || ""} onChange={handleChange} style={inputStyle} placeholder="e.g. Department of CSE" />
            </div>
          ) : (
            <>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: t.textSub, textTransform: "uppercase" }}>Program / Course</label>
                <input name="program" value={form.program} onChange={handleChange} style={inputStyle} placeholder="e.g. B.Tech Computer Science" />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: t.textSub, textTransform: "uppercase" }}>Validity Month</label>
                  <select name="validityMonth" value={form.validityMonth} onChange={handleChange} style={{ ...inputStyle, height: 46, padding: "0 16px" }}>
                    {["January","February","March","April","May","June","July","August","September","October","November","December"].map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 11, fontWeight: 700, color: t.textSub, textTransform: "uppercase" }}>Validity Year</label>
                  <input type="number" name="validityYear" value={form.validityYear} onChange={handleChange} style={inputStyle} placeholder="Year" />
                </div>
              </div>

              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: t.textSub, textTransform: "uppercase" }}>Assigned Bus Route</label>
                <select name="routeId" value={form.routeId} onChange={handleChange} style={{ ...inputStyle, height: 46, padding: "0 16px" }}>
                  <option value="">Select Route</option>
                  {routes.map(r => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>
            </>
          )}


          {error && <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, padding: 10, color: "#DC2626", fontSize: 12, fontWeight: 600 }}>⚠️ {error}</div>}
          {success && <div style={{ background: "#ECFDF5", border: "1px solid #A7F3D0", borderRadius: 8, padding: 10, color: "#047857", fontSize: 12, fontWeight: 600 }}>✓ Profile updated successfully!</div>}

          <button type="submit" disabled={saving} style={{
            width: "100%", background: saving ? t.border : t.accent, color: "#fff",
            border: "none", borderRadius: 10, padding: "14px 0", fontSize: 14, fontWeight: 700,
            cursor: saving ? "not-allowed" : "pointer", fontFamily: "'Inter',sans-serif", marginTop: 10,
            boxShadow: saving ? "none" : `0 4px 14px ${t.accent}33`, transition: "all 0.2s"
          }}>
            {saving ? "Saving Changes..." : "Save Changes"}
          </button>
        </div>
      </form>
    </div>
  );
});
