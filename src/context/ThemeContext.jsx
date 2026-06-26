import { createContext, useContext, useState, useEffect } from "react";

const ThemeContext = createContext();

export function ThemeProvider({ children }) {
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem("cm_theme");
    if (saved) return saved === "dark";
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    localStorage.setItem("cm_theme", dark ? "dark" : "light");
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  }, [dark]);

  const toggle = () => setDark(d => !d);

  // All colors in one place — swap here to change everywhere
  const t = dark ? {
    bg:          "#0B0F19", // Deep Navy Charcoal
    bgCard:      "#111827", // Modern Dark Card
    bgCard2:     "#1F2937", // Secondary Dark Card
    border:      "#1F2937", // Clean slate border
    borderStrong:"#374151", // Stronger divider
    text:        "#F9FAFB", // High contrast white
    textSub:     "#E5E7EB", // Medium gray text
    textMuted:   "#9CA3AF", // Soft gray details
    textHint:    "#6B7280", // Hint text
    accent:      "#3B82F6", // Electric Corporate Blue
    accentSub:   "#1E3A8A", // Deep navy highlight
    accentBorder:"#2563EB", // Blue accent border
    tabActive:   "#3B82F6",
    tabInactive: "#9CA3AF",
    btnText:     "#F3F4F6",
    headerBg:    "rgba(11,15,25,0.92)",
    inputBg:     "#111827",
    inputBorder: "#1F2937",
    pill: {
      activeBg:    "#1E3A8A",
      activeBorder:"#2563EB",
      activeText:  "#93C5FD",
      inactiveBg:  "#1F2937",
      inactiveBorder:"#374151",
      inactiveText:"#9CA3AF",
    },
  } : {
    bg:          "#F8FAFC", // Clean Slate Gray 50
    bgCard:      "#FFFFFF", // Pure Crisp White
    bgCard2:     "#F1F5F9", // Slate Gray 100
    border:      "#E2E8F0", // Slate Gray 200
    borderStrong:"#CBD5E1", // Slate Gray 300
    text:        "#0F172A", // Slate Gray 900
    textSub:     "#475569", // Slate Gray 600
    textMuted:   "#64748B", // Slate Gray 500
    textHint:    "#94A3B8", // Slate Gray 400
    accent:      "#2563EB", // Trust Blue 600
    accentSub:   "#EFF6FF", // Light Blue Highlight 50
    accentBorder:"#BFDBFE", // Blue border highlight 200
    tabActive:   "#2563EB",
    tabInactive: "#64748B",
    btnText:     "#475569",
    headerBg:    "rgba(255,255,255,0.92)",
    inputBg:     "#FFFFFF",
    inputBorder: "#E2E8F0",
    pill: {
      activeBg:    "#EFF6FF",
      activeBorder:"#BFDBFE",
      activeText:  "#1E40AF",
      inactiveBg:  "#F1F5F9",
      inactiveBorder:"#E2E8F0",
      inactiveText:"#475569",
    },
  };

  return (
    <ThemeContext.Provider value={{ dark, toggle, t }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
