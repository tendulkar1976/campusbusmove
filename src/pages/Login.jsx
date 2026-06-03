import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { db, auth } from "../firebase";
import { getDoc, doc, setDoc } from "firebase/firestore";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
} from "firebase/auth";

// ============================================================
// SECRET ADMIN CREDENTIALS — REPLACE THESE
const ADMIN_EMAIL = "gamethunder83@gmail.com";
const ADMIN_PASSWORD = "gamethunder83";
// ============================================================

const CAMPUSES = [{ id: "alliance-bangalore", name: "Alliance University, Bangalore" }];

function isCollegeEmail(email) {
  return email.toLowerCase().endsWith("@ced.alliance.edu.in") || 
         email.toLowerCase().endsWith("alliance.edu.in");
}

function isPersonalEmail(email) {
  const personal = ["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com"];
  return personal.some(d => email.toLowerCase().endsWith(d));
}

const ROLE_CONFIG = {
  student: { icon: "🎓", label: "Student", color: "#60A5FA", bg: "#0A1020", border: "#1A3060", hint: "Use your college email (.edu.in)" },
  teacher: { icon: "👨‍🏫", label: "Teacher", color: "#A78BFA", bg: "#1A0F2A", border: "#2D1F55", hint: "Use your personal email (Gmail etc.)" },
  driver: { icon: "🚌", label: "Driver", color: "#FF5A1F", bg: "#150D09", border: "#3D1F0A", hint: "Use your phone number & password" },
};

