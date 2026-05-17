import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { db, auth } from "../firebase";
import { getDoc, doc, setDoc } from "firebase/firestore";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";

const CAMPUSES = [
  { id: "alliance-bangalore", name: "Alliance University, Bangalore" },
];

export default function Login() {
  const navigate = useNavigate();
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "student", campusId: "alliance-bangalore" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function handleChange(e) { setForm({ ...form, [e.target.name]: e.target.value }); }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      if (mode === "login") {
        const cred = await signInWithEmailAndPassword(auth, form.email, form.password);
        const snap = await getDoc(doc(db, "users", cred.user.uid));
        if (!snap.exists()) { setError("Account not found. Please register."); setLoading(false); return; }
        const role = snap.data().role;
        if (role === "admin") navigate("/admin");
        else if (role === "driver") navigate("/driver");
        else navigate("/student");
      } else {
        const cred = await createUserWithEmailAndPassword(auth, form.email, form.password);
        await setDoc(doc(db, "users", cred.user.uid), { name: form.name, email: form.email, role: form.role, campusId: form.campusId, createdAt: Date.now() });
        if (form.role === "driver") navigate("/driver");
        else navigate("/student");
      }
    } catch (err) {
      setError(err.message.replace("Firebase: ", "").replace(/\(auth.*\)/, "").trim());
    } finally { setLoading(false); }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0A0A0A", display: "flex", flexDirection: "column", fontFamily: "'DM Sans', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />

      {/* Top brand strip */}
      <div style={{ padding: "28px 28px 0", display: "flex", alignItems: "center", gap: "10px" }}>
        <div style={{ width: 36, height: 36, background: "#FF5A1F", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🚌</div>
        <span style={{ color: "#fff", fontWeight: 600, fontSize: 16, letterSpacing: "-0.3px" }}>CampusMove</span>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 28px 40px" }}>
        <div style={{ maxWidth: 400, width: "100%", margin: "0 auto" }}>

          {/* Heading */}
          <div style={{ marginBottom: 36 }}>
            <h1 style={{ color: "#fff", fontSize: 30, fontWeight: 600, letterSpacing: "-0.8px", margin: "0 0 8px", lineHeight: 1.2 }}>
              {mode === "login" ? "Welcome back" : "Create account"}
            </h1>
            <p style={{ color: "#555", fontSize: 14, margin: 0 }}>
              {mode === "login" ? "Sign in to track your campus bus" : "Join your campus transport network"}
            </p>
          </div>

          {/* Mode toggle */}
          <div style={{ display: "flex", background: "#141414", borderRadius: 12, padding: 4, marginBottom: 28, border: "1px solid #1E1E1E" }}>
            {["login", "register"].map(m => (
              <button key={m} onClick={() => setMode(m)} style={{
                flex: 1, padding: "10px 0", border: "none", borderRadius: 9, cursor: "pointer", fontSize: 13, fontWeight: 500, fontFamily: "'DM Sans', sans-serif",
                background: mode === m ? "#FF5A1F" : "transparent",
                color: mode === m ? "#fff" : "#555",
                transition: "all 0.2s"
              }}>
                {m === "login" ? "Sign In" : "Register"}
              </button>
            ))}
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {mode === "register" && (
              <div>
                <label style={{ color: "#555", fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.8px", display: "block", marginBottom: 6 }}>Full Name</label>
                <input name="name" value={form.name} onChange={handleChange} placeholder="Your full name" required
                  style={{ width: "100%", background: "#111", border: "1px solid #1E1E1E", borderRadius: 12, padding: "14px 16px", color: "#fff", fontSize: 14, outline: "none", boxSizing: "border-box", fontFamily: "'DM Sans', sans-serif" }} />
              </div>
            )}

            <div>
              <label style={{ color: "#555", fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.8px", display: "block", marginBottom: 6 }}>Email</label>
              <input name="email" type="email" value={form.email} onChange={handleChange} placeholder="you@university.edu" required
                style={{ width: "100%", background: "#111", border: "1px solid #1E1E1E", borderRadius: 12, padding: "14px 16px", color: "#fff", fontSize: 14, outline: "none", boxSizing: "border-box", fontFamily: "'DM Sans', sans-serif" }} />
            </div>

            <div>
              <label style={{ color: "#555", fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.8px", display: "block", marginBottom: 6 }}>Password</label>
              <input name="password" type="password" value={form.password} onChange={handleChange} placeholder="••••••••" required
                style={{ width: "100%", background: "#111", border: "1px solid #1E1E1E", borderRadius: 12, padding: "14px 16px", color: "#fff", fontSize: 14, outline: "none", boxSizing: "border-box", fontFamily: "'DM Sans', sans-serif" }} />
            </div>

            {mode === "register" && (
              <>
                <div>
                  <label style={{ color: "#555", fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.8px", display: "block", marginBottom: 6 }}>I am a</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    {["student", "driver"].map(r => (
                      <button key={r} type="button" onClick={() => setForm({ ...form, role: r })} style={{
                        flex: 1, padding: "12px 0", borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 500, fontFamily: "'DM Sans', sans-serif",
                        border: form.role === r ? "1px solid #FF5A1F" : "1px solid #1E1E1E",
                        background: form.role === r ? "#1A0F0A" : "#111",
                        color: form.role === r ? "#FF5A1F" : "#555",
                        transition: "all 0.2s"
                      }}>
                        {r === "student" ? "🎓 Student" : "🚌 Driver"}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label style={{ color: "#555", fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.8px", display: "block", marginBottom: 6 }}>Campus</label>
                  <select name="campusId" value={form.campusId} onChange={handleChange}
                    style={{ width: "100%", background: "#111", border: "1px solid #1E1E1E", borderRadius: 12, padding: "14px 16px", color: "#fff", fontSize: 14, outline: "none", boxSizing: "border-box", fontFamily: "'DM Sans', sans-serif" }}>
                    {CAMPUSES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </>
            )}

            {error && (
              <div style={{ background: "#1A0808", border: "1px solid #3D1010", borderRadius: 10, padding: "12px 14px" }}>
                <p style={{ color: "#F87171", fontSize: 12, margin: 0 }}>{error}</p>
              </div>
            )}

            <button type="submit" disabled={loading} style={{
              width: "100%", background: loading ? "#2A1A10" : "#FF5A1F", border: "none", borderRadius: 12,
              padding: "16px 0", color: "#fff", fontSize: 15, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer",
              fontFamily: "'DM Sans', sans-serif", marginTop: 4, letterSpacing: "-0.2px", transition: "all 0.2s"
            }}>
              {loading ? "Please wait..." : mode === "login" ? "Sign In →" : "Create Account →"}
            </button>
          </form>

          <p style={{ textAlign: "center", color: "#2A2A2A", fontSize: 11, marginTop: 28 }}>Admin access via invite only</p>
        </div>
      </div>
    </div>
  );
}
