import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { db, auth } from "../firebase";
import { getDoc, doc, setDoc } from "firebase/firestore";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";

const CAMPUSES = [{ id: "alliance-bangalore", name: "Alliance University, Bangalore" }];

function AnimatedBus() {
  return (
    <div style={{ 
      position: "absolute", 
      bottom: 0, 
      left: 0, 
      right: 0, 
      height: 90, 
      overflow: "hidden", 
      pointerEvents: "none" 
    }}>
      {/* Road */}
      <div style={{ 
        position: "absolute", 
        bottom: 0, 
        left: 0, 
        right: 0, 
        height: 32, 
        background: "#0D0D0D",
        borderTop: "3px solid #1F1F1F"
      }} />

      {/* Road dashes */}
      {[0,1,2,3,4,5,6,7,8,9,10].map(i => (
        <div 
          key={i} 
          style={{
            position: "absolute", 
            bottom: 13, 
            left: `${i * 11}%`, 
            width: "7.5%", 
            height: 4, 
            background: "#FF8A4D", 
            borderRadius: 3, 
            animation: `roadMove 1.6s linear infinite`, 
            animationDelay: `${i * -0.16}s`,
          }} 
        />
      ))}

      {/* Moving Bus */}
      <div style={{
        position: "absolute",
        bottom: 22,
        left: "-18%",
        animation: "busDrive 16s linear infinite",
        animationDelay: "0.8s"
      }}>
        {/* Bus Body */}
        <div style={{ 
          width: 96, 
          height: 42, 
          background: "#FF5A1F", 
          borderRadius: "12px 12px 6px 6px", 
          position: "relative",
          boxShadow: "0 10px 25px rgba(0,0,0,0.7)"
        }}>
          {/* Windows */}
          {[11, 29, 47, 65].map((l, i) => (
            <div 
              key={i} 
              style={{
                position: "absolute", 
                top: 9, 
                left: l, 
                width: 13.5, 
                height: 13, 
                background: "#0F172A", 
                borderRadius: 2 
              }} 
            />
          ))}
          
          {/* Bottom stripe */}
          <div style={{ 
            position: "absolute", 
            bottom: 0, 
            left: 0, 
            right: 0, 
            height: 11, 
            background: "#E84E17", 
            borderRadius: "0 0 6px 6px" 
          }} />

          {/* Headlight */}
          <div style={{ 
            position: "absolute", 
            top: 13, 
            left: -14, 
            width: 18, 
            height: 13, 
            background: "#FEF08C", 
            borderRadius: "50% 30% 30% 50%", 
            boxShadow: "0 0 14px #FEF08C",
            animation: "glow 1.4s ease-in-out infinite"
          }} />
        </div>

        {/* Wheels */}
        {[14, 70].map((pos, i) => (
          <div 
            key={i}
            style={{
              position: "absolute",
              bottom: -11,
              left: pos,
              width: 20,
              height: 20,
              background: "#111",
              border: "3px solid #222",
              borderRadius: "50%",
              animation: "wheelSpin 0.55s linear infinite"
            }}
          >
            <div style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              width: 9,
              height: 9,
              background: "#333",
              borderRadius: "50%"
            }} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Login() {
  const navigate = useNavigate();
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "student", campusId: "alliance-bangalore" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [particles, setParticles] = useState([]);
  const [mounted, setMounted] = useState(false);
  const [formVisible, setFormVisible] = useState(false);

  useEffect(() => {
    const pts = Array.from({ length: 60 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      top: Math.random() * 100,
      size: Math.random() * 2 + 1,
      duration: 2 + Math.random() * 4,
      delay: Math.random() * 4,
      opacity: Math.random() * 0.4 + 0.1,
    }));
    setParticles(pts);
    setTimeout(() => setMounted(true), 100);
    setTimeout(() => setFormVisible(true), 400);
  }, []);

  function handleChange(e) { 
    setForm({ ...form, [e.target.name]: e.target.value }); 
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(""); 
    setLoading(true);
    try {
      if (mode === "login") {
        const cred = await signInWithEmailAndPassword(auth, form.email, form.password);
        const snap = await getDoc(doc(db, "users", cred.user.uid));
        if (!snap.exists()) { 
          setError("Account not found. Please register."); 
          setLoading(false); 
          return; 
        }
        const role = snap.data().role;
        if (role === "admin") navigate("/admin");
        else if (role === "driver") navigate("/driver");
        else navigate("/student");
      } else {
        const cred = await createUserWithEmailAndPassword(auth, form.email, form.password);
        await setDoc(doc(db, "users", cred.user.uid), { 
          name: form.name, 
          email: form.email, 
          role: form.role, 
          campusId: form.campusId, 
          createdAt: Date.now() 
        });
        if (form.role === "admin") navigate("/admin");
        else if (form.role === "driver") navigate("/driver");
        else navigate("/student");
      }
    } catch (err) {
      setError(err.message.replace("Firebase: ", "").replace(/\(auth.*\)/, "").trim());
    } finally { 
      setLoading(false); 
    }
  }

  return (
    <div style={{ 
      minHeight: "100vh", 
      background: "#0A0A0A", 
      display: "flex", 
      flexDirection: "column", 
      fontFamily: "'DM Sans', sans-serif", 
      position: "relative", 
      overflow: "hidden" 
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&display=swap');
        
        @keyframes twinkle { 0%,100%{opacity:0.1} 50%{opacity:0.8} }
        @keyframes roadMove { from{transform:translateX(0)} to{transform:translateX(-15%)} }
        @keyframes busDrive { 0% { transform: translateX(0); } 100% { transform: translateX(118vw); } }
        @keyframes wheelSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes glow { 0%,100%{opacity:0.9} 50%{opacity:1} }
        @keyframes slideUp { from{opacity:0;transform:translateY(24px)} to{opacity:1;transform:translateY(0)} }
        @keyframes fadeIn { from{opacity:0} to{opacity:1} }

        input:focus { border-color: #FF5A1F !important; outline: none; }
        input::placeholder { color: #2A2A2A; }
        select option { background: #111; color: #fff; }
      `}</style>

      {/* Particle stars */}
      {particles.map(p => (
        <div 
          key={p.id} 
          style={{ 
            position: "absolute", 
            left: `${p.left}%`, 
            top: `${p.top}%`, 
            width: p.size, 
            height: p.size, 
            background: "#fff", 
            borderRadius: "50%", 
            opacity: p.opacity, 
            animation: `twinkle ${p.duration}s ease-in-out ${p.delay}s infinite`, 
            pointerEvents: "none" 
          }} 
        />
      ))}

      {/* Subtle grid */}
      <div style={{ 
        position: "absolute", 
        inset: 0, 
        backgroundImage: "linear-gradient(rgba(255,90,31,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,90,31,0.03) 1px, transparent 1px)", 
        backgroundSize: "40px 40px", 
        pointerEvents: "none" 
      }} />

      {/* Orange glow top */}
      <div style={{ 
        position: "absolute", 
        top: -100, 
        left: "50%", 
        transform: "translateX(-50%)", 
        width: 400, 
        height: 300, 
        background: "radial-gradient(circle, rgba(255,90,31,0.08) 0%, transparent 70%)", 
        pointerEvents: "none" 
      }} />

      {/* Header */}
      <div style={{ 
        padding: "24px 28px 0", 
        display: "flex", 
        alignItems: "center", 
        gap: 10, 
        animation: mounted ? "fadeIn 0.6s ease forwards" : "none", 
        opacity: mounted ? 1 : 0 
      }}>
        <div style={{ 
          width: 36, height: 36, background: "#FF5A1F", borderRadius: 10, 
          display: "flex", alignItems: "center", justifyContent: "center", 
          fontSize: 18, boxShadow: "0 0 20px rgba(255,90,31,0.3)" 
        }}>🚌</div>
        <div>
          <div style={{ color: "#fff", fontWeight: 600, fontSize: 16, letterSpacing: "-0.3px" }}>CampusMove</div>
          <div style={{ color: "#FF5A1F", fontSize: 10, fontWeight: 500, letterSpacing: "1px", textTransform: "uppercase" }}>Live Bus Tracking</div>
        </div>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 24px 80px" }}>
        <div style={{ maxWidth: 380, width: "100%", margin: "0 auto" }}>

          {/* Heading */}
          <div style={{ marginBottom: 32, animation: formVisible ? "slideUp 0.5s ease forwards" : "none", opacity: formVisible ? 1 : 0 }}>
            <h1 style={{ color: "#fff", fontSize: 32, fontWeight: 600, letterSpacing: "-1px", margin: "0 0 8px", lineHeight: 1.1 }}>
              {mode === "login" ? <>Welcome<br /><span style={{ color: "#FF5A1F" }}>back.</span></> : <>Join<br /><span style={{ color: "#FF5A1F" }}>CampusMove.</span></>}
            </h1>
            <p style={{ color: "#333", fontSize: 14, margin: 0 }}>
              {mode === "login" ? "Sign in to track your campus bus live" : "Create your campus transport account"}
            </p>
          </div>

          {/* Card */}
          <div style={{ 
            background: "rgba(15,15,15,0.9)", 
            border: "1px solid #1A1A1A", 
            borderRadius: 20, 
            padding: 24, 
            backdropFilter: "blur(10px)", 
            animation: formVisible ? "slideUp 0.6s ease 0.1s forwards" : "none", 
            opacity: formVisible ? 1 : 0 
          }}>

            {/* Mode toggle */}
            <div style={{ display: "flex", background: "#0A0A0A", borderRadius: 12, padding: 3, marginBottom: 24, border: "1px solid #141414" }}>
              {["login", "register"].map(m => (
                <button 
                  key={m} 
                  onClick={() => setMode(m)} 
                  style={{ 
                    flex: 1, padding: "10px 0", border: "none", borderRadius: 9, cursor: "pointer", 
                    fontSize: 13, fontWeight: 500, fontFamily: "'DM Sans', sans-serif", 
                    background: mode === m ? "#FF5A1F" : "transparent", 
                    color: mode === m ? "#fff" : "#444", 
                    transition: "all 0.25s", 
                    boxShadow: mode === m ? "0 2px 12px rgba(255,90,31,0.3)" : "none" 
                  }}>
                  {m === "login" ? "Sign In" : "Register"}
                </button>
              ))}
            </div>

            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {mode === "register" && (
                <div>
                  <label style={{ color: "#444", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1px", display: "block", marginBottom: 6 }}>Full Name</label>
                  <input name="name" value={form.name} onChange={handleChange} placeholder="Your full name" required
                    style={{ width: "100%", background: "#0A0A0A", border: "1px solid #1A1A1A", borderRadius: 12, padding: "13px 16px", color: "#fff", fontSize: 14, boxSizing: "border-box", fontFamily: "'DM Sans', sans-serif", transition: "border-color 0.2s" }} />
                </div>
              )}

              <div>
                <label style={{ color: "#444", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1px", display: "block", marginBottom: 6 }}>Email</label>
                <input name="email" type="email" value={form.email} onChange={handleChange} placeholder="you@university.edu" required
                  style={{ width: "100%", background: "#0A0A0A", border: "1px solid #1A1A1A", borderRadius: 12, padding: "13px 16px", color: "#fff", fontSize: 14, boxSizing: "border-box", fontFamily: "'DM Sans', sans-serif", transition: "border-color 0.2s" }} />
              </div>

              <div>
                <label style={{ color: "#444", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1px", display: "block", marginBottom: 6 }}>Password</label>
                <div style={{ position: "relative" }}>
                  <input 
                    name="password" 
                    type={showPwd ? "text" : "password"} 
                    value={form.password} 
                    onChange={handleChange} 
                    placeholder="••••••••" 
                    required
                    style={{ width: "100%", background: "#0A0A0A", border: "1px solid #1A1A1A", borderRadius: 12, padding: "13px 48px 13px 16px", color: "#fff", fontSize: 14, boxSizing: "border-box", fontFamily: "'DM Sans', sans-serif", transition: "border-color 0.2s" }} 
                  />
                  <button 
                    type="button" 
                    onClick={() => setShowPwd(p => !p)} 
                    style={{ 
                      position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", 
                      background: "none", border: "none", cursor: "pointer", fontSize: 16, 
                      color: "#333", padding: 0 
                    }}
                  >
                    {showPwd ? "🙈" : "👁"}
                  </button>
                </div>
              </div>

              {mode === "register" && (
                <>
                  <div>
                    <label style={{ color: "#444", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1px", display: "block", marginBottom: 6 }}>I am a</label>
                    <div style={{ display: "flex", gap: 6 }}>
                      {["student", "driver", "admin"].map(r => (
                        <button 
                          key={r} 
                          type="button" 
                          onClick={() => setForm({ ...form, role: r })} 
                          style={{ 
                            flex: 1, padding: "11px 0", borderRadius: 10, cursor: "pointer", 
                            fontSize: 12, fontWeight: 600, fontFamily: "'DM Sans', sans-serif", 
                            border: `1px solid ${form.role === r ? "#FF5A1F" : "#1A1A1A"}`, 
                            background: form.role === r ? "#150D09" : "#0A0A0A", 
                            color: form.role === r ? "#FF5A1F" : "#444", 
                            transition: "all 0.2s" 
                          }}>
                          {r === "student" ? "🎓 Student" : r === "driver" ? "🚌 Driver" : "⚙️ Admin"}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label style={{ color: "#444", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "1px", display: "block", marginBottom: 6 }}>Campus</label>
                    <select name="campusId" value={form.campusId} onChange={handleChange}
                      style={{ width: "100%", background: "#0A0A0A", border: "1px solid #1A1A1A", borderRadius: 12, padding: "13px 16px", color: "#fff", fontSize: 14, boxSizing: "border-box", fontFamily: "'DM Sans', sans-serif" }}>
                      {CAMPUSES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                </>
              )}

              {error && (
                <div style={{ background: "#120808", border: "1px solid #2A1010", borderRadius: 10, padding: "11px 14px" }}>
                  <p style={{ color: "#F87171", fontSize: 12, margin: 0 }}>⚠ {error}</p>
                </div>
              )}

              <button 
                type="submit" 
                disabled={loading} 
                style={{ 
                  width: "100%", 
                  background: loading ? "#2A1A10" : "#FF5A1F", 
                  border: "none", 
                  borderRadius: 12, 
                  padding: "15px 0", 
                  color: "#fff", 
                  fontSize: 15, 
                  fontWeight: 600, 
                  cursor: loading ? "not-allowed" : "pointer", 
                  fontFamily: "'DM Sans', sans-serif", 
                  marginTop: 4, 
                  letterSpacing: "-0.2px", 
                  transition: "all 0.2s", 
                  boxShadow: loading ? "none" : "0 4px 20px rgba(255,90,31,0.3)" 
                }}
              >
                {loading ? "Please wait..." : mode === "login" ? "Sign In →" : "Create Account →"}
              </button>
            </form>
          </div>

          <p style={{ textAlign: "center", color: "#1A1A1A", fontSize: 11, marginTop: 20 }}>Admin access via invite only</p>
        </div>
      </div>

      {/* Animated Bus */}
      <AnimatedBus />
    </div>
  );
}