export default function Login() {
  const navigate = useNavigate();
  const [step, setStep] = useState("role");
  const [role, setRole] = useState(null);
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "", campusId: "alliance-bangalore" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [emailLinkSent, setEmailLinkSent] = useState(false);
  const [particles, setParticles] = useState([]);
  const [formVisible, setFormVisible] = useState(false);
  const [busPhase, setBusPhase] = useState("idle");

  useEffect(() => {
    const pts = Array.from({ length: 55 }, (_, i) => ({
      id: i, left: Math.random() * 100, top: Math.random() * 85,
      size: Math.random() * 1.8 + 0.8, duration: 2 + Math.random() * 3,
      delay: Math.random() * 4, opacity: Math.random() * 0.35 + 0.1,
    }));
    setParticles(pts);
    setTimeout(() => setFormVisible(true), 200);
    setTimeout(() => setBusPhase("driving"), 600);
    setTimeout(() => setBusPhase("idle"), 3200);

    // Handle email link sign-in on return
    if (isSignInWithEmailLink(auth, window.location.href)) {
      const savedEmail = localStorage.getItem("cm_email_link");
      const savedRole = localStorage.getItem("cm_pending_role") || "student";
      const savedName = localStorage.getItem("cm_pending_name") || "";
      const savedCampus = localStorage.getItem("cm_pending_campus") || "alliance-bangalore";
      if (savedEmail) {
        signInWithEmailLink(auth, savedEmail, window.location.href).then(async cred => {
          const snap = await getDoc(doc(db, "users", cred.user.uid));
          if (!snap.exists()) {
            await setDoc(doc(db, "users", cred.user.uid), {
              name: savedName, email: savedEmail, role: savedRole,
              campusId: savedCampus, createdAt: Date.now(),
            });
          }
          const r = snap.exists() ? snap.data().role : savedRole;
          if (r === "admin") navigate("/admin");
          else if (r === "driver") navigate("/driver");
          else navigate("/student");
        }).catch(() => setError("Email link expired. Please try again."));
      }
    }
  }, []);

  function handleChange(e) { setForm({ ...form, [e.target.name]: e.target.value }); setError(""); }
  function selectRole(r) { setRole(r); setStep("form"); setError(""); }

  // Email link for student/teacher
  async function sendEmailLink() {
    setError(""); setLoading(true);
    const email = form.email.trim();
    if (!email) { setError("Enter your email first."); setLoading(false); return; }
    if (role === "student" && !isCollegeEmail(email)) {
      setError("Students must use college email (.edu.in)");
      setLoading(false); return;
    }
    if (role === "teacher" && !isPersonalEmail(email)) {
      setError("Teachers must use personal email (Gmail, Yahoo, etc.)");
      setLoading(false); return;
    }
    try {
      await sendSignInLinkToEmail(auth, email, {
        url: "https://campusbusmove.vercel.app/login",
        handleCodeInApp: true,
      });
      localStorage.setItem("cm_email_link", email);
      localStorage.setItem("cm_pending_role", role);
      localStorage.setItem("cm_pending_name", form.name);
      localStorage.setItem("cm_pending_campus", form.campusId);
      setEmailLinkSent(true);
    } catch (err) {
      setError("Failed to send email link. Try again.");
    } finally { setLoading(false); }
  }

  // Student/Teacher email+password
  async function handleEmailLogin() {
    setError(""); setLoading(true); setBusPhase("driving");
    const email = form.email.trim();

    // Secret admin bypass — works from any role
    if (email === ADMIN_EMAIL && form.password === ADMIN_PASSWORD) {
      try {
        const cred = await signInWithEmailAndPassword(auth, email, form.password);
        const snap = await getDoc(doc(db, "users", cred.user.uid));
        if (!snap.exists()) {
          await setDoc(doc(db, "users", cred.user.uid), {
            name: "Admin", email: ADMIN_EMAIL, role: "admin",
            campusId: "alliance-bangalore", createdAt: Date.now(),
          });
        }
        navigate("/admin"); return;
      } catch (e) {
        setError("Admin login failed. Check credentials.");
        setLoading(false); setBusPhase("idle"); return;
      }
    }

    if (role === "student" && !isCollegeEmail(email)) {
      setError("Students must use college email (.edu.in)");
      setLoading(false); setBusPhase("idle"); return;
    }
    if (role === "teacher" && !isPersonalEmail(email)) {
      setError("Teachers must use personal email (Gmail, Yahoo, etc.)");
      setLoading(false); setBusPhase("idle"); return;
    }
    try {
      if (mode === "login") {
        const cred = await signInWithEmailAndPassword(auth, email, form.password);
        const snap = await getDoc(doc(db, "users", cred.user.uid));
        if (!snap.exists()) { setError("Account not found. Please register."); setLoading(false); setBusPhase("idle"); return; }
        const r = snap.data().role;
        setTimeout(() => {
          if (r === "admin") navigate("/admin");
          else if (r === "driver") navigate("/driver");
          else navigate("/student");
        }, 600);
      } else {
        const cred = await createUserWithEmailAndPassword(auth, email, form.password);
        await setDoc(doc(db, "users", cred.user.uid), {
          name: form.name, email, role, campusId: form.campusId, createdAt: Date.now(),
        });
        setTimeout(() => navigate("/student"), 600);
      }
    } catch (err) {
      const code = err.code;
      if (code === "auth/wrong-password" || code === "auth/invalid-credential") setError("Wrong password. Please try again.");
      else if (code === "auth/user-not-found") setError("No account found with this email.");
      else if (code === "auth/email-already-in-use") setError("Email already registered. Please sign in.");
      else if (code === "auth/weak-password") setError("Password must be at least 6 characters.");
      else if (code === "auth/invalid-email") setError("Please enter a valid email address.");
      else if (code === "auth/too-many-requests") setError("Too many attempts. Try again later.");
      else setError(err.message.replace("Firebase: ", "").replace(/\(auth.*\)/, "").trim());
      setBusPhase("idle");
    } finally { setLoading(false); }
  }

  // Driver phone+password login
  async function handleDriverLogin() {
    setError(""); setLoading(true); setBusPhase("driving");
    if (!form.phone || form.phone.length < 10) { setError("Enter a valid 10-digit phone number."); setLoading(false); setBusPhase("idle"); return; }
    if (!form.password || form.password.length < 6) { setError("Password must be at least 6 characters."); setLoading(false); setBusPhase("idle"); return; }
    const virtualEmail = form.phone.trim() + "@campusmove.driver";
    try {
      if (mode === "login") {
        const cred = await signInWithEmailAndPassword(auth, virtualEmail, form.password);
        const snap = await getDoc(doc(db, "users", cred.user.uid));
        if (!snap.exists()) { setError("Account not found. Please register first."); setLoading(false); setBusPhase("idle"); return; }
        navigate("/driver");
      } else {
        const cred = await createUserWithEmailAndPassword(auth, virtualEmail, form.password);
        await setDoc(doc(db, "users", cred.user.uid), {
          name: form.name || "Driver", phone: "+91" + form.phone.trim(),
          role: "driver", campusId: "alliance-bangalore", createdAt: Date.now(),
        });
        navigate("/driver");
      }
    } catch (err) {
      const code = err.code;
      if (code === "auth/wrong-password" || code === "auth/invalid-credential") setError("Wrong password. Please try again.");
      else if (code === "auth/user-not-found") setError("No driver account found. Please register first.");
      else if (code === "auth/email-already-in-use") setError("Phone number already registered. Please sign in.");
      else if (code === "auth/weak-password") setError("Password must be at least 6 characters.");
      else setError(err.message.replace("Firebase: ", "").replace(/\(auth.*\)/, "").trim());
      setBusPhase("idle");
    } finally { setLoading(false); }
  }

  const isDriving = busPhase === "driving";

  return (
    <div style={{ minHeight: "100vh", background: "#0A0A0A", display: "flex", flexDirection: "column", fontFamily: "'DM Sans', sans-serif", position: "relative", overflow: "hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&display=swap');
        @keyframes twinkle { 0%,100%{opacity:0.1} 50%{opacity:0.9} }
        @keyframes slideUp { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
        @keyframes fadeIn { from{opacity:0} to{opacity:1} }
        @keyframes busLoop { 0%{left:-140px} 100%{left:110vw} }
        @keyframes busIdle { 0%,100%{transform:translateY(0px)} 50%{transform:translateY(-3px)} }
        @keyframes roadDash { from{transform:translateX(0)} to{transform:translateX(-12vw)} }
        @keyframes spinWheel { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes exhaustPuff { 0%{opacity:0.6;transform:scale(0.4) translateX(0)} 100%{opacity:0;transform:scale(2.5) translateX(-30px)} }
        @keyframes headlightPulse { 0%,100%{box-shadow:0 0 4px rgba(255,224,102,0.3)} 50%{box-shadow:0 0 12px rgba(255,224,102,0.7),8px 0 30px rgba(255,224,102,0.2)} }
        @keyframes shake { 0%,100%{transform:translateX(0)} 20%,60%{transform:translateX(-6px)} 40%,80%{transform:translateX(6px)} }
        input:focus { border-color: #FF5A1F !important; box-shadow: 0 0 0 3px rgba(255,90,31,0.1) !important; outline: none; }
        input::placeholder { color: #252525; }
        select option { background: #111; }
        .error-shake { animation: shake 0.4s ease; }
      `}</style>

      {/* Stars */}
      {particles.map(p => (
        <div key={p.id} style={{ position: "absolute", left: `${p.left}%`, top: `${p.top}%`, width: p.size, height: p.size, background: "#fff", borderRadius: "50%", opacity: p.opacity, animation: `twinkle ${p.duration}s ease-in-out ${p.delay}s infinite`, pointerEvents: "none" }} />
      ))}
      <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(255,90,31,0.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,90,31,0.025) 1px,transparent 1px)", backgroundSize: "44px 44px", pointerEvents: "none" }} />
      <div style={{ position: "absolute", top: -80, left: "50%", transform: "translateX(-50%)", width: 500, height: 320, background: "radial-gradient(ellipse, rgba(255,90,31,0.07) 0%, transparent 70%)", pointerEvents: "none" }} />

      {/* Header */}
      <div style={{ padding: "24px 28px 0", display: "flex", alignItems: "center", gap: 10, animation: "fadeIn 0.8s ease forwards" }}>
        <div style={{ width: 36, height: 36, background: "#FF5A1F", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, boxShadow: "0 0 20px rgba(255,90,31,0.25)" }}>🚌</div>
        <div>
          <div style={{ color: "#333", fontWeight: 600, fontSize: 16, letterSpacing: "-0.3px" }}>CampusMove</div>
          <div style={{ color: "#FF5A1F", fontSize: 10, fontWeight: 600, letterSpacing: "1.2px", textTransform: "uppercase" }}>Live Bus Tracking</div>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 24px 100px" }}>
        <div style={{ maxWidth: 380, width: "100%", margin: "0 auto" }}>

          {/* STEP 1 — Role Selection */}
          {step === "role" && (
            <div style={{ opacity: formVisible ? 1 : 0, animation: formVisible ? "slideUp 0.5s ease forwards" : "none" }}>
              <h1 style={{ color: "#333", fontSize: 32, fontWeight: 600, letterSpacing: "-1px", margin: "0 0 8px", lineHeight: 1.1 }}>
                Who are<br /><span style={{ color: "#FF5A1F" }}>you?</span>
              </h1>
              <p style={{ color: "#333", fontSize: 14, margin: "0 0 28px" }}>Select your role to continue</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {Object.entries(ROLE_CONFIG).map(([r, cfg]) => (
                  <button key={r} onClick={() => selectRole(r)} style={{ display: "flex", alignItems: "center", gap: 16, padding: "18px 20px", background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: 16, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", transition: "all 0.2s", textAlign: "left" }}
                    onMouseEnter={e => e.currentTarget.style.transform = "scale(1.02)"}
                    onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}>
                    <div style={{ width: 44, height: 44, borderRadius: 12, background: "#0A0A0A", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, flexShrink: 0 }}>{cfg.icon}</div>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 600, color: cfg.color, letterSpacing: "-0.3px" }}>{cfg.label}</div>
                      <div style={{ fontSize: 11, color: "#333", marginTop: 3 }}>{cfg.hint}</div>
                    </div>
                    <div style={{ marginLeft: "auto", color: "#333", fontSize: 18 }}>›</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* STEP 2 — Form */}
          {step === "form" && !emailLinkSent && (
            <div style={{ animation: "slideUp 0.4s ease forwards" }}>
              <button onClick={() => { setStep("role"); setError(""); }} style={{ background: "none", border: "none", color: "#333", fontSize: 13, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", marginBottom: 20, padding: 0 }}>← Back</button>

              <h1 style={{ color: "#333", fontSize: 30, fontWeight: 600, letterSpacing: "-1px", margin: "0 0 6px", lineHeight: 1.1 }}>
                {mode === "login" ? "Welcome back" : "Create account"}
                <span style={{ color: ROLE_CONFIG[role]?.color }}> {ROLE_CONFIG[role]?.icon}</span>
              </h1>
              <p style={{ color: "#333", fontSize: 13, margin: "0 0 24px" }}>
                {role === "driver" ? "Enter your phone number & password" : role === "student" ? "Use your college email (.edu.in)" : "Use your personal email"}
              </p>

              {/* Mode toggle */}
              <div style={{ display: "flex", background: "#070707", borderRadius: 12, padding: 3, marginBottom: 20, border: "1px solid #111" }}>
                {["login", "register"].map(m => (
                  <button key={m} onClick={() => { setMode(m); setError(""); }} style={{ flex: 1, padding: "10px 0", border: "none", borderRadius: 9, cursor: "pointer", fontSize: 13, fontWeight: 500, fontFamily: "'DM Sans', sans-serif", background: mode === m ? "#FF5A1F" : "transparent", color: mode === m ? "#fff" : "#fff", transition: "all 0.2s", boxShadow: mode === m ? "0 2px 14px rgba(255,90,31,0.35)" : "none" }}>
                    {m === "login" ? "Sign In" : "Register"}
                  </button>
                ))}
              </div>

              <div style={{ background: "rgba(12,12,12,0.95)", border: "1px solid #161616", borderRadius: 20, padding: 20, backdropFilter: "blur(20px)" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

                  {/* DRIVER FORM */}
                  {role === "driver" && (
                    <>
                      {mode === "register" && (
                        <div>
                          <label style={{ color: "#333", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1px", display: "block", marginBottom: 6 }}>Full Name</label>
                          <input name="name" value={form.name} onChange={handleChange} placeholder="Driver name"
                            style={{ width: "100%", background: "#0A0A0A", border: "1px solid #161616", borderRadius: 11, padding: "13px 16px", color: "#333", fontSize: 14, boxSizing: "border-box", fontFamily: "'DM Sans', sans-serif" }} />
                        </div>
                      )}
                      <div>
                        <label style={{ color: "#333", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1px", display: "block", marginBottom: 6 }}>Phone Number</label>
                        <div style={{ position: "relative" }}>
                          <div style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "#333", fontSize: 14, fontWeight: 600 }}>+91</div>
                          <input name="phone" value={form.phone} onChange={handleChange} placeholder="9876543210" maxLength={10} type="tel"
                            style={{ width: "100%", background: "#0A0A0A", border: "1px solid #161616", borderRadius: 11, padding: "13px 16px 13px 48px", color: "#333", fontSize: 14, boxSizing: "border-box", fontFamily: "'DM Sans', sans-serif", letterSpacing: "1px" }} />
                        </div>
                      </div>
                      <div>
                        <label style={{ color: "#333", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1px", display: "block", marginBottom: 6 }}>Password</label>
                        <div style={{ position: "relative" }}>
                          <input name="password" type={showPwd ? "text" : "password"} value={form.password} onChange={handleChange} placeholder="••••••••"
                            style={{ width: "100%", background: "#0A0A0A", border: "1px solid #161616", borderRadius: 11, padding: "13px 46px 13px 16px", color: "#333", fontSize: 14, boxSizing: "border-box", fontFamily: "'DM Sans', sans-serif" }} />
                          <button type="button" onClick={() => setShowPwd(p => !p)} style={{ position: "absolute", right: 13, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", fontSize: 15, color: "#333", padding: 0 }}
                            onMouseEnter={e => e.target.style.color = "#FF5A1F"} onMouseLeave={e => e.target.style.color = "#fff"}>
                            {showPwd ? "🙈" : "👁"}
                          </button>
                        </div>
                      </div>
                      {error && <div className="error-shake" style={{ background: "#0F0606", border: "1px solid #2A1010", borderRadius: 10, padding: "11px 14px" }}><p style={{ color: "#F87171", fontSize: 12, margin: 0 }}>⚠️ {error}</p></div>}
                      <button onClick={handleDriverLogin} disabled={loading} style={{ width: "100%", background: loading ? "#1A0E06" : "#FF5A1F", border: "none", borderRadius: 12, padding: "15px 0", color: "#333", fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", boxShadow: "0 4px 22px rgba(255,90,31,0.3)" }}>
                        {loading ? "Please wait..." : mode === "login" ? "Sign In →" : "Create Account →"}
                      </button>
                    </>
                  )}

                  {/* STUDENT / TEACHER FORM */}
                  {role !== "driver" && (
                    <>
                      {mode === "register" && (
                        <div>
                          <label style={{ color: "#333", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1px", display: "block", marginBottom: 6 }}>Full Name</label>
                          <input name="name" value={form.name} onChange={handleChange} placeholder="Your full name" required
                            style={{ width: "100%", background: "#0A0A0A", border: "1px solid #161616", borderRadius: 11, padding: "13px 16px", color: "#333", fontSize: 14, boxSizing: "border-box", fontFamily: "'DM Sans', sans-serif" }} />
                        </div>
                      )}
                      <div>
                        <label style={{ color: "#333", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1px", display: "block", marginBottom: 6 }}>
                          {role === "student" ? "College Email" : "Personal Email"}
                        </label>
                        <input name="email" type="email" value={form.email} onChange={handleChange}
                          placeholder={role === "student" ? "College ID" : "you@gmail.com"}
                          style={{ width: "100%", background: "#0A0A0A", border: "1px solid #161616", borderRadius: 11, padding: "13px 16px", color: "#333", fontSize: 14, boxSizing: "border-box", fontFamily: "'DM Sans', sans-serif" }} />
                      </div>
                      <div>
                        <label style={{ color: "#333", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1px", display: "block", marginBottom: 6 }}>Password</label>
                        <div style={{ position: "relative" }}>
                          <input name="password" type={showPwd ? "text" : "password"} value={form.password} onChange={handleChange} placeholder="••••••••"
                            style={{ width: "100%", background: "#0A0A0A", border: `1px solid ${error && error.toLowerCase().includes("password") ? "#F87171" : "#161616"}`, borderRadius: 11, padding: "13px 46px 13px 16px", color: "#333", fontSize: 14, boxSizing: "border-box", fontFamily: "'DM Sans', sans-serif" }} />
                          <button type="button" onClick={() => setShowPwd(p => !p)} style={{ position: "absolute", right: 13, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", fontSize: 15, color: "#333", padding: 0 }}
                            onMouseEnter={e => e.target.style.color = "#FF5A1F"} onMouseLeave={e => e.target.style.color = "#fff"}>
                            {showPwd ? "🙈" : "👁"}
                          </button>
                        </div>
                      </div>
                      {error && <div className="error-shake" style={{ background: "#0F0606", border: "1px solid #2A1010", borderRadius: 10, padding: "11px 14px" }}><p style={{ color: "#F87171", fontSize: 12, margin: 0 }}>⚠️ {error}</p></div>}
                      <button onClick={handleEmailLogin} disabled={loading} style={{ width: "100%", background: loading ? "#1A0E06" : "#FF5A1F", border: "none", borderRadius: 12, padding: "15px 0", color: "#333", fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", boxShadow: "0 4px 22px rgba(255,90,31,0.3)" }}>
                        {loading ? "Please wait..." : mode === "login" ? "Sign In →" : "Create Account →"}
                      </button>
                      <div style={{ textAlign: "center" }}>
                        <span style={{ color: "#333", fontSize: 11 }}>or </span>
                        <button onClick={sendEmailLink} disabled={loading} style={{ background: "none", border: "none", color: "#FF5A1F", fontSize: 11, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", textDecoration: "underline" }}>
                          Sign in with email link (OTP-free)
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* EMAIL LINK SENT */}
          {emailLinkSent && (
            <div style={{ animation: "slideUp 0.4s ease forwards", textAlign: "center" }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>📧</div>
              <h2 style={{ color: "#333", fontSize: 22, fontWeight: 600, marginBottom: 8 }}>Check your email</h2>
              <p style={{ color: "#333", fontSize: 14, lineHeight: 1.6 }}>We sent a sign-in link to<br /><span style={{ color: "#FF5A1F" }}>{form.email}</span></p>
              <p style={{ color: "#333", fontSize: 12, marginTop: 16 }}>Click the link in your email to sign in instantly. No password needed.</p>
              <button onClick={() => { setEmailLinkSent(false); setError(""); }} style={{ marginTop: 20, background: "none", border: "1px solid #161616", borderRadius: 10, padding: "10px 20px", color: "#333", fontSize: 13, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>
                Use password instead
              </button>
            </div>
          )}
        </div>
      </div>

      {/* === ANIMATED BUS — facing RIGHT === */}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 72, pointerEvents: "none", overflow: "hidden" }}>
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 30, background: "#0D0D0D", borderTop: "1px solid #141414" }} />
        {Array.from({ length: 14 }).map((_, i) => (
          <div key={i} style={{ position: "absolute", bottom: 13, left: `${i * 8}%`, width: "5%", height: 3, background: "#161616", borderRadius: 2, animation: `roadDash ${isDriving ? "0.35s" : "1.1s"} linear infinite`, animationDelay: `${i * -0.08}s` }} />
        ))}
        <div style={{ position: "absolute", bottom: 26, animation: isDriving ? "busLoop 2.2s linear forwards" : "busIdle 2s ease-in-out infinite", left: isDriving ? undefined : "38%" }}>
          <div style={{ position: "relative" }}>
            {[0, 1, 2, 3].map(i => (
              <div key={i} style={{ position: "absolute", top: 20, left: -18 - i * 11, width: isDriving ? 13 : 9, height: isDriving ? 13 : 9, background: "#161616", borderRadius: "50%", animation: `exhaustPuff ${isDriving ? "0.5s" : "1s"} ease-out infinite`, animationDelay: `${i * 0.18}s` }} />
            ))}
            <div style={{ width: 110, height: 44, background: "#FF5A1F", borderRadius: "10px 10px 4px 4px", position: "relative", boxShadow: "0 4px 20px rgba(255,90,31,0.25)" }}>
              {[8, 30, 52, 74].map((l, i) => (
                <div key={i} style={{ position: "absolute", top: 8, left: l, width: 16, height: 12, background: "#0A0A0A", borderRadius: 3, opacity: 0.85 }} />
              ))}
              <div style={{ position: "absolute", top: 7, left: 10, width: 13, height: 24, background: "#0A0A0A", borderRadius: "3px 3px 0 0" }} />
              <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 12, background: "#CC4518", borderRadius: "0 0 4px 4px" }} />
              <div style={{ position: "absolute", top: 0, left: 8, right: 8, height: 3, background: "#E84E17", borderRadius: 2 }} />
            </div>
            <div style={{ position: "absolute", top: 4, right: -13, width: 16, height: 34, background: "#E84E17", borderRadius: "0 8px 4px 0" }}>
              <div style={{ position: "absolute", top: 8, right: 3, width: 7, height: 7, background: "#FFE066", borderRadius: "50%", animation: "headlightPulse 1.5s ease-in-out infinite" }} />
            </div>
            {[10, 80].map((l, i) => (
              <div key={i} style={{ position: "absolute", bottom: -11, left: l, width: 22, height: 22, background: "#0A0A0A", border: "2px solid #222", borderRadius: "50%", animation: `spinWheel ${isDriving ? "0.2s" : "0.5s"} linear infinite` }}>
                <div style={{ position: "absolute", inset: 3, background: "#111", border: "1px solid #fff", borderRadius: "50%" }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
