import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { db, auth } from "../firebase";
import { getDoc, doc, setDoc } from "firebase/firestore";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from "firebase/auth";
import { useTheme } from "../context/ThemeContext";

const ADMIN_EMAIL    = "gamethunder83@gmail.com";
const ADMIN_PASSWORD = "gamethunder83";

// Username → virtual email for Firebase Auth
function toVirtualEmail(username) { return username.trim().toLowerCase() + "@campusmove.user"; }

// Clean username generation to avoid double/leading/trailing dots and special characters
function generateCleanUsername(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s.]/g, "") // remove special characters except spaces and dots
    .replace(/[\s.]+/g, ".")       // collapse spaces and consecutive dots into a single dot
    .replace(/^\.+|\.+$/g, "");    // trim leading/trailing dots
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

export default function Login() {
  const navigate = useNavigate();
  const { dark, toggle } = useTheme();

  const [step, setStep]       = useState("role");
  const [role, setRole]       = useState(null);
  const [mode, setMode]       = useState("login");
  const [form, setForm]       = useState({ name:"", username:"", password:"" });
  const [error, setError]     = useState("");
  const [loading, setLoading] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [busPhase, setBusPhase] = useState("idle");

  // Bus Pass OCR Scanner states
  const [scanStep, setScanStep] = useState("capture"); // "capture" | "confirm"
  const [scanData, setScanData] = useState({ name: "", program: "", pickupPoint: "", validityMonth: "December", validityYear: "2026" });
  const [isScanning, setIsScanning] = useState(false);
  const [scanLog, setScanLog] = useState([]);
  const [uploadedImgUrl, setUploadedImgUrl] = useState(null);

  function runScanningSimulation(file) {
    setIsScanning(true);
    setScanLog([]);
    setError("");

    if (file) {
      const url = URL.createObjectURL(file);
      setUploadedImgUrl(url);
    }

    const logs = [
      "📷 Camera initialized. Aligning bus pass...",
      "🔍 Card detected: 'ALLIANCE UNIVERSITY BUS PASS'",
      "⚡ Running OCR text recognition...",
      "✅ Bus Pass detected successfully!",
      "🎉 Scanning complete. Loading registration form..."
    ];

    logs.forEach((txt, idx) => {
      setTimeout(() => {
        setScanLog(prev => [...prev, txt]);
      }, (idx + 1) * 300);
    });

    setTimeout(() => {
      setIsScanning(false);
      setScanStep("confirm");
      // Reset fields so student enters their actual details (self-registering)
      setScanData({
        name: "",
        program: "",
        pickupPoint: "",
        validityMonth: "December",
        validityYear: new Date().getFullYear().toString()
      });
      setForm(prev => ({
        ...prev,
        username: "",
        password: ""
      }));
    }, logs.length * 320);
  }

  function handleFileUpload(e) {
    if (e.target.files && e.target.files.length > 0) {
      runScanningSimulation(e.target.files[0]);
    }
  }

  useEffect(() => {
    setTimeout(() => setMounted(true), 80);
    setTimeout(() => setBusPhase("driving"), 400);
    setTimeout(() => setBusPhase("idle"), 2800);
  }, []);

  function handleChange(e) { setForm({ ...form, [e.target.name]: e.target.value }); setError(""); }

  async function handleDriverLogin() {
    setError(""); setLoading(true); setBusPhase("driving");
    if (!form.phone || form.phone.length < 10) { setError("Enter a valid 10-digit phone number."); setLoading(false); setBusPhase("idle"); return; }
    if (!form.password || form.password.length < 6) { setError("Password must be at least 6 characters."); setLoading(false); setBusPhase("idle"); return; }
    const virtualEmail = form.phone.trim() + "@campusmove.driver";
    try {
      if (mode === "login") {
        const cred = await signInWithEmailAndPassword(auth, virtualEmail, form.password);
        const snap = await getDoc(doc(db, "users", cred.user.uid));
        if (!snap.exists()) { setError("Account not found. Register first."); setLoading(false); setBusPhase("idle"); return; }
        setTimeout(() => navigate("/driver"), 600);
      } else {
        const cred = await createUserWithEmailAndPassword(auth, virtualEmail, form.password);
        await setDoc(doc(db, "users", cred.user.uid), { name:form.name||"Driver", phone:"+91"+form.phone.trim(), role:"driver", campusId:"alliance-bangalore", createdAt:Date.now() });
        setTimeout(() => navigate("/driver"), 600);
      }
    } catch (err) {
      const c = err.code;
      if (c==="auth/wrong-password"||c==="auth/invalid-credential") setError("Incorrect password.");
      else if (c==="auth/user-not-found") setError("No account found. Register first.");
      else if (c==="auth/email-already-in-use") setError("Phone already registered. Sign in instead.");
      else if (c==="auth/weak-password") setError("Password must be at least 6 characters.");
      else setError(err.message.replace("Firebase:", "").trim());
      setBusPhase("idle");
    } finally { setLoading(false); }
  }

  async function handleUserLogin() {
    setError(""); setLoading(true); setBusPhase("driving");
    let username = form.username.trim();
    if (mode === "register" && role === "teacher") {
      username = generateCleanUsername(form.name);
    }
    if (!username || username.length < 3) {
      setError(mode === "register" && role === "teacher" ? "Full name must be at least 3 characters to generate a username." : "Enter a valid username (min 3 characters).");
      setLoading(false); setBusPhase("idle"); return;
    }
    if (!form.password || form.password.length < 6) { setError("Password must be at least 6 characters."); setLoading(false); setBusPhase("idle"); return; }

    // Admin shortcut
    if (username === "admin") {
      if (role !== "admin") {
        setError("Access Denied. Admins must log in through the Administrator portal.");
        setLoading(false); setBusPhase("idle"); return;
      }
      if (form.password !== ADMIN_PASSWORD) {
        setError("Invalid administrative credentials.");
        setLoading(false); setBusPhase("idle"); return;
      }
      try {
        await signInWithEmailAndPassword(auth, ADMIN_EMAIL, ADMIN_PASSWORD);
        setTimeout(() => navigate("/admin"), 600);
        return;
      } catch { setError("Admin login failed."); setLoading(false); setBusPhase("idle"); return; }
    }

    if (role === "admin") {
      setError("Invalid administrative credentials.");
      setLoading(false); setBusPhase("idle"); return;
    }

    const virtualEmail = toVirtualEmail(username);
    try {
      if (mode === "login") {
        const cred = await signInWithEmailAndPassword(auth, virtualEmail, form.password);
        const snap = await getDoc(doc(db, "users", cred.user.uid));
        if (!snap.exists()) { setError("Account not found. Contact admin."); setLoading(false); setBusPhase("idle"); return; }
        
        const userRole = snap.data().role;
        if (role === "student" && userRole !== "student") {
          setError("This account is not registered as a Student.");
          await auth.signOut();
          setLoading(false); setBusPhase("idle"); return;
        }
        if (role === "teacher" && userRole !== "teacher") {
          setError("This account is not registered as Faculty.");
          await auth.signOut();
          setLoading(false); setBusPhase("idle"); return;
        }

        setTimeout(() => navigate("/student"), 600);
      } else {
        if (!form.name.trim()) { setError("Enter your full name."); setLoading(false); setBusPhase("idle"); return; }
        const cred = await createUserWithEmailAndPassword(auth, virtualEmail, form.password);
        const profile = {
          name: form.name.trim(),
          username: username,
          role: role,
          campusId: "alliance-bangalore",
          createdAt: Date.now(),
        };
        if (role === "teacher") {
          profile.pickupPoint = (form.pickupPoint || "").trim();
        }
        await setDoc(doc(db, "users", cred.user.uid), profile);
        setTimeout(() => navigate("/student"), 600);
      }
    } catch (err) {
      const c = err.code;
      if (c==="auth/wrong-password"||c==="auth/invalid-credential") setError("Incorrect password.");
      else if (c==="auth/user-not-found") setError("Username not found. Register or contact admin.");
      else if (c==="auth/email-already-in-use") setError("Username already taken. Try another.");
      else if (c==="auth/weak-password") setError("Password must be at least 6 characters.");
      else if (c==="auth/invalid-email") setError("Invalid username format. Use only letters, numbers, and single dots (no spaces or consecutive/leading/trailing dots).");
      else setError(err.message.replace("Firebase:", "").trim());
      setBusPhase("idle");
    } finally { setLoading(false); }
  }

  async function handleStudentRegister() {
    setError(""); setLoading(true); setBusPhase("driving");
    if (!scanData.name.trim()) { setError("Full name is required."); setLoading(false); setBusPhase("idle"); return; }
    
    // Auto-generate username from Full Name (e.g., "K. Tendulkar" -> "k.tendulkar")
    const username = generateCleanUsername(scanData.name);
    if (username.length < 3) { setError("Full name must contain at least 3 valid characters to generate a username."); setLoading(false); setBusPhase("idle"); return; }
    if (!form.password || form.password.length < 6) { setError("Password must be at least 6 characters."); setLoading(false); setBusPhase("idle"); return; }

    const virtualEmail = toVirtualEmail(username);
    try {
      const cred = await createUserWithEmailAndPassword(auth, virtualEmail, form.password);
      await setDoc(doc(db, "users", cred.user.uid), {
        name: scanData.name.trim(),
        username: username,
        role: "student",
        program: scanData.program.trim(),
        pickupPoint: scanData.pickupPoint.trim(),
        validityMonth: scanData.validityMonth,
        validityYear: parseInt(scanData.validityYear) || new Date().getFullYear(),
        campusId: "alliance-bangalore",
        createdAt: Date.now(),
      });
      setTimeout(() => navigate("/student"), 600);
    } catch (err) {
      const c = err.code;
      if (c === "auth/email-already-in-use") {
        setError("Username generated from your name is already taken. Please customize your name slightly or check with admin.");
      } else if (c === "auth/weak-password") {
        setError("Password must be at least 6 characters.");
      } else if (c === "auth/invalid-email") {
        setError("Invalid characters in your name. Use only letters, numbers, and spaces.");
      } else {
        setError(err.message.replace("Firebase:", "").trim());
      }
      setBusPhase("idle");
    } finally { setLoading(false); }
  }

  const isDriving = busPhase === "driving";

  const ROLES = [
    { id:"student", label:"Student",           sub:"Scan bus pass to register or sign in", icon:"🎓", color:"#3B82F6" },
    { id:"teacher", label:"Faculty / Teacher", sub:"Username & password sign in",          icon:"🧑‍🏫", color:"#10B981" },
    { id:"driver",  label:"Driver",            sub:"Phone number & password",              icon:"🚌", color:"#F59E0B" },
    { id:"admin",   label:"Administrator",     sub:"Access administrative console",        icon:"⚙️", color:"#EF4444" },
  ];

  const inp = {
    width:"100%", background:"#F8F9FA", border:"1.5px solid #E5E7EB",
    borderRadius:10, padding:"13px 16px", color:"#111", fontSize:14,
    boxSizing:"border-box", fontFamily:"'Inter',sans-serif",
    transition:"border-color 0.15s", outline:"none",
  };

  return (
    <div style={{ minHeight:"100vh", background:"#F1F5F9", display:"flex", flexDirection:"column", fontFamily:"'Inter',sans-serif", position:"relative", overflow:"hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
        @keyframes fadeUp { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
        @keyframes busLoop { 0%{left:-140px} 100%{left:110vw} }
        @keyframes busIdle { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-3px)} }
        @keyframes roadDash { from{transform:translateX(0)} to{transform:translateX(-12vw)} }
        @keyframes spinWheel { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes headlightPulse { 0%,100%{opacity:0.6} 50%{opacity:1} }
        @keyframes exhaustPuff { 0%{opacity:0.5;transform:scale(0.4) translateX(0)} 100%{opacity:0;transform:scale(2) translateX(-28px)} }
        @keyframes shake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-5px)} 75%{transform:translateX(5px)} }
        @keyframes laserScan { 0% { top: 4px; } 50% { top: calc(100% - 8px); } 100% { top: 4px; } }
        input:focus { border-color:#2563EB !important; box-shadow:0 0 0 3px rgba(37,99,235,0.1) !important; }
        input::placeholder { color:#9CA3AF; }
        .err-shake { animation:shake 0.35s ease; }
        .role-card:hover { border-color:#2563EB !important; background:#EFF6FF !important; }
        .role-card:hover .role-arrow { color:#2563EB !important; }
      `}</style>

      {/* Top nav */}
      <div style={{ background:"#fff", borderBottom:"1px solid #E5E7EB", padding:"0 24px", height:56, display:"flex", alignItems:"center", justifyContent:"space-between", position:"sticky", top:0, zIndex:10 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:32, height:32, background:"#FF5A1F", borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>🚌</div>
          <div>
            <div style={{ fontSize:14, fontWeight:700, color:"#111", letterSpacing:"-0.3px" }}>CampusMove</div>
            <div style={{ fontSize:10, color:"#FF5A1F", fontWeight:600, letterSpacing:"0.8px", textTransform:"uppercase", lineHeight:1 }}>Alliance University</div>
          </div>
        </div>
        <div style={{ fontSize:12, color:"#6B7280", background:"#F3F4F6", borderRadius:6, padding:"4px 10px", fontWeight:500 }}>Secure Portal</div>
      </div>

      {/* Content */}
      <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", padding:"24px 16px 100px" }}>
        <div style={{ width:"100%", maxWidth:400, opacity:mounted?1:0, animation:mounted?"fadeUp 0.4s ease forwards":"none" }}>

          {/* STEP 1 — Role */}
          {step === "role" && (
            <div>
              <div style={{ marginBottom:28 }}>
                <div style={{ fontSize:11, fontWeight:600, color:"#6B7280", letterSpacing:"1px", textTransform:"uppercase", marginBottom:8 }}>CampusMove Portal</div>
                <h1 style={{ fontSize:28, fontWeight:800, color:"#0F172A", margin:0, letterSpacing:"-0.5px", lineHeight:1.2 }}>Sign in to your<br/>account</h1>
                <p style={{ color:"#6B7280", fontSize:14, margin:"10px 0 0" }}>Select your role to continue</p>
              </div>

              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {ROLES.map((r, i) => (
                  <button key={r.id} className="role-card"
                    onClick={() => { setRole(r.id); setStep("form"); setError(""); setMode("login"); }}
                    style={{ display:"flex", alignItems:"center", gap:14, padding:"16px 18px", background:"#fff", border:"1.5px solid #E5E7EB", borderRadius:12, cursor:"pointer", fontFamily:"'Inter',sans-serif", textAlign:"left", transition:"all 0.15s", animation:`fadeUp 0.35s ease ${i*0.08}s both` }}>
                    <div style={{ width:42, height:42, borderRadius:10, background:`${r.color}15`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>{r.icon}</div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:15, fontWeight:700, color:"#0F172A" }}>{r.label}</div>
                      <div style={{ fontSize:12, color:"#9CA3AF", marginTop:2 }}>{r.sub}</div>
                    </div>
                    <div className="role-arrow" style={{ color:"#D1D5DB", fontSize:18 }}>›</div>
                  </button>
                ))}
              </div>

              {/* Support notice */}
              <div style={{ marginTop:20, padding:"14px 16px", background:"#FFF7ED", border:"1px solid #FED7AA", borderRadius:10, display:"flex", gap:10, alignItems:"flex-start" }}>
                <span style={{ fontSize:14, flexShrink:0 }}>ℹ️</span>
                <div style={{ fontSize:12, color:"#92400E", lineHeight:1.6 }}>
                  This portal is for <strong>Alliance University</strong> members only.<br/>
                  Having trouble logging in? Contact your transport admin for account access.
                </div>
              </div>
            </div>
          )}

          {/* STEP 2 — Form */}
          {step === "form" && (
            <div style={{ animation:"fadeUp 0.35s ease forwards" }}>
              <button onClick={() => { setStep("role"); setError(""); }}
                style={{ display:"flex", alignItems:"center", gap:6, background:"none", border:"none", color:"#6B7280", fontSize:13, fontWeight:500, cursor:"pointer", fontFamily:"'Inter',sans-serif", marginBottom:22, padding:0 }}>
                ← Back
              </button>

              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:20 }}>
                <div style={{
                  width:38, height:38, borderRadius:9,
                  background: role==="driver"?"#F59E0B15":role==="teacher"?"#10B98115":role==="admin"?"#EF444415":"#3B82F615",
                  display:"flex", alignItems:"center", justifyContent:"center", fontSize:18
                }}>
                  {role === "driver" ? "🚌" : role === "teacher" ? "🧑‍🏫" : role === "admin" ? "⚙️" : "🎓"}
                </div>
                <div>
                  <div style={{ fontSize:18, fontWeight:800, color:"#0F172A", letterSpacing:"-0.3px" }}>
                    {mode === "login" ? "Sign in" : "Create account"}
                  </div>
                  <div style={{ fontSize:12, color:"#9CA3AF" }}>
                    {role === "driver" ? "Driver · Phone & password" : role === "teacher" ? "Faculty · Username & password" : role === "admin" ? "Administrator · Console Access" : "Student · Scan pass or credentials"}
                  </div>
                </div>
              </div>

              <div style={{ background:"#fff", border:"1px solid #E5E7EB", borderRadius:14, padding:"20px", boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
                <div style={{ display:"flex", flexDirection:"column", gap:14 }}>

                  {/* DRIVER FORM */}
                  {role === "driver" && (
                    <>
                      {mode === "register" && (
                        <div>
                          <label style={{ fontSize:11, fontWeight:600, color:"#374151", letterSpacing:"0.3px", display:"block", marginBottom:6, textTransform:"uppercase" }}>Full Name</label>
                          <input name="name" value={form.name} onChange={handleChange} placeholder="Driver name" style={inp} />
                        </div>
                      )}
                      <div>
                        <label style={{ fontSize:11, fontWeight:600, color:"#374151", letterSpacing:"0.3px", display:"block", marginBottom:6, textTransform:"uppercase" }}>Phone Number</label>
                        <div style={{ position:"relative" }}>
                          <div style={{ position:"absolute", left:14, top:"50%", transform:"translateY(-50%)", color:"#6B7280", fontSize:14, fontWeight:600, borderRight:"1px solid #E5E7EB", paddingRight:10, lineHeight:1 }}>+91</div>
                          <input name="phone" value={form.phone||""} onChange={handleChange} placeholder="9876543210" maxLength={10} type="tel" style={{ ...inp, paddingLeft:56 }} />
                        </div>
                      </div>
                      <div>
                        <label style={{ fontSize:11, fontWeight:600, color:"#374151", letterSpacing:"0.3px", display:"block", marginBottom:6, textTransform:"uppercase" }}>Password</label>
                        <div style={{ position:"relative" }}>
                          <input name="password" type={showPwd?"text":"password"} value={form.password} onChange={handleChange} placeholder="••••••••" style={{ ...inp, paddingRight:44 }} />
                          <button type="button" onClick={() => setShowPwd(p=>!p)} style={{ position:"absolute", right:12, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", cursor:"pointer", fontSize:14, color:"#9CA3AF", padding:0 }}>{showPwd?"🙈":"👁"}</button>
                        </div>
                      </div>
                      {error && <div className="err-shake" style={{ background:"#FEF2F2", border:"1px solid #FECACA", borderRadius:8, padding:"10px 14px" }}><p style={{ color:"#DC2626", fontSize:12, margin:0, fontWeight:500 }}>⚠ {error}</p></div>}
                      <button onClick={handleDriverLogin} disabled={loading}
                        style={{ width:"100%", background:loading?"#93C5FD":"#1D4ED8", border:"none", borderRadius:10, padding:"14px 0", color:"#fff", fontSize:14, fontWeight:700, cursor:loading?"not-allowed":"pointer", fontFamily:"'Inter',sans-serif" }}>
                        {loading ? "Please wait..." : mode === "login" ? "Sign In →" : "Create Account →"}
                      </button>
                      <div style={{ textAlign:"center", marginTop:10 }}>
                        <button type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }} style={{ background:"none", border:"none", color:"#1D4ED8", fontSize:13, fontWeight:600, cursor:"pointer", padding:0, fontFamily:"'Inter',sans-serif" }}>
                          {mode === "login" ? "Don't have an account? Register" : "Already have an account? Sign In"}
                        </button>
                      </div>
                    </>
                  )}

                  {/* STUDENT REGISTER FLOW */}
                  {role === "student" && mode === "register" && (
                    <>
                      {scanStep === "capture" && (
                        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
                          {/* Visual Scanner Area */}
                          <div style={{
                            width:"100%", height:200, background:"#0F172A", borderRadius:12,
                            position:"relative", display:"flex", flexDirection:"column",
                            alignItems:"center", justifyContent:"center", overflow:"hidden", border:"1px solid #334155"
                          }}>
                            {/* Scanning line */}
                            {isScanning && (
                              <div style={{
                                position:"absolute", left:0, right:0, height:2,
                                background:"rgba(239, 68, 68, 0.8)", boxShadow:"0 0 10px rgba(239, 68, 68, 0.8)",
                                zIndex:5, animation:"laserScan 2s infinite linear"
                              }}/>
                            )}

                            {/* Pass Card Preview or Scanning State */}
                            {uploadedImgUrl ? (
                              <div style={{
                                width:"100%", height:"100%", position:"relative",
                                opacity: isScanning ? 0.6 : 1, transition:"opacity 0.3s"
                              }}>
                                <img src={uploadedImgUrl} style={{ width:"100%", height:"100%", objectFit:"contain", background:"#0F172A" }} alt="Uploaded pass preview" />
                              </div>
                            ) : (
                              <div style={{ textAlign:"center", color:"#94A3B8", padding:"0 20px" }}>
                                <div style={{ fontSize:32, marginBottom:8 }}>📷</div>
                                <div style={{ fontSize:12, fontWeight:600 }}>No Bus Pass Loaded</div>
                                <div style={{ fontSize:10, color:"#64748B", marginTop:4 }}>Upload or capture your bus pass to begin registration</div>
                              </div>
                            )}
                          </div>

                          {/* Scanner Logs */}
                          {scanLog.length > 0 && (
                            <div style={{
                              background:"#020617", border:"1px solid #1E293B", borderRadius:8,
                              padding:10, fontFamily:"monospace", fontSize:11, color:"#38BDF8",
                              maxHeight:100, overflowY:"auto", display:"flex", flexDirection:"column", gap:4
                            }}>
                              {scanLog.map((l, i) => <div key={i}>{l}</div>)}
                            </div>
                          )}

                          {/* File input / camera capture */}
                          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                            <label style={{
                              display:"flex", alignItems:"center", justifyContent:"center", gap:8,
                              background: isScanning ? "#93C5FD" : "#1D4ED8",
                              borderRadius:10, padding:"14px", color:"#fff", fontSize:14, fontWeight:700,
                              cursor: isScanning ? "not-allowed" : "pointer", fontFamily:"'Inter',sans-serif",
                              boxShadow: "0 4px 12px rgba(29,78,216,0.2)", textAlign:"center", transition:"background 0.2s"
                            }}>
                              📸 Capture / Upload Pass Image
                              <input type="file" accept="image/*" disabled={isScanning} onChange={handleFileUpload} style={{ display:"none" }} />
                            </label>
                          </div>

                          <div style={{ textAlign:"center", marginTop:6 }}>
                            <button type="button" onClick={() => { setMode("login"); setError(""); }} style={{ background:"none", border:"none", color:"#1D4ED8", fontSize:13, fontWeight:600, cursor:"pointer", padding:0, fontFamily:"'Inter',sans-serif" }}>
                              Already have an account? Sign In
                            </button>
                          </div>
                        </div>
                      )}

                      {scanStep === "confirm" && (
                        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
                          {/* Reference card header */}
                          {uploadedImgUrl && (
                            <div style={{
                              width: "100%", height: 130, borderRadius: 10, overflow: "hidden",
                              border: "1px solid #E5E7EB", position: "relative"
                            }}>
                              <img src={uploadedImgUrl} style={{ width: "100%", height: "100%", objectFit: "contain", background: "#0F172A" }} alt="Uploaded reference" />
                              <div style={{
                                position: "absolute", bottom: 6, right: 6, background: "rgba(15,23,42,0.8)",
                                color: "#fff", padding: "3px 8px", borderRadius: 4, fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5
                              }}>
                                Pass Reference Image
                              </div>
                            </div>
                          )}

                          <div style={{ background:"#ECFDF5", border:"1px solid #A7F3D0", borderRadius:10, padding:"12px 14px" }}>
                            <div style={{ fontSize:12, fontWeight:700, color:"#065F46" }}>✅ Pass Loaded Successfully!</div>
                            <div style={{ fontSize:11, color:"#047857", marginTop:2 }}>Fill in your bus pass details below to complete self-registration.</div>
                          </div>

                          {/* Calculated countdown badge */}
                          <div style={{
                            background: getDaysUntilExpiry(scanData.validityMonth, scanData.validityYear) > 0 ? "#EFF6FF" : "#FEF2F2",
                            border: `1px solid ${getDaysUntilExpiry(scanData.validityMonth, scanData.validityYear) > 0 ? "#BFDBFE" : "#FEE2E2"}`,
                            borderRadius:8, padding:10, textAlign:"center"
                          }}>
                            <div style={{ fontSize:11, fontWeight:600, color: getDaysUntilExpiry(scanData.validityMonth, scanData.validityYear) > 0 ? "#1E40AF" : "#991B1B" }}>
                              Calculated Pass Validity:
                            </div>
                            <div style={{ fontSize:14, fontWeight:800, color: getDaysUntilExpiry(scanData.validityMonth, scanData.validityYear) > 0 ? "#2563EB" : "#DC2626", marginTop:2 }}>
                              {getDaysUntilExpiry(scanData.validityMonth, scanData.validityYear) > 0
                                ? `Active (Expires in ${getDaysUntilExpiry(scanData.validityMonth, scanData.validityYear)} days)`
                                : `Expired (${scanData.validityMonth} ${scanData.validityYear})`
                              }
                            </div>
                          </div>

                          <div>
                            <label style={{ fontSize:11, fontWeight:600, color:"#374151", display:"block", marginBottom:4, textTransform:"uppercase" }}>Full Name</label>
                            <input value={scanData.name} onChange={(e) => setScanData({...scanData, name: e.target.value})} style={inp} placeholder="Full Name" />
                          </div>

                          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                            <div>
                              <label style={{ fontSize:11, fontWeight:600, color:"#374151", display:"block", marginBottom:4, textTransform:"uppercase" }}>Program / Course</label>
                              <input value={scanData.program} onChange={(e) => setScanData({...scanData, program: e.target.value})} style={inp} placeholder="e.g. B.Tech CSE" />
                            </div>
                            <div>
                              <label style={{ fontSize:11, fontWeight:600, color:"#374151", display:"block", marginBottom:4, textTransform:"uppercase" }}>Pick Up Stop</label>
                              <input value={scanData.pickupPoint} onChange={(e) => setScanData({...scanData, pickupPoint: e.target.value})} style={inp} placeholder="e.g. Silk Board" />
                            </div>
                          </div>

                          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                            <div>
                              <label style={{ fontSize:11, fontWeight:600, color:"#374151", display:"block", marginBottom:4, textTransform:"uppercase" }}>Validity Month</label>
                              <select value={scanData.validityMonth} onChange={(e) => setScanData({...scanData, validityMonth: e.target.value})} style={{ ...inp, height:44, padding:"0 12px" }}>
                                {["January","February","March","April","May","June","July","August","September","October","November","December"].map(m => (
                                  <option key={m} value={m}>{m}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label style={{ fontSize:11, fontWeight:600, color:"#374151", display:"block", marginBottom:4, textTransform:"uppercase" }}>Validity Year</label>
                              <input type="number" value={scanData.validityYear} onChange={(e) => setScanData({...scanData, validityYear: e.target.value})} style={inp} placeholder="Year" />
                            </div>
                          </div>


                          <div>
                            <label style={{ fontSize:11, fontWeight:600, color:"#374151", display:"block", marginBottom:4, textTransform:"uppercase" }}>Password</label>
                            <div style={{ position:"relative" }}>
                              <input name="password" type={showPwd?"text":"password"} value={form.password} onChange={handleChange} placeholder="Set password (min 6 chars)" style={{ ...inp, paddingRight:44 }} />
                              <button type="button" onClick={() => setShowPwd(p=>!p)} style={{ position:"absolute", right:12, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", cursor:"pointer", fontSize:14, color:"#9CA3AF", padding:0 }}>{showPwd?"🙈":"👁"}</button>
                            </div>
                          </div>

                          {error && <div className="err-shake" style={{ background:"#FEF2F2", border:"1px solid #FECACA", borderRadius:8, padding:"10px 14px" }}><p style={{ color:"#DC2626", fontSize:12, margin:0, fontWeight:500 }}>⚠ {error}</p></div>}

                          <div style={{ display:"grid", gridTemplateColumns:"1fr 2fr", gap:10, marginTop:6 }}>
                            <button type="button" onClick={() => setScanStep("capture")} style={{ width:"100%", background:"#F1F5F9", border:"1px solid #CBD5E1", borderRadius:10, padding:"14px 0", color:"#475569", fontSize:14, fontWeight:700, cursor:"pointer", fontFamily:"'Inter',sans-serif" }}>
                              ← Rescan
                            </button>
                            <button onClick={handleStudentRegister} disabled={loading}
                              style={{ width:"100%", background:loading?"#93C5FD":"#1D4ED8", border:"none", borderRadius:10, padding:"14px 0", color:"#fff", fontSize:14, fontWeight:700, cursor:loading?"not-allowed":"pointer", fontFamily:"'Inter',sans-serif" }}>
                              {loading ? "Creating..." : "Create Profile ✓"}
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {/* STUDENT SIGN IN FLOW */}
                  {role === "student" && mode === "login" && (
                    <>
                      <div>
                        <label style={{ fontSize:11, fontWeight:600, color:"#374151", letterSpacing:"0.3px", display:"block", marginBottom:6, textTransform:"uppercase" }}>Username</label>
                        <input name="username" value={form.username} onChange={handleChange} placeholder="e.g. john123 or AU2024001" style={inp} autoCapitalize="none" autoCorrect="off" />
                      </div>
                      <div>
                        <label style={{ fontSize:11, fontWeight:600, color:"#374151", letterSpacing:"0.3px", display:"block", marginBottom:6, textTransform:"uppercase" }}>Password</label>
                        <div style={{ position:"relative" }}>
                          <input name="password" type={showPwd?"text":"password"} value={form.password} onChange={handleChange} placeholder="••••••••" style={{ ...inp, paddingRight:44 }} />
                          <button type="button" onClick={() => setShowPwd(p=>!p)} style={{ position:"absolute", right:12, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", cursor:"pointer", fontSize:14, color:"#9CA3AF", padding:0 }}>{showPwd?"🙈":"👁"}</button>
                        </div>
                      </div>
                      {error && <div className="err-shake" style={{ background:"#FEF2F2", border:"1px solid #FECACA", borderRadius:8, padding:"10px 14px" }}><p style={{ color:"#DC2626", fontSize:12, margin:0, fontWeight:500 }}>⚠ {error}</p></div>}
                      <button onClick={handleUserLogin} disabled={loading}
                        style={{ width:"100%", background:loading?"#93C5FD":"#1D4ED8", border:"none", borderRadius:10, padding:"14px 0", color:"#fff", fontSize:14, fontWeight:700, cursor:loading?"not-allowed":"pointer", fontFamily:"'Inter',sans-serif" }}>
                        {loading ? "Please wait..." : "Sign In →"}
                      </button>
                      <div style={{ textAlign:"center", marginTop:10 }}>
                        <button type="button" onClick={() => { setMode("register"); setScanStep("capture"); setSelectedPass(null); setError(""); }} style={{ background:"none", border:"none", color:"#1D4ED8", fontSize:13, fontWeight:600, cursor:"pointer", padding:0, fontFamily:"'Inter',sans-serif" }}>
                          New Student? Scan Bus Pass to Register
                        </button>
                      </div>
                    </>
                  )}

                  {/* TEACHER FORM */}
                  {role === "teacher" && (
                    <>
                      {mode === "register" && (
                        <>
                          <div>
                            <label style={{ fontSize:11, fontWeight:600, color:"#374151", letterSpacing:"0.3px", display:"block", marginBottom:6, textTransform:"uppercase" }}>Full Name</label>
                            <input name="name" value={form.name||""} onChange={handleChange} placeholder="e.g. Prof. Nair" style={inp} />
                            {form.name && form.name.trim().length >= 3 && (
                              <div style={{ fontSize:11, color:"#10B981", marginTop:5, fontWeight:600, display:"flex", alignItems:"center", gap:4 }}>
                                🔑 Assigned Login Username: <span style={{ fontFamily:"monospace", background:"#ECFDF5", padding:"2px 6px", borderRadius:4, border:"1px solid #A7F3D0" }}>{generateCleanUsername(form.name)}</span>
                              </div>
                            )}
                          </div>
                          <div>
                            <label style={{ fontSize:11, fontWeight:600, color:"#374151", letterSpacing:"0.3px", display:"block", marginBottom:6, textTransform:"uppercase" }}>Pick Up Stop</label>
                            <input name="pickupPoint" value={form.pickupPoint||""} onChange={handleChange} placeholder="e.g. Silk Board Junction" style={inp} />
                          </div>
                        </>
                      )}
                      {mode === "login" && (
                        <div>
                          <label style={{ fontSize:11, fontWeight:600, color:"#374151", letterSpacing:"0.3px", display:"block", marginBottom:6, textTransform:"uppercase" }}>Username</label>
                          <input name="username" value={form.username} onChange={handleChange} placeholder="e.g. prof.nair or AU-FAC-992" style={inp} autoCapitalize="none" autoCorrect="off" />
                          <div style={{ fontSize:11, color:"#9CA3AF", marginTop:5 }}>Enter your university-assigned faculty username</div>
                        </div>
                      )}
                      <div>
                        <label style={{ fontSize:11, fontWeight:600, color:"#374151", letterSpacing:"0.3px", display:"block", marginBottom:6, textTransform:"uppercase" }}>Password</label>
                        <div style={{ position:"relative" }}>
                          <input name="password" type={showPwd?"text":"password"} value={form.password} onChange={handleChange} placeholder="••••••••" style={{ ...inp, paddingRight:44 }} />
                          <button type="button" onClick={() => setShowPwd(p=>!p)} style={{ position:"absolute", right:12, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", cursor:"pointer", fontSize:14, color:"#9CA3AF", padding:0 }}>{showPwd?"🙈":"👁"}</button>
                        </div>
                      </div>
                      {error && <div className="err-shake" style={{ background:"#FEF2F2", border:"1px solid #FECACA", borderRadius:8, padding:"10px 14px" }}><p style={{ color:"#DC2626", fontSize:12, margin:0, fontWeight:500 }}>⚠ {error}</p></div>}
                      <button onClick={handleUserLogin} disabled={loading}
                        style={{ width:"100%", background:loading?"#93C5FD":"#1D4ED8", border:"none", borderRadius:10, padding:"14px 0", color:"#fff", fontSize:14, fontWeight:700, cursor:loading?"not-allowed":"pointer", fontFamily:"'Inter',sans-serif" }}>
                        {loading ? "Please wait..." : mode === "login" ? "Sign In →" : "Create Account →"}
                      </button>
                      <div style={{ textAlign:"center", marginTop:10 }}>
                        <button type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }} style={{ background:"none", border:"none", color:"#1D4ED8", fontSize:13, fontWeight:600, cursor:"pointer", padding:0, fontFamily:"'Inter',sans-serif" }}>
                          {mode === "login" ? "Don't have an account? Register" : "Already have an account? Sign In"}
                        </button>
                      </div>
                    </>
                  )}
                  {/* ADMIN FORM */}
                  {role === "admin" && (
                    <>
                      <div>
                        <label style={{ fontSize:11, fontWeight:600, color:"#374151", letterSpacing:"0.3px", display:"block", marginBottom:6, textTransform:"uppercase" }}>Admin Username</label>
                        <input name="username" value={form.username} onChange={handleChange} placeholder="e.g. admin" style={inp} autoCapitalize="none" autoCorrect="off" />
                        <div style={{ fontSize:11, color:"#9CA3AF", marginTop:5 }}>Enter your administrative console username</div>
                      </div>
                      <div>
                        <label style={{ fontSize:11, fontWeight:600, color:"#374151", letterSpacing:"0.3px", display:"block", marginBottom:6, textTransform:"uppercase" }}>Password</label>
                        <div style={{ position:"relative" }}>
                          <input name="password" type={showPwd?"text":"password"} value={form.password} onChange={handleChange} placeholder="••••••••" style={{ ...inp, paddingRight:44 }} />
                          <button type="button" onClick={() => setShowPwd(p=>!p)} style={{ position:"absolute", right:12, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", cursor:"pointer", fontSize:14, color:"#9CA3AF", padding:0 }}>{showPwd?"🙈":"👁"}</button>
                        </div>
                      </div>
                      {error && <div className="err-shake" style={{ background:"#FEF2F2", border:"1px solid #FECACA", borderRadius:8, padding:"10px 14px" }}><p style={{ color:"#DC2626", fontSize:12, margin:0, fontWeight:500 }}>⚠ {error}</p></div>}
                      <button onClick={handleUserLogin} disabled={loading}
                        style={{ width:"100%", background:loading?"#FCA5A5":"#EF4444", border:"none", borderRadius:10, padding:"14px 0", color:"#fff", fontSize:14, fontWeight:700, cursor:loading?"not-allowed":"pointer", fontFamily:"'Inter',sans-serif", boxShadow: `0 4px 12px #EF444433` }}>
                        {loading ? "Please wait..." : "Sign In to Admin Console →"}
                      </button>
                    </>
                  )}

                </div>
              </div>

              {/* Support box */}
              <div style={{ marginTop:14, padding:"12px 14px", background:"#F8FAFC", border:"1px solid #E2E8F0", borderRadius:10, display:"flex", gap:10, alignItems:"flex-start" }}>
                <span style={{ fontSize:13, flexShrink:0 }}>🛟</span>
                <div style={{ fontSize:12, color:"#64748B", lineHeight:1.6 }}>
                  <strong style={{ color:"#475569" }}>Login issues?</strong> Contact your transport admin to reset your credentials or create an account. Your username is assigned by the admin office.
                </div>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Bus strip */}
      <div style={{ position:"fixed", bottom:0, left:0, right:0, height:64, pointerEvents:"none", overflow:"hidden" }}>
        <div style={{ position:"absolute", bottom:0, left:0, right:0, height:28, background:"#fff", borderTop:"1px solid #E5E7EB" }}/>
        {Array.from({length:14}).map((_, i) => (
          <div key={i} style={{ position:"absolute", bottom:12, left:`${i*8}%`, width:"5%", height:2, background:"#E5E7EB", borderRadius:2, animation:`roadDash ${isDriving?"0.3s":"1s"} linear infinite`, animationDelay:`${i*-0.07}s` }}/>
        ))}
        <div style={{ position:"absolute", bottom:24, animation:isDriving?"busLoop 2s linear forwards":"busIdle 2s ease-in-out infinite", left:isDriving?undefined:"38%" }}>
          <div style={{ position:"relative" }}>
            {[0,1,2].map(i => (
              <div key={i} style={{ position:"absolute", top:16, left:-14-i*9, width:isDriving?10:7, height:isDriving?10:7, background:"#D1D5DB", borderRadius:"50%", animation:`exhaustPuff ${isDriving?"0.45s":"1s"} ease-out infinite`, animationDelay:`${i*0.16}s` }}/>
            ))}
            <div style={{ width:100, height:40, background:"#FF5A1F", borderRadius:"9px 9px 3px 3px", position:"relative" }}>
              {[6,26,46,66].map((l, i) => (
                <div key={i} style={{ position:"absolute", top:7, left:l, width:14, height:11, background:"rgba(0,0,0,0.25)", borderRadius:2 }}/>
              ))}
              <div style={{ position:"absolute", bottom:0, left:0, right:0, height:10, background:"rgba(0,0,0,0.15)", borderRadius:"0 0 3px 3px" }}/>
              <div style={{ position:"absolute", top:0, left:0, right:0, height:6, background:"rgba(255,255,255,0.15)", borderRadius:"9px 9px 0 0" }}/>
            </div>
            <div style={{ position:"absolute", top:3, right:-12, width:14, height:32, background:"#E84E17", borderRadius:"0 7px 3px 0" }}>
              <div style={{ position:"absolute", top:7, right:2, width:6, height:6, background:"#FEF08A", borderRadius:"50%", animation:"headlightPulse 1.5s ease-in-out infinite" }}/>
            </div>
            {[8,72].map((l, i) => (
              <div key={i} style={{ position:"absolute", bottom:-10, left:l, width:20, height:20, background:"#1F2937", border:"2px solid #374151", borderRadius:"50%", animation:`spinWheel ${isDriving?"0.18s":"0.5s"} linear infinite` }}>
                <div style={{ position:"absolute", inset:3, background:"#374151", borderRadius:"50%" }}/>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
