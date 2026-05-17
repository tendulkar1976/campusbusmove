import { useEffect, useState, useRef } from "react";
import { ref, set } from "firebase/database";
import { collection, query, where, getDocs, addDoc, orderBy } from "firebase/firestore";
import { rtdb, db } from "../firebase";
import { useAuth } from "../context/AuthContext";
import MapView from "../components/MapView";

const ROUTES = [
  { id: "route-1", name: "Route 1", label: "North Gate Loop" },
  { id: "route-2", name: "Route 2", label: "South Campus Loop" },
  { id: "route-3", name: "Route 3", label: "East Wing Loop" },
  { id: "route-3a", name: "Route 3A", label: "Express Loop" },
];

export default function DriverDashboard() {
  const { user, campusId, logout } = useAuth();
  const [tab, setTab] = useState("live");
  const [selectedRouteId, setSelectedRouteId] = useState("route-1");
  const [tracking, setTracking] = useState(false);
  const [myLocation, setMyLocation] = useState(null);
  const [speed, setSpeed] = useState(0);
  const [error, setError] = useState("");
  const [tripStart, setTripStart] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [trips, setTrips] = useState([]);
  const watchIdRef = useRef(null);
  const timerRef = useRef(null);
  const tripDocRef = useRef(null);

  // Load trip history
  useEffect(() => {
    if (!user || tab !== "trips") return;
    const q = query(collection(db, "trips"), where("driverUid", "==", user.uid));
    getDocs(q).then(snap => {
      const t = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      t.sort((a, b) => b.startTime - a.startTime);
      setTrips(t);
    });
  }, [user, tab]);

  // Elapsed timer
  useEffect(() => {
    if (tracking) {
      timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
    } else {
      clearInterval(timerRef.current);
      setElapsed(0);
    }
    return () => clearInterval(timerRef.current);
  }, [tracking]);

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
    setTracking(true); setError("");
    const now = Date.now();
    setTripStart(now);

    // Create trip doc
    const tripDoc = await addDoc(collection(db, "trips"), {
      driverUid: user.uid,
      routeId: selectedRouteId,
      routeName: ROUTES.find(r => r.id === selectedRouteId)?.name,
      campusId,
      startTime: now,
      endTime: null,
      status: "active",
    });
    tripDocRef.current = tripDoc.id;

    set(ref(rtdb, `routes/${selectedRouteId}/live`), { routeId: selectedRouteId, driverUid: user.uid, active: true, lat: 12.9716, lng: 77.5946, speed: 0, heading: 0, updatedAt: now });

    watchIdRef.current = navigator.geolocation.watchPosition(
      pos => {
        const { latitude: lat, longitude: lng, speed: spd, heading } = pos.coords;
        const kmh = spd ? parseFloat((spd * 3.6).toFixed(1)) : 0;
        setMyLocation({ lat, lng });
        setSpeed(kmh);
        set(ref(rtdb, `routes/${selectedRouteId}/live`), { routeId: selectedRouteId, driverUid: user.uid, active: true, lat, lng, speed: kmh, heading: heading || 0, updatedAt: Date.now() });
      },
      err => setError("GPS error: " + err.message),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
    );
  }

  async function stopTracking() {
    if (watchIdRef.current) navigator.geolocation.clearWatch(watchIdRef.current);
    setTracking(false);
    set(ref(rtdb, `routes/${selectedRouteId}/live/active`), false);
    if (tripDocRef.current) {
      const { updateDoc, doc } = await import("firebase/firestore");
      await updateDoc(doc(db, "trips", tripDocRef.current), { endTime: Date.now(), status: "completed" });
    }
    setMyLocation(null); setSpeed(0);
  }

  useEffect(() => () => { if (watchIdRef.current) navigator.geolocation.clearWatch(watchIdRef.current); }, []);

  const selectedRoute = ROUTES.find(r => r.id === selectedRouteId);

  const S = {
    screen: { minHeight: "100vh", background: "#0A0A0A", fontFamily: "'DM Sans', sans-serif", color: "#fff" },
    header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 20px 14px", borderBottom: "1px solid #141414", position: "sticky", top: 0, background: "#0A0A0A", zIndex: 10 },
    logo: { width: 30, height: 30, background: "#FF5A1F", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 },
    badge: { background: "#0A1020", border: "1px solid #1A3060", borderRadius: 6, padding: "3px 8px", color: "#60A5FA", fontSize: 11, fontWeight: 600 },
    signOut: { background: "none", border: "1px solid #1E1E1E", borderRadius: 8, padding: "6px 14px", color: "#555", fontSize: 12, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" },
    tabs: { display: "flex", borderBottom: "1px solid #141414", padding: "0 16px" },
    tabBtn: (a) => ({ padding: "12px 16px", border: "none", background: "none", cursor: "pointer", fontSize: 13, fontWeight: 500, color: a ? "#FF5A1F" : "#444", borderBottom: a ? "2px solid #FF5A1F" : "2px solid transparent", fontFamily: "'DM Sans', sans-serif" }),
    body: { padding: "16px 16px 40px", maxWidth: 480, margin: "0 auto" },
    card: { background: "#0F0F0F", border: "1px solid #1A1A1A", borderRadius: 14, overflow: "hidden", marginBottom: 14 },
    label: { fontSize: 10, color: "#333", fontWeight: 600, textTransform: "uppercase", letterSpacing: "1px", marginBottom: 8 },
    routeBtn: (sel) => ({ flex: 1, padding: "10px 4px", border: `1px solid ${sel ? "#FF5A1F" : "#1A1A1A"}`, borderRadius: 10, background: sel ? "#150D09" : "#0F0F0F", color: sel ? "#FF5A1F" : "#555", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }),
    timerDisplay: { textAlign: "center", padding: "28px 16px", borderBottom: "1px solid #141414" },
    statsRow: { display: "flex", padding: "14px 16px", gap: 0 },
    stat: { flex: 1, textAlign: "center" },
    statVal: (col) => ({ fontSize: 22, fontWeight: 700, color: col, letterSpacing: "-0.5px" }),
    statLabel: { fontSize: 10, color: "#333", marginTop: 2 },
    startBtn: { width: "100%", background: "#FF5A1F", border: "none", borderRadius: 14, padding: "18px 0", color: "#fff", fontSize: 16, fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", marginBottom: 12 },
    stopBtn: { width: "100%", background: "#1A0808", border: "1px solid #3D1010", borderRadius: 14, padding: "18px 0", color: "#F87171", fontSize: 16, fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", marginBottom: 12 },
    tripCard: { background: "#0F0F0F", border: "1px solid #1A1A1A", borderRadius: 12, padding: "14px 16px", marginBottom: 10 },
  };

  return (
    <div style={S.screen}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet" />

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
            {/* Route selector */}
            <div style={{ marginBottom: 14 }}>
              <p style={S.label}>Select Route</p>
              <div style={{ display: "flex", gap: 6 }}>
                {ROUTES.map(r => (
                  <button key={r.id} style={S.routeBtn(selectedRouteId === r.id)} onClick={() => !tracking && setSelectedRouteId(r.id)}>{r.name}</button>
                ))}
              </div>
            </div>

            {/* Trip timer card */}
            <div style={S.card}>
              <div style={S.timerDisplay}>
                <div style={{ fontSize: 10, color: "#333", textTransform: "uppercase", letterSpacing: "1px", marginBottom: 8 }}>
                  {tracking ? "Trip Duration" : "Ready to Start"}
                </div>
                <div style={{ fontSize: 48, fontWeight: 700, letterSpacing: "-2px", color: tracking ? "#FF5A1F" : "#222", fontVariantNumeric: "tabular-nums" }}>
                  {formatTime(elapsed)}
                </div>
                {tracking && tripStart && (
                  <div style={{ fontSize: 11, color: "#444", marginTop: 6 }}>
                    Started at {new Date(tripStart).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </div>
                )}
              </div>
              <div style={S.statsRow}>
                <div style={S.stat}>
                  <div style={S.statVal(tracking ? "#4ADE80" : "#333")}>{speed}</div>
                  <div style={S.statLabel}>km/h</div>
                </div>
                <div style={{ width: 1, background: "#141414" }} />
                <div style={S.stat}>
                  <div style={S.statVal(tracking ? "#60A5FA" : "#333")}>{selectedRoute?.name}</div>
                  <div style={S.statLabel}>Route</div>
                </div>
                <div style={{ width: 1, background: "#141414" }} />
                <div style={S.stat}>
                  <div style={S.statVal(tracking ? "#4ADE80" : "#333")}>{tracking ? "Live" : "Off"}</div>
                  <div style={S.statLabel}>Status</div>
                </div>
              </div>
            </div>

            {/* Map */}
            <div style={{ ...S.card }}>
              <MapView busLocation={myLocation} />
            </div>

            {/* Control */}
            {!tracking
              ? <button onClick={startTracking} style={S.startBtn}>▶ Start Trip</button>
              : <button onClick={stopTracking} style={S.stopBtn}>■ End Trip</button>
            }

            {error && <div style={{ background: "#1A0808", border: "1px solid #3D1010", borderRadius: 10, padding: "12px 14px" }}><p style={{ color: "#F87171", fontSize: 12, margin: 0 }}>{error}</p></div>}

            {myLocation && (
              <div style={{ background: "#0F0F0F", border: "1px solid #1A1A1A", borderRadius: 12, padding: "12px 16px" }}>
                <p style={{ ...S.label, marginBottom: 4 }}>GPS Location</p>
                <p style={{ fontSize: 12, color: "#444", margin: 0, fontFamily: "monospace" }}>{myLocation.lat.toFixed(6)}, {myLocation.lng.toFixed(6)}</p>
              </div>
            )}
          </>
        )}

        {tab === "trips" && (
          <>
            <p style={S.label}>Trip History</p>
            {trips.length === 0
              ? <div style={{ textAlign: "center", padding: "40px 0", color: "#2A2A2A", fontSize: 14 }}>No trips yet</div>
              : trips.map(trip => (
                <div key={trip.id} style={S.tripCard}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "#ccc" }}>{trip.routeName}</div>
                      <div style={{ fontSize: 11, color: "#333", marginTop: 2 }}>{new Date(trip.startTime).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</div>
                    </div>
                    <span style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, background: trip.status === "active" ? "#0D1F12" : "#111", color: trip.status === "active" ? "#4ADE80" : "#444", border: `1px solid ${trip.status === "active" ? "#1E4D2B" : "#1A1A1A"}` }}>
                      {trip.status === "active" ? "● Live" : "Done"}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 16 }}>
                    <div>
                      <div style={{ fontSize: 10, color: "#333", textTransform: "uppercase", letterSpacing: "0.8px" }}>Start</div>
                      <div style={{ fontSize: 13, color: "#888", marginTop: 2 }}>{new Date(trip.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                    </div>
                    {trip.endTime && (
                      <>
                        <div style={{ color: "#1A1A1A" }}>→</div>
                        <div>
                          <div style={{ fontSize: 10, color: "#333", textTransform: "uppercase", letterSpacing: "0.8px" }}>End</div>
                          <div style={{ fontSize: 13, color: "#888", marginTop: 2 }}>{new Date(trip.endTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 10, color: "#333", textTransform: "uppercase", letterSpacing: "0.8px" }}>Duration</div>
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
