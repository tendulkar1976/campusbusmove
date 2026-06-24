import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { db, auth } from "../firebase";
import { getDoc, doc, setDoc } from "firebase/firestore";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink } from "firebase/auth";
import { useTheme } from "../context/ThemeContext";

const ADMIN_EMAIL    = "gamethunder83@gmail.com";
const ADMIN_PASSWORD = "gamethunder83";

function isCollegeEmail(e) { return e.toLowerCase().endsWith("@ced.alliance.edu.in")||e.toLowerCase().endsWith("@alliance.edu.in"); }
function isPersonalEmail(e) { return ["gmail.com","yahoo.com","outlook.com","hotmail.com","icloud.com"].some(d=>e.toLowerCase().endsWith(d)); }

const ROLES = [
  { id:"student", label:"Student",  sub:"Alliance University email required",  icon:"🎓", color:"#3B82F6" },
  { id:"teacher", label:"Faculty",  sub:"Personal email (Gmail, Outlook)",      icon:"👨‍🏫", color:"#8B5CF6" },
  { id:"driver",  label:"Driver",   sub:"Phone number & password",              icon:"🚌", color:"#F59E0B" },
];

export default function Login() {
  const navigate = useNavigate();
  const { dark, toggle } = useTheme();

  const [step, setStep]           = useState("role");
  const [role, setRole]           = useState(null);
  const [mode, setMode]           = useState("login");
  const [form, setForm]           = useState({ name:"", email:"", phone:"", password:"", campusId:"alliance-bangalore" });
  const [error, setError]         = useState("");
  const [loading, setLoading]     = useState(false);
  const [showPwd, setShowPwd]     = useState(false);
  const [emailLinkSent, setEmailLinkSent] = useState(false);
  const [mounted, setMounted]     = useState(false);
  const [busPhase, setBusPhase]   = useState("idle");

  useEffect(() => {
    setTimeout(() => setMounted(true), 80);
    setTimeout(() => setBusPhase("driving"), 400);
    setTimeout(() => setBusPhase("idle"), 2800);
    if (isSignInWithEmailLink(auth, window.location.href)) {
      const savedEmail  = localStorage.getItem("cm_email_link");
      const savedRole   = localStorage.getItem("cm_pending_role") || "student";
      const savedName   = localStorage.getItem("cm_pending_name") || "";
      const savedCampus = localStorage.getItem("cm_pending_campus") || "alliance-bangalore";
      if (savedEmail) {
        signInWithEmailLink(auth, savedEmail, window.location.href).then(async cred => {
          const snap = await getDoc(doc(db, "users", cred.user.uid));
          if (!snap.exists()) await setDoc(doc(db, "users", cred.user.uid), { name:savedName, email:savedEmail, role:savedRole, campusId:savedCampus, createdAt:Date.now() });
          const r = snap.exists() ? snap.data().role : savedRole;
          navigate(r === "admin" ? "/admin" : r === "driver" ? "/driver" : "/student");
        }).catch(() => setError("Email link expired. Please try again."));
      }
    }
  }, []);

  function handleChange(e) { setForm({ ...form, [e.target.name]: e.target.value }); setError(""); }

  async function sendEmailLink() {
    setError(""); setLoading(true);
    const email = form.email.trim();
    if (!email) { setError("Enter your email first."); setLoading(false); return; }
    if (role === "student" && !isCollegeEmail(email)) { setError("Use your Alliance University email."); setLoading(false); return; }
    if (role === "teacher" && !isPersonalEmail(email)) { setError("Use a personal email (Gmail etc.)"); setLoading(false); return; }
    try {
      await sendSignInLinkToEmail(auth, email, { url:"https://campusbusmove.vercel.app/login", handleCodeInApp:true });
      localStorage.setItem("cm_email_link", email);
      localStorage.setItem("cm_pending_role", role);
      localStorage.setItem("cm_pending_name", form.name);
      localStorage.setItem("cm_pending_campus", form.campusId);
      setEmailLinkSent(true);
    } catch { setError("Failed to send email link."); } finally { setLoading(false); }
  }

  async function handleEmailLogin() {
    setError(""); setLoading(true); setBusPhase("driving");
    const email = form.email.trim();
    if (email === ADMIN_EMAIL && form.password === ADMIN_PASSWORD) {
      try {
        await signInWithEmailAndPassword(auth, email, form.password);
        setTimeout(() => navigate("/admin"), 600);
        return;
      } catch { setError("Admin login failed."); setLoading(false); setBusPhase("idle"); return; }
    }
    if (role === "student" && !isCollegeEmail(email)) { setError("Use your Alliance University email."); setLoading(false); setBusPhase("idle"); return; }
    if (role === "teacher" && !isPersonalEmail(email)) { setError("Use a personal email."); setLoading(false); setBusPhase("idle"); return; }
    try {
      if (mode === "login") {
        const cred = await signInWithEmailAndPassword(auth, email, form.password);
        const snap = await getDoc(doc(db, "users", cred.user.uid));
        if (!snap.exists()) { setError("Account not found. Please register."); setLoading(false); setBusPhase("idle"); return; }
        const r = snap.data().role;
        setTimeout(() => navigate(r === "admin" ? "/admin" : r === "driver" ? "/driver" : "/student"), 600);
      } else {
        const cred = await createUserWithEmailAndPassword(auth, email, form.password);
        await setDoc(doc(db, "users", cred.user.uid), { name:form.name, email, role, campusId:form.campusId, createdAt:Date.now() });
        setTimeout(() => navigate("/student"), 600);
      }
    } catch (err) {
      const c = err.code;
      if (c === "auth/wrong-password" || c === "auth/invalid-credential") setError("Incorrect password.");
      else if (c === "auth/user-not-found") setError("No account found. Please register.");
      else if (c === "auth/email-already-in-use") setError("Email already registered. Sign in instead.");
      else if (c === "auth/weak-password") setError("Password must be at least 6 characters.");
      else if (c === "auth/invalid-email") setError("Invalid email address.");
      else if (c === "auth/too-many-requests") setError("Too many attempts. Please try again later.");
      else setError(err.message.replace("Firebase:", "").replace(/\(auth.*\)/, "").trim());
      setBusPhase("idle");
    } finally { setLoading(false); }
  }

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
        navigate("/driver");
      } else {
        const cred = await createUserWithEmailAndPassword(auth, virtualEmail, form.password);
        await setDoc(doc(db, "users", cred.user.uid), { name:form.name || "Driver", phone:"+91"+form.phone.trim(), role:"driver", campusId:"alliance-bangalore", createdAt:Date.now() });
        navigate("/driver");
      }
    } catch (err) {
      const c = err.code;
      if (c === "auth/wrong-password" || c === "auth/invalid-credential") setError("Incorrect password.");
      else if (c === "auth/user-not-found") setError("No account found. Register first.");
      else if (c === "auth/email-already-in-use") setError("Phone already registered. Sign in instead.");
      else if (c === "auth/weak-password") setError("Password must be at least 6 characters.");
      else setError(err.message.replace("Firebase:", "").replace(/\(auth.*\)/, "").trim());
      setBusPhase("idle");
    } finally { setLoading(false); }
  }

  const roleObj = ROLES.find(r => r.id === role);
  const isDriving = busPhase === "driving";

  const inp = {
    width: "100%",
    background: "#F8F9FA",
    border: "1.5px solid #E5E7EB",
    borderRadius: 10,
    padding: "13px 16px",
    color: "#111",
    fontSize: 14,
    boxSizing: "border-box",
    fontFamily: "'Inter', sans-serif",
    transition: "border-color 0.15s",
    outline: "none",
  };

  return (
    <div style={{ minHeight:"100vh", background:"#F1F5F9", display:"flex", flexDirection:"column", fontFamily:"'Inter', sans-serif", position:"relative", overflow:"hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
        @keyframes fadeUp { from { opacity:0; transform:translateY(16px) } to { opacity:1; transform:translateY(0) } }
        @keyframes busLoop { 0% { left:-140px } 100% { left:110vw } }
        @keyframes busIdle { 0%,100% { transform:translateY(0) } 50% { transform:translateY(-3px) } }
        @keyframes roadDash { from { transform:translateX(0) } to { transform:translateX(-12vw) } }
        @keyframes spinWheel { from { transform:rotate(0deg) } to { transform:rotate(360deg) } }
        @keyframes headlightPulse { 0%,100% { opacity:0.6 } 50% { opacity:1 } }
        @keyframes exhaustPuff { 0% { opacity:0.5; transform:scale(0.4) translateX(0) } 100% { opacity:0; transform:scale(2) translateX(-28px) } }
        @keyframes shake { 0%,100% { transform:translateX(0) } 25% { transform:translateX(-5px) } 75% { transform:translateX(5px) } }
        input:focus { border-color:#2563EB !important; box-shadow:0 0 0 3px rgba(37,99,235,0.1) !important; }
        input::placeholder { color:#9CA3AF; }
        .err-shake { animation: shake 0.35s ease; }
        .role-card:hover { border-color:#2563EB !important; background:#EFF6FF !important; }
        .role-card:hover .role-arrow { color:#2563EB !important; }
      `}</style>

      {/* Top nav bar */}
      <div style={{ background:"#fff", borderBottom:"1px solid #E5E7EB", padding:"0 24px", height:56, display:"flex", alignItems:"center", justifyContent:"space-between", position:"sticky", top:0, zIndex:10 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:32, height:32, background:"#FF5A1F", borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>🚌</div>
          <div>
            <div style={{ fontSize:14, fontWeight:700, color:"#111", letterSpacing:"-0.3px" }}>CampusMove</div>
            <div style={{ fontSize:10, color:"#FF5A1F", fontWeight:600, letterSpacing:"0.8px", textTransform:"uppercase", lineHeight:1 }}>Alliance University</div>
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <div style={{ fontSize:12, color:"#6B7280", background:"#F3F4F6", borderRadius:6, padding:"4px 10px", fontWeight:500 }}>Secure Login</div>
        </div>
      </div>

      {/* Main content */}
      <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", padding:"24px 16px 100px" }}>
        <div style={{ width:"100%", maxWidth:400, opacity:mounted?1:0, animation:mounted?"fadeUp 0.4s ease forwards":"none" }}>

          {/* STEP 1 — Role selection */}
          {step === "role" && (
            <div>
              <div style={{ marginBottom:28 }}>
                <div style={{ fontSize:11, fontWeight:600, color:"#6B7280", letterSpacing:"1px", textTransform:"uppercase", marginBottom:8 }}>Welcome to CampusMove</div>
                <h1 style={{ fontSize:28, fontWeight:800, color:"#0F172A", margin:0, letterSpacing:"-0.5px", lineHeight:1.2 }}>Sign in to your<br/>account</h1>
                <p style={{ color:"#6B7280", fontSize:14, margin:"10px 0 0", lineHeight:1.5 }}>Select your role to get started</p>
              </div>

              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {ROLES.map((r, i) => (
                  <button
                    key={r.id}
                    className="role-card"
                    onClick={() => { setRole(r.id); setStep("form"); setError(""); }}
                    style={{
                      display:"flex", alignItems:"center", gap:14,
                      padding:"16px 18px",
                      background:"#fff",
                      border:"1.5px solid #E5E7EB",
                      borderRadius:12,
                      cursor:"pointer",
                      fontFamily:"'Inter',sans-serif",
                      textAlign:"left",
                      transition:"all 0.15s",
                      animation:`fadeUp 0.35s ease ${i*0.07}s both`,
                    }}
                  >
                    <div style={{ width:42, height:42, borderRadius:10, background:`${r.color}15`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>
                      {r.icon}
                    </div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:15, fontWeight:700, color:"#0F172A" }}>{r.label}</div>
                      <div style={{ fontSize:12, color:"#9CA3AF", marginTop:2 }}>{r.sub}</div>
                    </div>
                    <div className="role-arrow" style={{ color:"#D1D5DB", fontSize:18, fontWeight:300 }}>›</div>
                  </button>
                ))}
              </div>

              <div style={{ marginTop:20, padding:"14px 16px", background:"#FFF7ED", border:"1px solid #FED7AA", borderRadius:10, display:"flex", gap:10, alignItems:"flex-start" }}>
                <span style={{ fontSize:14, flexShrink:0 }}>ℹ️</span>
                <div style={{ fontSize:12, color:"#92400E", lineHeight:1.5 }}>
                  This portal is for <strong>Alliance University</strong> members only. Contact your transport office for access.
                </div>
              </div>
            </div>
          )}

          {/* STEP 2 — Form */}
          {step === "form" && !emailLinkSent && (
            <div style={{ animation:"fadeUp 0.35s ease forwards" }}>
              <button
                onClick={() => { setStep("role"); setError(""); }}
                style={{ display:"flex", alignItems:"center", gap:6, background:"none", border:"none", color:"#6B7280", fontSize:13, fontWeight:500, cursor:"pointer", fontFamily:"'Inter',sans-serif", marginBottom:22, padding:0 }}
              >
                ← Back
              </button>

              {/* Role badge */}
              <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:20 }}>
                <div style={{ width:38, height:38, borderRadius:9, background:`${roleObj?.color}15`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>
                  {roleObj?.icon}
                </div>
                <div>
                  <div style={{ fontSize:18, fontWeight:800, color:"#0F172A", letterSpacing:"-0.3px" }}>
                    {mode === "login" ? "Sign in" : "Create account"}
                  </div>
                  <div style={{ fontSize:12, color:"#9CA3AF" }}>{roleObj?.label} · {roleObj?.sub}</div>
                </div>
              </div>

              {/* Mode toggle */}
              <div style={{ display:"flex", background:"#F1F5F9", borderRadius:10, padding:3, marginBottom:20, border:"1px solid #E5E7EB" }}>
                {["login","register"].map(m => (
                  <button key={m} onClick={() => { setMode(m); setError(""); }}
                    style={{ flex:1, padding:"9px 0", border:"none", borderRadius:7, cursor:"pointer", fontSize:13, fontWeight:600, fontFamily:"'Inter',sans-serif", background:mode===m?"#fff":"transparent", color:mode===m?"#0F172A":"#9CA3AF", boxShadow:mode===m?"0 1px 3px rgba(0,0,0,0.1)":"none", transition:"all 0.15s" }}>
                    {m === "login" ? "Sign In" : "Register"}
                  </button>
                ))}
              </div>

              {/* Form card */}
              <div style={{ background:"#fff", border:"1px solid #E5E7EB", borderRadius:14, padding:"20px", boxShadow:"0 1px 4px rgba(0,0,0,0.06)" }}>
                <div style={{ display:"flex", flexDirection:"column", gap:14 }}>

                  {role === "driver" ? (
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
                          <input name="phone" value={form.phone} onChange={handleChange} placeholder="9876543210" maxLength={10} type="tel" style={{ ...inp, paddingLeft:56 }} />
                        </div>
                      </div>
                      <div>
                        <label style={{ fontSize:11, fontWeight:600, color:"#374151", letterSpacing:"0.3px", display:"block", marginBottom:6, textTransform:"uppercase" }}>Password</label>
                        <div style={{ position:"relative" }}>
                          <input name="password" type={showPwd?"text":"password"} value={form.password} onChange={handleChange} placeholder="••••••••" style={{ ...inp, paddingRight:44 }} />
                          <button type="button" onClick={() => setShowPwd(p => !p)} style={{ position:"absolute", right:12, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", cursor:"pointer", fontSize:14, color:"#9CA3AF", padding:0 }}>{showPwd?"🙈":"👁"}</button>
                        </div>
                      </div>
                      {error && (
                        <div className="err-shake" style={{ background:"#FEF2F2", border:"1px solid #FECACA", borderRadius:8, padding:"10px 14px" }}>
                          <p style={{ color:"#DC2626", fontSize:12, margin:0, fontWeight:500 }}>⚠ {error}</p>
                        </div>
                      )}
                      <button onClick={handleDriverLogin} disabled={loading}
                        style={{ width:"100%", background:loading?"#93C5FD":"#1D4ED8", border:"none", borderRadius:10, padding:"14px 0", color:"#fff", fontSize:14, fontWeight:700, cursor:loading?"not-allowed":"pointer", fontFamily:"'Inter',sans-serif", transition:"background 0.15s" }}>
                        {loading ? "Please wait..." : mode === "login" ? "Sign In →" : "Create Account →"}
                      </button>
                    </>
                  ) : (
                    <>
                      {mode === "register" && (
                        <div>
                          <label style={{ fontSize:11, fontWeight:600, color:"#374151", letterSpacing:"0.3px", display:"block", marginBottom:6, textTransform:"uppercase" }}>Full Name</label>
                          <input name="name" value={form.name} onChange={handleChange} placeholder="Your full name" style={inp} />
                        </div>
                      )}
                      <div>
                        <label style={{ fontSize:11, fontWeight:600, color:"#374151", letterSpacing:"0.3px", display:"block", marginBottom:6, textTransform:"uppercase" }}>
                          {role === "student" ? "University Email" : "Personal Email"}
                        </label>
                        <input name="email" type="email" value={form.email} onChange={handleChange}
                          placeholder={role === "student" ? "you@ced.alliance.edu.in" : "you@gmail.com"} style={inp} />
                      </div>
                      <div>
                        <label style={{ fontSize:11, fontWeight:600, color:"#374151", letterSpacing:"0.3px", display:"block", marginBottom:6, textTransform:"uppercase" }}>Password</label>
                        <div style={{ position:"relative" }}>
                          <input name="password" type={showPwd?"text":"password"} value={form.password} onChange={handleChange} placeholder="••••••••" style={{ ...inp, paddingRight:44 }} />
                          <button type="button" onClick={() => setShowPwd(p => !p)} style={{ position:"absolute", right:12, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", cursor:"pointer", fontSize:14, color:"#9CA3AF", padding:0 }}>{showPwd?"🙈":"👁"}</button>
                        </div>
                      </div>
                      {error && (
                        <div className="err-shake" style={{ background:"#FEF2F2", border:"1px solid #FECACA", borderRadius:8, padding:"10px 14px" }}>
                          <p style={{ color:"#DC2626", fontSize:12, margin:0, fontWeight:500 }}>⚠ {error}</p>
                        </div>
                      )}
                      <button onClick={handleEmailLogin} disabled={loading}
                        style={{ width:"100%", background:loading?"#93C5FD":"#1D4ED8", border:"none", borderRadius:10, padding:"14px 0", color:"#fff", fontSize:14, fontWeight:700, cursor:loading?"not-allowed":"pointer", fontFamily:"'Inter',sans-serif", transition:"background 0.15s" }}>
                        {loading ? "Please wait..." : mode === "login" ? "Sign In →" : "Create Account →"}
                      </button>
                      <div style={{ textAlign:"center", paddingTop:4, borderTop:"1px solid #F3F4F6" }}>
                        <span style={{ color:"#9CA3AF", fontSize:12 }}>or </span>
                        <button onClick={sendEmailLink} disabled={loading}
                          style={{ background:"none", border:"none", color:"#2563EB", fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"'Inter',sans-serif" }}>
                          Sign in with email link
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <p style={{ textAlign:"center", fontSize:11, color:"#9CA3AF", marginTop:14 }}>
                By continuing, you agree to CampusMove's terms of use.
              </p>
            </div>
          )}

          {/* EMAIL LINK SENT */}
          {emailLinkSent && (
            <div style={{ animation:"fadeUp 0.4s ease forwards", textAlign:"center" }}>
              <div style={{ width:60, height:60, background:"#EFF6FF", borderRadius:16, display:"flex", alignItems:"center", justifyContent:"center", fontSize:28, margin:"0 auto 16px" }}>📧</div>
              <h2 style={{ color:"#0F172A", fontSize:20, fontWeight:800, marginBottom:8 }}>Check your inbox</h2>
              <p style={{ color:"#6B7280", fontSize:14, lineHeight:1.6 }}>We've sent a sign-in link to<br/><span style={{ color:"#2563EB", fontWeight:600 }}>{form.email}</span></p>
              <p style={{ color:"#9CA3AF", fontSize:12, marginTop:10 }}>Click the link in the email to sign in. No password needed.</p>
              <button onClick={() => { setEmailLinkSent(false); setError(""); }}
                style={{ marginTop:20, background:"none", border:"1.5px solid #E5E7EB", borderRadius:10, padding:"10px 20px", color:"#374151", fontSize:13, fontWeight:500, cursor:"pointer", fontFamily:"'Inter',sans-serif" }}>
                ← Use password instead
              </button>
            </div>
          )}

        </div>
      </div>

      {/* Animated bus strip */}
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
