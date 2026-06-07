import { useEffect, useState, useRef } from "react";
import { ref, set } from "firebase/database";
import { collection, getDocs, addDoc, updateDoc, doc, query, where } from "firebase/firestore";
import { rtdb, db } from "../firebase";
import { useAuth } from "../context/AuthContext";
import MapView from "../components/MapView";

export default function DriverDashboard() {
  const { user, campusId, logout } = useAuth();
  const [tab, setTab]                   = useState("live");
  const [routes, setRoutes]             = useState([]);
  const [selectedRouteId, setSelectedRouteId] = useState(null);
  const [tracking, setTracking]         = useState(false);
  const [myLocation, setMyLocation]     = useState(null);
  const [speed, setSpeed]               = useState(0);
  const [heading, setHeading]           = useState(0);
  const [accuracy, setAccuracy]         = useState(null);
  const [error, setError]               = useState("");
  const [tripStart, setTripStart]       = useState(null);
  const [elapsed, setElapsed]           = useState(0);
  const [trips, setTrips]               = useState([]);
  const [loading, setLoading]           = useState(true);

  const watchIdRef          = useRef(null);
  const lastFirebaseUpdate  = useRef(0);
  const timerRef            = useRef(null);
  const tripDocRef          = useRef(null);
  const selectedRouteIdRef  = useRef(null); // always-current ref for GPS callback closure

  // Keep ref in sync with state
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

  // Load trip history (proper query — no require())
  useEffect(() => {
    if (!user || tab !== "trips") return;
    const q = query(collection(db, "trips"), where("driverUid", "==", user.uid));
    getDocs(q).then(snap => {
      const t = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => b.startTime - a.startTime);
      setTrips(t);
    }).catch(() => setTrips([]));
  }, [user, tab]);

  // Trip timer
  useEffect(() => {
    if (tracking) {
      timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
    } else {
      clearInterval(timerRef.current);
      setElapsed(0);
    }
    return () => clearInterval(timerRef.current);
  }, [tracking]);

  // Reset Firebase throttle on app foreground
  useEffect(() => {
    const handleVisibility = () => {
      if (!document.hidden) lastFirebaseUpdate.current = 0;
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  function formatTime(secs) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`
      : `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  }

  function formatDuration(ms) {
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  async function startTracking() {
    if (!navigator.geolocation) { setError("GPS not supported."); return; }
    if (!selectedRouteId) { setError("Please select a route first."); return; }
    setError("");
    const now = Date.now();
    setTripStart(now);

    const selectedRoute = routes.find(r => r.id === selectedRouteId);

    // Create trip doc first
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

    // Seed RTDB with a placeholder (will be overwritten in <2s by real GPS)
    set(ref(rtdb, `routes/${selectedRouteId}/live`), {
      routeId: selectedRouteId, driverUid: user.uid,
      active: true, lat: 12.9716, lng: 77.5946,
      speed: 0, heading: 0, updatedAt: now,
    });

    setTracking(true);

    // FIX: maximumAge:0 forces fresh position every time (no cached stale data)
    // FIX: no local throttle on setMyLocation — map updates every GPS tick
    watchIdRef.current = navigator.geolocation.watchPosition(
      pos => {
        const { latitude: lat, longitude: lng, speed: spd, heading: hdg, accuracy: acc } = pos.coords;

        // speed from GPS is m/s — convert to km/h; null when device can't measure
        const kmh = (spd != null && spd >= 0) ? parseFloat((spd * 3.6).toFixed(1)) : 0;
        const hdgVal = hdg || 0;
        const now = Date.now();

        // Always update local state — smooth map + accurate speed display
        setMyLocation({ lat, lng });
        setSpeed(kmh);
        setHeading(hdgVal);
        setAccuracy(acc ? Math.round(acc) : null);

        // Throttle Firebase writes to 2s (saves Realtime DB bandwidth)
        if (now - lastFirebaseUpdate.current >= 2000) {
          const routeId = selectedRouteIdRef.current;
          set(ref(rtdb, `routes/${routeId}/live`), {
            routeId, driverUid: user.uid, active: true,
            lat, lng, speed: kmh, heading: hdgVal, updatedAt: now,
          });
          lastFirebaseUpdate.current = now;
        }
      },
      err => {
        const msgs = {
          1: "Location permission denied. Enable in settings.",
          2: "GPS signal lost. Move to open area.",
          3: "GPS timeout. Retrying...",
        };
        setError(msgs[err.code] || "GPS error: " + err.message);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,        // FIX: always fresh — no cached position
        timeout: 10000,
      }
    );
  }

  async function stopTracking() {
    if (watchIdRef.current) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setTracking(false);

    if (selectedRouteId) {
      set(ref(rtdb, `routes/${selectedRouteId}/live`), {
        routeId: selectedRouteId, driverUid: user.uid,
        active: false, lat: myLocation?.lat || 0, lng: myLocation?.lng || 0,
        speed: 0, heading: 0, updatedAt: Date.now(),
      });
    }

    if (tripDocRef.current) {
      await updateDoc(doc(db, "trips", tripDocRef.current), {
        endTime: Date.now(), status: "completed",
      });
      tripDocRef.current = null;
    }

    setSpeed(0); setHeading(0); setAccuracy(null);
    // Keep myLocation so map shows last position with red pin
  }

  // Cleanup on unmount
  useEffect(() => () => {
    if (watchIdRef.current) navigator.geolocation.clearWatch(watchIdRef.current);
    clearInterval(timerRef.current);
  }, []);

  const selectedRoute = routes.find(r => r.id === selectedRouteId);

  const S = {
    screen:   { minHeight: "100vh", background: "#0A0A0A", fontFamily: "'DM Sans', sans-serif", color: "#fff" },
    header:   { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 20px 14px", borderBottom: "1px solid #1A1A1A", position: "sticky", top: 0, background: "#0A0A0A", zIndex: 10 },
    logo:     { width: 32, height: 32, background: "#FF5A1F", borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, boxShadow: "0 0 16px rgba(255,90,31,0.3)" },
    badge:    { background: "#150D09", border: "1px solid #3D1F0A", borderRadius: 6, padding: "3px 9px", color: "#FF5A1F", fontSize: 11, fontWeight: 600 },
    signOut:  { background: "none", border: "1px solid #222", borderRadius: 8, padding: "7px 14px", color: "#aaa", fontSize: 12, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" },
    tabs:     { display: "flex", borderBottom: "1px solid #1A1A1A", padding: "0 16px", gap: 4 },
    tabBtn:   (a) => ({ padding: "12px 18px", border: "none", background: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, color: a ? "#FF5A1F" : "#555", borderBottom: a ? "2px solid #FF5A1F" : "2px solid transparent", fontFamily: "'DM Sans', sans-serif", transition: "color 0.2s" }),
    body:     { padding: "16px 16px 40px", maxWidth: 480, margin: "0 auto" },
    card:     { background: "#0D0D0D", border: "1px solid #1E1E1E", borderRadius: 16, overflow: "hidden", marginBottom: 14 },
    label:    { fontSize: 10, color: "#666", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.2px", marginBottom: 8 },
    routeBtn: (sel) => ({ flex: "0 0 auto", padding: "10px 16px", border: `1px solid ${sel ? "#FF5A1F" : "#1E1E1E"}`, borderRadius: 10, background: sel ? "#150D09" : "#0D0D0D", color: sel ? "#FF5A1F" : "#666", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", whiteSpace: "nowrap", transition: "all 0.15s" }),
    startBtn: { width: "100%", background: "linear-gradient(135deg,#FF5A1F,#e04800)", border: "none", borderRadius: 14, padding: "18px 0", color: "#fff", fontSize: 16, fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", marginBottom: 12, boxShadow: "0 6px 24px rgba(255,90,31,0.4)" },
    stopBtn:  { width: "100%", background: "#1A0808", border: "1px solid #3D1010", borderRadius: 14, padding: "18px 0", color: "#F87171", fontSize: 16, fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", marginBottom: 12 },
    tripCard: { background: "#0D0D0D", border: "1px solid #1E1E1E", borderRadius: 14, padding: "14px 16px", marginBottom: 10 },
  };

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#0A0A0A", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
      <div style={{ fontSize: 28 }}>🚌</div>
      <div style={{ color: "#FF5A1F", fontSize: 14, fontFamily: "'DM Sans', sans-serif" }}>Loading routes...</div>
    </div>
  );

  return (
    <div style={S.screen}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');`}</style>

      {/* Header */}
      <div style={S.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={S.logo}>🚌</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.3px" }}>CampusMove</div>
            <div style={{ fontSize: 10, color: "#555", fontWeight: 500 }}>Driver Mode</div>
          </div>
          <span style={S.badge}>Driver</span>
        </div>
        <button onClick={logout} style={S.signOut}>Sign out</button>
      </div>

      {/* Tabs */}
      <div style={S.tabs}>
        {[["live","🔴 Live"],["trips","📋 Trips"]].map(([t,l]) => (
          <button key={t} style={S.tabBtn(tab===t)} onClick={() => setTab(t)}>{l}</button>
        ))}
      </div>

      <div style={S.body}>
        {/* ── LIVE TAB ── */}
        {tab === "live" && (
          <>
            {routes.length === 0 ? (
              <div style={{ textAlign: "center", padding: "60px 0", color: "#555", fontSize: 14 }}>
                No routes available.<br />
                <span style={{ fontSize: 12, color: "#444" }}>Ask your admin to add routes.</span>
              </div>
            ) : (
              <>
                {/* Route selector */}
                <div style={{ marginBottom: 14 }}>
                  <p style={S.label}>Select Route</p>
                  <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
                    {routes.map(r => (
                      <button key={r.id} style={S.routeBtn(selectedRouteId === r.id)} onClick={() => !tracking && setSelectedRouteId(r.id)}>
                        {r.name}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Timer card */}
                <div style={S.card}>
                  <div style={{ textAlign: "center", padding: "24px 16px 20px", borderBottom: "1px solid #1A1A1A" }}>
                    <div style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: "1px", marginBottom: 8 }}>
                      {tracking ? "Trip Duration" : "Ready to Start"}
                    </div>
                    <div style={{ fontSize: 52, fontWeight: 700, letterSpacing: "-2px", color: tracking ? "#FF5A1F" : "#222", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
                      {formatTime(elapsed)}
                    </div>
                    {tracking && tripStart && (
                      <div style={{ fontSize: 11, color: "#666", marginTop: 8 }}>
                        Started at {new Date(tripStart).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </div>
                    )}
                  </div>

                  {/* Stats row */}
                  <div style={{ display: "flex", padding: "16px" }}>
                    {[
                      [tracking ? `${speed}` : "—", "km/h",  tracking ? (speed > 0 ? "#4ADE80" : "#facc15") : "#222"],
                      [selectedRoute?.name || "—",   "Route", tracking ? "#60A5FA" : "#222"],
                      [tracking ? "Live" : "Off",    "GPS",   tracking ? "#4ADE80" : "#222"],
                    ].map(([val, label, color], i) => (
                      <div key={i} style={{ flex: 1, textAlign: "center" }}>
                        <div style={{ fontSize: i === 1 ? 13 : 22, fontWeight: 700, color, letterSpacing: "-0.5px", lineHeight: 1.2 }}>{val}</div>
                        <div style={{ fontSize: 10, color: "#555", marginTop: 4, textTransform: "uppercase", letterSpacing: "0.8px" }}>{label}</div>
                      </div>
                    ))}
                  </div>

                  {/* Accuracy bar */}
                  {tracking && accuracy !== null && (
                    <div style={{ padding: "0 16px 14px", display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ flex: 1, height: 3, background: "#1A1A1A", borderRadius: 2, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${Math.max(0, 100 - accuracy)}%`, background: accuracy < 10 ? "#4ADE80" : accuracy < 30 ? "#facc15" : "#F87171", transition: "width 0.5s, background 0.5s", borderRadius: 2 }} />
                      </div>
                      <span style={{ fontSize: 10, color: accuracy < 10 ? "#4ADE80" : accuracy < 30 ? "#facc15" : "#F87171", whiteSpace: "nowrap" }}>
                        ±{accuracy}m
                      </span>
                    </div>
                  )}
                </div>

                {/* Live badge */}
                {tracking && (
                  <div style={{ background: "#0A1A0D", border: "1px solid #1A3D22", borderRadius: 10, padding: "10px 14px", marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#4ADE80", display: "inline-block", boxShadow: "0 0 6px #4ADE80" }} />
                    <span style={{ fontSize: 12, color: "#4ADE80", fontWeight: 500 }}>Broadcasting · Firebase updates every 2s · GPS high accuracy</span>
                  </div>
                )}

                {/* Map */}
                <div style={{ ...S.card, marginBottom: 14 }}>
                  <MapView busLocation={myLocation} busMoving={tracking && speed > 0} />
                </div>

                {/* Action button */}
                {!tracking
                  ? <button onClick={startTracking} style={S.startBtn}>▶ Start Trip</button>
                  : <button onClick={stopTracking}  style={S.stopBtn}>■ End Trip</button>
                }

                {error && (
                  <div style={{ background: "#1A0808", border: "1px solid #3D1010", borderRadius: 10, padding: "12px 14px", marginBottom: 10 }}>
                    <p style={{ color: "#F87171", fontSize: 12, margin: 0 }}>⚠️ {error}</p>
                  </div>
                )}

                {/* GPS debug row */}
                {myLocation && (
                  <div style={{ background: "#0D0D0D", border: "1px solid #1E1E1E", borderRadius: 12, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <p style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: "0.8px", margin: "0 0 4px" }}>Live GPS</p>
                      <p style={{ fontSize: 12, color: "#aaa", margin: 0, fontFamily: "monospace" }}>
                        {myLocation.lat.toFixed(5)}, {myLocation.lng.toFixed(5)}
                      </p>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <p style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: "0.8px", margin: "0 0 4px" }}>Heading</p>
                      <p style={{ fontSize: 12, color: "#aaa", margin: 0 }}>{heading}°</p>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* ── TRIPS TAB ── */}
        {tab === "trips" && (
          <>
            <p style={S.label}>Trip History</p>
            {trips.length === 0 ? (
              <div style={{ textAlign: "center", padding: "60px 0", color: "#555", fontSize: 14 }}>No trips yet</div>
            ) : (
              trips.map(trip => (
                <div key={trip.id} style={S.tripCard}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "#ddd" }}>{trip.routeName}</div>
                      <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>
                        {new Date(trip.startTime).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                      </div>
                    </div>
                    <span style={{ fontSize: 11, padding: "3px 9px", borderRadius: 6, fontWeight: 600, background: trip.status === "active" ? "#0A1A0D" : "#111", color: trip.status === "active" ? "#4ADE80" : "#888", border: `1px solid ${trip.status === "active" ? "#1A3D22" : "#1E1E1E"}` }}>
                      {trip.status === "active" ? "● Live" : "Done"}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 20 }}>
                    <div>
                      <div style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: "0.8px" }}>Start</div>
                      <div style={{ fontSize: 13, color: "#aaa", marginTop: 3 }}>{new Date(trip.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                    </div>
                    {trip.endTime && (
                      <>
                        <div style={{ color: "#333", alignSelf: "flex-end", fontSize: 16 }}>→</div>
                        <div>
                          <div style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: "0.8px" }}>End</div>
                          <div style={{ fontSize: 13, color: "#aaa", marginTop: 3 }}>{new Date(trip.endTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: "0.8px" }}>Duration</div>
                          <div style={{ fontSize: 13, color: "#FF5A1F", fontWeight: 600, marginTop: 3 }}>{formatDuration(trip.endTime - trip.startTime)}</div>
                        </div>
                      </>
                    )}
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
