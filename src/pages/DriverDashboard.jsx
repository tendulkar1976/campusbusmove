import { useEffect, useState, useRef } from "react";
import { ref, set } from "firebase/database";
import { collection, getDocs, addDoc } from "firebase/firestore";
import { rtdb, db } from "../firebase";
import { useAuth } from "../context/AuthContext";
import MapView from "../components/MapView";

export default function DriverDashboard() {
  const { user, campusId, logout } = useAuth();
  const [tab, setTab] = useState("live");
  const [routes, setRoutes] = useState([]);
  const [selectedRouteId, setSelectedRouteId] = useState(null);
  const [tracking, setTracking] = useState(false);
  const [myLocation, setMyLocation] = useState(null);
  const [speed, setSpeed] = useState(0);
  const [error, setError] = useState("");
  const [tripStart, setTripStart] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const watchIdRef = useRef(null);
  const lastMapUpdate = useRef(0);
  const lastFirebaseUpdate = useRef(0);
  const timerRef = useRef(null);
  const tripDocRef = useRef(null);

  // Load routes from Firestore only
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

  useEffect(() => {
    if (!user || tab !== "trips") return;
    getDocs(collection(db, "trips")).then(snap => {
      const t = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(d => d.driverUid === user.uid)
        .sort((a, b) => b.startTime - a.startTime);
      setTrips(t);
    });
  }, [user, tab]);

  useEffect(() => {
    if (tracking) {
      timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
    } else {
      clearInterval(timerRef.current);
      setElapsed(0);
    }
    return () => clearInterval(timerRef.current);
  }, [tracking]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) lastFirebaseUpdate.current = 0;
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  function formatTime(secs) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return h > 0 ? `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}` : `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
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
    setTracking(true); setError("");
    const now = Date.now();
    setTripStart(now);
    const selectedRoute = routes.find(r => r.id === selectedRouteId);
    const tripDoc = await addDoc(collection(db, "trips"), {
      driverUid: user.uid, routeId: selectedRouteId,
      routeName: selectedRoute?.name || selectedRouteId,
      campusId, startTime: now, endTime: null, status: "active",
    });
    tripDocRef.current = tripDoc.id;
    set(ref(rtdb, `routes/${selectedRouteId}/live`), {
      routeId: selectedRouteId, driverUid: user.uid, active: true,
      lat: 12.9716, lng: 77.5946, speed: 0, heading: 0, updatedAt: now
    });
    watchIdRef.current = navigator.geolocation.watchPosition(
      pos => {
        const { latitude: lat, longitude: lng, speed: spd, heading } = pos.coords;
        const kmh = spd ? parseFloat((spd * 3.6).toFixed(1)) : 0;
        const now = Date.now();
        if (now - lastMapUpdate.current > 3000) {
          setMyLocation({ lat, lng });
          setSpeed(kmh);
          lastMapUpdate.current = now;
        }
        if (now - lastFirebaseUpdate.current > 5000) {
          set(ref(rtdb, `routes/${selectedRouteId}/live`), {
            routeId: selectedRouteId, driverUid: user.uid, active: true,
            lat, lng, speed: kmh, heading: heading || 0, updatedAt: now
          });
          lastFirebaseUpdate.current = now;
        }
      },
      err => setError("GPS error: " + err.message),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
  }

  async function stopTracking() {
    if (watchIdRef.current) navigator.geolocation.clearWatch(watchIdRef.current);
    watchIdRef.current = null;
    setTracking(false);
    if (selectedRouteId) set(ref(rtdb, `routes/${selectedRouteId}/live/active`), false);
    if (tripDocRef.current) {
      const { updateDoc, doc } = await import("firebase/firestore");
      await updateDoc(doc(db, "trips", tripDocRef.current), { endTime: Date.now(), status: "completed" });
    }
    setMyLocation(null); setSpeed(0);
  }

  useEffect(() => () => {
    if (watchIdRef.current) navigator.geolocation.clearWatch(watchIdRef.current);
    clearInterval(timerRef.current);
  }, []);

  const selectedRoute = routes.find(r => r.id === selectedRouteId);

  const S = {
    screen: { minHeight: "100vh", background: "#0A0A0A", fontFamily: "'DM Sans', sans-serif", color: "#fff" },
    header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 20px 14px", borderBottom: "1px solid #111", position: "sticky", top: 0, background: "#0A0A0A", zIndex: 10 },
    logo: { width: 30, height: 30, background: "#FF5A1F", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 },
    badge: { background: "#0A1020", border: "1px solid #1A3060", borderRadius: 6, padding: "3px 8px", color: "#60A5FA", fontSize: 11, fontWeight: 600 },
    signOut: { background: "none", border: "1px solid #161616", borderRadius: 8, padding: "6px 14px", color: "#ccc", fontSize: 12, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" },
    tabs: { display: "flex", borderBottom: "1px solid #111", padding: "0 16px" },
    tabBtn: (a) => ({ padding: "12px 16px", border: "none", background: "none", cursor: "pointer", fontSize: 13, fontWeight: 500, color: a ? "#FF5A1F" : "#333", borderBottom: a ? "2px solid #FF5A1F" : "2px solid transparent", fontFamily: "'DM Sans', sans-serif" }),
    body: { padding: "16px 16px 40px", maxWidth: 480, margin: "0 auto" },
    card: { background: "#0D0D0D", border: "1px solid #141414", borderRadius: 14, overflow: "hidden", marginBottom: 14 },
    label: { fontSize: 10, color: "#888", fontWeight: 600, textTransform: "uppercase", letterSpacing: "1px", marginBottom: 8 },
    routeBtn: (sel) => ({ flex: "0 0 auto", padding: "10px 14px", border: `1px solid ${sel ? "#FF5A1F" : "#141414"}`, borderRadius: 10, background: sel ? "#150D09" : "#0D0D0D", color: sel ? "#FF5A1F" : "#444", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", whiteSpace: "nowrap" }),
    startBtn: { width: "100%", background: "#FF5A1F", border: "none", borderRadius: 14, padding: "18px 0", color: "#fff", fontSize: 16, fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", marginBottom: 12, boxShadow: "0 4px 20px rgba(255,90,31,0.3)" },
    stopBtn: { width: "100%", background: "#1A0808", border: "1px solid #3D1010", borderRadius: 14, padding: "18px 0", color: "#F87171", fontSize: 16, fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", marginBottom: 12 },
    tripCard: { background: "#0D0D0D", border: "1px solid #141414", borderRadius: 12, padding: "14px 16px", marginBottom: 10 },
  };

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#0A0A0A", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ color: "#FF5A1F", fontSize: 14, fontFamily: "'DM Sans', sans-serif" }}>Loading routes...</div>
    </div>
  );

  return (
    <div style={S.screen}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&display=swap');`}</style>
      <div style={S.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={S.logo}>🚌</div>
          <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.3px" }}>CampusMove</span>
          <span style={S.badge}>Driver</span>
        </div>
        <button onClick={logout} style={S.signOut}>Sign out</button>
      </div>

      <div style={S.tabs}>
        {[["live","🔴 Live"],["trips","📋 Trips"]].map(([t,l]) => (
          <button key={t} style={S.tabBtn(tab===t)} onClick={() => setTab(t)}>{l}</button>
        ))}
      </div>

      <div style={S.body}>
        {tab === "live" && (
          <>
            {routes.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px 0", color: "#888", fontSize: 14 }}>
                No routes available.<br />
                <span style={{ fontSize: 12, color: "#666" }}>Ask your admin to add routes.</span>
              </div>
            ) : (
              <>
                <div style={{ marginBottom: 14 }}>
                  <p style={S.label}>Select Route</p>
                  <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4 }}>
                    {routes.map(r => (
                      <button key={r.id} style={S.routeBtn(selectedRouteId === r.id)} onClick={() => !tracking && setSelectedRouteId(r.id)}>{r.name}</button>
                    ))}
                  </div>
                </div>

                <div style={S.card}>
                  <div style={{ textAlign: "center", padding: "28px 16px", borderBottom: "1px solid #111" }}>
                    <div style={{ fontSize: 10, color: "#888", textTransform: "uppercase", letterSpacing: "1px", marginBottom: 8 }}>
                      {tracking ? "Trip Duration" : "Ready to Start"}
                    </div>
                    <div style={{ fontSize: 48, fontWeight: 700, letterSpacing: "-2px", color: tracking ? "#FF5A1F" : "#1A1A1A", fontVariantNumeric: "tabular-nums" }}>
                      {formatTime(elapsed)}
                    </div>
                    {tracking && tripStart && (
                      <div style={{ fontSize: 11, color: "#bbb", marginTop: 6 }}>
                        Started at {new Date(tripStart).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", padding: "14px 16px" }}>
                    {[
                      [tracking ? speed : "—", "km/h", tracking ? "#4ADE80" : "#1A1A1A"],
                      [selectedRoute?.name || "—", "Route", tracking ? "#60A5FA" : "#1A1A1A"],
                      [tracking ? "Live" : "Off", "Status", tracking ? "#4ADE80" : "#1A1A1A"]
                    ].map(([val, label, color], i) => (
                      <div key={i} style={{ flex: 1, textAlign: "center" }}>
                        <div style={{ fontSize: 20, fontWeight: 700, color, letterSpacing: "-0.5px" }}>{val}</div>
                        <div style={{ fontSize: 10, color: "#888", marginTop: 2 }}>{label}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {tracking && (
                  <div style={{ background: "#0A1A0D", border: "1px solid #1A3D22", borderRadius: 10, padding: "10px 14px", marginBottom: 14, display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 14 }}>🔋</span>
                    <span style={{ fontSize: 11, color: "#4ADE80" }}>Battery optimized · GPS updates every 5s</span>
                  </div>
                )}

                <div style={S.card}><MapView busLocation={myLocation} busMoving={speed > 0} /></div>

                {!tracking
                  ? <button onClick={startTracking} style={S.startBtn}>▶ Start Trip</button>
                  : <button onClick={stopTracking} style={S.stopBtn}>■ End Trip</button>
                }

                {error && <div style={{ background: "#1A0808", border: "1px solid #3D1010", borderRadius: 10, padding: "12px 14px" }}><p style={{ color: "#F87171", fontSize: 12, margin: 0 }}>{error}</p></div>}

                {myLocation && (
                  <div style={{ background: "#0D0D0D", border: "1px solid #141414", borderRadius: 12, padding: "12px 16px" }}>
                    <p style={{ fontSize: 10, color: "#888", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: 4 }}>GPS Location</p>
                    <p style={{ fontSize: 12, color: "#bbb", margin: 0, fontFamily: "monospace" }}>{myLocation.lat.toFixed(6)}, {myLocation.lng.toFixed(6)}</p>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {tab === "trips" && (
          <>
            <p style={S.label}>Trip History</p>
            {trips.length === 0
              ? <div style={{ textAlign: "center", padding: "40px 0", color: "#666", fontSize: 14 }}>No trips yet</div>
              : trips.map(trip => (
                <div key={trip.id} style={S.tripCard}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "#bbb" }}>{trip.routeName}</div>
                      <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{new Date(trip.startTime).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</div>
                    </div>
                    <span style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, background: trip.status === "active" ? "#0A1A0D" : "#0D0D0D", color: trip.status === "active" ? "#4ADE80" : "#333", border: `1px solid ${trip.status === "active" ? "#1A3D22" : "#141414"}` }}>
                      {trip.status === "active" ? "● Live" : "Done"}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 16 }}>
                    <div>
                      <div style={{ fontSize: 10, color: "#888", textTransform: "uppercase", letterSpacing: "0.8px" }}>Start</div>
                      <div style={{ fontSize: 13, color: "#777", marginTop: 2 }}>{new Date(trip.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                    </div>
                    {trip.endTime && (
                      <>
                        <div style={{ color: "#666", alignSelf: "flex-end" }}>→</div>
                        <div>
                          <div style={{ fontSize: 10, color: "#888", textTransform: "uppercase", letterSpacing: "0.8px" }}>End</div>
                          <div style={{ fontSize: 13, color: "#777", marginTop: 2 }}>{new Date(trip.endTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 10, color: "#888", textTransform: "uppercase", letterSpacing: "0.8px" }}>Duration</div>
                          <div style={{ fontSize: 13, color: "#FF5A1F", marginTop: 2 }}>{formatDuration(trip.endTime - trip.startTime)}</div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ))
            }
          </>
        )}
      </div>
    </div>
  );
}
