import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { db, auth } from "../firebase";
import { getDoc, doc, setDoc } from "firebase/firestore";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";

const CAMPUSES = [{ id: "alliance-bangalore", name: "Alliance University, Bangalore" }];

function Particle({ style }) {
  return <div style={style} />;
}

function AnimatedBus() {
  return (
    <div style={{
      position: "absolute",
      bottom: 0,
      left: 0,
      right: 0,
      height: 110,
      overflow: "hidden",
      pointerEvents: "none",
      zIndex: 1
    }}>
      {/* Road with gradient */}
      <div style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        height: 48,
        background: "linear-gradient(to bottom, #0A0A0A, #111111)",
        boxShadow: "0 -20px 40px rgba(0,0,0,0.6)"
      }} />

      {/* Road lines */}
      {[0,1,2,3,4,5,6,7,8].map(i => (
        <div
          key={i}
          style={{
            position: "absolute",
            bottom: 22,
            left: `${i * 12}%`,
            width: "9%",
            height: 4,
            background: "linear-gradient(90deg, transparent, #FF5A1F, transparent)",
            borderRadius: 2,
            opacity: 0.7,
            animation: `roadMove 1.1s linear infinite`,
            animationDelay: `${i * -0.13}s`,
            boxShadow: "0 0 8px rgba(255,90,31,0.4)"
          }}
        />
      ))}

      {/* Bus - Premium look */}
      <div style={{
        position: "absolute",
        bottom: 28,
        left: "6%",
        animation: "busFloat 2.4s ease-in-out infinite"
      }}>
        {/* Main Body */}
        <div style={{
          width: 108,
          height: 46,
          background: "linear-gradient(145deg, #FF5A1F, #E84E17)",
          borderRadius: "12px 12px 6px 6px",
          position: "relative",
          boxShadow: "0 12px 30px rgba(255,90,31,0.35), inset 0 -8px 12px rgba(0,0,0,0.3)"
        }}>
          {/* Windows with glow */}
          {[12, 32, 52, 72].map((l, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                top: 8,
                left: l,
                width: 16,
                height: 14,
                background: "#0F172A",
                borderRadius: 4,
                boxShadow: "inset 0 0 6px rgba(255,224,102,0.3)"
              }}
            />
          ))}

          {/* Top highlight */}
          <div style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 8,
            background: "linear-gradient(transparent, rgba(255,255,255,0.25))",
            borderRadius: "12px 12px 0 0"
          }} />

          {/* Bottom stripe */}
          <div style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: 12,
            background: "linear-gradient(#CC4518, #B33C15)",
            borderRadius: "0 0 6px 6px"
          }} />
        </div>

        {/* Front Cab */}
        <div style={{
          position: "absolute",
          top: 6,
          left: -14,
          width: 18,
          height: 34,
          background: "#E84E17",
          borderRadius: "8px 4px 4px 8px",
          boxShadow: "0 8px 20px rgba(0,0,0,0.4)"
        }}>
          <div style={{
            position: "absolute",
            top: 9,
            left: 4,
            width: 8,
            height: 8,
            background: "#FFEE99",
            borderRadius: "50%",
            animation: "glow 1.8s ease-in-out infinite",
            boxShadow: "0 0 14px #FFEE99"
          }} />
        </div>

        {/* Exhaust */}
        {[0,1,2].map(i => (
          <div
            key={i}
            style={{
              position: "absolute",
              top: 28,
              left: -22 - i * 11,
              width: 9,
              height: 9,
              background: "#475569",
              borderRadius: "50%",
              animation: `puff 0.95s ease-out infinite`,
              animationDelay: `${i * 0.22}s`,
              opacity: 0.7
            }}
          />
        ))}

        {/* Wheels - Premium */}
        {[12, 72].map((l, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              bottom: -11,
              left: l,
              width: 22,
              height: 22,
              background: "#0F172A",
              border: "3px solid #1E2937",
              borderRadius: "50%",
              animation: "spin 0.35s linear infinite",
              boxShadow: "0 6px 12px rgba(0,0,0,0.6)"
            }}
          >
            <div style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%,-50%)",
              width: 9,
              height: 9,
              background: "#334155",
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
    const pts = Array.from({ length: 80 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      top: Math.random() * 70,
      size: Math.random() * 2.5 + 1,
      duration: 3 + Math.random() * 5,
      delay: Math.random() * 5,
      opacity: Math.random() * 0.5 + 0.15,
    }));
    setParticles(pts);
    setTimeout(() => setMounted(true), 80);
    setTimeout(() => setFormVisible(true), 300);
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
      fontFamily: "'DM Sans', system-ui, sans-serif",
      position: "relative",
      overflow: "hidden",
      color: "#fff"
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=Inter:wght@400;500;600&display=swap');
        
        @keyframes twinkle { 0%,100%{opacity:0.2} 50%{opacity:0.85} }
        @keyframes roadMove { from{transform:translateX(0)} to{transform:translateX(-14%)} }
        @keyframes busFloat { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes puff { 0%{opacity:0.6;transform:scale(0.4) translateX(0)} 100%{opacity:0;transform:scale(2.2) translateX(-28px)} }
        @keyframes glow { 0%,100%{box-shadow:0 0 12px #FFEE99} 50%{box-shadow:0 0 22px #FFEE99} }
        
        @keyframes slideUp { from{opacity:0;transform:translateY(30px)} to{opacity:1;transform:translateY(0)} }
        @keyframes fadeIn { from{opacity:0} to{opacity:1} }
        
        .glass-card {
          background: rgba(15, 15, 20, 0.75);
          border: 1px solid rgba(255,90,31,0.15);
          backdrop-filter: blur(16px);
        }
        
        input:focus {
          border-color: #FF5A1F;
          box-shadow: 0 0 0 4px rgba(255,90,31,0.15);
        }
      `}</style>

      {/* Background Elements */}
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at 30% 20%, rgba(255,90,31,0.08) 0%, transparent 50%)" }} />
      <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(255,90,31,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,90,31,0.035) 1px, transparent 1px)", backgroundSize: "50px 50px" }} />

      {/* Enhanced Particles */}
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
            pointerEvents: "none",
            boxShadow: "0 0 6px rgba(255,255,255,0.6)"
          }}
        />
      ))}

      {/* Header */}
      <div style={{
        padding: "28px 32px 0",
        display: "flex",
        alignItems: "center",
        gap: 14,
        animation: mounted ? "fadeIn 0.8s ease forwards" : "none"
      }}>
        <div style={{
          width: 42,
          height: 42,
          background: "linear-gradient(135deg, #FF5A1F, #FF8A4D)",
          borderRadius: 12,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 22,
          boxShadow: "0 0 30px rgba(255,90,31,0.5)",
          transform: "rotate(-8deg)"
        }}>
          🚌
        </div>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.6px" }}>CampusMove</div>
          <div style={{ color: "#FF5A1F", fontSize: 11, fontWeight: 600, letterSpacing: "1.5px", textTransform: "uppercase" }}>Live • Reliable • Campus</div>
        </div>
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px 24px 100px" }}>
        <div style={{ maxWidth: 400, width: "100%" }}>

          {/* Headline */}
          <div style={{
            marginBottom: 40,
            animation: formVisible ? "slideUp 0.7s cubic-bezier(0.23,1,0.32,1) forwards" : "none",
            opacity: formVisible ? 1 : 0
          }}>
            <h1 style={{
              fontSize: "42px",
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: "-1.8px",
              margin: 0
            }}>
              {mode === "login" ? (
                <>Welcome back<span style={{ color: "#FF5A1F" }}>.</span></>
              ) : (
                <>Join the ride<span style={{ color: "#FF5A1F" }}>.</span></>
              )}
            </h1>
            <p style={{ color: "#999", fontSize: 16.5, marginTop: 12, fontWeight: 400 }}>
              {mode === "login"
                ? "Track your campus bus in real-time"
                : "Get started with smart campus transport"}
            </p>
          </div>

          {/* Premium Glass Card */}
          <div className="glass-card" style={{
            borderRadius: 24,
            padding: 32,
            boxShadow: "0 30px 70px rgba(0,0,0,0.6)",
            animation: formVisible ? "slideUp 0.8s cubic-bezier(0.23,1,0.32,1) 0.1s forwards" : "none",
            opacity: formVisible ? 1 : 0
          }}>

            {/* Toggle */}
            <div style={{
              display: "flex",
              background: "rgba(10,10,10,0.8)",
              borderRadius: 16,
              padding: 4,
              marginBottom: 32,
              border: "1px solid rgba(255,90,31,0.1)"
            }}>
              {["login", "register"].map(m => (
                <button
                  key={m}
                  onClick={() => { setMode(m); setError(""); }}
                  style={{
                    flex: 1,
                    padding: "14px 0",
                    border: "none",
                    borderRadius: 12,
                    fontSize: 15,
                    fontWeight: 600,
                    cursor: "pointer",
                    background: mode === m ? "#FF5A1F" : "transparent",
                    color: mode === m ? "#fff" : "#888",
                    transition: "all 0.3s cubic-bezier(0.4,0,0.2,1)",
                    boxShadow: mode === m ? "0 4px 15px rgba(255,90,31,0.4)" : "none"
                  }}
                >
                  {m === "login" ? "Sign In" : "Register"}
                </button>
              ))}
            </div>

            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {mode === "register" && (
                <div>
                  <label style={{ color: "#888", fontSize: 12, fontWeight: 600, display: "block", marginBottom: 8 }}>FULL NAME</label>
                  <input
                    name="name"
                    value={form.name}
                    onChange={handleChange}
                    placeholder="Alex Rivera"
                    required
                    style={{
                      width: "100%",
                      background: "rgba(10,10,15,0.9)",
                      border: "1px solid #222",
                      borderRadius: 14,
                      padding: "16px 18px",
                      color: "#fff",
                      fontSize: 16,
                      transition: "all 0.2s"
                    }}
                  />
                </div>
              )}

              <div>
                <label style={{ color: "#888", fontSize: 12, fontWeight: 600, display: "block", marginBottom: 8 }}>UNIVERSITY EMAIL</label>
                <input
                  name="email"
                  type="email"
                  value={form.email}
                  onChange={handleChange}
                  placeholder="yourname@university.edu"
                  required
                  style={{
                    width: "100%",
                    background: "rgba(10,10,15,0.9)",
                    border: "1px solid #222",
                    borderRadius: 14,
                    padding: "16px 18px",
                    color: "#fff",
                    fontSize: 16,
                    transition: "all 0.2s"
                  }}
                />
              </div>

              <div>
                <label style={{ color: "#888", fontSize: 12, fontWeight: 600, display: "block", marginBottom: 8 }}>PASSWORD</label>
                <div style={{ position: "relative" }}>
                  <input
                    name="password"
                    type={showPwd ? "text" : "password"}
                    value={form.password}
                    onChange={handleChange}
                    placeholder="••••••••"
                    required
                    style={{
                      width: "100%",
                      background: "rgba(10,10,15,0.9)",
                      border: "1px solid #222",
                      borderRadius: 14,
                      padding: "16px 52px 16px 18px",
                      color: "#fff",
                      fontSize: 16,
                      transition: "all 0.2s"
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd(!showPwd)}
                    style={{
                      position: "absolute",
                      right: 18,
                      top: "50%",
                      transform: "translateY(-50%)",
                      background: "none",
                      border: "none",
                      fontSize: 20,
                      cursor: "pointer",
                      color: "#666"
                    }}
                  >
                    {showPwd ? "🙈" : "👁️"}
                  </button>
                </div>
              </div>

              {mode === "register" && (
                <>
                  <div>
                    <label style={{ color: "#888", fontSize: 12, fontWeight: 600, display: "block", marginBottom: 10 }}>I AM A</label>
                    <div style={{ display: "flex", gap: 8 }}>
                      {["student", "driver", "admin"].map(r => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setForm({ ...form, role: r })}
                          style={{
                            flex: 1,
                            padding: "14px 10px",
                            borderRadius: 12,
                            border: `1.5px solid ${form.role === r ? "#FF5A1F" : "#222"}`,
                            background: form.role === r ? "rgba(255,90,31,0.08)" : "rgba(10,10,15,0.8)",
                            color: form.role === r ? "#FF5A1F" : "#aaa",
                            fontWeight: 600,
                            fontSize: 13.5,
                            transition: "all 0.2s"
                          }}
                        >
                          {r === "student" ? "🎓 Student" : r === "driver" ? "🚌 Driver" : "⚙️ Admin"}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label style={{ color: "#888", fontSize: 12, fontWeight: 600, display: "block", marginBottom: 8 }}>CAMPUS</label>
                    <select
                      name="campusId"
                      value={form.campusId}
                      onChange={handleChange}
                      style={{
                        width: "100%",
                        background: "rgba(10,10,15,0.9)",
                        border: "1px solid #222",
                        borderRadius: 14,
                        padding: "16px 18px",
                        color: "#fff",
                        fontSize: 16
                      }}
                    >
                      {CAMPUSES.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              {error && (
                <div style={{
                  background: "rgba(185,28,28,0.15)",
                  border: "1px solid rgba(248,113,113,0.3)",
                  borderRadius: 12,
                  padding: "14px 16px",
                  color: "#FCA5A5",
                  fontSize: 13.5
                }}>
                  ⚠️ {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                style={{
                  marginTop: 8,
                  width: "100%",
                  background: loading ? "#3F2A1F" : "linear-gradient(90deg, #FF5A1F, #FF8A4D)",
                  border: "none",
                  borderRadius: 16,
                  padding: "18px 0",
                  color: "#fff",
                  fontSize: 17,
                  fontWeight: 700,
                  cursor: loading ? "not-allowed" : "pointer",
                  boxShadow: loading ? "none" : "0 10px 30px rgba(255,90,31,0.4)",
                  transition: "all 0.3s cubic-bezier(0.4,0,0.2,1)"
                }}
                onMouseEnter={(e) => {
                  if (!loading) e.target.style.transform = "translateY(-2px)";
                }}
                onMouseLeave={(e) => {
                  if (!loading) e.target.style.transform = "translateY(0)";
                }}
              >
                {loading ? "Connecting..." : mode === "login" ? "Sign In Securely" : "Create My Account"}
              </button>
            </form>
          </div>

          <p style={{ textAlign: "center", color: "#444", fontSize: 12, marginTop: 24 }}>
            Admin access is invite-only • Secure • Encrypted
          </p>
        </div>
      </div>

      <AnimatedBus />
    </div>
  );
}