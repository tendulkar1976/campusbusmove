import { useEffect, useState, useRef } from "react";
import { ref, onValue } from "firebase/database";
import { collection, query, where, getDocs, addDoc, doc, getDoc } from "firebase/firestore";
import { rtdb, db } from "../firebase";
import { useAuth } from "../context/AuthContext";
import MapView from "../components/MapView";

function getDistanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getETA(busLat, busLng, stopLat, stopLng, speed) {
  const dist = getDistanceMeters(busLat, busLng, stopLat, stopLng);
  const spd = parseFloat(speed) || 20;
  const mins = Math.round((dist / 1000) / spd * 60);
  return { dist: Math.round(dist), mins };
}

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

export default function StudentDashboard() {
  const { user, campusId, logout } = useAuth();
  const [tab, setTab] = useState("track");
  const [myRoute, setMyRoute] = useState(null);
  const [routes, setRoutes] = useState([]);
  const [selected, setSelected] = useState(null);
  const [busData, setBusData] = useState({});
  const [myLocation, setMyLocation] = useState(null);
  const [eta, setEta] = useState(null);
  const [distance, setDistance] = useState(null);
  const [attendanceLog, setAttendanceLog] = useState({});
  const [attendanceStatus, setAttendanceStatus] = useState(null);
  const [inGeofence, setInGeofence] = useState(false);
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  const [calYear, setCalYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);
  const geofenceTimerRef = useRef(null);
  const attendanceMarkedRef = useRef(false);
  const gpsWatchRef = useRef(null);

  // Load routes from Firestore only (admin-added routes)
  useEffect(() => {
    getDocs(collection(db, "routes")).then(snap => {
      if (!snap.empty) {
        const r = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setRoutes(r);
        setSelected(r[0]);
      } else {
        setRoutes([]);
        setSelected(null);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  // Get student's assigned route
  useEffect(() => {
    if (!user || routes.length === 0) return;
    getDoc(doc(db, "users", user.uid)).then(snap => {
      if (snap.exists()) {
        const data = snap.data();
        if (data.routeId) {
          const r = routes.find(x => x.id === data.routeId);
          if (r) { setMyRoute(r); setSelected(r); }
        }
      }
    });
  }, [user, routes]);

  // Listen to all bus locations
  useEffect(() => {
    const r = ref(rtdb, "routes");
    const unsub = onValue(r, snap => { if (snap.exists()) setBusData(snap.val()); });
    return () => unsub();
  }, []);

  // Get student GPS
  useEffect(() => {
    if (!navigator.geolocation) return;
    gpsWatchRef.current = navigator.geolocation.watchPosition(
      pos => setMyLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {}, { enableHighAccuracy: true, maximumAge: 8000, timeout: 20000 }
    );
    return () => { if (gpsWatchRef.current) navigator.geolocation.clearWatch(gpsWatchRef.current); };
  }, []);

  // Pause GPS when app backgrounded
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden && gpsWatchRef.current) {
        navigator.geolocation.clearWatch(gpsWatchRef.current);
        gpsWatchRef.current = null;
      } else if (!document.hidden && !gpsWatchRef.current) {
        gpsWatchRef.current = navigator.geolocation.watchPosition(
          pos => setMyLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
          () => {}, { enableHighAccuracy: true, maximumAge: 8000, timeout: 20000 }
        );
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  // ETA + geofence
  useEffect(() => {
    const busLive = busData[selected?.id]?.live;
    if (!busLive?.active || !myLocation || !selected) { setEta(null); setDistance(null); return; }
    if (selected.stops?.length > 0) {
      const nearestStop = selected.stops.reduce((closest, stop) => {
        const d = getDistanceMeters(myLocation.lat, myLocation.lng, stop.lat, stop.lng);
        return d < closest.d ? { stop, d } : closest;
      }, { stop: null, d: Infinity });
      if (nearestStop.stop) {
        const result = getETA(busLive.lat, busLive.lng, nearestStop.stop.lat, nearestStop.stop.lng, busLive.speed);
        setEta(result.mins);
        setDistance(result.dist);
      }
    }
    const busDist = getDistanceMeters(myLocation.lat, myLocation.lng, busLive.lat, busLive.lng);
    const inside = busDist <= 300;
    setInGeofence(inside);
    if (inside && !attendanceMarkedRef.current && attendanceStatus !== "present") {
      setAttendanceStatus("pending");
      if (!geofenceTimerRef.current) {
        geofenceTimerRef.current = setTimeout(() => markAttendance("absent"), 15 * 60 * 1000);
      }
    }
  }, [busData, myLocation, selected, attendanceStatus]);

  async function markAttendance(status) {
    if (attendanceMarkedRef.current) return;
    attendanceMarkedRef.current = true;
    clearTimeout(geofenceTimerRef.current);
    geofenceTimerRef.current = null;
    setAttendanceStatus(status);
    const today = new Date().toISOString().split("T")[0];
    await addDoc(collection(db, "attendance"), {
      studentId: user.uid, routeId: selected.id, date: today,
      status, timestamp: Date.now(), campusId,
    });
    setAttendanceLog(prev => ({ ...prev, [today]: status }));
  }

  useEffect(() => {
    if (!user || tab !== "attendance") return;
    const q = query(collection(db, "attendance"), where("studentId", "==", user.uid));
    getDocs(q).then(snap => {
      const log = {};
      snap.docs.forEach(d => { const data = d.data(); log[data.date] = data.status; });
      setAttendanceLog(log);
    });
  }, [user, tab]);

  const activeBus = busData[selected?.id]?.live;
  const presentCount = Object.values(attendanceLog).filter(v => v === "present").length;
  const totalCount = Object.values(attendanceLog).length;
  const pct = totalCount > 0 ? Math.round(presentCount / totalCount * 100) : 0;

  const S = {
    screen: { minHeight: "100vh", background: "#0A0A0A", fontFamily: "'DM Sans', sans-serif", color: "#fff" },
    header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 20px 14px", borderBottom: "1px solid #141414", position: "sticky", top: 0, background: "#0A0A0A", zIndex: 10 },
    logo: { width: 30, height: 30, background: "#FF5A1F", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 },
    tabs: { display: "flex", borderBottom: "1px solid #141414", padding: "0 16px" },
    tab: (a) => ({ padding: "12px 14px", border: "none", background: "none", cursor: "pointer", fontSize: 13, fontWeight: 500, color: a ? "#FF5A1F" : "#FF5A1F", borderBottom: a ? "2px solid #FF5A1F" : "2px solid transparent", fontFamily: "'DM Sans', sans-serif" }),
    body: { padding: "16px 16px 100px", maxWidth: 480, margin: "0 auto" },
    card: { background: "#0F0F0F", border: "1px solid #1A1A1A", borderRadius: 14, overflow: "hidden", marginBottom: 14 },
    label: { fontSize: 10, color: "#999", fontWeight: 600, textTransform: "uppercase", letterSpacing: "1px", marginBottom: 8 },
    pill: (color, bg, border) => ({ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 20, background: bg, border: `1px solid ${border}`, fontSize: 12, color, fontWeight: 500 }),
    routeBtn: (sel) => ({ flex: "0 0 auto", padding: "10px 14px", border: `1px solid ${sel ? "#FF5A1F" : "#1A1A1A"}`, borderRadius: 10, background: sel ? "#150D09" : "#0F0F0F", color: sel ? "#FF5A1F" : "#FF5A1F", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", whiteSpace: "nowrap" }),
    etaBox: { background: "#111", border: "1px solid #1A1A1A", borderRadius: 12, padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
    statBox: { flex: 1, textAlign: "center" },
    statVal: { fontSize: 26, fontWeight: 700, letterSpacing: "-1px", color: "#FF5A1F" },
    statLabel: { fontSize: 10, color: "#FF5A1F", marginTop: 2 },
    attendBtn: (col, bg, bdr) => ({ width: "100%", padding: "16px", border: `1px solid ${bdr}`, borderRadius: 12, background: bg, color: col, fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", marginBottom: 10 }),
  };

  function renderCalendar() {
    const days = getDaysInMonth(calYear, calMonth);
    const firstDay = new Date(calYear, calMonth, 1).getDay();
    const monthName = new Date(calYear, calMonth).toLocaleString("default", { month: "long" });
    const cells = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= days; d++) cells.push(d);
    return (
      <div style={S.card}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid #141414", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <button onClick={() => { if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1); } else setCalMonth(m => m - 1); }} style={{ background: "none", border: "none", color: "#FF5A1F", cursor: "pointer", fontSize: 18 }}>‹</button>
          <span style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>{monthName} {calYear}</span>
          <button onClick={() => { if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1); } else setCalMonth(m => m + 1); }} style={{ background: "none", border: "none", color: "#FF5A1F", cursor: "pointer", fontSize: 18 }}>›</button>
        </div>
        <div style={{ padding: "12px 16px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4, marginBottom: 8 }}>
            {["S","M","T","W","T","F","S"].map((d,i) => <div key={i} style={{ textAlign: "center", fontSize: 10, color: "#999", fontWeight: 600 }}>{d}</div>)}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 4 }}>
            {cells.map((d, i) => {
              if (!d) return <div key={i} />;
              const dateStr = `${calYear}-${String(calMonth+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
              const status = attendanceLog[dateStr];
              const isToday = new Date().toISOString().split("T")[0] === dateStr;
              return (
                <div key={i} style={{ aspectRatio: "1", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: isToday ? 700 : 400, background: status === "present" ? "#0D1F12" : status === "absent" ? "#1A0808" : isToday ? "#1A1A1A" : "transparent", color: status === "present" ? "#4ADE80" : status === "absent" ? "#F87171" : isToday ? "#fff" : "#FF5A1F", border: isToday ? "1px solid #333" : "none" }}>
                  {d}
                </div>
              );
            })}
          </div>
        </div>
        <div style={{ padding: "12px 16px", borderTop: "1px solid #141414", display: "flex", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}><div style={{ width: 10, height: 10, borderRadius: 3, background: "#0D1F12", border: "1px solid #1E4D2B" }} /><span style={{ fontSize: 11, color: "#FF5A1F" }}>Present</span></div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}><div style={{ width: 10, height: 10, borderRadius: 3, background: "#1A0808", border: "1px solid #3D1010" }} /><span style={{ fontSize: 11, color: "#FF5A1F" }}>Absent</span></div>
        </div>
      </div>
    );
  }

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#0A0A0A", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ color: "#FF5A1F", fontSize: 14, fontFamily: "'DM Sans', sans-serif" }}>Loading routes...</div>
    </div>
  );

  return (
    <div style={S.screen}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet" />
      <div style={S.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={S.logo}>🚌</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.3px" }}>CampusMove</div>
            {myRoute && <div style={{ fontSize: 10, color: "#FF5A1F", fontWeight: 500 }}>{myRoute.name} assigned</div>}
          </div>
        </div>
        <button onClick={logout} style={{ background: "none", border: "1px solid #1E1E1E", borderRadius: 8, padding: "6px 14px", color: "#FF5A1F", fontSize: 12, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>Sign out</button>
      </div>

      <div style={S.tabs}>
        {[["track","🗺 Track"],["attendance","📅 Attendance"]].map(([t,l]) => (
          <button key={t} style={S.tab(tab===t)} onClick={() => setTab(t)}>{l}</button>
        ))}
      </div>

      <div style={S.body}>
        {tab === "track" && (
          <>
            {routes.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px 0", color: "#888", fontSize: 14 }}>
                No routes added yet.<br />
                <span style={{ fontSize: 12, color: "#FF5A1F" }}>Ask your admin to add routes.</span>
              </div>
            ) : (
              <>
                <div style={{ marginBottom: 14 }}>
                  <p style={S.label}>Select Bus Route</p>
                  <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4 }}>
                    {routes.map(r => (
                      <button key={r.id} style={S.routeBtn(selected?.id === r.id)} onClick={() => setSelected(r)}>{r.name}</button>
                    ))}
                  </div>
                </div>

                <div style={{ marginBottom: 14 }}>
                  {activeBus?.active ? (
                    <div style={{ ...S.pill("#4ADE80", "#0D1F12", "#1E4D2B"), marginBottom: 10 }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#4ADE80", display: "inline-block" }} />
                      {selected?.name} is live
                    </div>
                  ) : (
                    <div style={{ ...S.pill("#FF5A1F", "#111", "#1A1A1A"), marginBottom: 10 }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#333", display: "inline-block" }} />
                      Bus not active
                    </div>
                  )}
                </div>

                {activeBus?.active && (
                  <div style={S.etaBox}>
                    <div style={S.statBox}>
                      <div style={S.statVal}>{eta !== null ? eta : "—"}</div>
                      <div style={S.statLabel}>min to your stop</div>
                    </div>
                    <div style={{ width: 1, height: 40, background: "#1A1A1A" }} />
                    <div style={S.statBox}>
                      <div style={S.statVal}>{distance !== null ? distance > 1000 ? `${(distance/1000).toFixed(1)}k` : distance : "—"}</div>
                      <div style={S.statLabel}>meters away</div>
                    </div>
                    <div style={{ width: 1, height: 40, background: "#1A1A1A" }} />
                    <div style={S.statBox}>
                      <div style={S.statVal}>{activeBus.speed || 0}</div>
                      <div style={S.statLabel}>km/h speed</div>
                    </div>
                  </div>
                )}

                <div style={{ ...S.card, marginBottom: 14 }}>
                  <MapView
                    busLocation={activeBus?.active ? { lat: activeBus.lat, lng: activeBus.lng } : null}
                    busMoving={activeBus?.speed > 0}
                    routePath={selected?.path?.map(p => [p.lat, p.lng])}
                    center={selected?.center ? [selected.center.lat, selected.center.lng] : null}
                    myLocation={myLocation}
                  />
                </div>

                {inGeofence && attendanceStatus === "pending" && (
                  <div style={{ background: "#0D1520", border: "1px solid #1E3A5F", borderRadius: 14, padding: "16px", marginBottom: 14 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#60A5FA", marginBottom: 4 }}>🚌 Bus is nearby!</div>
                    <div style={{ fontSize: 12, color: "#FF5A1F", marginBottom: 14 }}>Mark your attendance. Auto-marks absent in 15 min.</div>
                    <button onClick={() => markAttendance("present")} style={S.attendBtn("#fff", "#FF5A1F", "#FF5A1F")}>✓ Mark Present</button>
                  </div>
                )}

                {attendanceStatus === "present" && (
                  <div style={{ background: "#0D1F12", border: "1px solid #1E4D2B", borderRadius: 12, padding: "14px 16px", display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                    <span style={{ fontSize: 20 }}>✅</span>
                    <div><div style={{ fontSize: 13, fontWeight: 600, color: "#4ADE80" }}>Attendance marked</div><div style={{ fontSize: 11, color: "#1E4D2B" }}>Present for today</div></div>
                  </div>
                )}

                {attendanceStatus === "absent" && (
                  <div style={{ background: "#1A0808", border: "1px solid #3D1010", borderRadius: 12, padding: "14px 16px", display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                    <span style={{ fontSize: 20 }}>❌</span>
                    <div><div style={{ fontSize: 13, fontWeight: 600, color: "#F87171" }}>Marked absent</div><div style={{ fontSize: 11, color: "#3D1010" }}>Didn't respond in time</div></div>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {tab === "attendance" && (
          <>
            <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
              <div style={{ ...S.card, flex: 1, padding: "14px", textAlign: "center", marginBottom: 0 }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: "#4ADE80", letterSpacing: "-1px" }}>{presentCount}</div>
                <div style={{ fontSize: 10, color: "#999", marginTop: 2, textTransform: "uppercase", letterSpacing: "0.8px" }}>Present</div>
              </div>
              <div style={{ ...S.card, flex: 1, padding: "14px", textAlign: "center", marginBottom: 0 }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: "#F87171", letterSpacing: "-1px" }}>{totalCount - presentCount}</div>
                <div style={{ fontSize: 10, color: "#999", marginTop: 2, textTransform: "uppercase", letterSpacing: "0.8px" }}>Absent</div>
              </div>
              <div style={{ ...S.card, flex: 1, padding: "14px", textAlign: "center", marginBottom: 0 }}>
                <div style={{ fontSize: 28, fontWeight: 700, color: pct >= 75 ? "#4ADE80" : "#F87171", letterSpacing: "-1px" }}>{pct}%</div>
                <div style={{ fontSize: 10, color: "#999", marginTop: 2, textTransform: "uppercase", letterSpacing: "0.8px" }}>Rate</div>
              </div>
            </div>
            {renderCalendar()}
          </>
        )}
      </div>
    </div>
  );
}
