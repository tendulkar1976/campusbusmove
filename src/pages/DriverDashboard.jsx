import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { ref, set, onValue } from "firebase/database";
import { collection, getDocs, addDoc, updateDoc, doc, query, where } from "firebase/firestore";
import { rtdb, db } from "../firebase";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import MapView from "../components/MapView";

function formatTime(s) {
  const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60;
  return h>0?`${h}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`:`${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
}
function formatDuration(ms) {
  const s=Math.floor(ms/1000),h=Math.floor(s/3600),m=Math.floor((s%3600)/60);
  return h>0?`${h}h ${m}m`:`${m}m`;
}

export default function DriverDashboard() {
  const { user, campusId, logout } = useAuth();
  const { dark, toggle, t } = useTheme();

  const [tab, setTab]                         = useState("live");
  const [routes, setRoutes]                   = useState([]);
  const [selectedRouteId, setSelectedRouteId] = useState(null);
  const [tracking, setTracking]               = useState(false);
  const [myLocation, setMyLocation]           = useState(null);
  const [speed, setSpeed]                     = useState(0);
  const [heading, setHeading]                 = useState(0);
  const [accuracy, setAccuracy]               = useState(null);
  const [gpsStatus, setGpsStatus]             = useState("idle"); // idle | waiting | active | error
  const [error, setError]                     = useState("");
  const [tripStart, setTripStart]             = useState(null);
  const [elapsed, setElapsed]                 = useState(0);
  const [trips, setTrips]                     = useState([]);
  const [loading, setLoading]                 = useState(true);
  const [gpsAlert, setGpsAlert]               = useState(null); // null | 'blocked' | 'off'

  const watchIdRef         = useRef(null);
  const lastFirebaseUpdate = useRef(0);
  const timerRef           = useRef(null);
  const tripDocRef         = useRef(null);
  const selectedRouteIdRef = useRef(null);
  const gpsRetryRef        = useRef(null);
  const wakeLockRef        = useRef(null);
  const lastLocationUpdateTimestamp = useRef(0);
  const watchdogRef                 = useRef(null);
  const useHighAccuracyRef          = useRef(true);
  const adminInitiatedRef           = useRef(false);

  // Wake lock helpers
  async function requestWakeLock() {
    try {
      if ("wakeLock" in navigator) {
        wakeLockRef.current = await navigator.wakeLock.request("screen");
        console.log("Screen Wake Lock active");
      }
    } catch (err) {
      console.warn("Screen Wake Lock failed:", err);
    }
  }

  function releaseWakeLock() {
    if (wakeLockRef.current) {
      wakeLockRef.current.release().then(() => {
        wakeLockRef.current = null;
        console.log("Screen Wake Lock released");
      }).catch(err => console.error("Release wake lock error:", err));
    }
  }

  useEffect(() => { selectedRouteIdRef.current = selectedRouteId; }, [selectedRouteId]);

  // Load routes
  useEffect(() => {
    getDocs(collection(db, "routes")).then(snap => {
      if (!snap.empty) {
        const r = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setRoutes(r);
        setSelectedRouteId(r[0].id);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  // Listen to remote admin-forced start/stop signals
  useEffect(() => {
    if (!user || routes.length === 0) return;
    const r = ref(rtdb, "routes");
    const unsub = onValue(r, snap => {
      if (snap.exists()) {
        const data = snap.val();
        let currentAssignedRouteId = null;
        let remoteTripId = null;
        let remoteActive = false;

        Object.entries(data).forEach(([rid, rData]) => {
          const live = rData.live;
          if (live && live.active && live.driverUid === user.uid && live.adminStarted) {
            currentAssignedRouteId = rid;
            remoteTripId = live.tripId;
            remoteActive = true;
          }
        });

        if (remoteActive && currentAssignedRouteId) {
          if (!trackingRef.current) {
            console.log("Admin forced start trip for route:", currentAssignedRouteId);
            autoStartFromAdmin(currentAssignedRouteId, remoteTripId);
          }
        } else {
          if (trackingRef.current && adminInitiatedRef.current) {
            console.log("Admin forced stop trip");
            stopTracking();
          }
        }
      }
    });
    return () => unsub();
  }, [user, routes]);

  async function autoStartFromAdmin(routeId, tripId) {
    if (!navigator.geolocation) { return; }
    setSelectedRouteId(routeId);
    selectedRouteIdRef.current = routeId;
    adminInitiatedRef.current = true;
    setError("");
    const now = Date.now();
    setTripStart(now);
    tripDocRef.current = tripId;

    writeToRTDB(null, null, 0, 0, true); 
    lastFirebaseUpdate.current = 0;
    lastLocationUpdateTimestamp.current = Date.now();
    useHighAccuracyRef.current = true;

    setTracking(true);
    requestWakeLock();
    startWatchingGPS();

    clearInterval(watchdogRef.current);
    watchdogRef.current = setInterval(() => {
      const elapsedSinceLastUpdate = Date.now() - lastLocationUpdateTimestamp.current;
      if (elapsedSinceLastUpdate > 45000) {
        console.warn(`GPS watchdog: No updates for ${elapsedSinceLastUpdate}ms. Restarting watch...`);
        setError("GPS signal stalled — re-establishing connection...");
        if (useHighAccuracyRef.current) {
          useHighAccuracyRef.current = false;
        }
        startWatchingGPS();
      }
    }, 20000);
  }
  // Trip history
  useEffect(() => {
    if (!user || tab !== "trips") return;
    getDocs(query(collection(db,"trips"), where("driverUid","==",user.uid))).then(snap => {
      setTrips(snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>b.startTime-a.startTime));
    }).catch(() => setTrips([]));
  }, [user, tab]);

  // Timer
  useEffect(() => {
    if (tracking) { timerRef.current = setInterval(() => setElapsed(e => e+1), 1000); }
    else { clearInterval(timerRef.current); setElapsed(0); }
    return () => clearInterval(timerRef.current);
  }, [tracking]);

  // Handle app foregrounding: reset throttle, re-request wake lock, and restart GPS tracking if active
  useEffect(() => {
    const h = async () => {
      if (!document.hidden) {
        lastFirebaseUpdate.current = 0;
        if (trackingRef.current) {
          console.log("App foregrounded, re-requesting wake lock and restarting GPS");
          await requestWakeLock();
          startWatchingGPS();
          lastLocationUpdateTimestamp.current = Date.now();
        }
      }
    };
    document.addEventListener("visibilitychange", h);
    return () => document.removeEventListener("visibilitychange", h);
  }, []);

  function writeToRTDB(lat, lng, spd, hdg, active) {
    const rid = selectedRouteIdRef.current;
    if (!rid) return;
    const data = {
      routeId: rid,
      driverUid: user.uid,
      active,
      speed: spd,
      heading: hdg,
      updatedAt: Date.now(),
      source: "driver-gps"
    };
    if (adminInitiatedRef.current) {
      data.adminStarted = true;
      if (tripDocRef.current) data.tripId = tripDocRef.current;
    }
    if (lat !== null && lng !== null) {
      data.lat = lat;
      data.lng = lng;
    }
    set(ref(rtdb, `routes/${rid}/live`), data).catch(err => console.error("RTDB write failed:", err));
  }

  // startWatchingGPS
  function startWatchingGPS() {
    if (watchIdRef.current) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    setGpsStatus("waiting");

    watchIdRef.current = navigator.geolocation.watchPosition(
      pos => {
        const { latitude: lat, longitude: lng, speed: spd, heading: hdg, accuracy: acc } = pos.coords;
        const kmh = (spd != null && spd >= 0) ? parseFloat((spd * 3.6).toFixed(1)) : 0;
        const now = Date.now();

        setGpsStatus("active");
        setError(""); 
        setMyLocation({ lat, lng });
        setSpeed(kmh);
        setHeading(hdg || 0);
        setAccuracy(acc ? Math.round(acc) : null);
        lastLocationUpdateTimestamp.current = now;

        // If we got a highly accurate location, make sure we keep high accuracy turned on
        if (!useHighAccuracyRef.current && acc && acc < 20) {
          console.log("Low accuracy watch returned highly accurate position. Upgrading to high accuracy.");
          useHighAccuracyRef.current = true;
          setTimeout(() => {
            if (trackingRef.current) startWatchingGPS();
          }, 0);
        }

        if (now - lastFirebaseUpdate.current >= 2000) {
          writeToRTDB(lat, lng, kmh, hdg || 0, true);
          lastFirebaseUpdate.current = now;
        }
      },
      err => {
        const msgs = {
          1: "Location permission denied. Enable in device settings.",
          2: "GPS signal weak. Searching...",
          3: "GPS timeout — searching...",
        };
        setError(msgs[err.code] || "GPS error: " + err.message);

        if (err.code === 1) {
          setGpsAlert("blocked");
        } else if (err.code === 2) {
          setGpsAlert("off");
        }

        if (err.code === 2 || err.code === 3) {
          setGpsStatus("waiting");
          if (useHighAccuracyRef.current) {
            console.log("High accuracy watch position failed. Falling back to low accuracy.");
            useHighAccuracyRef.current = false;
            clearTimeout(gpsRetryRef.current);
            gpsRetryRef.current = setTimeout(() => {
              if (trackingRef.current) startWatchingGPS();
            }, 1000);
          }
          // If we are already using low accuracy, let the native watch run continuously
        } else {
          setGpsStatus("error");
        }
      },
      {
        enableHighAccuracy: useHighAccuracyRef.current,
        maximumAge: 0,
        timeout: 10000,
      }
    );
  }

  const trackingRef = useRef(false);
  useEffect(() => { trackingRef.current = tracking; }, [tracking]);

  async function startTracking() {
    if (!navigator.geolocation) { setError("GPS not supported on this device."); return; }
    if (!selectedRouteId) { setError("Please select a route first."); return; }

    // Run a quick check to alert if location is turned off or blocked
    navigator.geolocation.getCurrentPosition(
      () => {},
      (err) => {
        if (err.code === 1) {
          setGpsAlert("blocked");
        } else if (err.code === 2) {
          setGpsAlert("off");
        }
      },
      { enableHighAccuracy: false, timeout: 1000 }
    );

    setError("");
    const now = Date.now();
    setTripStart(now);

    const selectedRoute = routes.find(r => r.id === selectedRouteId);

    const tripDoc = await addDoc(collection(db, "trips"), {
      driverUid: user.uid,
      routeId: selectedRouteId,
      routeName: selectedRoute?.name || selectedRouteId,
      campusId,
      startTime: now,
      endTime: null,
      status: "active",
    });
    tripDocRef.current = tripDoc.id;

    writeToRTDB(null, null, 0, 0, true); // Do not write fake coordinates, only write active state
    lastFirebaseUpdate.current = 0; // Set to 0 so first position writes immediately
    lastLocationUpdateTimestamp.current = Date.now();
    useHighAccuracyRef.current = true; // reset to try high accuracy first

    setTracking(true);
    requestWakeLock(); // Keep screen awake
    startWatchingGPS();

    // Start watchdog timer (check every 20s, restart if silent for 45s to avoid interfering with GPS cold starts)
    clearInterval(watchdogRef.current);
    watchdogRef.current = setInterval(() => {
      const elapsedSinceLastUpdate = Date.now() - lastLocationUpdateTimestamp.current;
      if (elapsedSinceLastUpdate > 45000) {
        console.warn(`GPS watchdog: No updates for ${elapsedSinceLastUpdate}ms. Restarting watch...`);
        setError("GPS signal stalled — re-establishing connection...");
        if (useHighAccuracyRef.current) {
          console.log("Stalled with high accuracy. Trying low accuracy fallback.");
          useHighAccuracyRef.current = false;
        }
        startWatchingGPS();
      }
    }, 20000);
  }

  async function stopTracking() {
    clearTimeout(gpsRetryRef.current);
    clearInterval(watchdogRef.current);
    watchdogRef.current = null;
    if (watchIdRef.current) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    const activeTripId = tripDocRef.current;
    tripDocRef.current = null;

    setTracking(false);
    releaseWakeLock(); // Let screen sleep
    setGpsStatus("idle");

    const lastLat = myLocation?.lat || null;
    const lastLng = myLocation?.lng || null;
    setMyLocation(null);

    if (activeTripId) {
      try {
        await updateDoc(doc(db, "trips", activeTripId), {
          endTime: Date.now(), status: "completed",
        });
      } catch (err) {
        console.error("Failed to update Firestore trip status:", err);
      }
    }

    writeToRTDB(lastLat, lastLng, 0, 0, false);
    setSpeed(0); setHeading(0); setAccuracy(null);
    adminInitiatedRef.current = false;
  }

  useEffect(() => () => {
    clearTimeout(gpsRetryRef.current);
    clearInterval(watchdogRef.current);
    if (watchIdRef.current) navigator.geolocation.clearWatch(watchIdRef.current);
    clearInterval(timerRef.current);
    releaseWakeLock(); // Cleanup on unmount
  }, []);

  const selectedRoute = useMemo(() => routes.find(r => r.id === selectedRouteId), [routes, selectedRouteId]);

  const S = {
    screen:   { minHeight:"100vh", background:t.bg, fontFamily:"'DM Sans',sans-serif", color:t.text, transition:"background 0.25s,color 0.25s" },
    header:   { display:"flex", alignItems:"center", justifyBetween:"center", justifyContent:"space-between", padding:"16px 20px", borderBottom:`1px solid ${t.border}`, position:"sticky", top:0, background:t.headerBg, backdropFilter:"blur(20px)", WebkitBackdropFilter:"blur(20px)", zIndex:20 },
    tabs:     { display:"flex", borderBottom:`1px solid ${t.border}`, padding:"12px 20px", background:t.bg },
    tabBtn:   (active) => ({ padding:"8px 18px", border:"none", borderRadius:10, background:active ? (dark ? "#222" : "#FFFFFF") : "transparent", cursor:"pointer", fontSize:13, fontWeight:700, color:active?t.text:t.textMuted, boxShadow:active ? (dark ? "0 2px 10px rgba(0,0,0,0.5)" : "0 2px 10px rgba(0,0,0,0.05)") : "none", fontFamily:"'DM Sans',sans-serif", transition:"all 0.2s ease-in-out" }),
    body:     { padding:"20px 20px 80px", maxWidth:480, margin:"0 auto" },
    card:     { background:t.bgCard, border:`1px solid ${t.border}`, borderRadius:20, overflow:"hidden", marginBottom:18, boxShadow: dark ? "0 4px 20px rgba(0,0,0,0.4)" : "0 4px 20px rgba(0,0,0,0.03)" },
    label:    { fontSize:10, color:t.textMuted, fontWeight:800, textTransform:"uppercase", letterSpacing:"1.5px", marginBottom:10 },
    routeBtn: (sel) => ({ flex:"0 0 auto", padding:"10px 18px", border:`1px solid ${sel?t.accent:t.border}`, borderRadius:12, background:sel?t.accentSub:t.bgCard, color:sel?t.accent:t.textSub, fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"'DM Sans',sans-serif", whiteSpace:"nowrap", transition:"all 0.2s", boxShadow: sel ? `0 4px 14px ${t.accent}15` : "none" }),
    startBtn: { width:"100%", background:`linear-gradient(135deg,${t.accent},#e04800)`, border:"none", borderRadius:14, padding:"16px 0", color:"#fff", fontSize:15, fontWeight:800, cursor:"pointer", fontFamily:"'DM Sans',sans-serif", marginBottom:12, boxShadow:`0 6px 20px ${t.accent}33`, transition:"transform 0.15s, filter 0.15s" },
    stopBtn:  { width:"100%", background:dark?"#2A0808":"#FEF2F2", border:`1px solid ${dark?"#5D1010":"#FCA5A5"}`, borderRadius:14, padding:"16px 0", color:dark?"#F87171":"#B91C1C", fontSize:15, fontWeight:800, cursor:"pointer", fontFamily:"'DM Sans',sans-serif", marginBottom:12, transition:"transform 0.15s" },
    tripCard: { background:t.bgCard, border:`1px solid ${t.border}`, borderRadius:16, padding:"16px", marginBottom:12, position: "relative", boxShadow: dark ? "0 4px 12px rgba(0,0,0,0.3)" : "0 4px 12px rgba(0,0,0,0.02)" },
  };

  const gpsIndicator = {
    idle:    { color: t.textMuted,  dot: t.textHint,  text: "Offline" },
    waiting: { color: "#FBBF24",    dot: "#FBBF24",   text: "Awaiting Fix" },
    active:  { color: "#4ADE80",    dot: "#4ADE80",   text: "Active" },
    error:   { color: "#F87171",    dot: "#F87171",   text: "GPS Error" },
  }[gpsStatus];

  if (loading) return (
    <div style={{ minHeight:"100vh", background:t.bg, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:16, fontFamily:"'DM Sans',sans-serif" }}>
      <div style={{ fontSize:36 }}>🚌</div>
      <div style={{ width: 140, height: 3, background: t.border, borderRadius: 2, overflow: "hidden", position: "relative" }}>
        <div style={{ height: "100%", width: "40%", background: t.accent, borderRadius: 2, position: "absolute", animation: "loadingSwipe 1.2s ease-in-out infinite alternate" }} />
      </div>
      <style>{`
        @keyframes loadingSwipe { from{left:0%} to{left:60%} }
      `}</style>
      <div style={{ color:t.accent, fontSize:12, fontWeight: 800, letterSpacing: "1px", textTransform: "uppercase" }}>Loading Routes</div>
    </div>
  );

  return (
    <div style={S.screen}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700;800&display=swap');
        *{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
        .custom-scroll::-webkit-scrollbar { height: 4px; }
        .custom-scroll::-webkit-scrollbar-track { background: transparent; }
        .custom-scroll::-webkit-scrollbar-thumb { background: ${t.borderStrong}; border-radius: 2px; }
        .start-btn-hover:active { transform: scale(0.98); filter: brightness(0.95); }
      `}</style>

      {/* HEADER */}
      <div style={S.header}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <div style={{ width:38, height:38, background:t.accent, borderRadius:12, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, boxShadow: `0 4px 12px ${t.accent}33` }}>🚌</div>
          <div>
            <div style={{ fontSize:16, fontWeight:800, color:t.text, letterSpacing: "-0.3px" }}>CampusMove</div>
            <div style={{ fontSize:11, color:t.accent, fontWeight:700, marginTop: 1 }}>Driver Portal</div>
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <button onClick={toggle} style={{ width:38, height:38, borderRadius:12, border:`1px solid ${t.border}`, background:t.bgCard, cursor:"pointer", fontSize:18, display:"flex", alignItems:"center", justifyContent:"center", transition: "all 0.2s", boxShadow: dark ? "0 4px 10px rgba(0,0,0,0.3)" : "0 4px 10px rgba(0,0,0,0.03)" }}>
            {dark?"☀️":"🌙"}
          </button>
          <button onClick={logout} style={{ display:"flex", alignItems:"center", gap:6, padding:"8px 14px", border:`1px solid ${t.border}`, borderRadius:12, background:t.bgCard, color:t.textSub, fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"'DM Sans',sans-serif", transition: "all 0.2s", boxShadow: dark ? "0 4px 10px rgba(0,0,0,0.3)" : "0 4px 10px rgba(0,0,0,0.03)" }}>
            <span>↩</span> Sign Out
          </button>
        </div>
      </div>

      {/* TABS SEGMENT CONTROLLER */}
      <div style={S.tabs}>
        <div style={{ display:"flex", background:dark ? "#121212" : "#E5E5DF", borderRadius:14, padding:4, gap:4 }}>
          {[["live","🔴  Live Trip"],["trips","📋  Trip History"]].map(([v,l]) => (
            <button key={v} onClick={() => setTab(v)} style={S.tabBtn(tab===v)}>{l}</button>
          ))}
        </div>
      </div>

      <div style={S.body}>
        {tab === "live" && (
          <>
            {!routes.length ? (
              <div style={{ textAlign:"center", padding:"80px 0", color:t.textMuted, background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 20, boxShadow: dark ? "0 4px 20px rgba(0,0,0,0.3)" : "0 4px 20px rgba(0,0,0,0.02)" }}>
                <span style={{ fontSize: 44 }}>🚌</span>
                <div style={{ fontSize:15, fontWeight: 700, marginTop: 16, color: t.text }}>No Routes Defined</div>
                <div style={{ fontSize:13, color:t.textMuted, marginTop: 6 }}>Please contact administrator to add route files.</div>
              </div>
            ) : (
              <>
                {/* Route Selector */}
                <div style={{ marginBottom:18 }}>
                  <p style={S.label}>Select Assigned Route</p>
                  <div className="custom-scroll" style={{ display:"flex", gap:10, overflowX:"auto", paddingBottom:8 }}>
                    {routes.map(r => (
                      <button key={r.id} style={S.routeBtn(selectedRouteId===r.id)} onClick={() => !tracking && setSelectedRouteId(r.id)}>
                        {r.name}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Dashboard Instrument Panel */}
                <div style={S.card}>
                  {/* Circular Dial Timer */}
                  <div style={{ textAlign:"center", padding:"28px 20px 24px", borderBottom:`1px solid ${t.border}`, background: dark ? "#0E0E0E" : "#FAFBF7", position: "relative" }}>
                    {/* Ring frame */}
                    <div style={{
                      position: "absolute",
                      inset: "16px",
                      border: `1.5px dashed ${tracking ? t.accent + "33" : t.border}`,
                      borderRadius: 16,
                      pointerEvents: "none"
                    }} />
                    
                    <div style={{ fontSize:10, color:t.textMuted, textTransform:"uppercase", letterSpacing:"1.5px", fontWeight: 800, marginBottom:8 }}>
                      {tracking ? "Live Trip Timer" : "Trip Idle"}
                    </div>
                    <div style={{ fontSize:56, fontWeight:800, letterSpacing:"-2px", color:tracking?t.accent:t.textHint, fontVariantNumeric:"tabular-nums", lineHeight:1, fontFamily: "monospace" }}>
                      {formatTime(elapsed)}
                    </div>
                    {tracking && tripStart && (
                      <div style={{ fontSize:11, color:t.textMuted, marginTop:10, fontWeight: 600 }}>
                        Departure: {new Date(tripStart).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}
                      </div>
                    )}
                  </div>

                  {/* Widget Metrics Grid */}
                  <div style={{ display:"flex", padding:"18px 12px" }}>
                    {[
                      [`${speed}`, "km/h",  tracking?(speed>0?"#4ADE80":"#FBBF24"):t.textHint],
                      [selectedRoute?.name||"—", "Route ID", tracking?t.accent:t.textHint],
                      [gpsStatus==="active"?"Active":gpsStatus==="waiting"?"Waiting":"Offline", "GPS Status", gpsIndicator.color],
                    ].map(([val,label,color],i) => (
                      <div key={i} style={{ flex:1, textAlign:"center", borderRight: i<2 ? `1px solid ${t.border}` : "none" }}>
                        <div style={{ fontSize:i===1?13:24, fontWeight:800, color, letterSpacing:"-0.5px", lineHeight:1.2 }}>{val}</div>
                        <div style={{ fontSize:9, color:t.textMuted, marginTop:6, textTransform:"uppercase", letterSpacing:"1px", fontWeight: 700 }}>{label}</div>
                      </div>
                    ))}
                  </div>

                  {/* Accuracy progress bar */}
                  {tracking && accuracy !== null && (
                    <div style={{ padding:"0 20px 18px", display:"flex", alignItems:"center", gap:10 }}>
                      <div style={{ flex:1, height:4, background:t.border, borderRadius:2, overflow:"hidden" }}>
                        <div style={{ height:"100%", width:`${Math.max(10, 100-accuracy)}%`, background:accuracy<10?"#4ADE80":accuracy<30?"#FBBF24":"#F87171", transition:"all 0.5s", borderRadius:2 }}/>
                      </div>
                      <span style={{ fontSize:10, fontWeight:700, color:accuracy<10?"#4ADE80":accuracy<30?"#FBBF24":"#F87171", whiteSpace:"nowrap", fontFamily: "monospace" }}>GPS: ±{accuracy}m</span>
                    </div>
                  )}
                </div>

                {/* GPS Status Banner */}
                {tracking && (
                  <div style={{
                    background:dark?(gpsStatus==="active"?"#0A2010":"#241A05"):(gpsStatus==="active"?"#ECFDF5":"#FFFBEB"),
                    border:`1px solid ${dark?(gpsStatus==="active"?"#1E4D2B":"#5D4005"):(gpsStatus==="active"?"#A7F3D0":"#FDE68A")}`,
                    borderRadius:14,
                    padding:"12px 16px",
                    marginBottom:18,
                    display:"flex",
                    alignItems:"center",
                    gap:10,
                    boxShadow: dark ? "0 4px 12px rgba(0,0,0,0.2)" : "0 4px 12px rgba(0,0,0,0.01)"
                  }}>
                    <span style={{ width:8, height:8, borderRadius:"50%", background:gpsIndicator.dot, display:"inline-block", boxShadow:gpsStatus==="active"?`0 0 10px ${gpsIndicator.dot}`:"none" }}/>
                    <span style={{ fontSize:12, color:gpsIndicator.color, fontWeight:600 }}>
                      {gpsStatus==="active" ? "GPS active · Streaming coordinates every 2s" : gpsStatus==="waiting" ? "GPS waiting for lock · Student display live" : "GPS broadcast error"}
                    </span>
                  </div>
                )}

                {/* Keeping Screen Active Instruction Banner */}
                {tracking && (
                  <div style={{
                    background: dark ? "#1E1B4B" : "#EEF2FF",
                    border: `1px solid ${dark ? "#4338CA" : "#C7D2FE"}`,
                    borderRadius: 14,
                    padding: "12px 16px",
                    marginBottom: 18,
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    boxShadow: dark ? "0 4px 12px rgba(0,0,0,0.2)" : "0 4px 12px rgba(0,0,0,0.01)"
                  }}>
                    <span style={{ fontSize: 16, marginTop: -2 }}>📱</span>
                    <div>
                      <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: dark ? "#E0E7FF" : "#3730A3", textAlign: "left" }}>Keep screen on & app open</p>
                      <p style={{ margin: "4px 0 0", fontSize: 11, lineHeight: 1.4, color: dark ? "#C7D2FE" : "#4F46E5", textAlign: "left" }}>
                        Screen Wake Lock is active to prevent sleep. Do not manually lock your phone screen or close the browser tab to keep location streaming continuously for students.
                      </p>
                    </div>
                  </div>
                )}

                {/* Map View Card */}
                <div style={{ ...S.card, height: 300 }}>
                  <MapView busLocation={myLocation} busMoving={tracking && speed>0} dark={dark}/>
                </div>

                {/* Action Buttons */}
                {!tracking
                  ? <button onClick={startTracking} className="start-btn-hover" style={S.startBtn}>▶ Start Live Route</button>
                  : <button onClick={stopTracking}  className="start-btn-hover" style={S.stopBtn}>■ End Live Route</button>
                }

                {error && (
                  <div style={{ background:dark?"#2A0808":"#FEF2F2", border:`1px solid ${dark?"#5D1010":"#FEE2E2"}`, borderRadius:14, padding:"14px", marginBottom:14 }}>
                    <p style={{ color:dark?"#F87171":"#B91C1C", fontSize:13, margin:0, fontWeight: 600 }}>⚠️ {error}</p>
                    {(error.includes("stalled") || error.includes("timeout") || error.includes("weak")) && (
                      <div style={{ marginTop: 10, fontSize: 11, color: dark ? "#FCA5A5" : "#7F1D1D", textAlign: "left", lineHeight: 1.5 }}>
                        <p style={{ margin: "4px 0", fontWeight: 700 }}>Quick Troubleshooting:</p>
                        <ul style={{ margin: 0, paddingLeft: 16 }}>
                          <li>Ensure device location/GPS is enabled in quick settings.</li>
                          <li>Confirm Chrome/Browser app has system-level permission to access location.</li>
                          <li>If indoors, step outside or near a window to get a clear sky view for GPS lock.</li>
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {/* GPS Metadata readout */}
                {myLocation && (
                  <div style={{ background:t.bgCard, border:`1px solid ${t.border}`, borderRadius:16, padding:"14px 18px", display:"flex", justifyContent:"space-between", boxShadow: dark ? "0 4px 12px rgba(0,0,0,0.3)" : "0 4px 12px rgba(0,0,0,0.02)" }}>
                    <div>
                      <p style={{ fontSize:9, color:t.textMuted, textTransform:"uppercase", letterSpacing:"1px", margin:"0 0 4px", fontWeight: 700 }}>Telemetry Coordinates</p>
                      <p style={{ fontSize:12, color:t.textSub, margin:0, fontFamily:"monospace", fontWeight: 600 }}>{myLocation.lat.toFixed(6)}, {myLocation.lng.toFixed(6)}</p>
                    </div>
                    <div style={{ textAlign:"right" }}>
                      <p style={{ fontSize:9, color:t.textMuted, textTransform:"uppercase", letterSpacing:"1px", margin:"0 0 4px", fontWeight: 700 }}>Compass Heading</p>
                      <p style={{ fontSize:12, color:t.textSub, margin:0, fontFamily:"monospace", fontWeight: 600 }}>{heading}°</p>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* TRIP HISTORY LIST */}
        {tab === "trips" && (
          <>
            <p style={S.label}>Completed Trips History</p>
            {!trips.length ? (
              <div style={{ textAlign:"center", padding:"80px 0", color:t.textMuted, background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 20, boxShadow: dark ? "0 4px 20px rgba(0,0,0,0.3)" : "0 4px 20px rgba(0,0,0,0.02)" }}>
                <span style={{ fontSize: 36 }}>📋</span>
                <div style={{ fontSize:15, fontWeight: 700, marginTop: 16, color: t.text }}>No Trip History</div>
                <div style={{ fontSize:13, color:t.textMuted, marginTop: 6 }}>Completed trips will appear here automatically.</div>
              </div>
            ) : (
              trips.map(trip => (
                <div key={trip.id} style={{ ...S.tripCard, borderLeft: `4px solid ${trip.status === "active" ? "#4ADE80" : t.borderStrong}` }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:12 }}>
                    <div>
                      <div style={{ fontSize:15, fontWeight:800, color:t.text, letterSpacing: "-0.2px" }}>{trip.routeName}</div>
                      <div style={{ fontSize:11, color:t.textMuted, marginTop:4, fontWeight: 600 }}>{new Date(trip.startTime).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})}</div>
                    </div>
                    <span style={{ fontSize:10, padding:"4px 10px", borderRadius:20, fontWeight:700, background:trip.status==="active"?(dark?"#0A2010":"#ECFDF5"):(dark?"#161616":t.bgCard), color:trip.status==="active"?(dark?"#4ADE80":"#047857"):t.textMuted, border:`1px solid ${trip.status==="active"?(dark?"#1E4D2B":"#A7F3D0"):t.border}` }}>
                      {trip.status==="active"?"● Live Now":"Finished"}
                    </span>
                  </div>
                  <div style={{ display:"flex", gap:24, background: dark ? "#0A0A0A" : "#FBFBFA", padding: 12, borderRadius: 12, border: `1px solid ${t.border}` }}>
                    <div><div style={{ fontSize:9, color:t.textMuted, textTransform:"uppercase", letterSpacing:"0.8px", fontWeight:700 }}>Depart</div><div style={{ fontSize:13, color:t.textSub, marginTop:4, fontWeight:600, fontFamily: "monospace" }}>{new Date(trip.startTime).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</div></div>
                    {trip.endTime && <>
                      <div style={{ color:t.textHint, alignSelf:"flex-end", fontSize:14, paddingBottom: 2 }}>→</div>
                      <div><div style={{ fontSize:9, color:t.textMuted, textTransform:"uppercase", letterSpacing:"0.8px", fontWeight:700 }}>Arrive</div><div style={{ fontSize:13, color:t.textSub, marginTop:4, fontWeight:600, fontFamily: "monospace" }}>{new Date(trip.endTime).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</div></div>
                      <div style={{ marginLeft: "auto" }}><div style={{ fontSize:9, color:t.textMuted, textTransform:"uppercase", letterSpacing:"0.8px", fontWeight:700 }}>Duration</div><div style={{ fontSize:13, color:t.accent, fontWeight:800, marginTop:4 }}>{formatDuration(trip.endTime-trip.startTime)}</div></div>
                    </>}
                  </div>
                </div>
              ))
            )}
          </>
        )}
      </div>

      {/* GPS Troubleshooting Modal */}
      {gpsAlert && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.75)",
          backdropFilter: "blur(6px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          zIndex: 1000,
          fontFamily: "'DM Sans', sans-serif"
        }}>
          <div style={{
            background: t.bgCard,
            border: `1.5px solid ${t.border}`,
            borderRadius: 24,
            padding: 28,
            maxWidth: 360,
            width: "100%",
            textAlign: "center",
            boxShadow: "0 10px 30px rgba(0,0,0,0.3)"
          }}>
            <div style={{ fontSize: 44, marginBottom: 16 }}>📍</div>
            <h3 style={{ color: t.text, fontSize: 18, fontWeight: 800, margin: "0 0 10px" }}>
              {gpsAlert === "blocked" ? "Location Access Blocked" : "GPS / Location is OFF"}
            </h3>
            <p style={{ color: t.textSub, fontSize: 13, lineHeight: 1.6, margin: "0 0 24px", textAlign: "center" }}>
              {gpsAlert === "blocked" ? (
                "Location permissions are disabled in your browser. Please tap the settings/lock icon in Chrome's address bar and grant Location permissions."
              ) : (
                "Your phone's location services are turned off. Please swipe down your notification shade, toggle Location / GPS ON, and try starting the route again."
              )}
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button
                onClick={() => {
                  setGpsAlert(null);
                  if (trackingRef.current) {
                    startWatchingGPS();
                  } else {
                    startTracking();
                  }
                }}
                style={{
                  width: "100%",
                  background: t.accent,
                  color: "#fff",
                  border: "none",
                  borderRadius: 14,
                  padding: "14px 0",
                  fontSize: 14,
                  fontWeight: 800,
                  cursor: "pointer",
                  fontFamily: "'DM Sans', sans-serif"
                }}
              >
                🔄 Retry Connection
              </button>
              <button
                onClick={() => {
                  setGpsAlert(null);
                  window.location.reload();
                }}
                style={{
                  width: "100%",
                  background: "none",
                  border: `1.5px solid ${t.border}`,
                  color: t.text,
                  borderRadius: 14,
                  padding: "12px 0",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "'DM Sans', sans-serif"
                }}
              >
                Refresh Page
              </button>
              <button
                onClick={() => setGpsAlert(null)}
                style={{
                  width: "100%",
                  background: "none",
                  border: "none",
                  color: t.textSub,
                  borderRadius: 14,
                  padding: "8px 0",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "'DM Sans', sans-serif"
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
