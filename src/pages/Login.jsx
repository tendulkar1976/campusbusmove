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
      height: "110px",
      overflow: "hidden",
      pointerEvents: "none",
      perspective: "1400px",
      perspectiveOrigin: "50% 75%"
    }}>
      {/* Futuristic Road */}
      <div style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        height: "52px",
        background: "linear-gradient(180deg, #0A0A0A 0%, #111 100%)",
        boxShadow: "0 -30px 60px rgba(0, 240, 255, 0.1)"
      }} />

      {/* Holographic Road Lines */}
      {[0,1,2,3,4,5,6,7,8,9].map(i => (
        <div
          key={i}
          style={{
            position: "absolute",
            bottom: "19px",
            left: `${i * 11}%`,
            width: "9%",
            height: "3px",
            background: "linear-gradient(90deg, transparent, #00F0FF, #FF5A1F, transparent)",
            boxShadow: "0 0 10px #00F0FF",
            animation: `roadMove 1.35s linear infinite`,
            animationDelay: `${i * -0.135}s`,
            willChange: "transform"
          }}
        />
      ))}

      {/* Futuristic 3D Bus */}
      <div style={{
        position: "absolute",
        bottom: "28px",
        left: "-20%",
        animation: "busDrive 14s linear infinite",
        animationDelay: "0.4s",
        transformStyle: "preserve-3d",
        willChange: "transform"
      }}>
        <div style={{
          width: "112px",
          height: "50px",
          background: "linear-gradient(145deg, #FF5A1F, #C2410C)",
          borderRadius: "16px 16px 8px 8px",
          position: "relative",
          boxShadow: `
            0 20px 40px rgba(0,0,0,0.9),
            0 0 30px rgba(255,90,31,0.7),
            inset 0 4px 15px rgba(255,255,255,0.2)
          `,
          transform: "rotateX(14deg) translateZ(0)",
        }}>
          {/* Neon Windows */}
          {[13, 35, 57, 79].map((l, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                top: "11px",
                left: l,
                width: "14px",
                height: "19px",
                background: "#0A1625",
                borderRadius: "3px",
                boxShadow: "0 0 14px #00F0FF, inset 0 0 6px #67E8F9",
                border: "1px solid #00F0FF"
              }}
            />
          ))}

          {/* Neon Bottom Bar */}
          <div style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: "13px",
            background: "linear-gradient(90deg, #00F0FF, #FF5A1F, #00F0FF)",
            borderRadius: "0 0 8px 8px",
            boxShadow: "0 0 18px #00F0FF"
          }} />

          {/* Headlight */}
          <div style={{
            position: "absolute",
            top: "15px",
            left: "-19px",
            width: "24px",
            height: "17px",
            background: "#E0F2FE",
            borderRadius: "50% 40% 40% 50%",
            boxShadow: "0 0 28px #67E8F9, 0 0 45px #0EA5E9",
            animation: "glow 1.1s ease-in-out infinite alternate"
          }} />

          {/* Scanner Line */}
          <div style={{
            position: "absolute",
            top: "24px",
            left: "-10%",
            right: "-10%",
            height: "2px",
            background: "linear-gradient(90deg, transparent, #67E8F9, transparent)",
            boxShadow: "0 0 12px #67E8F9",
            animation: "scan 2.2s linear infinite"
          }} />
        </div>

        {/* Wheels */}
        {[18, 80].map((pos, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              bottom: "-15px",
              left: pos,
              width: "26px",
              height: "26px",
              background: "#0A0A0A",
              border: "4px solid #555",
              borderRadius: "50%",
              boxShadow: "0 6px 15px rgba(0,0,0,0.9), inset 0 0 12px #777",
              animation: "wheelSpin 0.48s linear infinite",
              transform: "translateZ(15px)"
            }}
          >
            <div style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              width: "11px",
              height: "11px",
              background: "#222",
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
    const pts = Array.from({ length: 45 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      top: Math.random() * 75,
      size: Math.random() * 2.5 + 1,
      duration: 2.5 + Math.random() * 5,
      delay: Math.random() * 5,
      opacity: Math.random() * 0.5 + 0.15,
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
      background: "#050505",
      display: "flex",
      flexDirection: "column",
      fontFamily: "'DM Sans', sans-serif",
      position: "relative",
      overflow: "hidden"
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=Inter:wght@400;500;600&display=swap');
        
        @keyframes twinkle { 0%,100%{opacity:0.15} 50%{opacity:0.85} }
        @keyframes roadMove { from { transform: translateX(0); } to { transform: translateX(-16%); } }
        @keyframes busDrive { 0% { transform: translateX(0) rotateX(14deg); } 100% { transform: translateX(122vw) rotateX(14deg); } }
        @keyframes wheelSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes glow { from { box-shadow: 0 0 25px #67E8F9; } to { box-shadow: 0 0 45px #BAE6FD; } }
        @keyframes scan { 0% { transform: translateX(-120%); } 100% { transform: translateX(220%); } }

        @keyframes slideUp { from{opacity:0;transform:translateY(30px)} to{opacity:1;transform:translateY(0)} }
        @keyframes fadeIn { from{opacity:0} to{opacity:1} }
        @keyframes borderGlow { 0%,100% { border-color: #00F0FF; } 50% { border-color: #FF5A1F; } }
      `}</style>

      {/* Stars */}
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

      {/* Subtle Grid */}
      <div style={{
        position: "absolute",
        inset: 0,
        backgroundImage: `
          linear-gradient(rgba(0,240,255,0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(0,240,255,0.03) 1px, transparent 1px)
        `,
        backgroundSize: "50px 50px",
        pointerEvents: "none"
      }} />

      {/* Header */}
      <div style={{
        padding: "28px 32px 0",
        display: "flex",
        alignItems: "center",
        gap: 12,
        animation: mounted ? "fadeIn 0.8s ease forwards" : "none"
      }}>
        <div style={{
          width: 42, height: 42, background: "linear-gradient(135deg, #FF5A1F, #00F0FF)",
          borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 22, boxShadow: "0 0 25px rgba(0,240,255,0.5)"
        }}>🛰️</div>
        <div>
          <div style={{ color: "#fff", fontWeight: 700, fontSize: 18, letterSpacing: "-0.5px" }}>CampusMove</div>
          <div style={{ color: "#00F0FF", fontSize: 11, fontWeight: 500, letterSpacing: "2px", textTransform: "uppercase" }}>LIVE BUS TRACKING</div>
        </div>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 24px 100px" }}>
        <div style={{ maxWidth: 400, width: "100%", margin: "0 auto" }}>

          {/* Futuristic Heading */}
          <div style={{ marginBottom: 40, textAlign: "center", animation: formVisible ? "slideUp 0.7s ease forwards" : "none" }}>
            <h1 style={{ 
              color: "#fff", 
              fontSize: 38, 
              fontWeight: 700, 
              letterSpacing: "-1.5px", 
              margin: "0 0 12px",
              background: "linear-gradient(90deg, #fff, #00F0FF)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent"
            }}>
              {mode === "login" ? "WELCOME BACK" : "JOIN THE GRID"}
            </h1>
            <p style={{ color: "#94A3B8", fontSize: 15 }}>
              {mode === "login" ? "Access your campus mobility network" : "Create your secure transport profile"}
            </p>
          </div>

          {/* Futuristic Glass Card */}
          <div style={{
            background: "rgba(15, 23, 42, 0.65)",
            backdropFilter: "blur(16px)",
            border: "1px solid rgba(0, 240, 255, 0.3)",
            borderRadius: 24,
            padding: 32,
            boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255,90,31,0.2) inset",
            animation: formVisible ? "slideUp 0.8s ease 0.1s forwards" : "none",
            position: "relative",
            overflow: "hidden"
          }}>
            {/* Subtle inner grid */}
            <div style={{
              position: "absolute",
              inset: 0,
              backgroundImage: "linear-gradient(rgba(0,240,255,0.04) 1px, transparent 1px)",
              backgroundSize: "30px 30px",
              opacity: 0.6,
              pointerEvents: "none"
            }} />

            {/* Mode Toggle */}
            <div style={{ 
              display: "flex", 
              background: "rgba(0,0,0,0.4)", 
              borderRadius: 16, 
              padding: 4, 
              marginBottom: 32,
              border: "1px solid rgba(255,255,255,0.08)"
            }}>
              {["login", "register"].map(m => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  style={{
                    flex: 1,
                    padding: "12px 0",
                    border: "none",
                    borderRadius: 12,
                    fontSize: 14,
                    fontWeight: 600,
                    background: mode === m ? "linear-gradient(90deg, #FF5A1F, #F97316)" : "transparent",
                    color: mode === m ? "#fff" : "#94A3B8",
                    cursor: "pointer",
                    transition: "all 0.3s ease",
                    boxShadow: mode === m ? "0 4px 15px rgba(249, 115, 22, 0.4)" : "none"
                  }}
                >
                  {m === "login" ? "SIGN IN" : "REGISTER"}
                </button>
              ))}
            </div>

            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {/* Form fields with neon style */}
              {mode === "register" && (
                <div>
                  <label style={{ color: "#64748B", fontSize: 12, fontWeight: 500, marginBottom: 8, display: "block" }}>FULL NAME</label>
                  <input name="name" value={form.name} onChange={handleChange} placeholder="Alex Rivera" required
                    style={{
                      width: "100%", background: "rgba(15,23,42,0.8)", border: "1px solid #334155",
                      borderRadius: 14, padding: "14px 18px", color: "#fff", fontSize: 15
                    }}
                  />
                </div>
              )}

              <div>
                <label style={{ color: "#64748B", fontSize: 12, fontWeight: 500, marginBottom: 8, display: "block" }}>EMAIL</label>
                <input name="email" type="email" value={form.email} onChange={handleChange} placeholder="you@university.edu" required
                  style={{
                    width: "100%", background: "rgba(15,23,42,0.8)", border: "1px solid #334155",
                    borderRadius: 14, padding: "14px 18px", color: "#fff", fontSize: 15
                  }}
                />
              </div>

              <div>
                <label style={{ color: "#64748B", fontSize: 12, fontWeight: 500, marginBottom: 8, display: "block" }}>PASSWORD</label>
                <div style={{ position: "relative" }}>
                  <input
                    name="password"
                    type={showPwd ? "text" : "password"}
                    value={form.password}
                    onChange={handleChange}
                    placeholder="••••••••"
                    required
                    style={{
                      width: "100%", background: "rgba(15,23,42,0.8)", border: "1px solid #334155",
                      borderRadius: 14, padding: "14px 18px 14px 18px", color: "#fff", fontSize: 15
                    }}
                  />
                  <button type="button" onClick={() => setShowPwd(!showPwd)}
                    style={{ position: "absolute", right: 16, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#64748B", fontSize: 18, cursor: "pointer" }}>
                    {showPwd ? "🙈" : "👁"}
                  </button>
                </div>
              </div>

              {mode === "register" && (
                /* Role & Campus selectors - keep similar but styled */
                <div style={{ display: "flex", gap: 12 }}>
                  {["student", "driver", "admin"].map(r => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setForm({ ...form, role: r })}
                      style={{
                        flex: 1,
                        padding: "12px 8px",
                        borderRadius: 12,
                        border: `1px solid ${form.role === r ? "#00F0FF" : "#334155"}`,
                        background: form.role === r ? "rgba(0,240,255,0.1)" : "rgba(15,23,42,0.6)",
                        color: form.role === r ? "#00F0FF" : "#94A3B8",
                        fontSize: 13,
                        fontWeight: 600
                      }}
                    >
                      {r === "student" ? "🎓 Student" : r === "driver" ? "🚌 Driver" : "⚡ Admin"}
                    </button>
                  ))}
                </div>
              )}

              {error && <p style={{ color: "#F87171", textAlign: "center", fontSize: 13 }}>{error}</p>}

              <button
                type="submit"
                disabled={loading}
                style={{
                  marginTop: 8,
                  padding: "16px",
                  background: "linear-gradient(90deg, #FF5A1F, #F97316)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 16,
                  fontSize: 16,
                  fontWeight: 700,
                  cursor: loading ? "not-allowed" : "pointer",
                  boxShadow: "0 10px 30px rgba(249, 115, 22, 0.4)",
                  transition: "all 0.2s"
                }}
              >
                {loading ? "CONNECTING..." : mode === "login" ? "SIGN IN →" : "CREATE ACCOUNT →"}
              </button>
            </form>
          </div>

          <p style={{ textAlign: "center", color: "#475569", fontSize: 12, marginTop: 24 }}>
            Admin access • Invite only
          </p>
        </div>
      </div>

      <AnimatedBus />
    </div>
  );
}