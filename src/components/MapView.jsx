import { useEffect, useRef, memo, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// ── Shared Helper ──
function lerp(a, b, t) { return a + (b - a) * t; }

// ── Offset Overlapping Coordinates (Spiderfying) ──
function applyOffset(markers) {
  if (markers.length <= 1) return markers;

  const result = markers.map(m => ({ ...m, originalLat: m.lat, originalLng: m.lng }));
  const threshold = 0.00015; // ~15 meters
  const offsetRadius = 0.00008; // ~8 meters

  const groups = [];
  const visited = new Set();

  for (let i = 0; i < result.length; i++) {
    if (visited.has(i)) continue;
    const group = [i];
    visited.add(i);

    for (let j = i + 1; j < result.length; j++) {
      if (visited.has(j)) continue;
      const latDiff = result[i].lat - result[j].lat;
      const lngDiff = result[i].lng - result[j].lng;
      const dist = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff);
      if (dist < threshold) {
        group.push(j);
        visited.add(j);
      }
    }
    groups.push(group);
  }

  groups.forEach(group => {
    if (group.length <= 1) return;

    let avgLat = 0;
    let avgLng = 0;
    group.forEach(idx => {
      avgLat += result[idx].lat;
      avgLng += result[idx].lng;
    });
    avgLat /= group.length;
    avgLng /= group.length;

    group.forEach((idx, step) => {
      const angle = (2 * Math.PI * step) / group.length;
      result[idx].lat = avgLat + offsetRadius * Math.sin(angle);
      result[idx].lng = avgLng + offsetRadius * Math.cos(angle);
    });
  });

  return result;
}

// ── Rich CSS Tooltip/Popup Template ──
function getPopupContent(bus) {
  const statusColor = bus.moving ? "#DEF7EC" : "#FDE8E8";
  const statusTextCol = bus.moving ? "#03543F" : "#9B1C1C";
  const regNo = `KA-03-MM-${bus.routeId.slice(0, 4).toUpperCase()}`;
  return `
    <div style="font-family:'Inter',sans-serif;padding:4px;min-width:180px;line-height:1.4;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;border-bottom:1px solid #E5E7EB;padding-bottom:6px;">
        <span style="font-weight:800;font-size:13px;color:#111827;">${bus.routeName}</span>
        <span style="background:${statusColor};color:${statusTextCol};font-size:10px;font-weight:700;padding:2px 6px;border-radius:6px;text-transform:uppercase;">
          ${bus.moving ? "Live" : "Stopped"}
        </span>
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;font-size:11px;color:#4B5563;">
        <div><strong>Driver:</strong> ${bus.driverName}</div>
        <div><strong>Phone:</strong> <a href="tel:${bus.driverPhone}" style="color:#FF5A1F;text-decoration:none;font-weight:600;">${bus.driverPhone}</a></div>
        <div><strong>Speed:</strong> ${bus.speed} km/h</div>
        <div style="margin-top:4px;font-family:monospace;font-size:10px;background:#F3F4F6;color:#374151;padding:2px 6px;border-radius:4px;width:fit-content;letter-spacing:0.5px;">
          ${regNo}
        </div>
      </div>
    </div>
  `;
}

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
const LeafletMapView = memo(function LeafletMapView({ activeBuses, busLocation, busMoving, routePath, center, myLocation, dark }) {
  const mapRef        = useRef(null);
  const mapInstance   = useRef(null);
  const routeLayer    = useRef(null);
  const tileLayer     = useRef(null);
  const animFrameRef  = useRef(null);

  const markersRef          = useRef({}); // { [id]: L.marker }
  const currentPositionsRef = useRef({}); // { [id]: { lat, lng } }
  const targetPositionsRef  = useRef({});  // { [id]: { lat, lng } }
  const prevMovingRef       = useRef({});  // { [id]: boolean }

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
      markersRef.current = {};
      currentPositionsRef.current = {};
      targetPositionsRef.current = {};
      prevMovingRef.current = {};
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

  // Main active buses and user location rendering
  useEffect(() => {
    if (!mapInstance.current) return;

    const buses = activeBuses || (busLocation ? [{
      routeId: "default",
      routeName: "Active Bus",
      lat: busLocation.lat,
      lng: busLocation.lng,
      moving: busMoving,
      speed: 0,
      isCurrent: true,
      driverName: "Driver",
      driverPhone: "N/A"
    }] : []);

    const rawMarkers = [];
    if (myLocation && typeof myLocation.lat === "number" && !isNaN(myLocation.lat) && typeof myLocation.lng === "number" && !isNaN(myLocation.lng)) {
      rawMarkers.push({ id: "myLocation", lat: myLocation.lat, lng: myLocation.lng, isUser: true });
    }
    buses.forEach(b => {
      rawMarkers.push({ id: b.routeId, lat: b.lat, lng: b.lng, isBus: true, bus: b });
    });

    const plottedMarkers = applyOffset(rawMarkers);
    const activeIds = new Set(plottedMarkers.map(m => m.id));

    // Remove inactive markers
    Object.keys(markersRef.current).forEach(id => {
      if (!activeIds.has(id)) {
        markersRef.current[id].remove();
        delete markersRef.current[id];
        delete currentPositionsRef.current[id];
        delete targetPositionsRef.current[id];
        delete prevMovingRef.current[id];
      }
    });

    // Add or update active markers
    plottedMarkers.forEach(m => {
      const targetLat = m.lat;
      const targetLng = m.lng;
      targetPositionsRef.current[m.id] = { lat: targetLat, lng: targetLng };

      if (!markersRef.current[m.id]) {
        let marker;
        if (m.isUser) {
          marker = L.marker([targetLat, targetLng], { icon: MY_ICON, zIndexOffset: 50 });
        } else {
          marker = L.marker([targetLat, targetLng], { icon: getBusIcon(m.bus.moving), zIndexOffset: 100 });
          marker.bindPopup(getPopupContent(m.bus), { closeButton: false, offset: L.point(0, -6) });
          prevMovingRef.current[m.id] = m.bus.moving;
        }
        marker.addTo(mapInstance.current);
        markersRef.current[m.id] = marker;
        currentPositionsRef.current[m.id] = { lat: targetLat, lng: targetLng };
      } else {
        const marker = markersRef.current[m.id];
        if (m.isBus) {
          marker.setPopupContent(getPopupContent(m.bus));
          if (prevMovingRef.current[m.id] !== m.bus.moving) {
            marker.setIcon(getBusIcon(m.bus.moving));
            prevMovingRef.current[m.id] = m.bus.moving;
          }
        }
      }
    });

    // Smooth movement animations (interpolate position)
    cancelAnimationFrame(animFrameRef.current);
    const duration = 600;
    const startTime = performance.now();
    const startPositions = {};
    Object.keys(markersRef.current).forEach(id => {
      startPositions[id] = { ...(currentPositionsRef.current[id] || targetPositionsRef.current[id]) };
    });

    function animate(now) {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);

      Object.keys(markersRef.current).forEach(id => {
        const start = startPositions[id];
        const target = targetPositionsRef.current[id];
        const marker = markersRef.current[id];
        if (!start || !target || !marker) return;

        const iLat = lerp(start.lat, target.lat, eased);
        const iLng = lerp(start.lng, target.lng, eased);
        currentPositionsRef.current[id] = { lat: iLat, lng: iLng };
        marker.setLatLng([iLat, iLng]);
      });

      if (t < 1) {
        animFrameRef.current = requestAnimationFrame(animate);
      }
    }
    animFrameRef.current = requestAnimationFrame(animate);

    // Pan map to selected bus or student location
    const currentBus = buses.find(b => b.isCurrent);
    if (currentBus) {
      mapInstance.current.panTo([currentBus.lat, currentBus.lng], { animate: true, duration: 0.7 });
    } else if (myLocation) {
      mapInstance.current.panTo([myLocation.lat, myLocation.lng], { animate: true, duration: 0.7 });
    }
  }, [activeBuses, busLocation, busMoving, myLocation]);

  return <div ref={mapRef} style={{ width: "100%", height: "100%", borderRadius: 14 }} />;
});

