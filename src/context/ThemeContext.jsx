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
    bg:          "#0A0A0A",
    bgCard:      "#111111",
    bgCard2:     "#161616",
    border:      "#1E1E1E",
    borderStrong:"#2A2A2A",
    text:        "#FFFFFF",
    textSub:     "#AAAAAA",
    textMuted:   "#666666",
    textHint:    "#444444",
    accent:      "#FF5A1F",
    accentSub:   "#150D09",
    accentBorder:"#3D1F0A",
    tabActive:   "#FF5A1F",
    tabInactive: "#555555",
    btnText:     "#CCCCCC",
    headerBg:    "rgba(10,10,10,0.95)",
    inputBg:     "#0A0A0A",
    inputBorder: "#1E1E1E",
    pill: {
      activeBg:    "#0A1A0D",
      activeBorder:"#1A3D22",
      activeText:  "#4ADE80",
      inactiveBg:  "#111",
      inactiveBorder:"#1E1E1E",
      inactiveText:"#666",
    },
  } : {
    bg:          "#F5F5F0",
    bgCard:      "#FFFFFF",
    bgCard2:     "#F0F0EB",
    border:      "#E0E0D8",
    borderStrong:"#C8C8C0",
    text:        "#111111",
    textSub:     "#444444",
    textMuted:   "#666666",
    textHint:    "#999999",
    accent:      "#E04800",
    accentSub:   "#FFF0EB",
    accentBorder:"#FFD0B8",
    tabActive:   "#E04800",
    tabInactive: "#777777",
    btnText:     "#333333",
    headerBg:    "rgba(245,245,240,0.95)",
    inputBg:     "#FFFFFF",
    inputBorder: "#D8D8D0",
    pill: {
      activeBg:    "#ECFDF5",
      activeBorder:"#6EE7B7",
      activeText:  "#065F46",
      inactiveBg:  "#F5F5F0",
      inactiveBorder:"#D8D8D0",
      inactiveText:"#777",
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
