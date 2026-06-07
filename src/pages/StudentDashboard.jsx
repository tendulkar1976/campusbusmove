import { useEffect, useState, useRef } from "react";
import { ref, onValue } from "firebase/database";
import { collection, query, where, getDocs, addDoc, doc, getDoc } from "firebase/firestore";
import { rtdb, db } from "../firebase";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import MapView from "../components/MapView";

function getDistanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
function getETA(busLat, busLng, stopLat, stopLng, speed) {
  const dist = getDistanceMeters(busLat, busLng, stopLat, stopLng);
  const spd = parseFloat(speed) || 20;
  return { dist: Math.round(dist), mins: Math.round((dist/1000)/spd*60) };
}
function getDaysInMonth(y, m) { return new Date(y, m+1, 0).getDate(); }
function getTodayStr() { return new Date().toISOString().split("T")[0]; }

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
  const [loading, setLoading]       = useState(true);

  const geofenceTimerRef = useRef(null);
  const markedDateRef    = useRef(null);
  const gpsWatchRef      = useRef(null);
  const rtdbUnsubRef     = useRef(null);

  useEffect(() => {
    getDocs(collection(db, "routes")).then(snap => {
      if (!snap.empty) { const r = snap.docs.map(d=>({id:d.id,...d.data()})); setRoutes(r); setSelected(r[0]); }
      setLoading(false);
    }).catch(()=>setLoading(false));
  }, []);

  useEffect(() => {
    if (!user || routes.length===0) return;
    getDoc(doc(db,"users",user.uid)).then(snap => {
      if (snap.exists() && snap.data().routeId) {
        const r = routes.find(x=>x.id===snap.data().routeId);
        if (r) { setMyRoute(r); setSelected(r); }
      }
    });
  }, [user, routes]);

  useEffect(() => {
    if (!selected?.id) { setActiveBus(null); return; }
    if (rtdbUnsubRef.current) { rtdbUnsubRef.current(); rtdbUnsubRef.current = null; }
    const unsub = onValue(ref(rtdb,`routes/${selected.id}/live`), snap => {
      setActiveBus(snap.exists() ? {...snap.val()} : null);
    });
    rtdbUnsubRef.current = unsub;
    return () => { unsub(); rtdbUnsubRef.current = null; };
  }, [selected?.id]);

  useEffect(() => {
    if (!user) return;
    const today = getTodayStr();
    getDocs(query(collection(db,"attendance"),where("studentId","==",user.uid),where("date","==",today))).then(snap => {
      if (!snap.empty) { const d=snap.docs[0].data(); markedDateRef.current=today; setAttendanceStatus(d.status); setAttendanceLog(p=>({...p,[today]:d.status})); }
    });
  }, [user]);

  useEffect(() => {
    if (!navigator.geolocation) return;
    gpsWatchRef.current = navigator.geolocation.watchPosition(
      pos => setMyLocation({lat:pos.coords.latitude,lng:pos.coords.longitude}),
      ()=>{}, {enableHighAccuracy:true,maximumAge:0,timeout:15000}
    );
    return () => { if (gpsWatchRef.current) navigator.geolocation.clearWatch(gpsWatchRef.current); };
  }, []);

  useEffect(() => {
    const handle = () => {
      if (document.hidden && gpsWatchRef.current) { navigator.geolocation.clearWatch(gpsWatchRef.current); gpsWatchRef.current=null; }
      else if (!document.hidden && !gpsWatchRef.current) {
        gpsWatchRef.current = navigator.geolocation.watchPosition(pos=>setMyLocation({lat:pos.coords.latitude,lng:pos.coords.longitude}),()=>{},{enableHighAccuracy:true,maximumAge:0,timeout:15000});
      }
    };
    document.addEventListener("visibilitychange",handle);
    return ()=>document.removeEventListener("visibilitychange",handle);
  }, []);

  useEffect(() => {
    if (!activeBus || activeBus.active!==true || !myLocation || !selected) { setEta(null); setDistance(null); setInGeofence(false); return; }
    if (selected.stops?.length>0) {
      const nearest = selected.stops.reduce((c,s)=>{const d=getDistanceMeters(myLocation.lat,myLocation.lng,s.lat,s.lng);return d<c.d?{stop:s,d}:c},{stop:null,d:Infinity});
      if (nearest.stop) { const r=getETA(activeBus.lat,activeBus.lng,nearest.stop.lat,nearest.stop.lng,activeBus.speed); setEta(r.mins); setDistance(r.dist); }
    }
    const bd = getDistanceMeters(myLocation.lat,myLocation.lng,activeBus.lat,activeBus.lng);
    const inside = bd<=300;
    setInGeofence(inside);
    const today = getTodayStr();
    if (inside && markedDateRef.current!==today) {
      if (attendanceStatus!=="pending") setAttendanceStatus("pending");
      if (!geofenceTimerRef.current) geofenceTimerRef.current=setTimeout(()=>markAttendance("absent"),15*60*1000);
    } else if (!inside && attendanceStatus==="pending") {
      clearTimeout(geofenceTimerRef.current); geofenceTimerRef.current=null; setAttendanceStatus(null);
    }
  }, [activeBus, myLocation, selected, attendanceStatus]);

  async function markAttendance(status) {
    const today = getTodayStr();
    if (markedDateRef.current===today) return;
    markedDateRef.current=today;
    clearTimeout(geofenceTimerRef.current); geofenceTimerRef.current=null;
    setAttendanceStatus(status);
    await addDoc(collection(db,"attendance"),{studentId:user.uid,routeId:selected?.id,date:today,status,timestamp:Date.now(),campusId});
    setAttendanceLog(p=>({...p,[today]:status}));
  }

  useEffect(() => {
    if (!user||tab!=="attendance") return;
    getDocs(query(collection(db,"attendance"),where("studentId","==",user.uid))).then(snap=>{
      const log={}; snap.docs.forEach(d=>{const data=d.data();log[data.date]=data.status;}); setAttendanceLog(log);
    });
  }, [user, tab]);

  const isActive     = activeBus?.active===true;
  const presentCount = Object.values(attendanceLog).filter(v=>v==="present").length;
  const totalCount   = Object.values(attendanceLog).length;
  const pct          = totalCount>0?Math.round(presentCount/totalCount*100):0;

  if (loading) return (
    <div style={{minHeight:"100vh",background:t.bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12,fontFamily:"'DM Sans',sans-serif"}}>
      <div style={{fontSize:32}}>🚌</div>
      <div style={{color:t.accent,fontSize:14}}>Loading routes...</div>
    </div>
  );

  return (
    <div style={{minHeight:"100vh",background:t.bg,fontFamily:"'DM Sans',sans-serif",color:t.text,transition:"background 0.3s,color 0.3s"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');`}</style>

      {/* ── HEADER ── */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 16px",borderBottom:`1px solid ${t.border}`,position:"sticky",top:0,background:t.headerBg,backdropFilter:"blur(12px)",zIndex:20}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:34,height:34,background:t.accent,borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>🎓</div>
          <div>
            <div style={{fontSize:15,fontWeight:700,color:t.text,letterSpacing:"-0.3px"}}>CampusMove</div>
            {myRoute
              ? <div style={{fontSize:11,color:t.accent,fontWeight:600}}>{myRoute.name}</div>
              : <div style={{fontSize:11,color:t.textMuted}}>Student</div>}
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          {/* Theme toggle — always visible */}
          <button onClick={toggle} title={dark?"Switch to Light":"Switch to Dark"} style={{width:36,height:36,borderRadius:10,border:`1px solid ${t.border}`,background:t.bgCard,cursor:"pointer",fontSize:18,display:"flex",alignItems:"center",justifyContent:"center"}}>
            {dark ? "☀️" : "🌙"}
          </button>
          {/* Sign out — always visible, labelled */}
          <button onClick={logout} style={{display:"flex",alignItems:"center",gap:6,padding:"7px 12px",border:`1px solid ${t.border}`,borderRadius:10,background:t.bgCard,color:t.textSub,fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
            <span style={{fontSize:14}}>↩</span> Sign out
          </button>
        </div>
      </div>

      {/* ── TABS ── */}
      <div style={{display:"flex",borderBottom:`1px solid ${t.border}`,padding:"0 16px",background:t.bg}}>
        {[["track","🗺️  Track"],["attendance","📅  Attendance"]].map(([v,l])=>(
          <button key={v} onClick={()=>setTab(v)} style={{padding:"13px 18px",border:"none",background:"none",cursor:"pointer",fontSize:13,fontWeight:600,color:tab===v?t.tabActive:t.tabInactive,borderBottom:tab===v?`2px solid ${t.tabActive}`:"2px solid transparent",fontFamily:"'DM Sans',sans-serif",transition:"color 0.2s"}}>
            {l}
          </button>
        ))}
      </div>

      <div style={{padding:"16px 16px 100px",maxWidth:480,margin:"0 auto"}}>

        {tab==="track" && (
          <>
            {routes.length===0 ? (
              <div style={{textAlign:"center",padding:"60px 0",color:t.textMuted,fontSize:14}}>
                No routes yet.<br/><span style={{fontSize:12,color:t.textHint}}>Ask admin to add routes.</span>
              </div>
            ) : (
              <>
                {/* Route pills */}
                <div style={{marginBottom:14}}>
                  <p style={{fontSize:10,color:t.textMuted,fontWeight:700,textTransform:"uppercase",letterSpacing:"1.2px",marginBottom:8}}>Select Bus Route</p>
                  <div style={{display:"flex",gap:8,overflowX:"auto",paddingBottom:4}}>
                    {routes.map(r=>(
                      <button key={r.id} onClick={()=>setSelected(r)} style={{flex:"0 0 auto",padding:"10px 16px",border:`1px solid ${selected?.id===r.id?t.accent:t.border}`,borderRadius:10,background:selected?.id===r.id?t.accentSub:t.bgCard,color:selected?.id===r.id?t.accent:t.textSub,fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",whiteSpace:"nowrap",transition:"all 0.15s"}}>
                        {r.name}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Active status */}
                <div style={{marginBottom:14}}>
                  {isActive ? (
                    <div style={{display:"inline-flex",alignItems:"center",gap:8,padding:"9px 16px",borderRadius:20,background:t.pill.activeBg,border:`1px solid ${t.pill.activeBorder}`,fontSize:13,color:t.pill.activeText,fontWeight:600}}>
                      <span style={{width:8,height:8,borderRadius:"50%",background:"#4ADE80",display:"inline-block",boxShadow:"0 0 6px #4ADE80"}}/>
                      {selected?.name} is live · {activeBus.speed||0} km/h
                    </div>
                  ) : (
                    <div style={{display:"inline-flex",alignItems:"center",gap:8,padding:"9px 16px",borderRadius:20,background:t.pill.inactiveBg,border:`1px solid ${t.pill.inactiveBorder}`,fontSize:13,color:t.pill.inactiveText,fontWeight:600}}>
                      <span style={{width:8,height:8,borderRadius:"50%",background:t.textHint,display:"inline-block"}}/>
                      Bus not active
                    </div>
                  )}
                </div>

                {/* ETA box */}
                {isActive && (
                  <div style={{background:t.bgCard,border:`1px solid ${t.border}`,borderRadius:14,padding:"16px",display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                    {[
                      [eta!==null?eta:"—","min to stop"],
                      [distance!==null?(distance>1000?`${(distance/1000).toFixed(1)}k`:distance):"—","meters away"],
                      [activeBus?.speed||0,"km/h"],
                    ].map(([val,label],i)=>(
                      <div key={i} style={{flex:1,textAlign:"center"}}>
                        <div style={{fontSize:26,fontWeight:700,color:t.accent,letterSpacing:"-1px"}}>{val}</div>
                        <div style={{fontSize:10,color:t.textMuted,marginTop:4,textTransform:"uppercase",letterSpacing:"0.8px"}}>{label}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Map */}
                <div style={{background:t.bgCard,border:`1px solid ${t.border}`,borderRadius:16,overflow:"hidden",marginBottom:14}}>
                  <MapView
                    busLocation={isActive?{lat:activeBus.lat,lng:activeBus.lng}:null}
                    busMoving={isActive&&activeBus.speed>0}
                    routePath={selected?.path?.map(p=>[p.lat,p.lng])}
                    center={selected?.center?[selected.center.lat,selected.center.lng]:null}
                    myLocation={myLocation}
                    dark={dark}
                  />
                </div>

                {/* Attendance prompt */}
                {inGeofence && attendanceStatus==="pending" && markedDateRef.current!==getTodayStr() && (
                  <div style={{background:dark?"#0D1520":"#EFF6FF",border:`1px solid ${dark?"#1E3A5F":"#93C5FD"}`,borderRadius:14,padding:"16px",marginBottom:14}}>
                    <div style={{fontSize:14,fontWeight:700,color:"#3B82F6",marginBottom:4}}>🚌 Bus is nearby!</div>
                    <div style={{fontSize:13,color:t.textSub,marginBottom:14}}>Mark your attendance. Auto-marks absent in 15 min.</div>
                    <button onClick={()=>markAttendance("present")} style={{width:"100%",padding:"15px",border:"none",borderRadius:12,background:t.accent,color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                      ✓ Mark Present
                    </button>
                  </div>
                )}

                {attendanceStatus==="present" && (
                  <div style={{background:dark?"#0D1F12":"#ECFDF5",border:`1px solid ${dark?"#1E4D2B":"#6EE7B7"}`,borderRadius:12,padding:"14px 16px",display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
                    <span style={{fontSize:22}}>✅</span>
                    <div>
                      <div style={{fontSize:14,fontWeight:700,color:dark?"#4ADE80":"#065F46"}}>Attendance marked</div>
                      <div style={{fontSize:12,color:t.textMuted}}>Present for today</div>
                    </div>
                  </div>
                )}
                {attendanceStatus==="absent" && (
                  <div style={{background:dark?"#1A0808":"#FEF2F2",border:`1px solid ${dark?"#3D1010":"#FCA5A5"}`,borderRadius:12,padding:"14px 16px",display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
                    <span style={{fontSize:22}}>❌</span>
                    <div>
                      <div style={{fontSize:14,fontWeight:700,color:dark?"#F87171":"#991B1B"}}>Marked absent</div>
                      <div style={{fontSize:12,color:t.textMuted}}>Didn't respond in time</div>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {tab==="attendance" && (
          <>
            <div style={{display:"flex",gap:10,marginBottom:14}}>
              {[[presentCount,"#4ADE80",dark?"#0D1F12":"#ECFDF5","Present"],[totalCount-presentCount,"#F87171",dark?"#1A0808":"#FEF2F2","Absent"],[`${pct}%`,pct>=75?"#4ADE80":"#F87171",dark?"#111":pct>=75?"#ECFDF5":"#FEF2F2","Rate"]].map(([val,col,bg,label],i)=>(
                <div key={i} style={{flex:1,background:t.bgCard,border:`1px solid ${t.border}`,borderRadius:14,padding:"14px",textAlign:"center"}}>
                  <div style={{fontSize:28,fontWeight:700,color:col,letterSpacing:"-1px"}}>{val}</div>
                  <div style={{fontSize:11,color:t.textMuted,marginTop:4,textTransform:"uppercase",letterSpacing:"0.8px"}}>{label}</div>
                </div>
              ))}
            </div>
            {/* Calendar */}
            {(()=>{
              const days=getDaysInMonth(calYear,calMonth);
              const firstDay=new Date(calYear,calMonth,1).getDay();
              const monthName=new Date(calYear,calMonth).toLocaleString("default",{month:"long"});
              const cells=[]; for(let i=0;i<firstDay;i++)cells.push(null); for(let d=1;d<=days;d++)cells.push(d);
              return (
                <div style={{background:t.bgCard,border:`1px solid ${t.border}`,borderRadius:16,overflow:"hidden"}}>
                  <div style={{padding:"14px 16px",borderBottom:`1px solid ${t.border}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                    <button onClick={()=>{if(calMonth===0){setCalMonth(11);setCalYear(y=>y-1);}else setCalMonth(m=>m-1);}} style={{background:"none",border:`1px solid ${t.border}`,color:t.textSub,cursor:"pointer",fontSize:18,width:32,height:32,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center"}}>‹</button>
                    <span style={{fontSize:14,fontWeight:700,color:t.text}}>{monthName} {calYear}</span>
                    <button onClick={()=>{if(calMonth===11){setCalMonth(0);setCalYear(y=>y+1);}else setCalMonth(m=>m+1);}} style={{background:"none",border:`1px solid ${t.border}`,color:t.textSub,cursor:"pointer",fontSize:18,width:32,height:32,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center"}}>›</button>
                  </div>
                  <div style={{padding:"12px 16px"}}>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4,marginBottom:8}}>
                      {["S","M","T","W","T","F","S"].map((d,i)=><div key={i} style={{textAlign:"center",fontSize:11,color:t.textMuted,fontWeight:700}}>{d}</div>)}
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4}}>
                      {cells.map((d,i)=>{
                        if(!d)return<div key={i}/>;
                        const ds=`${calYear}-${String(calMonth+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
                        const st=attendanceLog[ds]; const isToday=getTodayStr()===ds;
                        return <div key={i} style={{aspectRatio:"1",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:isToday?700:500,background:st==="present"?(dark?"#0D1F12":"#ECFDF5"):st==="absent"?(dark?"#1A0808":"#FEF2F2"):isToday?t.accentSub:"transparent",color:st==="present"?(dark?"#4ADE80":"#065F46"):st==="absent"?(dark?"#F87171":"#991B1B"):isToday?t.accent:t.textSub,border:isToday?`1px solid ${t.accent}`:"none"}}>{d}</div>;
                      })}
                    </div>
                  </div>
                  <div style={{padding:"12px 16px",borderTop:`1px solid ${t.border}`,display:"flex",gap:16}}>
                    <div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:10,height:10,borderRadius:3,background:dark?"#0D1F12":"#ECFDF5",border:`1px solid ${dark?"#1E4D2B":"#6EE7B7"}`}}/><span style={{fontSize:12,color:t.textSub}}>Present</span></div>
                    <div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:10,height:10,borderRadius:3,background:dark?"#1A0808":"#FEF2F2",border:`1px solid ${dark?"#3D1010":"#FCA5A5"}`}}/><span style={{fontSize:12,color:t.textSub}}>Absent</span></div>
                  </div>
                </div>
              );
            })()}
          </>
        )}
      </div>
    </div>
  );
}
