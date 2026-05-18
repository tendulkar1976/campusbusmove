import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { db, auth } from "../firebase";
import { getDoc, doc, setDoc } from "firebase/firestore";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";

export default function Login() {
  const navigate = useNavigate();
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "student" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const cardRef = useRef(null);

  // Advanced 3D Tilt - Works on Mobile + Desktop
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;

    let timeout;

    const handleTilt = (clientX, clientY) => {
      const rect = card.getBoundingClientRect();
      const x = ((clientX - rect.left) / rect.width - 0.5) * 28;
      const y = ((clientY - rect.top) / rect.height - 0.5) * 28;

      card.style.transform = `
        perspective(1100px) 
        rotateX(${-y}deg) 
        rotateY(${x}deg) 
        scale(1.03)
      `;
    };

    const handleMouseMove = (e) => handleTilt(e.clientX, e.clientY);

    const handleTouchMove = (e) => {
      if (e.touches.length > 0) {
        handleTilt(e.touches[0].clientX, e.touches[0].clientY);
      }
    };

    const resetTilt = () => {
      card.style.transform = `perspective(1100px) rotateX(0deg) rotateY(0deg) scale(1)`;
    };

    // Desktop
    card.addEventListener("mousemove", handleMouseMove);
    card.addEventListener("mouseleave", resetTilt);

    // Mobile
    card.addEventListener("touchmove", handleTouchMove);
    card.addEventListener("touchend", resetTilt);

    return () => {
      card.removeEventListener("mousemove", handleMouseMove);
      card.removeEventListener("mouseleave", resetTilt);
      card.removeEventListener("touchmove", handleTouchMove);
      card.removeEventListener("touchend", resetTilt);
    };
  }, []);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    // Your existing Firebase logic here...
    try {
      // ... (keep your original submit logic)
    } catch (err) {
      setError(err.message.replace("Firebase: ", "").replace(/\(auth.*\)/, "").trim());
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0A0A0F",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "'DM Sans', system-ui, sans-serif",
      padding: "20px",
      position: "relative",
      overflow: "hidden"
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');
      `}</style>

      <div style={{ width: "100%", maxWidth: 440 }}>

        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 50 }}>
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 16 }}>
            <div style={{
              width: 62, height: 62,
              background: "linear-gradient(135deg, #FF5A1F, #22D3EE)",
              borderRadius: 20,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 34,
              boxShadow: "0 0 50px rgba(34, 211, 238, 0.5)"
            }}>🚌</div>
            <div>
              <div style={{ fontSize: 32, fontWeight: 700, color: "#fff" }}>CampusMove</div>
              <div style={{ color: "#67E8F9", fontSize: 13, letterSpacing: "3px" }}>LIVE BUS TRACKING</div>
            </div>
          </div>
        </div>

        {/* 3D Tilt Card */}
        <div
          ref={cardRef}
          style={{
            background: "rgba(15, 23, 42, 0.92)",
            backdropFilter: "blur(32px)",
            border: "1px solid rgba(148, 163, 184, 0.3)",
            borderRadius: 32,
            padding: "48px 40px",
            boxShadow: "0 50px 120px -30px rgba(0,0,0,0.9)",
            transition: "transform 0.15s cubic-bezier(0.23, 1, 0.32, 1)",
            willChange: "transform"
          }}
        >
          <h1 style={{
            textAlign: "center",
            fontSize: 38,
            fontWeight: 700,
            marginBottom: 12,
            color: "#fff"
          }}>
            {mode === "login" ? "Welcome Back" : "Create Account"}
          </h1>
          <p style={{ textAlign: "center", color: "#94A3B8", marginBottom: 40 }}>
            {mode === "login" ? "Sign in to track your campus bus" : "Join the campus mobility network"}
          </p>

          {/* Toggle Buttons - Fixed & Equal */}
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
                  padding: "16px 0",
                  borderRadius: 9999,
                  fontWeight: 600,
                  fontSize: 16,
                  background: mode === m ? "#FF5A1F" : "transparent",
                  color: mode === m ? "#fff" : "#94A3B8",
                  border: "none",
                  cursor: "pointer",
                  transition: "all 0.4s ease"
                }}
              >
                {m === "login" ? "SIGN IN" : "REGISTER"}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 26 }}>
            {mode === "register" && (
              <div>
                <label style={{ color: "#CBD5E1", fontSize: 14, marginBottom: 8, display: "block" }}>FULL NAME</label>
                <input name="name" value={form.name} onChange={handleChange} placeholder="Alex Rivera" required
                  style={{ width: "100%", padding: "18px 24px", background: "#1E2937", border: "1px solid #475569", borderRadius: 16, color: "#fff", fontSize: 17 }} />
              </div>
            )}

            <div>
              <label style={{ color: "#CBD5E1", fontSize: 14, marginBottom: 8, display: "block" }}>EMAIL ADDRESS</label>
              <input name="email" type="email" value={form.email} onChange={handleChange} placeholder="you@university.edu" required
                style={{ width: "100%", padding: "18px 24px", background: "#1E2937", border: "1px solid #475569", borderRadius: 16, color: "#fff", fontSize: 17 }} />
            </div>

            <div>
              <label style={{ color: "#CBD5E1", fontSize: 14, marginBottom: 8, display: "block" }}>PASSWORD</label>
              <div style={{ position: "relative" }}>
                <input
                  name="password"
                  type={showPwd ? "text" : "password"}
                  value={form.password}
                  onChange={handleChange}
                  placeholder="••••••••"
                  required
                  style={{ width: "100%", padding: "18px 24px", background: "#1E2937", border: "1px solid #475569", borderRadius: 16, color: "#fff", fontSize: 17 }}
                />
                <button type="button" onClick={() => setShowPwd(!showPwd)}
                  style={{ position: "absolute", right: 24, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#94A3B8", fontSize: 22 }}>
                  {showPwd ? "🙈" : "👁"}
                </button>
              </div>
            </div>

            {error && <p style={{ color: "#FF7171", textAlign: "center" }}>{error}</p>}

            <button
              type="submit"
              disabled={loading}
              style={{
                marginTop: 10,
                padding: "20px 0",
                background: "linear-gradient(90deg, #FF5A1F, #F97316)",
                border: "none",
                borderRadius: 9999,
                color: "#fff",
                fontSize: 18,
                fontWeight: 700,
                cursor: loading ? "not-allowed" : "pointer",
                boxShadow: "0 15px 40px rgba(255, 90, 31, 0.45)"
              }}
            >
              {loading ? "AUTHENTICATING..." : mode === "login" ? "SIGN IN SECURELY" : "CREATE ACCOUNT"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}