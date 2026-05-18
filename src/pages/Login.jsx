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
      perspective: "1200px",           // 3D perspective
      perspectiveOrigin: "50% 80%"
    }}>
      {/* Futuristic Road / Grid */}
      <div style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        height: "48px",
        background: "linear-gradient(180deg, #0A0A0A 0%, #111 100%)",
        boxShadow: "0 -20px 40px rgba(255,90,31,0.15)"
      }} />

      {/* Holographic Road Lines */}
      {[0,1,2,3,4,5,6,7,8,9].map(i => (
        <div
          key={i}
          style={{
            position: "absolute",
            bottom: "18px",
            left: `${i * 11}%`,
            width: "9%",
            height: "3px",
            background: "linear-gradient(90deg, transparent, #00F0FF, #FF5A1F, transparent)",
            boxShadow: "0 0 8px #00F0FF",
            animation: `roadMove 1.4s linear infinite`,
            animationDelay: `${i * -0.14}s`,
            opacity: 0.9,
            willChange: "transform"
          }}
        />
      ))}

      {/* Futuristic Bus - 3D Style */}
      <div style={{
        position: "absolute",
        bottom: "28px",
        left: "-20%",
        animation: "busDrive 14s linear infinite",
        animationDelay: "0.5s",
        transformStyle: "preserve-3d",
        willChange: "transform"
      }}>
        <div style={{
          width: "110px",
          height: "48px",
          background: "linear-gradient(145deg, #FF5A1F, #E84E17)",
          borderRadius: "14px 14px 8px 8px",
          position: "relative",
          boxShadow: `
            0 15px 35px rgba(0,0,0,0.8),
            0 0 25px rgba(255,90,31,0.6),
            inset 0 0 20px rgba(255,255,255,0.15)
          `,
          transform: "rotateX(12deg) translateZ(0)",
        }}>
          {/* Neon Windows */}
          {[12, 34, 56, 78].map((l, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                top: "10px",
                left: l,
                width: "14px",
                height: "18px",
                background: "#0A1625",
                borderRadius: "3px",
                boxShadow: "0 0 12px #00F0FF",
                border: "1px solid #00F0FF"
              }}
            />
          ))}

          {/* Bottom Neon Stripe */}
          <div style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: "12px",
            background: "linear-gradient(90deg, #00F0FF, #FF5A1F)",
            borderRadius: "0 0 8px 8px",
            boxShadow: "0 0 15px #00F0FF"
          }} />

          {/* Futuristic Headlight */}
          <div style={{
            position: "absolute",
            top: "14px",
            left: "-18px",
            width: "22px",
            height: "16px",
            background: "#BAE6FD",
            borderRadius: "50% 40% 40% 50%",
            boxShadow: "0 0 25px #67E8F9, 0 0 40px #0EA5E9",
            animation: "glow 1.2s ease-in-out infinite alternate"
          }} />

          {/* Side Scanner Line */}
          <div style={{
            position: "absolute",
            top: "22px",
            left: "0",
            right: "0",
            height: "2px",
            background: "#67E8F9",
            boxShadow: "0 0 10px #67E8F9",
            animation: "scan 2.5s linear infinite"
          }} />
        </div>

        {/* Wheels with 3D rim effect */}
        {[18, 78].map((pos, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              bottom: "-14px",
              left: pos,
              width: "24px",
              height: "24px",
              background: "#0A0A0A",
              border: "4px solid #444",
              borderRadius: "50%",
              boxShadow: "0 4px 12px rgba(0,0,0,0.9), inset 0 0 10px #666",
              animation: "wheelSpin 0.5s linear infinite",
              transform: "translateZ(10px)"
            }}
          >
            <div style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              width: "10px",
              height: "10px",
              background: "#222",
              borderRadius: "50%",
              boxShadow: "inset 0 0 6px #888"
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
    setTimeout(() => setMounted(true), 80);
    setTimeout(() => setFormVisible(true), 350);
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
      overflow: "hidden",
      color: "#fff"
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&display=swap');
        
        @keyframes twinkle { 0%,100%{opacity:0.15} 50%{opacity:0.85} }
        @keyframes roadMove { from { transform: translateX(0); } to { transform: translateX(-16%); } }
        @keyframes busDrive { 0% { transform: translateX(0) rotateX(8deg); } 100% { transform: translateX(122vw) rotateX(8deg); } }
        @keyframes wheelSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes glow { from { box-shadow: 0 0 20px #67E8F9; } to { box-shadow: 0 0 35px #BAE6FD; } }
        @keyframes scan { 0% { transform: translateX(-100%); } 100% { transform: translateX(200%); } }

        @keyframes slideUp { from{opacity:0;transform:translateY(30px)} to{opacity:1;transform:translateY(0)} }
        @keyframes fadeIn { from{opacity:0} to{opacity:1} }

        input:focus { border-color: #00F0FF !important; box-shadow: 0 0 0 3px rgba(0,240,255,0.2); }
      `}</style>

      {/* Stars / Particles */}
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
            willChange: "opacity"
          }}
        />
      ))}

      {/* Rest of your UI (Header + Form) remains the same */}
      {/* ... [Keep your existing header, form card, etc.] ... */}

      {/* Futuristic 3D Bus */}
      <AnimatedBus />
    </div>
  );
}