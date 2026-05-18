import { useState, useEffect } from "react";
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
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const pts = Array.from({ length: 80 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      top: Math.random() * 65,
      size: Math.random() * 2.8 + 1,
      duration: 4 + Math.random() * 8,
      delay: Math.random() * 8,
      opacity: Math.random() * 0.5 + 0.25,
    }));
    setParticles(pts);
    setTimeout(() => setMounted(true), 150);
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
          name: form.name, email: form.email, role: form.role,
          campusId: form.campusId, createdAt: Date.now()
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
      background: `
        radial-gradient(circle at 50% 20%, rgba(103, 232, 249, 0.13) 0%, transparent 60%),
        radial-gradient(circle at 80% 70%, rgba(249, 115, 22, 0.08) 0%, transparent 50%),
        #0A0A0F
      `,
      display: "flex",
      flexDirection: "column",
      fontFamily: "'DM Sans', system-ui, sans-serif",
      position: "relative",
      overflow: "hidden",
      color: "#fff"
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');
        
        @keyframes twinkle { 0%,100%{opacity:0.25} 50%{opacity:0.85} }
        @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-12px)} }
        @keyframes scaleIn { from { opacity:0; transform:scale(0.92) translateY(20px); } to { opacity:1; transform:scale(1) translateY(0); } }
        
        .glass-card {
          transition: all 0.6s cubic-bezier(0.23, 1, 0.32, 1);
        }
        .glass-card:hover {
          transform: translateY(-8px);
          box-shadow: 0 40px 80px -20px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(103, 232, 249, 0.3) inset;
        }
      `}</style>

      {/* Premium Background Grid */}
      <div style={{
        position: "absolute",
        inset: 0,
        backgroundImage: `
          linear-gradient(rgba(103,232,249,0.028) 1px, transparent 1px),
          linear-gradient(90deg, rgba(103,232,249,0.028) 1px, transparent 1px)
        `,
        backgroundSize: "80px 80px",
        pointerEvents: "none"
      }} />

      {/* Floating Premium Particles */}
      {particles.map(p => (
        <div
          key={p.id}
          style={{
            position: "absolute",
            left: `${p.left}%`,
            top: `${p.top}%`,
            width: p.size,
            height: p.size,
            background: p.left > 50 ? "#67E8F9" : "#FBBF24",
            borderRadius: "50%",
            opacity: p.opacity,
            animation: `twinkle ${p.duration}s ease-in-out ${p.delay}s infinite`,
            boxShadow: "0 0 8px currentColor",
            pointerEvents: "none"
          }}
        />
      ))}

      {/* Header */}
      <div style={{ padding: "32px 40px 0", display: "flex", alignItems: "center", gap: 14, zIndex: 20 }}>
        <div style={{
          width: 48, height: 48,
          background: "linear-gradient(135deg, #FF5A1F, #00F0FF)",
          borderRadius: 14,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 26,
          boxShadow: "0 0 30px rgba(0, 240, 255, 0.5)"
        }}>🚀</div>
        <div>
          <div style={{ fontSize: 21, fontWeight: 700, letterSpacing: "-0.6px" }}>CampusMove</div>
          <div style={{ fontSize: 11.5, letterSpacing: "2.5px", color: "#67E8F9", fontWeight: 500 }}>LIVE BUS TRACKING</div>
        </div>
      </div>

      {/* Main Section */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px", zIndex: 10 }}>
        <div style={{ maxWidth: 420, width: "100%" }}>

          <div style={{
            textAlign: "center",
            marginBottom: 48,
            animation: mounted ? "scaleIn 0.9s cubic-bezier(0.23,1,0.32,1) forwards" : "none"
          }}>
            <h1 style={{
              fontSize: 52,
              fontWeight: 700,
              letterSpacing: "-2.2px",
              lineHeight: 1.05,
              marginBottom: 16,
              background: "linear-gradient(90deg, #ffffff, #a5f3fc)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent"
            }}>
              Welcome Back
            </h1>
            <p style={{ color: "#94A3B8", fontSize: 17.5, maxWidth: 340, margin: "0 auto" }}>
              Secure access to your campus mobility network
            </p>
          </div>

          {/* Premium Glass Card */}
          <div className="glass-card" style={{
            background: "rgba(15, 23, 42, 0.72)",
            backdropFilter: "blur(24px)",
            border: "1px solid rgba(148, 163, 184, 0.18)",
            borderRadius: 32,
            padding: 40,
            boxShadow: "0 35px 90px -15px rgba(0,0,0,0.85), inset 0 2px 0 rgba(255,255,255,0.08)",
            position: "relative",
            overflow: "hidden"
          }}>
            {/* Mode Switch */}
            <div style={{
              display: "flex",
              background: "rgba(0,0,0,0.45)",
              borderRadius: 20,
              padding: 6,
              marginBottom: 36,
              border: "1px solid rgba(148,163,184,0.1)"
            }}>
              {["login", "register"].map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  style={{
                    flex: 1,
                    padding: "14px 0",
                    borderRadius: 16,
                    fontWeight: 600,
                    fontSize: 15.5,
                    background: mode === m ? "linear-gradient(90deg, #FF5A1F, #FB923C)" : "transparent",
                    color: mode === m ? "#fff" : "#CBD5E1",
                    transition: "all 0.4s cubic-bezier(0.23,1,0.32,1)"
                  }}
                >
                  {m === "login" ? "SIGN IN" : "REGISTER"}
                </button>
              ))}
            </div>

            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              {mode === "register" && (
                <div>
                  <label style={{ color: "#94A3B8", fontSize: 13.5, fontWeight: 500, marginBottom: 9, display: "block" }}>FULL NAME</label>
                  <input name="name" value={form.name} onChange={handleChange} placeholder="Alex Rivera" required
                    style={{ width: "100%", background: "rgba(15,23,42,0.85)", border: "1px solid #475569", borderRadius: 16, padding: "16px 20px", color: "#fff", fontSize: 16.5 }} />
                </div>
              )}

              <div>
                <label style={{ color: "#94A3B8", fontSize: 13.5, fontWeight: 500, marginBottom: 9, display: "block" }}>EMAIL ADDRESS</label>
                <input name="email" type="email" value={form.email} onChange={handleChange} placeholder="you@university.edu" required
                  style={{ width: "100%", background: "rgba(15,23,42,0.85)", border: "1px solid #475569", borderRadius: 16, padding: "16px 20px", color: "#fff", fontSize: 16.5 }} />
              </div>

              <div>
                <label style={{ color: "#94A3B8", fontSize: 13.5, fontWeight: 500, marginBottom: 9, display: "block" }}>PASSWORD</label>
                <div style={{ position: "relative" }}>
                  <input
                    name="password"
                    type={showPwd ? "text" : "password"}
                    value={form.password}
                    onChange={handleChange}
                    placeholder="••••••••"
                    required
                    style={{ width: "100%", background: "rgba(15,23,42,0.85)", border: "1px solid #475569", borderRadius: 16, padding: "16px 20px", color: "#fff", fontSize: 16.5 }}
                  />
                  <button type="button" onClick={() => setShowPwd(!showPwd)}
                    style={{ position: "absolute", right: 20, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#64748B", fontSize: 22 }}>
                    {showPwd ? "🙈" : "👁"}
                  </button>
                </div>
              </div>

              {error && <p style={{ color: "#FF7171", textAlign: "center", fontSize: 14 }}>{error}</p>}

              <button
                type="submit"
                disabled={loading}
                style={{
                  marginTop: 12,
                  padding: "18px 0",
                  background: "linear-gradient(90deg, #FF5A1F, #F97316)",
                  border: "none",
                  borderRadius: 18,
                  color: "#fff",
                  fontSize: 17.5,
                  fontWeight: 700,
                  cursor: loading ? "not-allowed" : "pointer",
                  boxShadow: "0 15px 35px rgba(249, 115, 22, 0.45)",
                  transition: "all 0.3s ease"
                }}
                onMouseOver={(e) => e.target.style.transform = "translateY(-2px)"}
                onMouseLeave={(e) => e.target.style.transform = "translateY(0)"}
              >
                {loading ? "AUTHENTICATING..." : mode === "login" ? "SIGN IN SECURELY" : "CREATE ACCOUNT"}
              </button>
            </form>
          </div>

          <p style={{ textAlign: "center", color: "#64748B", fontSize: 13.5, marginTop: 32 }}>
            Admin access is invite only
          </p>
        </div>
      </div>
    </div>
  );
}