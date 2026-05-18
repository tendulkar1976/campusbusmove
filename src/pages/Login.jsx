import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { db, auth } from "../firebase";
import { getDoc, doc, setDoc } from "firebase/firestore";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";

const CAMPUSES = [{ id: "alliance-bangalore", name: "Alliance University, Bangalore" }];

export default function Login() {
  const navigate = useNavigate();
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "student", campusId: "alliance-bangalore" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [particles, setParticles] = useState([]);
  const [formVisible, setFormVisible] = useState(false);
  const [busPhase, setBusPhase] = useState("idle");
  const busRef = useRef(null);

  useEffect(() => {
    const pts = Array.from({ length: 55 }, (_, i) => ({
      id: i, left: Math.random() * 100, top: Math.random() * 85,
      size: Math.random() * 1.8 + 0.8,
      duration: 2 + Math.random() * 3,
      delay: Math.random() * 4,
      opacity: Math.random() * 0.35 + 0.1,
    }));
    setParticles(pts);
    setTimeout(() => setFormVisible(true), 200);
    setTimeout(() => setBusPhase("driving"), 600);
    setTimeout(() => setBusPhase("idle"), 3200);
  }, []);

  function handleChange(e) { setForm({ ...form, [e.target.name]: e.target.value }); }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(""); setLoading(true);
    setBusPhase("driving");
    try {
      if (mode === "login") {
        const cred = await signInWithEmailAndPassword(auth, form.email, form.password);
        const snap = await getDoc(doc(db, "users", cred.user.uid));
        if (!snap.exists()) { setError("No account found. Please register."); setLoading(false); setBusPhase("idle"); return; }
        const role = snap.data().role;
        setTimeout(() => {
          if (role === "admin") navigate("/admin");
          else if (role === "driver") navigate("/driver");
          else navigate("/student");
        }, 800);
      } else {
        const cred = await createUserWithEmailAndPassword(auth, form.email, form.password);
        await setDoc(doc(db, "users", cred.user.uid), { name: form.name, email: form.email, role: form.role, campusId: form.campusId, createdAt: Date.now() });
        setTimeout(() => {
          if (form.role === "admin") navigate("/admin");
          else if (form.role === "driver") navigate("/driver");
          else navigate("/student");
        }, 800);
      }
    } catch (err) {
      const code = err.code;
      if (code === "auth/wrong-password" || code === "auth/invalid-credential") {
        setError("Wrong password. Please try again.");
      } else if (code === "auth/user-not-found") {
        setError("No account found with this email.");
      } else if (code === "auth/invalid-email") {
        setError("Please enter a valid email address.");
      } else if (code === "auth/too-many-requests") {
        setError("Too many attempts. Please try again later.");
      } else if (code === "auth/email-already-in-use") {
        setError("Email already registered. Please sign in.");
      } else if (code === "auth/weak-password") {
        setError("Password must be at least 6 characters.");
      } else {
        setError(err.message.replace("Firebase: ", "").replace(/\(auth.*\)/, "").trim());
      }
      setLoading(false);
      setBusPhase("idle");
    }
  }

  const isDriving = busPhase === "driving";

  return (
    <div style={{ minHeight: "100vh", background: "#0A0A0A", display: "flex", flexDirection: "column", fontFamily: "'DM Sans', sans-serif", position: "relative", overflow: "hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&display=swap');
        @keyframes twinkle { 0%,100%{opacity:0.1} 50%{opacity:0.9} }
        @keyframes slideUp { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
        @keyframes fadeIn { from{opacity:0} to{opacity:1} }
        @keyframes busLoop { 0%{left:-120px} 100%{left:110vw} }
        @keyframes busIdle { 0%,100%{transform:translateY(0px)} 50%{transform:translateY(-3px)} }
        @keyframes roadDash { from{transform:translateX(0)} to{transform:translateX(-12vw)} }
        @keyframes spinWheel { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes exhaustPuff { 0%{opacity:0.6;transform:scale(0.4) translateX(0)} 100%{opacity:0;transform:scale(2.5) translateX(-30px)} }
        @keyframes headlightPulse { 0%,100%{box-shadow:0 0 4px rgba(255,224,102,0.3)} 50%{box-shadow:0 0 12px rgba(255,224,102,0.7), 8px 0 30px rgba(255,224,102,0.2)} }
        @keyframes shake { 0%,100%{transform:translateX(0)} 20%,60%{transform:translateX(-6px)} 40%,80%{transform:translateX(6px)} }
        input:focus { border-color: #FF5A1F !important; box-shadow: 0 0 0 3px rgba(255,90,31,0.1) !important; outline: none; }
        input::placeholder { color: #252525; }
        select option { background: #111; }
        button:active { transform: scale(0.98); }
        .error-box { animation: shake 0.4s ease; }
      `}</style>

      {/* Stars */}
      {particles.map(p => (
        <div key={p.id} style={{ position: "absolute", left: `${p.left}%`, top: `${p.top}%`, width: p.size, height: p.size, background: "#fff", borderRadius: "50%", opacity: p.opacity, animation: `twinkle ${p.duration}s ease-in-out ${p.delay}s infinite`, pointerEvents: "none" }} />
      ))}

      {/* Grid */}
      <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(255,90,31,0.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,90,31,0.025) 1px,transparent 1px)", backgroundSize: "44px 44px", pointerEvents: "none" }} />

      {/* Orange glow */}
      <div style={{ position: "absolute", top: -80, left: "50%", transform: "translateX(-50%)", width: 500, height: 320, background: "radial-gradient(ellipse, rgba(255,90,31,0.07) 0%, transparent 70%)", pointerEvents: "none" }} />

      {/* Header */}
      <div style={{ padding: "24px 28px 0", display: "flex", alignItems: "center", gap: 10, animation: "fadeIn 0.8s ease forwards" }}>
        <div style={{ width: 36, height: 36, background: "#FF5A1F", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, boxShadow: "0 0 20px rgba(255,90,31,0.25)" }}>🚌</div>
        <div>
          <div style={{ color: "#fff", fontWeight: 600, fontSize: 16, letterSpacing: "-0.3px" }}>CampusMove</div>
          <div style={{ color: "#FF5A1F", fontSize: 10, fontWeight: 600, letterSpacing: "1.2px", textTransform: "uppercase" }}>Live Bus Tracking</div>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 24px 100px" }}>
        <div style={{ maxWidth: 380, width: "100%", margin: "0 auto" }}>

          {/* Heading */}
          <div style={{ marginBottom: 28, opacity: formVisible ? 1 : 0, animation: formVisible ? "slideUp 0.5s ease forwards" : "none" }}>
            <h1 style={{ color: "#fff", fontSize: 34, fontWeight: 600, letterSpacing: "-1.2px", margin: "0 0 8px", lineHeight: 1.1 }}>
              {mode === "login" ? <>Welcome<br /><span style={{ color: "#FF5A1F" }}>back.</span></> : <>Join<br /><span style={{ color: "#FF5A1F" }}>CampusMove.</span></>}
            </h1>
            <p style={{ color: "#2A2A2A", fontSize: 14, margin: 0 }}>
              {mode === "login" ? "Sign in to track your campus bus live" : "Create your campus transport account"}
            </p>
          </div>

          {/* Card */}
          <div style={{ background: "rgba(12,12,12,0.95)", border: "1px solid #161616", borderRadius: 20, padding: 24, backdropFilter: "blur(20px)", opacity: formVisible ? 1 : 0, animation: formVisible ? "slideUp 0.6s ease 0.1s forwards" : "none" }}>

            {/* Toggle */}
            <div style={{ display: "flex", background: "#070707", borderRadius: 12, padding: 3, marginBottom: 22, border: "1px solid #111" }}>
              {["login", "register"].map(m => (
                <button key={m} onClick={() => { setMode(m); setError(""); }} style={{ flex: 1, padding: "10px 0", border: "none", borderRadius: 9, cursor: "pointer", fontSize: 13, fontWeight: 500, fontFamily: "'DM Sans', sans-serif", background: mode === m ? "#FF5A1F" : "transparent", color: mode === m ? "#fff" : "#333", transition: "all 0.2s", boxShadow: mode === m ? "0 2px 14px rgba(255,90,31,0.35)" : "none" }}>
                  {m === "login" ? "Sign In" : "Register"}
                </button>
              ))}
            </div>

            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {mode === "register" && (
                <div>
                  <label style={{ color: "#333", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1px", display: "block", marginBottom: 6 }}>Full Name</label>
                  <input name="name" value={form.name} onChange={handleChange} placeholder="Your full name" required
                    style={{ width: "100%", background: "#0A0A0A", border: "1px solid #161616", borderRadius: 11, padding: "13px 16px", color: "#fff", fontSize: 14, boxSizing: "border-box", fontFamily: "'DM Sans', sans-serif", transition: "all 0.2s" }} />
                </div>
              )}
              <div>
                <label style={{ color: "#333", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1px", display: "block", marginBottom: 6 }}>Email</label>
                <input name="email" type="email" value={form.email} onChange={handleChange} placeholder="you@university.edu" required
                  style={{ width: "100%", background: "#0A0A0A", border: "1px solid #161616", borderRadius: 11, padding: "13px 16px", color: "#fff", fontSize: 14, boxSizing: "border-box", fontFamily: "'DM Sans', sans-serif", transition: "all 0.2s" }} />
              </div>
              <div>
                <label style={{ color: "#333", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1px", display: "block", marginBottom: 6 }}>Password</label>
                <div style={{ position: "relative" }}>
                  <input name="password" type={showPwd ? "text" : "password"} value={form.password} onChange={handleChange} placeholder="••••••••" required
                    style={{ width: "100%", background: "#0A0A0A", border: `1px solid ${error && error.toLowerCase().includes("password") ? "#F87171" : "#161616"}`, borderRadius: 11, padding: "13px 46px 13px 16px", color: "#fff", fontSize: 14, boxSizing: "border-box", fontFamily: "'DM Sans', sans-serif", transition: "all 0.2s" }} />
                  <button type="button" onClick={() => setShowPwd(p => !p)} style={{ position: "absolute", right: 13, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", fontSize: 15, color: "#2A2A2A", padding: 0, transition: "color 0.2s" }}
                    onMouseEnter={e => e.target.style.color = "#FF5A1F"} onMouseLeave={e => e.target.style.color = "#2A2A2A"}>
                    {showPwd ? "🙈" : "👁"}
                  </button>
                </div>
              </div>

              {mode === "register" && (
                <>
                  <div>
                    <label style={{ color: "#333", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1px", display: "block", marginBottom: 6 }}>I am a</label>
                    <div style={{ display: "flex", gap: 6 }}>
                      {["student", "driver", "admin"].map(r => (
                        <button key={r} type="button" onClick={() => setForm({ ...form, role: r })} style={{ flex: 1, padding: "11px 0", borderRadius: 10, cursor: "pointer", fontSize: 11, fontWeight: 600, fontFamily: "'DM Sans', sans-serif", border: `1px solid ${form.role === r ? "#FF5A1F" : "#161616"}`, background: form.role === r ? "#130B06" : "#0A0A0A", color: form.role === r ? "#FF5A1F" : "#333", transition: "all 0.2s" }}>
                          {r === "student" ? "🎓 Student" : r === "driver" ? "🚌 Driver" : "⚙️ Admin"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label style={{ color: "#333", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1px", display: "block", marginBottom: 6 }}>Campus</label>
                    <select name="campusId" value={form.campusId} onChange={handleChange}
                      style={{ width: "100%", background: "#0A0A0A", border: "1px solid #161616", borderRadius: 11, padding: "13px 16px", color: "#fff", fontSize: 14, boxSizing: "border-box", fontFamily: "'DM Sans', sans-serif" }}>
                      {CAMPUSES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                </>
              )}

              {error && (
                <div className="error-box" style={{ background: "#0F0606", border: "1px solid #2A1010", borderRadius: 10, padding: "11px 14px", display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 16 }}>⚠️</span>
                  <p style={{ color: "#F87171", fontSize: 12, margin: 0, fontWeight: 500 }}>{error}</p>
                </div>
              )}

              <button type="submit" disabled={loading} style={{ width: "100%", background: loading ? "#1A0E06" : "#FF5A1F", border: "none", borderRadius: 12, padding: "15px 0", color: loading ? "#663311" : "#fff", fontSize: 15, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer", fontFamily: "'DM Sans', sans-serif", marginTop: 2, transition: "all 0.25s", boxShadow: loading ? "none" : "0 4px 22px rgba(255,90,31,0.3)" }}
                onMouseEnter={e => { if (!loading) e.target.style.boxShadow = "0 6px 30px rgba(255,90,31,0.55)"; }}
                onMouseLeave={e => { if (!loading) e.target.style.boxShadow = "0 4px 22px rgba(255,90,31,0.3)"; }}>
                {loading ? "Signing in..." : mode === "login" ? "Sign In →" : "Create Account →"}
              </button>
            </form>
          </div>
          <p style={{ textAlign: "center", color: "#141414", fontSize: 11, marginTop: 18 }}>Admin access via invite only</p>
        </div>
      </div>

      {/* === ANIMATED BUS SCENE === */}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 72, pointerEvents: "none", overflow: "hidden" }}>
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 30, background: "#0D0D0D", borderTop: "1px solid #141414" }} />
        {Array.from({length: 14}).map((_, i) => (
          <div key={i} style={{ position: "absolute", bottom: 13, left: `${i * 8}%`, width: "5%", height: 3, background: "#161616", borderRadius: 2, animation: `roadDash ${isDriving ? "0.35s" : "1.1s"} linear infinite`, animationDelay: `${i * -0.08}s`, transition: "animation-duration 0.4s" }} />
        ))}
        <div ref={busRef} style={{ position: "absolute", bottom: 26, animation: isDriving ? "busLoop 2.2s linear forwards" : "busIdle 2s ease-in-out infinite", left: isDriving ? undefined : "38%" }}>
          <div style={{ position: "relative" }}>
            {[0,1,2,3].map(i => (
              <div key={i} style={{ position: "absolute", top: 20, left: -18 - i*11, width: isDriving ? 13 : 9, height: isDriving ? 13 : 9, background: "#161616", borderRadius: "50%", animation: `exhaustPuff ${isDriving ? "0.5s" : "1s"} ease-out infinite`, animationDelay: `${i*0.18}s` }} />
            ))}
            <div style={{ position: "absolute", top: 4, left: -13, width: 16, height: 34, background: "#E84E17", borderRadius: "8px 0 0 4px" }}>
              <div style={{ position: "absolute", top: 8, left: 3, width: 7, height: 7, background: "#FFE066", borderRadius: "50%", animation: "headlightPulse 1.5s ease-in-out infinite" }} />
            </div>
            <div style={{ width: 110, height: 44, background: "#FF5A1F", borderRadius: "10px 10px 4px 4px", position: "relative", boxShadow: "0 4px 20px rgba(255,90,31,0.25)" }}>
              {[8,30,52,74].map((l,i) => (
                <div key={i} style={{ position: "absolute", top: 8, left: l, width: 16, height: 12, background: "#0A0A0A", borderRadius: 3, opacity: 0.85 }} />
              ))}
              <div style={{ position: "absolute", top: 7, right: 10, width: 13, height: 24, background: "#0A0A0A", borderRadius: "3px 3px 0 0" }} />
              <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 12, background: "#CC4518", borderRadius: "0 0 4px 4px" }} />
              <div style={{ position: "absolute", top: 0, left: 8, right: 8, height: 3, background: "#E84E17", borderRadius: 2 }} />
            </div>
            {[10, 80].map((l,i) => (
              <div key={i} style={{ position: "absolute", bottom: -11, left: l, width: 22, height: 22, background: "#0A0A0A", border: "2px solid #222", borderRadius: "50%", animation: `spinWheel ${isDriving ? "0.2s" : "0.5s"} linear infinite`, transition: "animation-duration 0.3s" }}>
                <div style={{ position: "absolute", inset: 3, background: "#111", border: "1px solid #2A2A2A", borderRadius: "50%" }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
