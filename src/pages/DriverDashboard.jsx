// At top of file, outside component — temporary
let routeCache = null; // already exists, just make sure it's null on reload
// 
import { useEffect, useState, useRef, useCallback, useMemo, memo } from "react";
import { ref, set } from "firebase/database";
import { collection, getDocs, addDoc, updateDoc, doc, query, where } from "firebase/firestore";
import { rtdb, db } from "../firebase";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import MapView from "../components/MapView";

// Route cache shared with StudentDashboard
let routeCache = null;

function formatTime(s) {
  const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60;
  return h>0?`${h}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`:`${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
}
function formatDuration(ms) {
  const s=Math.floor(ms/1000),h=Math.floor(s/3600),m=Math.floor((s%3600)/60);
  return h>0?`${h}h ${m}m`:`${m}m`;
}

// Memoized trip card
const TripCard = memo(function TripCard({ trip, t, dark }) {
  return (
    <div style={{ background:t.bgCard, border:`1px solid ${t.border}`, borderRadius:14, padding:"14px 16px", marginBottom:10 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
        <div>
          <div style={{ fontSize:14, fontWeight:700, color:t.text }}>{trip.routeName}</div>
          <div style={{ fontSize:11, color:t.textMuted, marginTop:2 }}>{new Date(trip.startTime).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})}</div>
        </div>
        <span style={{ fontSize:11, padding:"3px 9px", borderRadius:6, fontWeight:600, background:trip.status==="active"?(dark?"#0A1A0D":"#ECFDF5"):(dark?"#111":t.bgCard2), color:trip.status==="active"?(dark?"#4ADE80":"#065F46"):t.textMuted, border:`1px solid ${trip.status==="active"?(dark?"#1A3D22":"#6EE7B7"):t.border}` }}>
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
  );
});

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
  const [error, setError]                     = useState("");
  const [tripStart, setTripStart]             = useState(null);
  const [elapsed, setElapsed]                 = useState(0);
  const [trips, setTrips]                     = useState([]);
  const [loading, setLoading]                 = useState(!routeCache);

  const watchIdRef         = useRef(null);
  const lastFirebaseUpdate = useRef(0);
  const timerRef           = useRef(null);
  const tripDocRef         = useRef(null);
  const selectedRouteIdRef = useRef(null);

  useEffect(() => { selectedRouteIdRef.current = selectedRouteId; }, [selectedRouteId]);

  // ── Load routes (cache hit = instant) ──
  useEffect(() => {
    if (routeCache) { setRoutes(routeCache); setSelectedRouteId(routeCache[0]?.id||null); setLoading(false); return; }
    getDocs(collection(db,"routes")).then(snap => {
      const r = snap.docs.map(d=>({id:d.id,...d.data()}));
      routeCache = r;
      setRoutes(r); if (r.length) setSelectedRouteId(r[0].id);
      setLoading(false);
    }).catch(()=>setLoading(false));
  }, []);

  // ── Trip history ──
  useEffect(() => {
    if (!user||tab!=="trips") return;
    getDocs(query(collection(db,"trips"),where("driverUid","==",user.uid))).then(snap=>{
      setTrips(snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>b.startTime-a.startTime));
    }).catch(()=>setTrips([]));
  }, [user, tab]);

  // ── Timer ──
  useEffect(() => {
    if (tracking) { timerRef.current=setInterval(()=>setElapsed(e=>e+1),1000); }
    else { clearInterval(timerRef.current); setElapsed(0); }
    return ()=>clearInterval(timerRef.current);
  }, [tracking]);

  // ── Firebase throttle reset on foreground ──
  useEffect(() => {
    const h=()=>{if(!document.hidden)lastFirebaseUpdate.current=0;};
    document.addEventListener("visibilitychange",h);
    return ()=>document.removeEventListener("visibilitychange",h);
  }, []);

  // ── GPS callback — stable ref ──
  const onGpsSuccess = useCallback(pos => {
    const { latitude:lat, longitude:lng, speed:spd, heading:hdg, accuracy:acc } = pos.coords;
    const kmh = (spd!=null&&spd>=0) ? parseFloat((spd*3.6).toFixed(1)) : 0;
    const now = Date.now();
    // Always update local state
    setMyLocation({ lat, lng });
    setSpeed(kmh);
    setHeading(hdg||0);
    setAccuracy(acc?Math.round(acc):null);
    // Throttle Firebase
    if (now-lastFirebaseUpdate.current>=2000) {
      const rid = selectedRouteIdRef.current;
      set(ref(rtdb,`routes/${rid}/live`),{routeId:rid,driverUid:user.uid,active:true,lat,lng,speed:kmh,heading:hdg||0,updatedAt:now});
      lastFirebaseUpdate.current=now;
    }
  }, [user]);

  const startTracking = useCallback(async () => {
    if (!navigator.geolocation) { setError("GPS not supported."); return; }
    if (!selectedRouteId) { setError("Select a route first."); return; }
    setError("");
    const now=Date.now(); setTripStart(now);
    const route=routes.find(r=>r.id===selectedRouteId);
    const tripDoc=await addDoc(collection(db,"trips"),{driverUid:user.uid,routeId:selectedRouteId,routeName:route?.name||selectedRouteId,campusId,startTime:now,endTime:null,status:"active"});
    tripDocRef.current=tripDoc.id;
    set(ref(rtdb,`routes/${selectedRouteId}/live`),{routeId:selectedRouteId,driverUid:user.uid,active:true,lat:12.9716,lng:77.5946,speed:0,heading:0,updatedAt:now});
    setTracking(true);
    watchIdRef.current=navigator.geolocation.watchPosition(onGpsSuccess,err=>{
      const msgs={1:"Location permission denied.",2:"GPS signal lost.",3:"GPS timeout."};
      setError(msgs[err.code]||"GPS error: "+err.message);
    },{enableHighAccuracy:true,maximumAge:0,timeout:10000});
  }, [selectedRouteId, routes, user, campusId, onGpsSuccess]);

  const stopTracking = useCallback(async () => {
    if (watchIdRef.current) { navigator.geolocation.clearWatch(watchIdRef.current); watchIdRef.current=null; }
    setTracking(false);
    if (selectedRouteId) set(ref(rtdb,`routes/${selectedRouteId}/live`),{routeId:selectedRouteId,driverUid:user.uid,active:false,lat:myLocation?.lat||0,lng:myLocation?.lng||0,speed:0,heading:0,updatedAt:Date.now()});
    if (tripDocRef.current) { await updateDoc(doc(db,"trips",tripDocRef.current),{endTime:Date.now(),status:"completed"}); tripDocRef.current=null; }
    setSpeed(0); setHeading(0); setAccuracy(null);
  }, [selectedRouteId, myLocation, user]);

  useEffect(()=>()=>{ if(watchIdRef.current)navigator.geolocation.clearWatch(watchIdRef.current); clearInterval(timerRef.current); },[]);

  const selectedRoute = useMemo(()=>routes.find(r=>r.id===selectedRouteId),[routes,selectedRouteId]);
  const handleTabChange = useCallback(v=>setTab(v),[]);

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
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"14px 16px", borderBottom:`1px solid ${t.border}`, position:"sticky", top:0, background:t.headerBg, backdropFilter:"blur(16px)", WebkitBackdropFilter:"blur(16px)", zIndex:20 }}>
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
      <div style={{ display:"flex", borderBottom:`1px solid ${t.border}`, padding:"0 16px", background:t.bg }}>
        {[["live","🔴  Live"],["trips","📋  Trips"]].map(([v,l])=>(
          <button key={v} onClick={()=>handleTabChange(v)} style={{ padding:"13px 18px", border:"none", background:"none", cursor:"pointer", fontSize:13, fontWeight:600, color:tab===v?t.tabActive:t.tabInactive, borderBottom:tab===v?`2px solid ${t.tabActive}`:"2px solid transparent", fontFamily:"'DM Sans',sans-serif", transition:"color 0.15s" }}>{l}</button>
        ))}
      </div>

      <div style={{ padding:"16px 16px 40px", maxWidth:480, margin:"0 auto" }}>

        {tab==="live" && (
          <>
            {!routes.length ? (
              <div style={{ textAlign:"center", padding:"60px 0", color:t.textMuted, fontSize:14 }}>No routes yet.<br/><span style={{ fontSize:12, color:t.textHint }}>Ask admin.</span></div>
            ) : (
              <>
                {/* Route selector */}
                <div style={{ marginBottom:14 }}>
                  <p style={{ fontSize:10, color:t.textMuted, fontWeight:700, textTransform:"uppercase", letterSpacing:"1.2px", marginBottom:8 }}>Select Route</p>
                  <div style={{ display:"flex", gap:8, overflowX:"auto", paddingBottom:4 }}>
                    {routes.map(r=>(
                      <button key={r.id} onClick={()=>!tracking&&setSelectedRouteId(r.id)} style={{ flex:"0 0 auto", padding:"10px 16px", border:`1px solid ${selectedRouteId===r.id?t.accent:t.border}`, borderRadius:10, background:selectedRouteId===r.id?t.accentSub:t.bgCard, color:selectedRouteId===r.id?t.accent:t.textSub, fontSize:12, fontWeight:600, cursor:tracking?"default":"pointer", fontFamily:"'DM Sans',sans-serif", whiteSpace:"nowrap", opacity:tracking&&selectedRouteId!==r.id?0.4:1, transition:"all 0.12s" }}>{r.name}</button>
                    ))}
                  </div>
                </div>

                {/* Timer card */}
                <div style={{ background:t.bgCard, border:`1px solid ${t.border}`, borderRadius:16, overflow:"hidden", marginBottom:14 }}>
                  <div style={{ textAlign:"center", padding:"24px 16px 20px", borderBottom:`1px solid ${t.border}` }}>
                    <div style={{ fontSize:10, color:t.textMuted, textTransform:"uppercase", letterSpacing:"1px", marginBottom:8 }}>{tracking?"Trip Duration":"Ready to Start"}</div>
                    <div style={{ fontSize:52, fontWeight:700, letterSpacing:"-2px", color:tracking?t.accent:t.textHint, fontVariantNumeric:"tabular-nums", lineHeight:1 }}>{formatTime(elapsed)}</div>
                    {tracking&&tripStart&&<div style={{ fontSize:11, color:t.textMuted, marginTop:8 }}>Started at {new Date(tripStart).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</div>}
                  </div>
                  <div style={{ display:"flex", padding:"16px" }}>
                    {[[`${speed}`,"km/h",tracking?(speed>0?"#4ADE80":"#facc15"):t.textHint],[selectedRoute?.name||"—","Route",tracking?t.accent:t.textHint],[tracking?"Live":"Off","GPS",tracking?"#4ADE80":t.textHint]].map(([val,label,color],i)=>(
                      <div key={i} style={{ flex:1, textAlign:"center" }}>
                        <div style={{ fontSize:i===1?13:22, fontWeight:700, color, letterSpacing:"-0.5px", lineHeight:1.2 }}>{val}</div>
                        <div style={{ fontSize:10, color:t.textMuted, marginTop:4, textTransform:"uppercase", letterSpacing:"0.8px" }}>{label}</div>
                      </div>
                    ))}
                  </div>
                  {tracking&&accuracy!==null&&(
                    <div style={{ padding:"0 16px 14px", display:"flex", alignItems:"center", gap:8 }}>
                      <div style={{ flex:1, height:3, background:t.border, borderRadius:2, overflow:"hidden" }}>
                        <div style={{ height:"100%", width:`${Math.max(0,100-accuracy)}%`, background:accuracy<10?"#4ADE80":accuracy<30?"#facc15":"#F87171", transition:"width 0.4s", borderRadius:2 }}/>
                      </div>
                      <span style={{ fontSize:10, color:accuracy<10?"#4ADE80":accuracy<30?"#facc15":"#F87171", whiteSpace:"nowrap" }}>±{accuracy}m</span>
                    </div>
                  )}
                </div>

                {tracking&&(
                  <div style={{ background:dark?"#0A1A0D":"#ECFDF5", border:`1px solid ${dark?"#1A3D22":"#6EE7B7"}`, borderRadius:10, padding:"10px 14px", marginBottom:14, display:"flex", alignItems:"center", gap:8 }}>
                    <span style={{ width:7, height:7, borderRadius:"50%", background:"#4ADE80", display:"inline-block" }}/>
                    <span style={{ fontSize:12, color:dark?"#4ADE80":"#065F46", fontWeight:500 }}>Broadcasting · Firebase every 2s</span>
                  </div>
                )}

                <div style={{ background:t.bgCard, border:`1px solid ${t.border}`, borderRadius:16, overflow:"hidden", marginBottom:14 }}>
                  <MapView busLocation={myLocation} busMoving={tracking&&speed>0} dark={dark}/>
                </div>

                {!tracking
                  ?<button onClick={startTracking} style={{ width:"100%", background:t.accent, border:"none", borderRadius:14, padding:"18px 0", color:"#fff", fontSize:16, fontWeight:700, cursor:"pointer", fontFamily:"'DM Sans',sans-serif", marginBottom:12 }}>▶ Start Trip</button>
                  :<button onClick={stopTracking}  style={{ width:"100%", background:dark?"#1A0808":"#FEF2F2", border:`1px solid ${dark?"#3D1010":"#FCA5A5"}`, borderRadius:14, padding:"18px 0", color:dark?"#F87171":"#991B1B", fontSize:16, fontWeight:700, cursor:"pointer", fontFamily:"'DM Sans',sans-serif", marginBottom:12 }}>■ End Trip</button>
                }

                {error&&<div style={{ background:dark?"#1A0808":"#FEF2F2", border:`1px solid ${dark?"#3D1010":"#FCA5A5"}`, borderRadius:10, padding:"12px 14px", marginBottom:10 }}><p style={{ color:dark?"#F87171":"#991B1B", fontSize:13, margin:0 }}>⚠️ {error}</p></div>}

                {myLocation&&(
                  <div style={{ background:t.bgCard, border:`1px solid ${t.border}`, borderRadius:12, padding:"12px 16px", display:"flex", justifyContent:"space-between" }}>
                    <div><p style={{ fontSize:10, color:t.textMuted, textTransform:"uppercase", letterSpacing:"0.8px", margin:"0 0 4px" }}>Live GPS</p><p style={{ fontSize:12, color:t.textSub, margin:0, fontFamily:"monospace" }}>{myLocation.lat.toFixed(5)}, {myLocation.lng.toFixed(5)}</p></div>
                    <div style={{ textAlign:"right" }}><p style={{ fontSize:10, color:t.textMuted, textTransform:"uppercase", letterSpacing:"0.8px", margin:"0 0 4px" }}>Heading</p><p style={{ fontSize:12, color:t.textSub, margin:0 }}>{heading}°</p></div>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {tab==="trips" && (
          <>
            <p style={{ fontSize:10, color:t.textMuted, fontWeight:700, textTransform:"uppercase", letterSpacing:"1.2px", marginBottom:12 }}>Trip History</p>
            {!trips.length
              ?<div style={{ textAlign:"center", padding:"60px 0", color:t.textMuted, fontSize:14 }}>No trips yet</div>
              :trips.map(trip=><TripCard key={trip.id} trip={trip} t={t} dark={dark}/>)
            }
          </>
        )}
      </div>
    </div>
  );
}
