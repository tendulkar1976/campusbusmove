import { useEffect, useRef, memo, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// ── Shared Helper ──
function lerp(a, b, t) { return a + (b - a) * t; }

// ── Leaflet Icons Cache ──
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

const TILES = {
  dark:  "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  light: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
};

// ── Google Maps Themes ──
const GOOGLE_MAPS_STYLES = {
  dark: [
    { elementType: "geometry", stylers: [{ color: "#0B0F19" }] },
    { elementType: "labels.text.stroke", stylers: [{ color: "#0B0F19" }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#4B5563" }] },
    { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#9CA3AF" }] },
    { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#6B7280" }] },
    { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#111827" }] },
    { featureType: "poi.park", elementType: "labels.text.fill", stylers: [{ color: "#4B5563" }] },
    { featureType: "road", elementType: "geometry", stylers: [{ color: "#1F2937" }] },
    { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#374151" }] },
    { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#9CA3AF" }] },
    { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#374151" }] },
    { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#1F2937" }] },
    { featureType: "road.highway", elementType: "labels.text.fill", stylers: [{ color: "#D1D5DB" }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: "#1A2E40" }] },
    { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#3B82F6" }] },
  ],
  light: [
    { elementType: "geometry", stylers: [{ color: "#F1F5F9" }] },
    { elementType: "labels.text.stroke", stylers: [{ color: "#F1F5F9" }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#6B7280" }] },
    { featureType: "road", elementType: "geometry", stylers: [{ color: "#FFFFFF" }] },
    { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#E2E8F0" }] },
    { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#F8FAFC" }] },
    { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#E2E8F0" }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: "#BFDBFE" }] },
  ],
};

// ── Dynamic Google Maps script loader ──
let googleScriptPromise = null;
function loadGoogleMaps(apiKey) {
  if (window.google?.maps) return Promise.resolve();
  if (googleScriptPromise) return googleScriptPromise;
  
  googleScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}`;
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return googleScriptPromise;
}

// ── Leaflet Map Component ──
const LeafletMapView = memo(function LeafletMapView({ busLocation, busMoving, routePath, center, myLocation, dark }) {
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

  useEffect(() => {
    if (mapInstance.current) return;
    mapInstance.current = L.map(mapRef.current, {
      center: defaultCenter,
      zoom: 16,
      zoomControl: false,
      attributionControl: false,
      renderer: L.canvas({ padding: 0.5 }),
    });

    tileLayer.current = L.tileLayer(dark ? TILES.dark : TILES.light, {
      subdomains: "abcd",
      maxZoom: 19,
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

  useEffect(() => {
    if (!mapInstance.current || !tileLayer.current) return;
    tileLayer.current.setUrl(dark ? TILES.dark : TILES.light);
  }, [dark]);

  useEffect(() => {
    if (!mapInstance.current || !routePath?.length) return;
    routeLayer.current?.remove();
    routeLayer.current = L.polyline(routePath, {
      color: "#FF5A1F", weight: 4, opacity: 0.7, dashArray: "8 5",
    }).addTo(mapInstance.current);
  }, [routePath]);

  useEffect(() => {
    if (!mapInstance.current) return;
    if (!busLocation) {
      if (busMarker.current) busMarker.current.setIcon(getBusIcon(false));
      cancelAnimationFrame(animFrameRef.current);
      return;
    }

    const { lat, lng } = busLocation;
    let actuallyMoving = busMoving;
    if (prevBusPos.current) {
      const dlat = Math.abs(lat - prevBusPos.current.lat);
      const dlng = Math.abs(lng - prevBusPos.current.lng);
      actuallyMoving = dlat > 0.00003 || dlng > 0.00003;
    }
    prevBusPos.current = { lat, lng };
    targetPosRef.current = { lat, lng };
    if (!currentPosRef.current) currentPosRef.current = { lat, lng };

    const iconChanged = prevMoving.current !== actuallyMoving;
    prevMoving.current = actuallyMoving;
    const icon = getBusIcon(actuallyMoving);

    if (!busMarker.current) {
      busMarker.current = L.marker([lat, lng], { icon, zIndexOffset: 100 }).addTo(mapInstance.current);
      currentPosRef.current = { lat, lng };
    } else if (iconChanged) {
      busMarker.current.setIcon(icon);
    }

    cancelAnimationFrame(animFrameRef.current);
    const duration = 600;
    const startTime = performance.now();
    const startPos = { ...currentPosRef.current };

    function animate(now) {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      const iLat = lerp(startPos.lat, targetPosRef.current.lat, eased);
      const iLng = lerp(startPos.lng, targetPosRef.current.lng, eased);
      currentPosRef.current = { lat: iLat, lng: iLng };
      busMarker.current?.setLatLng([iLat, iLng]);
      if (t < 1) animFrameRef.current = requestAnimationFrame(animate);
    }
    animFrameRef.current = requestAnimationFrame(animate);

    mapInstance.current.panTo([lat, lng], { animate: true, duration: 0.7, easeLinearity: 0.5 });
  }, [busLocation, busMoving]);

  useEffect(() => {
    if (!mapInstance.current || !myLocation) return;
    const { lat, lng } = myLocation;
    if (!myMarker.current) {
      myMarker.current = L.marker([lat, lng], { icon: MY_ICON, zIndexOffset: 50 }).addTo(mapInstance.current);
    } else {
      myMarker.current.setLatLng([lat, lng]);
    }
  }, [myLocation]);

  return <div ref={mapRef} style={{ width: "100%", height: "100%", borderRadius: 14 }} />;
});

// ── Google Map Component ──
const GoogleMapView = memo(function GoogleMapView({ busLocation, busMoving, routePath, center, myLocation, dark }) {
  const mapRef        = useRef(null);
  const mapInstance   = useRef(null);
  const busMarker     = useRef(null);
  const myMarker      = useRef(null);
  const routePolyline = useRef(null);
  const prevBusPos    = useRef(null);
  const prevMoving    = useRef(null);
  const animFrameRef  = useRef(null);
  const targetPosRef  = useRef(null);
  const currentPosRef = useRef(null);

  const defaultCenter = center || [12.9716, 77.5946];

  useEffect(() => {
    if (mapInstance.current || !mapRef.current) return;
    mapInstance.current = new window.google.maps.Map(mapRef.current, {
      center: { lat: defaultCenter[0], lng: defaultCenter[1] },
      zoom: 16,
      disableDefaultUI: true,
      zoomControl: true,
      zoomControlOptions: {
        position: window.google.maps.ControlPosition.RIGHT_BOTTOM,
      },
      styles: dark ? GOOGLE_MAPS_STYLES.dark : GOOGLE_MAPS_STYLES.light,
    });

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      busMarker.current?.setMap(null);
      myMarker.current?.setMap(null);
      routePolyline.current?.setMap(null);
      mapInstance.current = null;
    };
  }, []);

  // Update styles on theme change
  useEffect(() => {
    if (!mapInstance.current) return;
    mapInstance.current.setOptions({
      styles: dark ? GOOGLE_MAPS_STYLES.dark : GOOGLE_MAPS_STYLES.light,
    });
  }, [dark]);

  // Route Polyline
  useEffect(() => {
    if (!mapInstance.current) return;
    if (routePolyline.current) {
      routePolyline.current.setMap(null);
      routePolyline.current = null;
    }
    if (!routePath?.length) return;

    const pathCoords = routePath.map(coord => ({ lat: coord[0], lng: coord[1] }));
    
    // Dashed line in Google Maps
    routePolyline.current = new window.google.maps.Polyline({
      path: pathCoords,
      geodesic: true,
      strokeColor: "#FF5A1F",
      strokeOpacity: 0,
      strokeWeight: 4,
      icons: [{
        icon: {
          path: "M 0,-1 0,1",
          strokeOpacity: 0.8,
          strokeWeight: 4,
          scale: 3
        },
        offset: "0",
        repeat: "15px"
      }],
    });
    routePolyline.current.setMap(mapInstance.current);
  }, [routePath]);

  // Bus Marker and smooth tracking
  useEffect(() => {
    if (!mapInstance.current) return;
    if (!busLocation) {
      cancelAnimationFrame(animFrameRef.current);
      return;
    }

    const { lat, lng } = busLocation;
    let actuallyMoving = busMoving;
    if (prevBusPos.current) {
      const dlat = Math.abs(lat - prevBusPos.current.lat);
      const dlng = Math.abs(lng - prevBusPos.current.lng);
      actuallyMoving = dlat > 0.00003 || dlng > 0.00003;
    }
    prevBusPos.current = { lat, lng };
    targetPosRef.current = { lat, lng };
    if (!currentPosRef.current) currentPosRef.current = { lat, lng };

    prevMoving.current = actuallyMoving;
    const color = actuallyMoving ? "#4ADE80" : "#F87171";

    const busIcon = {
      path: window.google.maps.SymbolPath.CIRCLE,
      fillColor: color,
      fillOpacity: 1.0,
      strokeColor: "#FFFFFF",
      strokeWeight: 3.5,
      scale: 9,
    };

    if (!busMarker.current) {
      busMarker.current = new window.google.maps.Marker({
        position: { lat, lng },
        map: mapInstance.current,
        icon: busIcon,
        zIndex: 100,
      });
      currentPosRef.current = { lat, lng };
    } else {
      busMarker.current.setIcon(busIcon);
    }

    cancelAnimationFrame(animFrameRef.current);
    const duration = 600;
    const startTime = performance.now();
    const startPos = { ...currentPosRef.current };

    function animate(now) {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      const iLat = lerp(startPos.lat, targetPosRef.current.lat, eased);
      const iLng = lerp(startPos.lng, targetPosRef.current.lng, eased);
      currentPosRef.current = { lat: iLat, lng: iLng };
      busMarker.current?.setPosition({ lat: iLat, lng: iLng });
      if (t < 1) animFrameRef.current = requestAnimationFrame(animate);
    }
    animFrameRef.current = requestAnimationFrame(animate);

    mapInstance.current.panTo({ lat, lng });
  }, [busLocation, busMoving]);

  // My location marker
  useEffect(() => {
    if (!mapInstance.current || !myLocation) return;
    const { lat, lng } = myLocation;

    const myIcon = {
      path: window.google.maps.SymbolPath.CIRCLE,
      fillColor: "#60A5FA",
      fillOpacity: 1.0,
      strokeColor: "#FFFFFF",
      strokeWeight: 2.5,
      scale: 7,
    };

    if (!myMarker.current) {
      myMarker.current = new window.google.maps.Marker({
        position: { lat, lng },
        map: mapInstance.current,
        icon: myIcon,
        zIndex: 50,
      });
    } else {
      myMarker.current.setPosition({ lat, lng });
    }
  }, [myLocation]);

  return <div ref={mapRef} style={{ width: "100%", height: "100%", borderRadius: 14 }} />;
});

// ── Main MapView Wrapper ──
const MapView = memo(function MapView({ busLocation, busMoving, routePath, center, myLocation, dark = true }) {
  const [useGoogleMaps, setUseGoogleMaps] = useState(false);
  const [sdkLoading, setSdkLoading] = useState(false);
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "";

  useEffect(() => {
    if (apiKey) {
      setSdkLoading(true);
      loadGoogleMaps(apiKey)
        .then(() => {
          setUseGoogleMaps(true);
        })
        .catch(err => {
          console.error("Google Maps SDK failed to load, falling back to Leaflet:", err);
          setUseGoogleMaps(false);
        })
        .finally(() => {
          setSdkLoading(false);
        });
    } else {
      setUseGoogleMaps(false);
    }
  }, [apiKey]);

  return (
    <div style={{ width: "100%", height: 300, zIndex: 0, borderRadius: 14, contain: "strict", background: dark ? "#0B0F19" : "#F1F5F9" }}>
      {sdkLoading ? (
        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: dark ? "#4B5563" : "#9CA3AF" }}>
          <div style={{ width: 24, height: 24, border: `2.5px solid ${dark ? "#1F2937" : "#E5E7EB"}`, borderTopColor: "#FF5A1F", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      ) : useGoogleMaps ? (
        <GoogleMapView
          busLocation={busLocation}
          busMoving={busMoving}
          routePath={routePath}
          center={center}
          myLocation={myLocation}
          dark={dark}
        />
      ) : (
        <LeafletMapView
          busLocation={busLocation}
          busMoving={busMoving}
          routePath={routePath}
          center={center}
          myLocation={myLocation}
          dark={dark}
        />
      )}
    </div>
  );
});

export default MapView;
