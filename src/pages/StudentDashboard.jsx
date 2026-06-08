// At top of file, outside component — temporary
let routeCache = null; // already exists, just make sure it's null on reload
// 
import { useEffect, useState, useRef, useCallback, useMemo, memo } from "react";
import { ref, onValue } from "firebase/database";
import { collection, query, where, getDocs, addDoc, doc, getDoc } from "firebase/firestore";
import { rtdb, db } from "../firebase";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import MapView from "../components/MapView";

// ── Pure helpers (defined outside component — never recreated) ──
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

// ── Route cache — avoids Firestore re-fetch on every mount ──
let routeCache = null;

// ── Memoized sub-components ──
const StatBox = memo(({ val, label, color }) => (
  <div style={{ flex: 1, textAlign: "center" }}>
    <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-1px", color }}>{val}</div>
    <div style={{ fontSize: 10, color: "#666", marginTop: 4, textTransform: "uppercase", letterSpacing: "0.8px" }}>{label}</div>
  </div>
));

const AttendanceBadge = memo(({ status, dark }) => {
  if (status === "present") return (
    <div style={{ background: dark?"#0D1F12":"#ECFDF5", border: `1px solid ${dark?"#1E4D2B":"#6EE7B7"}`, borderRadius: 12, padding: "14px 16px", display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
      <span style={{ fontSize: 22 }}>✅</span>
      <div><div style={{ fontSize: 14, fontWeight: 700, color: dark?"#4ADE80":"#065F46" }}>Attendance marked</div><div style={{ fontSize: 12, color: "#666" }}>Present for today</div></div>
    </div>
  );
  if (status === "absent") return (
    <div style={{ background: dark?"#1A0808":"#FEF2F2", border: `1px solid ${dark?"#3D1010":"#FCA5A5"}`, borderRadius: 12, padding: "14px 16px", display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
      <span style={{ fontSize: 22 }}>❌</span>
      <div><div style={{ fontSize: 14, fontWeight: 700, color: dark?"#F87171":"#991B1B" }}>Marked absent</div><div style={{ fontSize: 12, color: "#666" }}>Didn't respond in time</div></div>
    </div>
  );
  return null;
});

export default function StudentDashboard() {
  const { user, campusId, logout } = useAuth();
  const { dark, toggle, t } = useTheme();

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

  const geofenceTimerRef = useRef(null);
  const markedDateRef    = useRef(null);
  const gpsWatchRef      = useRef(null);
  const rtdbUnsubRef     = useRef(null);
  const busUpdateTimer   = useRef(null); // debounce RTDB updates

  // ── Load routes (cache hit = instant) ──
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

  // ── RTDB listener — debounced 300ms to prevent rapid re-renders ──
  useEffect(() => {
    if (!selected?.id) { setActiveBus(null); return; }
    if (rtdbUnsubRef.current) { rtdbUnsubRef.current(); rtdbUnsubRef.current = null; }
    const unsub = onValue(ref(rtdb, `routes/${selected.id}/live`), snap => {
      clearTimeout(busUpdateTimer.current);
      busUpdateTimer.current = setTimeout(() => {
        setActiveBus(snap.exists() ? { ...snap.val() } : null);
      }, 300);
    });
    rtdbUnsubRef.current = unsub;
    return () => { unsub(); clearTimeout(busUpdateTimer.current); rtdbUnsubRef.current = null; };
  }, [selected?.id]);

  // ── Today's attendance check ──
  useEffect(() => {
    if (!user) return;
    const today = getTodayStr();
    getDocs(query(collection(db,"attendance"), where("studentId","==",user.uid), where("date","==",today))).then(snap => {
      if (!snap.empty) { const d=snap.docs[0].data(); markedDateRef.current=today; setAttendanceStatus(d.status); setAttendanceLog(p=>({...p,[today]:d.status})); }
    });
  }, [user]);

  // ── GPS — stable callback via useCallback ──
  const onGpsSuccess = useCallback(pos => {
    setMyLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
  }, []);

  useEffect(() => {
    if (!navigator.geolocation) return;
    gpsWatchRef.current = navigator.geolocation.watchPosition(onGpsSuccess, ()=>{}, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
    return () => { if (gpsWatchRef.current) navigator.geolocation.clearWatch(gpsWatchRef.current); };
  }, [onGpsSuccess]);

  // ── Visibility — pause GPS in background ──
  useEffect(() => {
    const handle = () => {
      if (document.hidden && gpsWatchRef.current) { navigator.geolocation.clearWatch(gpsWatchRef.current); gpsWatchRef.current=null; }
      else if (!document.hidden && !gpsWatchRef.current) gpsWatchRef.current=navigator.geolocation.watchPosition(onGpsSuccess,()=>{},{enableHighAccuracy:true,maximumAge:0,timeout:15000});
    };
    document.addEventListener("visibilitychange", handle);
    return () => document.removeEventListener("visibilitychange", handle);
  }, [onGpsSuccess]);

  // ── ETA + geofence — memoized computation ──
  useEffect(() => {
    if (!activeBus || activeBus.active!==true || !myLocation || !selected) {
      setEta(null); setDistance(null); setInGeofence(false); return;
    }
    if (selected.stops?.length) {
      const nearest = selected.stops.reduce((c,s)=>{const d=getDistanceMeters(myLocation.lat,myLocation.lng,s.lat,s.lng);return d<c.d?{stop:s,d}:c},{stop:null,d:Infinity});
      if (nearest.stop) { const r=getETA(activeBus.lat,activeBus.lng,nearest.stop.lat,nearest.stop.lng,activeBus.speed); setEta(r.mins); setDistance(r.dist); }
    }
    const bd = getDistanceMeters(myLocation.lat, myLocation.lng, activeBus.lat, activeBus.lng);
    const inside = bd <= 300;
    setInGeofence(inside);
    const today = getTodayStr();
    if (inside && markedDateRef.current!==today) {
      if (attendanceStatus!=="pending") setAttendanceStatus("pending");
      if (!geofenceTimerRef.current) geofenceTimerRef.current=setTimeout(()=>markAttendance("absent"),15*60*1000);
    } else if (!inside && attendanceStatus==="pending") {
      clearTimeout(geofenceTimerRef.current); geofenceTimerRef.current=null; setAttendanceStatus(null);
    }
  }, [activeBus, myLocation, selected, attendanceStatus]);

  const markAttendance = useCallback(async status => {
    const today = getTodayStr();
    if (markedDateRef.current===today) return;
    markedDateRef.current=today;
    clearTimeout(geofenceTimerRef.current); geofenceTimerRef.current=null;
    setAttendanceStatus(status);
    await addDoc(collection(db,"attendance"),{studentId:user.uid,routeId:selected?.id,date:today,status,timestamp:Date.now(),campusId});
    setAttendanceLog(p=>({...p,[today]:status}));
  }, [user, selected, campusId]);

  // ── Attendance tab load ──
  useEffect(() => {
    if (!user||tab!=="attendance") return;
    getDocs(query(collection(db,"attendance"),where("studentId","==",user.uid))).then(snap=>{
      const log={}; snap.docs.forEach(d=>{const x=d.data();log[x.date]=x.status;}); setAttendanceLog(log);
    });
  }, [user, tab]);

  // ── Derived values — memoized ──
  const isActive     = useMemo(() => activeBus?.active===true, [activeBus]);
  const busMapLoc    = useMemo(() => isActive ? { lat: activeBus.lat, lng: activeBus.lng } : null, [isActive, activeBus]);
  const presentCount = useMemo(() => Object.values(attendanceLog).filter(v=>v==="present").length, [attendanceLog]);
  const totalCount   = useMemo(() => Object.values(attendanceLog).length, [attendanceLog]);
  const pct          = useMemo(() => totalCount>0?Math.round(presentCount/totalCount*100):0, [presentCount, totalCount]);

  // ── Stable tab change ──
  const handleTabChange = useCallback(v => setTab(v), []);
  const handleRouteSelect = useCallback(r => setSelected(r), []);

  if (loading) return (
    <div style={{ minHeight:"100vh", background:t.bg, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:12, fontFamily:"'DM Sans',sans-serif" }}>
      <div style={{ fontSize:32 }}>🚌</div>
      <div style={{ color:t.accent, fontSize:14 }}>Loading...</div>
    </div>
  );

  return (
    <div style={{ minHeight:"100vh", background:t.bg, fontFamily:"'DM Sans',sans-serif", color:t.text, willChange:"background", transition:"background 0.25s,color 0.25s" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');*{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}`}</style>

      {/* HEADER */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"14px 16px", borderBottom:`1px solid ${t.border}`, position:"sticky", top:0, background:t.headerBg, backdropFilter:"blur(16px)", WebkitBackdropFilter:"blur(16px)", zIndex:20, willChange:"transform" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:34, height:34, background:t.accent, borderRadius:10, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>🎓</div>
          <div>
            <div style={{ fontSize:15, fontWeight:700, color:t.text }}>CampusMove</div>
            {myRoute ? <div style={{ fontSize:11, color:t.accent, fontWeight:600 }}>{myRoute.name}</div>
                     : <div style={{ fontSize:11, color:t.textMuted }}>Student</div>}
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <button onClick={toggle} style={{ width:36, height:36, borderRadius:10, border:`1px solid ${t.border}`, background:t.bgCard, cursor:"pointer", fontSize:18, display:"flex", alignItems:"center", justifyContent:"center" }}>
            {dark?"☀️":"🌙"}
          </button>
          <button onClick={logout} style={{ display:"flex", alignItems:"center", gap:6, padding:"7px 12px", border:`1px solid ${t.border}`, borderRadius:10, background:t.bgCard, color:t.textSub, fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" }}>
            <span>↩</span> Sign out
          </button>
        </div>
      </div>

      {/* TABS */}
      <div style={{ display:"flex", borderBottom:`1px solid ${t.border}`, padding:"0 16px", background:t.bg }}>
        {[["track","🗺️  Track"],["attendance","📅  Attendance"]].map(([v,l]) => (
          <button key={v} onClick={() => handleTabChange(v)} style={{ padding:"13px 18px", border:"none", background:"none", cursor:"pointer", fontSize:13, fontWeight:600, color:tab===v?t.tabActive:t.tabInactive, borderBottom:tab===v?`2px solid ${t.tabActive}`:"2px solid transparent", fontFamily:"'DM Sans',sans-serif", transition:"color 0.15s" }}>
            {l}
          </button>
        ))}
      </div>

      <div style={{ padding:"16px 16px 100px", maxWidth:480, margin:"0 auto" }}>

        {tab==="track" && (
          <>
            {!routes.length ? (
              <div style={{ textAlign:"center", padding:"60px 0", color:t.textMuted, fontSize:14 }}>No routes yet.<br/><span style={{ fontSize:12, color:t.textHint }}>Ask admin to add routes.</span></div>
            ) : (
              <>
                {/* Route selector */}
                <div style={{ marginBottom:14 }}>
                  <p style={{ fontSize:10, color:t.textMuted, fontWeight:700, textTransform:"uppercase", letterSpacing:"1.2px", marginBottom:8 }}>Select Bus Route</p>
                  <div style={{ display:"flex", gap:8, overflowX:"auto", paddingBottom:4 }}>
                    {routes.map(r => (
                      <button key={r.id} onClick={() => handleRouteSelect(r)} style={{ flex:"0 0 auto", padding:"10px 16px", border:`1px solid ${selected?.id===r.id?t.accent:t.border}`, borderRadius:10, background:selected?.id===r.id?t.accentSub:t.bgCard, color:selected?.id===r.id?t.accent:t.textSub, fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"'DM Sans',sans-serif", whiteSpace:"nowrap", transition:"all 0.12s" }}>
                        {r.name}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Status pill */}
                <div style={{ marginBottom:14 }}>
                  {isActive ? (
                    <div style={{ display:"inline-flex", alignItems:"center", gap:8, padding:"9px 16px", borderRadius:20, background:t.pill.activeBg, border:`1px solid ${t.pill.activeBorder}`, fontSize:13, color:t.pill.activeText, fontWeight:600 }}>
                      <span style={{ width:8, height:8, borderRadius:"50%", background:"#4ADE80", display:"inline-block", boxShadow:"0 0 6px #4ADE80" }}/>
                      {selected?.name} is live · {activeBus.speed||0} km/h
                    </div>
                  ) : (
                    <div style={{ display:"inline-flex", alignItems:"center", gap:8, padding:"9px 16px", borderRadius:20, background:t.pill.inactiveBg, border:`1px solid ${t.pill.inactiveBorder}`, fontSize:13, color:t.pill.inactiveText, fontWeight:600 }}>
                      <span style={{ width:8, height:8, borderRadius:"50%", background:t.textHint, display:"inline-block" }}/>
                      Bus not active
                    </div>
                  )}
                </div>

                {/* ETA */}
                {isActive && (
                  <div style={{ background:t.bgCard, border:`1px solid ${t.border}`, borderRadius:14, padding:"16px", display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
                    {[[eta!==null?eta:"—","min to stop"],[distance!==null?(distance>1000?`${(distance/1000).toFixed(1)}k`:distance):"—","meters away"],[activeBus?.speed||0,"km/h"]].map(([val,label],i) => (
                      <StatBox key={i} val={val} label={label} color={t.accent}/>
                    ))}
                  </div>
                )}

                {/* Map */}
                <div style={{ background:t.bgCard, border:`1px solid ${t.border}`, borderRadius:16, overflow:"hidden", marginBottom:14 }}>
                  <MapView busLocation={busMapLoc} busMoving={isActive&&activeBus.speed>0} routePath={selected?.path?.map(p=>[p.lat,p.lng])} center={selected?.center?[selected.center.lat,selected.center.lng]:null} myLocation={myLocation} dark={dark}/>
                </div>

                {/* Attendance prompt */}
                {inGeofence && attendanceStatus==="pending" && markedDateRef.current!==getTodayStr() && (
                  <div style={{ background:dark?"#0D1520":"#EFF6FF", border:`1px solid ${dark?"#1E3A5F":"#93C5FD"}`, borderRadius:14, padding:"16px", marginBottom:14 }}>
                    <div style={{ fontSize:14, fontWeight:700, color:"#3B82F6", marginBottom:4 }}>🚌 Bus is nearby!</div>
                    <div style={{ fontSize:13, color:t.textSub, marginBottom:14 }}>Mark attendance. Auto-absent in 15 min.</div>
                    <button onClick={() => markAttendance("present")} style={{ width:"100%", padding:"15px", border:"none", borderRadius:12, background:t.accent, color:"#fff", fontSize:14, fontWeight:700, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" }}>
                      ✓ Mark Present
                    </button>
                  </div>
                )}

                <AttendanceBadge status={attendanceStatus} dark={dark}/>
              </>
            )}
          </>
        )}

        {tab==="attendance" && (
          <>
            <div style={{ display:"flex", gap:10, marginBottom:14 }}>
              {[[presentCount,"#4ADE80","Present"],[totalCount-presentCount,"#F87171","Absent"],[`${pct}%`,pct>=75?"#4ADE80":"#F87171","Rate"]].map(([val,color,label],i) => (
                <div key={i} style={{ flex:1, background:t.bgCard, border:`1px solid ${t.border}`, borderRadius:14, padding:"14px", textAlign:"center" }}>
                  <div style={{ fontSize:28, fontWeight:700, color, letterSpacing:"-1px" }}>{val}</div>
                  <div style={{ fontSize:11, color:t.textMuted, marginTop:4, textTransform:"uppercase", letterSpacing:"0.8px" }}>{label}</div>
                </div>
              ))}
            </div>
            <CalendarView calYear={calYear} calMonth={calMonth} attendanceLog={attendanceLog} t={t} dark={dark} onPrev={()=>{if(calMonth===0){setCalMonth(11);setCalYear(y=>y-1);}else setCalMonth(m=>m-1);}} onNext={()=>{if(calMonth===11){setCalMonth(0);setCalYear(y=>y+1);}else setCalMonth(m=>m+1);}}/>
          </>
        )}
      </div>
    </div>
  );
}

// Memoized calendar — only re-renders when month/log changes
const CalendarView = memo(function CalendarView({ calYear, calMonth, attendanceLog, t, dark, onPrev, onNext }) {
  const days     = getDaysInMonth(calYear, calMonth);
  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const monthName = new Date(calYear, calMonth).toLocaleString("default", { month: "long" });
  const cells = useMemo(() => {
    const c = []; for(let i=0;i<firstDay;i++)c.push(null); for(let d=1;d<=days;d++)c.push(d); return c;
  }, [calYear, calMonth]);
  const today = getTodayStr();
  return (
    <div style={{ background:t.bgCard, border:`1px solid ${t.border}`, borderRadius:16, overflow:"hidden" }}>
      <div style={{ padding:"14px 16px", borderBottom:`1px solid ${t.border}`, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <button onClick={onPrev} style={{ background:"none", border:`1px solid ${t.border}`, color:t.textSub, cursor:"pointer", fontSize:18, width:32, height:32, borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center" }}>‹</button>
        <span style={{ fontSize:14, fontWeight:700, color:t.text }}>{monthName} {calYear}</span>
        <button onClick={onNext} style={{ background:"none", border:`1px solid ${t.border}`, color:t.textSub, cursor:"pointer", fontSize:18, width:32, height:32, borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center" }}>›</button>
      </div>
      <div style={{ padding:"12px 16px" }}>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:4, marginBottom:8 }}>
          {["S","M","T","W","T","F","S"].map((d,i)=><div key={i} style={{ textAlign:"center", fontSize:11, color:t.textMuted, fontWeight:700 }}>{d}</div>)}
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:4 }}>
          {cells.map((d,i) => {
            if (!d) return <div key={i}/>;
            const ds = `${calYear}-${String(calMonth+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
            const st = attendanceLog[ds]; const isToday = today===ds;
            return <div key={i} style={{ aspectRatio:"1", borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:isToday?700:500, background:st==="present"?(dark?"#0D1F12":"#ECFDF5"):st==="absent"?(dark?"#1A0808":"#FEF2F2"):isToday?t.accentSub:"transparent", color:st==="present"?(dark?"#4ADE80":"#065F46"):st==="absent"?(dark?"#F87171":"#991B1B"):isToday?t.accent:t.textSub, border:isToday?`1px solid ${t.accent}`:"none" }}>{d}</div>;
          })}
        </div>
      </div>
      <div style={{ padding:"12px 16px", borderTop:`1px solid ${t.border}`, display:"flex", gap:16 }}>
        <div style={{ display:"flex", alignItems:"center", gap:6 }}><div style={{ width:10, height:10, borderRadius:3, background:dark?"#0D1F12":"#ECFDF5", border:`1px solid ${dark?"#1E4D2B":"#6EE7B7"}` }}/><span style={{ fontSize:12, color:t.textSub }}>Present</span></div>
        <div style={{ display:"flex", alignItems:"center", gap:6 }}><div style={{ width:10, height:10, borderRadius:3, background:dark?"#1A0808":"#FEF2F2", border:`1px solid ${dark?"#3D1010":"#FCA5A5"}` }}/><span style={{ fontSize:12, color:t.textSub }}>Absent</span></div>
      </div>
    </div>
  );
});
