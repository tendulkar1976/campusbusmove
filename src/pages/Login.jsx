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

  // 3D Tilt
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;

    const handleMove = (e) => {
      const rect = card.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width - 0.5) * 25;
      const y = ((e.clientY - rect.top) / rect.height - 0.5) * 25;
      
      card.style.transform = `perspective(1000px) rotateX(${-y}deg) rotateY(${x}deg) scale(1.03)`;
    };

    const handleLeave = () => {
      card.style.transform = `perspective(1000px) rotateX(0deg) rotateY(0deg) scale(1)`;
    };

    card.addEventListener("mousemove", handleMove);
    card.addEventListener("mouseleave", handleLeave);

    return () => {
      card.removeEventListener("mousemove", handleMove);
      card.removeEventListener("mouseleave", handleLeave);
    };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    // ... your existing submit logic
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0A0A0F",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "'Inter', system-ui, sans-serif",
      position: "relative",
      overflow: "hidden"
    }}>
      {/* Background Grid + Glow */}
      <div style={{
        position: "absolute",
        inset: 0,
        backgroundImage: "linear-gradient(rgba(103,232,249,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(103,232,249,0.03) 1px, transparent 1px)",
        backgroundSize: "80px 80px",
      }} />

      <div style={{ width: "100%", maxWidth: 420, padding: "20px" }}>

        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 60 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16 }}>
            <div style={{
              width: 58, height: 58,
              background: "linear-gradient(135deg, #FF5A1F, #22D3EE)",
              borderRadius: 20,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 32,
              boxShadow: "0 0 50px rgba(34, 211, 238, 0.6)"
            }}>🚌</div>
            <div style={{ textAlign: "left" }}>
              <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-1.5px", color: "#fff" }}>CampusMove</div>
              <div style={{ color: "#67E8F9", fontSize: 13, letterSpacing: "4px", fontWeight: 600 }}>LIVE BUS TRACKING</div>
            </div>
          </div>
        </div>

        {/* Premium Card with 3D Tilt */}
        <div
          ref={cardRef}
          style={{
            background: "rgba(15, 23, 42, 0.95)",
            backdropFilter: "blur(30px)",
            border: "1px solid rgba(148, 163, 184, 0.3)",
            borderRadius: 28,
            padding: "52px 48px",
            boxShadow: "0 50px 100px -20px rgba(0,0,0,0.85)",
            transition: "transform 0.12s cubic-bezier(0.23,1,0.32,1)",
            willChange: "transform"
          }}
        >
          <h1 style={{
            textAlign: "center",
            fontSize: 42,
            fontWeight: 700,
            marginBottom: 12,
            color: "#fff"
          }}>
            {mode === "login" ? "Welcome Back" : "Get Started"}
          </h1>
          <p style={{ textAlign: "center", color: "#94A3B8", marginBottom: 40 }}>
            {mode === "login" ? "Sign in to continue" : "Create your account"}
          </p>

          {/* Toggle */}
          <div style={{ display: "flex", gap: 8, background: "#0F172A", padding: 6, borderRadius: 9999, marginBottom: 40 }}>
            {["login", "register"].map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                style={{
                  flex: 1,
                  padding: "16px",
                  borderRadius: 9999,
                  fontWeight: 600,
                  background: mode === m ? "#FF5A1F" : "transparent",
                  color: mode === m ? "white" : "#94A3B8",
                  border: "none",
                  cursor: "pointer",
                  transition: "all 0.4s ease"
                }}
              >
                {m === "login" ? "Sign In" : "Register"}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {mode === "register" && (
              <div>
                <label style={{ color: "#CBD5E1", fontSize: 14, marginBottom: 8, display: "block" }}>FULL NAME</label>
                <input name="name" placeholder="Alex Rivera" required
                  style={{ width: "100%", padding: "18px 24px", background: "#1E2937", border: "1px solid #475569", borderRadius: 16, color: "#fff", fontSize: 17 }} />
              </div>
            )}

            <div>
              <label style={{ color: "#CBD5E1", fontSize: 14, marginBottom: 8, display: "block" }}>EMAIL</label>
              <input name="email" type="email" placeholder="you@university.edu" required
                style={{ width: "100%", padding: "18px 24px", background: "#1E2937", border: "1px solid #475569", borderRadius: 16, color: "#fff", fontSize: 17 }} />
            </div>

            <div>
              <label style={{ color: "#CBD5E1", fontSize: 14, marginBottom: 8, display: "block" }}>PASSWORD</label>
              <div style={{ position: "relative" }}>
                <input name="password" type={showPwd ? "text" : "password"} placeholder="••••••••" required
                  style={{ width: "100%", padding: "18px 24px", background: "#1E2937", border: "1px solid #475569", borderRadius: 16, color: "#fff", fontSize: 17 }} />
                <button type="button" onClick={() => setShowPwd(!showPwd)}
                  style={{ position: "absolute", right: 24, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#94A3B8" }}>
                  {showPwd ? "🙈" : "👁"}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{
                marginTop: 12,
                padding: "20px",
                background: "linear-gradient(to right, #FF5A1F, #FB923C)",
                color: "white",
                border: "none",
                borderRadius: 9999,
                fontSize: 18,
                fontWeight: 700,
                cursor: loading ? "not-allowed" : "pointer",
                boxShadow: "0 15px 35px rgba(255,90,31,0.4)"
              }}
            >
              {loading ? "PLEASE WAIT..." : mode === "login" ? "SIGN IN" : "CREATE ACCOUNT"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}