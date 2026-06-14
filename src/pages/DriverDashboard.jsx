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

  const watchIdRef         = useRef(null);
  const lastFirebaseUpdate = useRef(0);
  const timerRef           = useRef(null);
  const tripDocRef         = useRef(null);
  const selectedRouteIdRef = useRef(null);
  const gpsRetryRef        = useRef(null);

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

  // Reset Firebase throttle on foreground
  useEffect(() => {
    const h = () => { if (!document.hidden) lastFirebaseUpdate.current = 0; };
    document.addEventListener("visibilitychange", h);
    return () => document.removeEventListener("visibilitychange", h);
  }, []);

  // FIX: Write to RTDB helper — always uses current routeId from ref
  function writeToRTDB(lat, lng, spd, hdg, active) {
    const rid = selectedRouteIdRef.current;
    if (!rid) return;
    set(ref(rtdb, `routes/${rid}/live`), {
      routeId: rid,
      driverUid: user.uid,
      active,
      lat, lng,
      speed: spd,
      heading: hdg,
      updatedAt: Date.now(),
    }).catch(err => console.error("RTDB write failed:", err));
  }

  // FIX: startWatchingGPS — separate function so it can retry
  function startWatchingGPS() {
    // Clear any existing watch
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
        setError(""); // clear any GPS error once we get a fix
        setMyLocation({ lat, lng });
        setSpeed(kmh);
        setHeading(hdg || 0);
        setAccuracy(acc ? Math.round(acc) : null);

        // FIX: throttle Firebase writes to 2s
        if (now - lastFirebaseUpdate.current >= 2000) {
          writeToRTDB(lat, lng, kmh, hdg || 0, true);
          lastFirebaseUpdate.current = now;
        }
      },
      err => {
        const msgs = {
          1: "Location permission denied. Enable in device settings.",
          2: "GPS signal lost. Move to open area.",
          3: "GPS timeout — retrying...",
        };
        setError(msgs[err.code] || "GPS error: " + err.message);

        // FIX: auto-retry on timeout (code 3) — most common on Android cold start
        if (err.code === 3) {
          setGpsStatus("waiting");
          clearTimeout(gpsRetryRef.current);
          gpsRetryRef.current = setTimeout(() => {
            if (tracking || trackingRef.current) startWatchingGPS();
          }, 3000);
        } else {
          setGpsStatus("error");
        }
      },
      {
        enableHighAccuracy: false,
        maximumAge: 10000,
        timeout: 60000,
      }
    );
  }

  // Need a ref for tracking so retry closure can check it
  const trackingRef = useRef(false);
  useEffect(() => { trackingRef.current = tracking; }, [tracking]);

  async function startTracking() {
    if (!navigator.geolocation) { setError("GPS not supported on this device."); return; }
    if (!selectedRouteId) { setError("Please select a route first."); return; }

    setError("");
    const now = Date.now();
    setTripStart(now);

    const selectedRoute = routes.find(r => r.id === selectedRouteId);

    // Create Firestore trip doc
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

    // FIX: Write active:true to RTDB IMMEDIATELY — students see bus is live
    // even before GPS gets first fix
    writeToRTDB(12.9716, 77.5946, 0, 0, true);
    lastFirebaseUpdate.current = Date.now();

    setTracking(true);
    startWatchingGPS();
  }

  async function stopTracking() {
    clearTimeout(gpsRetryRef.current);
    if (watchIdRef.current) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setTracking(false);
    setGpsStatus("idle");

    // FIX: Write active:false with last known coords
    writeToRTDB(
      myLocation?.lat || 12.9716,
      myLocation?.lng || 77.5946,
      0, 0, false
    );

    if (tripDocRef.current) {
      await updateDoc(doc(db, "trips", tripDocRef.current), {
        endTime: Date.now(), status: "completed",
      });
      tripDocRef.current = null;
    }

    setSpeed(0); setHeading(0); setAccuracy(null);
  }

  useEffect(() => () => {
    clearTimeout(gpsRetryRef.current);
    if (watchIdRef.current) navigator.geolocation.clearWatch(watchIdRef.current);
    clearInterval(timerRef.current);
  }, []);

  const selectedRoute = useMemo(() => routes.find(r => r.id === selectedRouteId), [routes, selectedRouteId]);

  const S = {
    screen:   { minHeight:"100vh", background:t.bg, fontFamily:"'DM Sans',sans-serif", color:t.text, transition:"background 0.25s,color 0.25s" },
    header:   { display:"flex", alignItems:"center", justifyContent:"space-between", padding:"14px 16px", borderBottom:`1px solid ${t.border}`, position:"sticky", top:0, background:t.headerBg, backdropFilter:"blur(16px)", WebkitBackdropFilter:"blur(16px)", zIndex:20 },
    tabs:     { display:"flex", borderBottom:`1px solid ${t.border}`, padding:"0 16px", background:t.bg },
    tabBtn:   (a) => ({ padding:"13px 18px", border:"none", background:"none", cursor:"pointer", fontSize:13, fontWeight:600, color:a?t.tabActive:t.tabInactive, borderBottom:a?`2px solid ${t.tabActive}`:"2px solid transparent", fontFamily:"'DM Sans',sans-serif", transition:"color 0.15s" }),
    body:     { padding:"16px 16px 40px", maxWidth:480, margin:"0 auto" },
    card:     { background:t.bgCard, border:`1px solid ${t.border}`, borderRadius:16, overflow:"hidden", marginBottom:14 },
    label:    { fontSize:10, color:t.textMuted, fontWeight:700, textTransform:"uppercase", letterSpacing:"1.2px", marginBottom:8 },
    routeBtn: (sel) => ({ flex:"0 0 auto", padding:"10px 16px", border:`1px solid ${sel?t.accent:t.border}`, borderRadius:10, background:sel?t.accentSub:t.bgCard, color:sel?t.accent:t.textSub, fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"'DM Sans',sans-serif", whiteSpace:"nowrap", transition:"all 0.15s" }),
    startBtn: { width:"100%", background:`linear-gradient(135deg,${t.accent},#e04800)`, border:"none", borderRadius:14, padding:"18px 0", color:"#fff", fontSize:16, fontWeight:700, cursor:"pointer", fontFamily:"'DM Sans',sans-serif", marginBottom:12, boxShadow:`0 6px 24px rgba(255,90,31,0.4)` },
    stopBtn:  { width:"100%", background:dark?"#1A0808":"#FEF2F2", border:`1px solid ${dark?"#3D1010":"#FCA5A5"}`, borderRadius:14, padding:"18px 0", color:dark?"#F87171":"#991B1B", fontSize:16, fontWeight:700, cursor:"pointer", fontFamily:"'DM Sans',sans-serif", marginBottom:12 },
    tripCard: { background:t.bgCard, border:`1px solid ${t.border}`, borderRadius:14, padding:"14px 16px", marginBottom:10 },
  };

  // GPS status indicator
  const gpsIndicator = {
    idle:    { color: t.textMuted,  dot: t.textHint,  text: "GPS off" },
    waiting: { color: "#facc15",    dot: "#facc15",   text: "Getting GPS fix..." },
    active:  { color: "#4ADE80",    dot: "#4ADE80",   text: "GPS active" },
    error:   { color: "#F87171",    dot: "#F87171",   text: "GPS error" },
  }[gpsStatus];

  if (loading) return (
    <div style={{ minHeight:"100vh", background:t.bg, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:12, fontFamily:"'DM Sans',sans-serif" }}>
      <div style={{ fontSize:32 }}>🚌</div>
      <div style={{ color:t.accent, fontSize:14 }}>Loading routes...</div>
    </div>
  );

  return (
    <div style={S.screen}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');*{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}`}</style>

      {/* HEADER */}
      <div style={S.header}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:34, height:34, background:t.accent, borderRadius:10, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>🚌</div>
          <div>
            <div style={{ fontSize:15, fontWeight:700, color:t.text }}>CampusMove</div>
            <div style={{ fontSize:11, color:t.accent, fontWeight:600 }}>Driver Mode</div>
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <button onClick={toggle} style={{ width:36, height:36, borderRadius:10, border:`1px solid ${t.border}`, background:t.bgCard, cursor:"pointer", fontSize:18, display:"flex", alignItems:"center", justifyContent:"center" }}>{dark?"☀️":"🌙"}</button>
          <button onClick={logout} style={{ display:"flex", alignItems:"center", gap:6, padding:"7px 12px", border:`1px solid ${t.border}`, borderRadius:10, background:t.bgCard, color:t.textSub, fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" }}>
            <span>↩</span> Sign out
          </button>
        </div>
      </div>

      {/* TABS */}
      <div style={S.tabs}>
        {[["live","🔴  Live"],["trips","📋  Trips"]].map(([v,l]) => (
          <button key={v} onClick={() => setTab(v)} style={S.tabBtn(tab===v)}>{l}</button>
        ))}
      </div>

      <div style={S.body}>
        {tab === "live" && (
          <>
            {!routes.length ? (
              <div style={{ textAlign:"center", padding:"60px 0", color:t.textMuted, fontSize:14 }}>
                No routes yet.<br/><span style={{ fontSize:12, color:t.textHint }}>Ask admin to add routes.</span>
              </div>
            ) : (
              <>
                {/* Route selector */}
                <div style={{ marginBottom:14 }}>
                  <p style={S.label}>Select Route</p>
                  <div style={{ display:"flex", gap:8, overflowX:"auto", paddingBottom:4 }}>
                    {routes.map(r => (
                      <button key={r.id} style={S.routeBtn(selectedRouteId===r.id)} onClick={() => !tracking && setSelectedRouteId(r.id)}>
                        {r.name}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Timer card */}
                <div style={S.card}>
                  <div style={{ textAlign:"center", padding:"24px 16px 20px", borderBottom:`1px solid ${t.border}` }}>
                    <div style={{ fontSize:10, color:t.textMuted, textTransform:"uppercase", letterSpacing:"1px", marginBottom:8 }}>
                      {tracking ? "Trip Duration" : "Ready to Start"}
                    </div>
                    <div style={{ fontSize:52, fontWeight:700, letterSpacing:"-2px", color:tracking?t.accent:t.textHint, fontVariantNumeric:"tabular-nums", lineHeight:1 }}>
                      {formatTime(elapsed)}
                    </div>
                    {tracking && tripStart && (
                      <div style={{ fontSize:11, color:t.textMuted, marginTop:8 }}>
                        Started at {new Date(tripStart).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}
                      </div>
                    )}
                  </div>

                  {/* Stats */}
                  <div style={{ display:"flex", padding:"16px" }}>
                    {[
                      [`${speed}`, "km/h",  tracking?(speed>0?"#4ADE80":"#facc15"):t.textHint],
                      [selectedRoute?.name||"—", "Route", tracking?t.accent:t.textHint],
                      [gpsStatus==="active"?"Live":gpsStatus==="waiting"?"Wait...":"Off", "GPS", gpsIndicator.color],
                    ].map(([val,label,color],i) => (
                      <div key={i} style={{ flex:1, textAlign:"center" }}>
                        <div style={{ fontSize:i===1?13:22, fontWeight:700, color, letterSpacing:"-0.5px", lineHeight:1.2 }}>{val}</div>
                        <div style={{ fontSize:10, color:t.textMuted, marginTop:4, textTransform:"uppercase", letterSpacing:"0.8px" }}>{label}</div>
                      </div>
                    ))}
                  </div>

                  {/* Accuracy bar */}
                  {tracking && accuracy !== null && (
                    <div style={{ padding:"0 16px 14px", display:"flex", alignItems:"center", gap:8 }}>
                      <div style={{ flex:1, height:3, background:t.border, borderRadius:2, overflow:"hidden" }}>
                        <div style={{ height:"100%", width:`${Math.max(0,100-accuracy)}%`, background:accuracy<10?"#4ADE80":accuracy<30?"#facc15":"#F87171", transition:"width 0.4s", borderRadius:2 }}/>
                      </div>
                      <span style={{ fontSize:10, color:accuracy<10?"#4ADE80":accuracy<30?"#facc15":"#F87171", whiteSpace:"nowrap" }}>±{accuracy}m</span>
                    </div>
                  )}
                </div>

                {/* Status banner */}
                {tracking && (
                  <div style={{ background:dark?(gpsStatus==="active"?"#0A1A0D":"#1A1400"):(gpsStatus==="active"?"#ECFDF5":"#FEFCE8"), border:`1px solid ${dark?(gpsStatus==="active"?"#1A3D22":"#3D3000"):(gpsStatus==="active"?"#6EE7B7":"#FDE68A")}`, borderRadius:10, padding:"10px 14px", marginBottom:14, display:"flex", alignItems:"center", gap:8 }}>
                    <span style={{ width:7, height:7, borderRadius:"50%", background:gpsIndicator.dot, display:"inline-block", boxShadow:gpsStatus==="active"?`0 0 6px ${gpsIndicator.dot}`:"none" }}/>
                    <span style={{ fontSize:12, color:gpsIndicator.color, fontWeight:500 }}>
                      {gpsStatus==="active" ? "Broadcasting live · Firebase every 2s" : gpsStatus==="waiting" ? "Waiting for GPS fix — students can see bus is active" : "GPS error — retrying"}
                    </span>
                  </div>
                )}

                {/* Map */}
                <div style={{ ...S.card, marginBottom:14 }}>
                  <MapView busLocation={myLocation} busMoving={tracking && speed>0} dark={dark}/>
                </div>

                {!tracking
                  ? <button onClick={startTracking} style={S.startBtn}>▶ Start Trip</button>
                  : <button onClick={stopTracking}  style={S.stopBtn}>■ End Trip</button>
                }

                {error && (
                  <div style={{ background:dark?"#1A0808":"#FEF2F2", border:`1px solid ${dark?"#3D1010":"#FCA5A5"}`, borderRadius:10, padding:"12px 14px", marginBottom:10 }}>
                    <p style={{ color:dark?"#F87171":"#991B1B", fontSize:13, margin:0 }}>⚠️ {error}</p>
                  </div>
                )}

                {myLocation && (
                  <div style={{ background:t.bgCard, border:`1px solid ${t.border}`, borderRadius:12, padding:"12px 16px", display:"flex", justifyContent:"space-between" }}>
                    <div>
                      <p style={{ fontSize:10, color:t.textMuted, textTransform:"uppercase", letterSpacing:"0.8px", margin:"0 0 4px" }}>Live GPS</p>
                      <p style={{ fontSize:12, color:t.textSub, margin:0, fontFamily:"monospace" }}>{myLocation.lat.toFixed(5)}, {myLocation.lng.toFixed(5)}</p>
                    </div>
                    <div style={{ textAlign:"right" }}>
                      <p style={{ fontSize:10, color:t.textMuted, textTransform:"uppercase", letterSpacing:"0.8px", margin:"0 0 4px" }}>Heading</p>
                      <p style={{ fontSize:12, color:t.textSub, margin:0 }}>{heading}°</p>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {tab === "trips" && (
          <>
            <p style={S.label}>Trip History</p>
            {!trips.length ? (
              <div style={{ textAlign:"center", padding:"60px 0", color:t.textMuted, fontSize:14 }}>No trips yet</div>
            ) : (
              trips.map(trip => (
                <div key={trip.id} style={S.tripCard}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
                    <div>
                      <div style={{ fontSize:14, fontWeight:700, color:t.text }}>{trip.routeName}</div>
                      <div style={{ fontSize:11, color:t.textMuted, marginTop:2 }}>{new Date(trip.startTime).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})}</div>
                    </div>
                    <span style={{ fontSize:11, padding:"3px 9px", borderRadius:6, fontWeight:600, background:trip.status==="active"?(dark?"#0A1A0D":"#ECFDF5"):(dark?"#111":t.bgCard), color:trip.status==="active"?(dark?"#4ADE80":"#065F46"):t.textMuted, border:`1px solid ${trip.status==="active"?(dark?"#1A3D22":"#6EE7B7"):t.border}` }}>
                      {trip.status==="active"?"● Live":"Done"}
                    </span>
                  </div>
                  <div style={{ display:"flex", gap:20 }}>
                    <div><div style={{ fontSize:10, color:t.textMuted, textTransform:"uppercase", letterSpacing:"0.8px" }}>Start</div><div style={{ fontSize:13, color:t.textSub, marginTop:3 }}>{new Date(trip.startTime).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</div></div>
                    {trip.endTime && <>
                      <div style={{ color:t.textHint, alignSelf:"flex-end", fontSize:16 }}>→</div>
                      <div><div style={{ fontSize:10, color:t.textMuted, textTransform:"uppercase", letterSpacing:"0.8px" }}>End</div><div style={{ fontSize:13, color:t.textSub, marginTop:3 }}>{new Date(trip.endTime).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</div></div>
                      <div><div style={{ fontSize:10, color:t.textMuted, textTransform:"uppercase", letterSpacing:"0.8px" }}>Duration</div><div style={{ fontSize:13, color:t.accent, fontWeight:600, marginTop:3 }}>{formatDuration(trip.endTime-trip.startTime)}</div></div>
                    </>}
                  </div>
                </div>
              ))
            )}
          </>
        )}
      </div>
    </div>
  );
}
