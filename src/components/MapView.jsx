import { useEffect, useRef, memo } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Built once per moving state — never recreated mid-render
const ICON_CACHE = {};
function getBusIcon(moving) {
  const key = moving ? "moving" : "stopped";
  if (ICON_CACHE[key]) return ICON_CACHE[key];
  const color = moving ? "#4ADE80" : "#F87171";
  const glow  = moving
    ? "0 0 0 3px rgba(74,222,128,0.25),0 0 14px rgba(74,222,128,0.5)"
    : "0 0 0 3px rgba(248,113,113,0.25),0 0 14px rgba(248,113,113,0.5)";
  ICON_CACHE[key] = L.divIcon({
    className: "",
    html: `<div style="position:relative;width:26px;height:26px;display:flex;align-items:center;justify-content:center;">
      <div style="width:18px;height:18px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:${glow};"></div>
      ${moving ? `<div style="position:absolute;inset:0;border-radius:50%;background:${color};opacity:0.25;animation:ping 1.4s cubic-bezier(0,0,0.2,1) infinite;"></div>` : ""}
    </div>
    <style>@keyframes ping{75%,100%{transform:scale(1.9);opacity:0}}</style>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
  return ICON_CACHE[key];
}

const MY_ICON = L.divIcon({
  className: "",
  html: `<div style="width:14px;height:14px;border-radius:50%;background:#60A5FA;border:3px solid #fff;box-shadow:0 0 0 5px rgba(96,165,250,0.2);"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

// Tile URLs — swap on theme change
const TILES = {
  dark:  "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  light: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
};

// Linear interpolation for smooth marker movement
function lerp(a, b, t) { return a + (b - a) * t; }

const MapView = memo(function MapView({ busLocation, busMoving, routePath, center, myLocation, dark = true }) {
  const mapRef        = useRef(null);
  const mapInstance   = useRef(null);
  const busMarker     = useRef(null);
  const myMarker      = useRef(null);
  const routeLayer    = useRef(null);
  const tileLayer     = useRef(null);
  const prevBusPos    = useRef(null);
  const prevMoving    = useRef(null);
  const animFrameRef  = useRef(null);
  const targetPosRef  = useRef(null);
  const currentPosRef = useRef(null);

  const defaultCenter = center || [12.9716, 77.5946];

  // ── Init map once ──
  useEffect(() => {
    if (mapInstance.current) return;
    mapInstance.current = L.map(mapRef.current, {
      center: defaultCenter,
      zoom: 16,
      zoomControl: false,
      attributionControl: false,
      // Performance: prefer canvas renderer
      renderer: L.canvas({ padding: 0.5 }),
    });

    tileLayer.current = L.tileLayer(dark ? TILES.dark : TILES.light, {
      subdomains: "abcd",
      maxZoom: 19,
      // Aggressive tile caching
      keepBuffer: 4,
      updateWhenIdle: false,
      updateWhenZooming: false,
    }).addTo(mapInstance.current);

    L.control.zoom({ position: "bottomright" }).addTo(mapInstance.current);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      mapInstance.current?.remove();
      mapInstance.current = null;
      busMarker.current = null;
      myMarker.current = null;
      routeLayer.current = null;
    };
  }, []);

  // ── Swap tile layer on theme change (no map reinit) ──
  useEffect(() => {
    if (!mapInstance.current || !tileLayer.current) return;
    tileLayer.current.setUrl(dark ? TILES.dark : TILES.light);
  }, [dark]);

  // ── Route polyline ──
  useEffect(() => {
    if (!mapInstance.current || !routePath?.length) return;
    routeLayer.current?.remove();
    routeLayer.current = L.polyline(routePath, {
      color: "#FF5A1F", weight: 4, opacity: 0.5, dashArray: "8 5",
    }).addTo(mapInstance.current);
  }, [routePath]);

  // ── Bus marker with smooth rAF interpolation ──
  useEffect(() => {
    if (!mapInstance.current) return;

    if (!busLocation) {
      if (busMarker.current) busMarker.current.setIcon(getBusIcon(false));
      cancelAnimationFrame(animFrameRef.current);
      return;
    }

    const { lat, lng } = busLocation;

    // Detect movement via position delta
    let actuallyMoving = busMoving;
    if (prevBusPos.current) {
      const dlat = Math.abs(lat - prevBusPos.current.lat);
      const dlng = Math.abs(lng - prevBusPos.current.lng);
      actuallyMoving = dlat > 0.00003 || dlng > 0.00003;
    }
    prevBusPos.current = { lat, lng };
    targetPosRef.current = { lat, lng };
    if (!currentPosRef.current) currentPosRef.current = { lat, lng };

    // Only rebuild icon when moving state changes
    const iconChanged = prevMoving.current !== actuallyMoving;
    prevMoving.current = actuallyMoving;
    const icon = getBusIcon(actuallyMoving);

    if (!busMarker.current) {
      busMarker.current = L.marker([lat, lng], { icon, zIndexOffset: 100 }).addTo(mapInstance.current);
      currentPosRef.current = { lat, lng };
    } else if (iconChanged) {
      busMarker.current.setIcon(icon);
    }

    // Cancel any running animation
    cancelAnimationFrame(animFrameRef.current);

    // Smooth interpolation over ~600ms using rAF
    const duration = 600;
    const startTime = performance.now();
    const startPos = { ...currentPosRef.current };

    function animate(now) {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      const iLat = lerp(startPos.lat, targetPosRef.current.lat, eased);
      const iLng = lerp(startPos.lng, targetPosRef.current.lng, eased);
      currentPosRef.current = { lat: iLat, lng: iLng };
      busMarker.current?.setLatLng([iLat, iLng]);
      if (t < 1) animFrameRef.current = requestAnimationFrame(animate);
    }
    animFrameRef.current = requestAnimationFrame(animate);

    // Pan map smoothly
    mapInstance.current.panTo([lat, lng], { animate: true, duration: 0.7, easeLinearity: 0.5 });
  }, [busLocation, busMoving]);

  // ── My location marker (no animation needed — just update) ──
  useEffect(() => {
    if (!mapInstance.current || !myLocation) return;
    const { lat, lng } = myLocation;
    if (!myMarker.current) {
      myMarker.current = L.marker([lat, lng], { icon: MY_ICON, zIndexOffset: 50 }).addTo(mapInstance.current);
    } else {
      myMarker.current.setLatLng([lat, lng]);
    }
  }, [myLocation]);

  return (
    <div
      ref={mapRef}
      style={{ width: "100%", height: 300, zIndex: 0, borderRadius: 14, contain: "strict" }}
    />
  );
});

export default MapView;
