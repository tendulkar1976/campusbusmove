import { useState, useEffect } from "react";
import { useTheme } from "../context/ThemeContext";

const PERMISSIONS = [
  {
    id: "location",
    icon: "📍",
    title: "Location Access",
    description: "Required to show your position on map and auto-mark attendance when the bus is nearby.",
    required: true,
  },
  {
    id: "notifications",
    icon: "🔔",
    title: "Push Notifications",
    description: "Get alerts when your bus is nearby, delayed, or attendance is marked.",
    required: false,
  },
];

export default function PermissionsGate({ children }) {
  const { dark, t } = useTheme();
  const [step, setStep] = useState("checking"); // checking | needed | done
  const [current, setCurrent] = useState(0);
  const [results, setResults] = useState({});
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    const alreadyGranted = localStorage.getItem("cm_permissions_done");
    if (alreadyGranted) { setStep("done"); return; }
    setStep("needed");
  }, []);

  async function requestPermission(perm) {
    setRequesting(true);
    if (perm.id === "location") {
      try {
        await new Promise((res, rej) =>
          navigator.geolocation.getCurrentPosition(res, rej, { timeout: 8000 })
        );
        setResults(r => ({ ...r, location: "granted" }));
      } catch {
        setResults(r => ({ ...r, location: "denied" }));
      }
    } else if (perm.id === "notifications") {
      try {
        const result = await Notification.requestPermission();
        setResults(r => ({ ...r, notifications: result }));
      } catch {
        setResults(r => ({ ...r, notifications: "denied" }));
      }
    }
    setRequesting(false);
    goNext();
  }

  function skipPermission() {
    setResults(r => ({ ...r, [PERMISSIONS[current].id]: "skipped" }));
    goNext();
  }

  function goNext() {
    if (current < PERMISSIONS.length - 1) {
      setCurrent(c => c + 1);
    } else {
      localStorage.setItem("cm_permissions_done", "true");
      setStep("done");
    }
  }

  if (step === "checking") return null;
  if (step === "done") return children;

  const perm = PERMISSIONS[current];
  const isGranted = results[perm.id] === "granted";

  return (
    <div style={{ 
      minHeight: "100vh", 
      background: t.bg, 
      display: "flex", 
      flexDirection: "column", 
      alignItems: "center", 
      justifyContent: "center", 
      padding: "24px", 
      fontFamily: "'Inter', sans-serif",
      transition: "background 0.25s"
    }}>
      <style>{`
        @keyframes pulsePill {
          0% { transform: scale(0.95); opacity: 0.15; }
          50% { transform: scale(1.15); opacity: 0.3; }
          100% { transform: scale(0.95); opacity: 0.15; }
        }
      `}</style>

      {/* Main card */}
      <div style={{
        background: t.bgCard,
        border: `1.5px solid ${t.border}`,
        borderRadius: 24,
        padding: "40px 32px",
        maxWidth: 400,
        width: "100%",
        boxShadow: dark ? "0 10px 40px rgba(0,0,0,0.3)" : "0 12px 36px rgba(15,23,42,0.04)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        position: "relative"
      }}>
        {/* Progress dots */}
        <div style={{ display: "flex", gap: 8, marginBottom: 36 }}>
          {PERMISSIONS.map((_, i) => (
            <div 
              key={i} 
              style={{ 
                width: i === current ? 24 : 8, 
                height: 8, 
                borderRadius: 4, 
                background: i === current ? t.accent : i < current ? `${t.accent}44` : t.border, 
                transition: "all 0.3s" 
              }} 
            />
          ))}
        </div>

        {/* Icon with pulsing background */}
        <div style={{ position: "relative", marginBottom: 28 }}>
          <div style={{ 
            position: "absolute", 
            top: -8, left: -8, right: -8, bottom: -8, 
            background: t.accent, 
            borderRadius: "50%", 
            animation: "pulsePill 2.2s infinite ease-in-out" 
          }} />
          <div style={{ 
            width: 72, 
            height: 72, 
            background: dark ? t.bgCard2 : "#F8FAFC", 
            border: `1.5px solid ${t.border}`, 
            borderRadius: "50%", 
            display: "flex", 
            alignItems: "center", 
            justifyContent: "center", 
            fontSize: 32, 
            position: "relative",
            zIndex: 1
          }}>
            {perm.icon}
          </div>
        </div>

        {/* Content */}
        <h2 style={{ color: t.text, fontSize: 20, fontWeight: 800, letterSpacing: "-0.5px", margin: "0 0 12px" }}>
          {perm.title}
        </h2>
        <p style={{ color: t.textMuted, fontSize: 13, lineHeight: 1.6, margin: "0 0 32px" }}>
          {perm.description}
        </p>

        {/* Buttons / Actions */}
        {isGranted ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%" }}>
            <div style={{ background: dark ? "#0F2E1B" : "#ECFDF5", border: `1.5px solid ${dark ? "#1E4D2B" : "#A7F3D0"}`, borderRadius: 12, padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <span style={{ fontSize: 16 }}>✅</span>
              <span style={{ color: dark ? "#34D399" : "#047857", fontSize: 13, fontWeight: 700 }}>Permission Granted!</span>
            </div>
            <button onClick={goNext} style={{ width: "100%", background: t.accent, border: "none", borderRadius: 12, padding: "14px 0", color: "#fff", fontSize: 14, fontWeight: 800, cursor: "pointer", fontFamily: "'Inter', sans-serif", boxShadow: `0 4px 16px ${t.accent}22` }}>
              Continue
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%" }}>
            <button 
              onClick={() => requestPermission(perm)} 
              disabled={requesting} 
              style={{ 
                width: "100%", 
                background: requesting ? t.bgCard2 : t.accent, 
                border: "none", 
                borderRadius: 12, 
                padding: "14px 0", 
                color: requesting ? t.textMuted : "#fff", 
                fontSize: 14, 
                fontWeight: 800, 
                cursor: requesting ? "not-allowed" : "pointer", 
                fontFamily: "'Inter', sans-serif", 
                boxShadow: requesting ? "none" : `0 4px 16px ${t.accent}22` 
              }}
            >
              {requesting ? "Requesting..." : `Allow ${perm.title}`}
            </button>
            
            {!perm.required && (
              <button onClick={skipPermission} style={{ width: "100%", background: "transparent", border: `1.5px solid ${t.border}`, borderRadius: 12, padding: "12px 0", color: t.textSub, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "'Inter', sans-serif" }}>
                Skip for now
              </button>
            )}
            
            {perm.required && (
              <p style={{ color: t.textHint, fontSize: 11, fontWeight: 600, marginTop: 4 }}>
                * Location is required for the app to function properly.
              </p>
            )}
          </div>
        )}
      </div>

      {/* App branding */}
      <div style={{ marginTop: 24, display: "flex", alignItems: "center", gap: 8, opacity: 0.6 }}>
        <div style={{ width: 20, height: 20, background: t.accent, borderRadius: 5, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#fff" }}>🚌</div>
        <span style={{ color: t.textMuted, fontSize: 11, fontWeight: 700, letterSpacing: "0.5px", textTransform: "uppercase" }}>CampusMove</span>
      </div>
    </div>
  );
}

