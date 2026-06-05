import { useState, useEffect } from "react";

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
    <div style={{ minHeight: "100vh", background: "#0A0A0A", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "0 28px", fontFamily: "'DM Sans', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&display=swap');`}</style>

      {/* Progress dots */}
      <div style={{ display: "flex", gap: 8, marginBottom: 48 }}>
        {PERMISSIONS.map((_, i) => (
          <div key={i} style={{ width: i === current ? 24 : 8, height: 8, borderRadius: 4, background: i === current ? "#FF5A1F" : i < current ? "#FF5A1F44" : "#1A1A1A", transition: "all 0.3s" }} />
        ))}
      </div>

      {/* Icon */}
      <div style={{ width: 80, height: 80, background: "#111", border: "1px solid #1A1A1A", borderRadius: 24, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36, marginBottom: 28, boxShadow: "0 0 40px rgba(255,90,31,0.1)" }}>
        {perm.icon}
      </div>

      {/* Content */}
      <h2 style={{ color: "#fff", fontSize: 24, fontWeight: 600, letterSpacing: "-0.5px", margin: "0 0 12px", textAlign: "center" }}>
        {perm.title}
      </h2>
      <p style={{ color: "#444", fontSize: 14, lineHeight: 1.7, textAlign: "center", maxWidth: 300, margin: "0 0 40px" }}>
        {perm.description}
      </p>

      {/* Granted state */}
      {isGranted ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%", maxWidth: 320 }}>
          <div style={{ background: "#0D1F12", border: "1px solid #1E4D2B", borderRadius: 14, padding: "14px 20px", display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 20 }}>✅</span>
            <span style={{ color: "#4ADE80", fontSize: 14, fontWeight: 500 }}>Permission granted!</span>
          </div>
          <button onClick={goNext} style={{ width: "100%", background: "#FF5A1F", border: "none", borderRadius: 14, padding: "16px 0", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", boxShadow: "0 4px 22px rgba(255,90,31,0.3)" }}>
            Continue →
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%", maxWidth: 320 }}>
          <button onClick={() => requestPermission(perm)} disabled={requesting} style={{ width: "100%", background: requesting ? "#1A0E06" : "#FF5A1F", border: "none", borderRadius: 14, padding: "16px 0", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", boxShadow: "0 4px 22px rgba(255,90,31,0.3)" }}>
            {requesting ? "Requesting..." : `Allow ${perm.title}`}
          </button>
          {!perm.required && (
            <button onClick={skipPermission} style={{ width: "100%", background: "none", border: "1px solid #1A1A1A", borderRadius: 14, padding: "14px 0", color: "#333", fontSize: 14, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>
              Skip for now
            </button>
          )}
          {perm.required && (
            <p style={{ color: "#2A2A2A", fontSize: 12, textAlign: "center", margin: 0 }}>
              Location is required for the app to work properly.
            </p>
          )}
        </div>
      )}

      {/* App branding */}
      <div style={{ position: "absolute", bottom: 40, display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 24, height: 24, background: "#FF5A1F", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>🚌</div>
        <span style={{ color: "#1A1A1A", fontSize: 12, fontWeight: 500 }}>CampusMove</span>
      </div>
    </div>
  );
}