// ── Google Map Component ──
const GoogleMapView = memo(function GoogleMapView({ activeBuses, busLocation, busMoving, routePath, center, myLocation, dark }) {
  const mapRef        = useRef(null);
  const mapInstance   = useRef(null);
  const routePolyline = useRef(null);
  const animFrameRef  = useRef(null);

  const markersRef          = useRef({}); // { [id]: google.maps.Marker }
  const currentPositionsRef = useRef({}); // { [id]: { lat, lng } }
  const targetPositionsRef  = useRef({});  // { [id]: { lat, lng } }
  const prevMovingRef       = useRef({});  // { [id]: boolean }
  const infoWindowRef       = useRef(null);

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

    infoWindowRef.current = new window.google.maps.InfoWindow();

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      Object.values(markersRef.current).forEach(m => m.setMap(null));
      markersRef.current = {};
      currentPositionsRef.current = {};
      targetPositionsRef.current = {};
      prevMovingRef.current = {};
      routePolyline.current?.setMap(null);
      mapInstance.current = null;
      infoWindowRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapInstance.current) return;
    mapInstance.current.setOptions({
      styles: dark ? GOOGLE_MAPS_STYLES.dark : GOOGLE_MAPS_STYLES.light,
    });
  }, [dark]);

  useEffect(() => {
    if (!mapInstance.current) return;
    if (routePolyline.current) {
      routePolyline.current.setMap(null);
      routePolyline.current = null;
    }
    if (!routePath?.length) return;

    const pathCoords = routePath.map(coord => ({ lat: coord[0], lng: coord[1] }));
    
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

  // Main active buses and user location rendering
  useEffect(() => {
    if (!mapInstance.current) return;

    const buses = activeBuses || (busLocation ? [{
      routeId: "default",
      routeName: "Active Bus",
      lat: busLocation.lat,
      lng: busLocation.lng,
      moving: busMoving,
      speed: 0,
      isCurrent: true,
      driverName: "Driver",
      driverPhone: "N/A"
    }] : []);

    const rawMarkers = [];
    if (myLocation && typeof myLocation.lat === "number" && !isNaN(myLocation.lat) && typeof myLocation.lng === "number" && !isNaN(myLocation.lng)) {
      rawMarkers.push({ id: "myLocation", lat: myLocation.lat, lng: myLocation.lng, isUser: true });
    }
    buses.forEach(b => {
      rawMarkers.push({ id: b.routeId, lat: b.lat, lng: b.lng, isBus: true, bus: b });
    });

    const plottedMarkers = applyOffset(rawMarkers);
    const activeIds = new Set(plottedMarkers.map(m => m.id));

    // Remove inactive markers
    Object.keys(markersRef.current).forEach(id => {
      if (!activeIds.has(id)) {
        markersRef.current[id].setMap(null);
        delete markersRef.current[id];
        delete currentPositionsRef.current[id];
        delete targetPositionsRef.current[id];
        delete prevMovingRef.current[id];
      }
    });

    // Add or update active markers
    plottedMarkers.forEach(m => {
      const targetLat = m.lat;
      const targetLng = m.lng;
      targetPositionsRef.current[m.id] = { lat: targetLat, lng: targetLng };

      if (!markersRef.current[m.id]) {
        let icon;
        if (m.isUser) {
          icon = {
            path: window.google.maps.SymbolPath.CIRCLE,
            fillColor: "#60A5FA",
            fillOpacity: 1.0,
            strokeColor: "#FFFFFF",
            strokeWeight: 2.5,
            scale: 7,
          };
        } else {
          const color = m.bus.moving ? "#4ADE80" : "#F87171";
          icon = {
            path: window.google.maps.SymbolPath.CIRCLE,
            fillColor: color,
            fillOpacity: 1.0,
            strokeColor: "#FFFFFF",
            strokeWeight: 3.5,
            scale: 9,
          };
        }

        const marker = new window.google.maps.Marker({
          position: { lat: targetLat, lng: targetLng },
          map: mapInstance.current,
          icon,
          zIndex: m.isUser ? 50 : 100,
        });

        if (m.isBus) {
          marker.addListener("click", () => {
            if (!infoWindowRef.current) {
              infoWindowRef.current = new window.google.maps.InfoWindow();
            }
            infoWindowRef.current.setContent(getPopupContent(m.bus));
            infoWindowRef.current.open(mapInstance.current, marker);
          });
          prevMovingRef.current[m.id] = m.bus.moving;
        }

        markersRef.current[m.id] = marker;
        currentPositionsRef.current[m.id] = { lat: targetLat, lng: targetLng };
      } else {
        const marker = markersRef.current[m.id];
        if (m.isBus) {
          if (prevMovingRef.current[m.id] !== m.bus.moving) {
            const color = m.bus.moving ? "#4ADE80" : "#F87171";
            marker.setIcon({
              path: window.google.maps.SymbolPath.CIRCLE,
              fillColor: color,
              fillOpacity: 1.0,
              strokeColor: "#FFFFFF",
              strokeWeight: 3.5,
              scale: 9,
            });
            prevMovingRef.current[m.id] = m.bus.moving;
          }
        }
      }
    });

    // Smooth movement animations (interpolate position)
    cancelAnimationFrame(animFrameRef.current);
    const duration = 600;
    const startTime = performance.now();
    const startPositions = {};
    Object.keys(markersRef.current).forEach(id => {
      startPositions[id] = { ...(currentPositionsRef.current[id] || targetPositionsRef.current[id]) };
    });

    function animate(now) {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);

      Object.keys(markersRef.current).forEach(id => {
        const start = startPositions[id];
        const target = targetPositionsRef.current[id];
        const marker = markersRef.current[id];
        if (!start || !target || !marker) return;

        const iLat = lerp(start.lat, target.lat, eased);
        const iLng = lerp(start.lng, target.lng, eased);
        currentPositionsRef.current[id] = { lat: iLat, lng: iLng };
        marker.setPosition({ lat: iLat, lng: iLng });
      });

      if (t < 1) {
        animFrameRef.current = requestAnimationFrame(animate);
      }
    }
    animFrameRef.current = requestAnimationFrame(animate);

    // Pan map to selected bus or student location
    const currentBus = buses.find(b => b.isCurrent);
    if (currentBus) {
      mapInstance.current.panTo({ lat: currentBus.lat, lng: currentBus.lng });
    } else if (myLocation) {
      mapInstance.current.panTo({ lat: myLocation.lat, lng: myLocation.lng });
    }
  }, [activeBuses, busLocation, busMoving, myLocation]);

  return <div ref={mapRef} style={{ width: "100%", height: "100%", borderRadius: 14 }} />;
});

// ── Main MapView Wrapper ──
const MapView = memo(function MapView({ activeBuses, busLocation, busMoving, routePath, center, myLocation, dark = true }) {
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
          activeBuses={activeBuses}
          busLocation={busLocation}
          busMoving={busMoving}
          routePath={routePath}
          center={center}
          myLocation={myLocation}
          dark={dark}
        />
      ) : (
        <LeafletMapView
          activeBuses={activeBuses}
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
