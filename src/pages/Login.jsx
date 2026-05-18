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
  const [mounted, setMounted] = useState(false);

  const cardRef = useRef(null);

  // 3D Tilt Effect
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;

    const handleMouseMove = (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      
      const rotateX = (y - centerY) / 15;   // Adjust sensitivity
      const rotateY = (centerX - x) / 15;

      card.style.transform = `
        perspective(1200px) 
        rotateX(${rotateX}deg) 
        rotateY(${rotateY}deg) 
        scale(1.02)
      `;
    };

    const handleMouseLeave = () => {
      card.style.transform = `
        perspective(1200px) 
        rotateX(0deg) 
        rotateY(0deg) 
        scale(1)
      `;
    };

    card.addEventListener("mousemove", handleMouseMove);
    card.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      card.removeEventListener("mousemove", handleMouseMove);
      card.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, []);

  useEffect(() => {
    setTimeout(() => setMounted(true), 200);
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
      background: "linear-gradient(135deg, #0A0A0F 0%, #1A1428 100%)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "'DM Sans', system-ui, sans-serif",
      position: "relative",
      overflow: "hidden"
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');
        
        @keyframes fadeScale {
          from { opacity: 0; transform: scale(0.94) translateY(30px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>

      {/* Background Accent */}
      <div style={{
        position: "absolute",
        inset: 0,
        backgroundImage: "radial-gradient(circle at 30% 20%, rgba(103,232,249,0.09) 0%, transparent 55%)",
        pointerEvents: "none"
      }} />

      <div style={{ maxWidth: 440, width: "100%", padding: "20px", zIndex: 10 }}>

        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 50 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 14 }}>
            <div style={{
              width: 56, height: 56,
              background: "linear-gradient(135deg, #FF5A1F, #00F0FF)",
              borderRadius: 18,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 30,
              boxShadow: "0 0 45px rgba(0, 240, 255, 0.7)"
            }}>🚌</div>
            <div>
              <div style={{ fontSize: 29, fontWeight: 700, letterSpacing: "-1px" }}>CampusMove</div>
              <div style={{ fontSize: 12.5, color: "#67E8F9", letterSpacing: "3px", fontWeight: 500 }}>LIVE BUS TRACKING</div>
            </div>
          </div>
        </div>

        {/* 3D Tilt Card */}
        <div 
          ref={cardRef}
          style={{
            background: "rgba(15, 23, 42, 0.88)",
            backdropFilter: "blur(32px)",
            border: "1px solid rgba(148, 163, 184, 0.25)",
            borderRadius: 32,
            padding: 48,
            boxShadow: "0 40px 100px -20px rgba(0, 0, 0, 0.9)",
            transition: "transform 0.1s ease-out",
            animation: mounted ? "fadeScale 0.9s cubic-bezier(0.23, 1, 0.32, 1) forwards" : "none",
            willChange: "transform"
          }}
        >
          <h1 style={{
            textAlign: "center",
            fontSize: 38,
            fontWeight: 700,
            marginBottom: 10,
            background: "linear-gradient(90deg, #fff, #bae6fd)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent"
          }}>
            {mode === "login" ? "Welcome Back" : "Join CampusMove"}
          </h1>
          <p style={{ textAlign: "center", color: "#94A3B8", marginBottom: 40, fontSize: 16.5 }}>
            {mode === "login" 
              ? "Sign in to track your campus bus live" 
              : "Create your campus transport account"}
          </p>

          {/* Toggle */}
          <div style={{
            display: "flex",
            background: "#0F172A",
            borderRadius: 9999,
            padding: 6,
            marginBottom: 40,
            border: "1px solid #334155"
          }}>
            {["login", "register"].map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                style={{
                  flex: 1,
                  padding: "14px 0",
                  borderRadius: 9999,
                  fontWeight: 600,
                  fontSize: 15.5,
                  background: mode === m ? "#FF5A1F" : "transparent",
                  color: mode === m ? "#fff" : "#94A3B8",
                  transition: "all 0.4s ease"
                }}
              >
                {m === "login" ? "SIGN IN" : "REGISTER"}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 28 }}>
            {mode === "register" && (
              <div>
                <label style={{ display: "block", color: "#CBD5E1", fontSize: 14, marginBottom: 8 }}>FULL NAME</label>
                <input name="name" value={form.name} onChange={handleChange} placeholder="Alex Rivera" required
                  style={{ width: "100%", padding: "18px 22px", background: "#1E2937", border: "1px solid #475569", borderRadius: 16, color: "#fff", fontSize: 16.5 }} />
              </div>
            )}

            <div>
              <label style={{ display: "block", color: "#CBD5E1", fontSize: 14, marginBottom: 8 }}>EMAIL ADDRESS</label>
              <input name="email" type="email" value={form.email} onChange={handleChange} placeholder="you@university.edu" required
                style={{ width: "100%", padding: "18px 22px", background: "#1E2937", border: "1px solid #475569", borderRadius: 16, color: "#fff", fontSize: 16.5 }} />
            </div>

            <div>
              <label style={{ display: "block", color: "#CBD5E1", fontSize: 14, marginBottom: 8 }}>PASSWORD</label>
              <div style={{ position: "relative" }}>
                <input
                  name="password" type={showPwd ? "text" : "password"} value={form.password} onChange={handleChange}
                  placeholder="••••••••" required
                  style={{ width: "100%", padding: "18px 22px", background: "#1E2937", border: "1px solid #475569", borderRadius: 16, color: "#fff", fontSize: 16.5 }}
                />
                <button type="button" onClick={() => setShowPwd(!showPwd)}
                  style={{ position: "absolute", right: 22, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#94A3B8", fontSize: 21 }}>
                  {showPwd ? "🙈" : "👁"}
                </button>
              </div>
            </div>

            {error && <p style={{ color: "#FF7171", textAlign: "center" }}>{error}</p>}

            <button
              type="submit"
              disabled={loading}
              style={{
                padding: "18px 0",
                background: "linear-gradient(90deg, #FF5A1F, #F97316)",
                border: "none",
                borderRadius: 9999,
                color: "#fff",
                fontSize: 17.5,
                fontWeight: 700,
                cursor: loading ? "not-allowed" : "pointer",
                boxShadow: "0 12px 35px rgba(255, 90, 31, 0.5)",
                transition: "all 0.3s ease"
              }}
            >
              {loading ? "AUTHENTICATING..." : mode === "login" ? "SIGN IN SECURELY" : "CREATE ACCOUNT"}
            </button>
          </form>
        </div>

        <p style={{ textAlign: "center", color: "#64748B", marginTop: 28, fontSize: 14 }}>
          Admin access is by invitation only
        </p>
      </div>
    </div>
  );
}