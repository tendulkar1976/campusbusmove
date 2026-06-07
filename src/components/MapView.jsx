import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Green = moving, Red = stopped/ended
function getBusIcon(moving) {
  const color = moving ? "#4ADE80" : "#F87171";
  const glow  = moving
    ? "0 0 0 3px rgba(74,222,128,0.25), 0 0 14px rgba(74,222,128,0.5)"
    : "0 0 0 3px rgba(248,113,113,0.25), 0 0 14px rgba(248,113,113,0.5)";
  return L.divIcon({
    className: "",
    html: `
      <div style="
        position:relative;
        width:26px;height:26px;
        display:flex;align-items:center;justify-content:center;">
        <div style="
          width:18px;height:18px;border-radius:50%;
          background:${color};
          border:3px solid #fff;
          box-shadow:${glow};
          transition:background 0.4s,box-shadow 0.4s;">
        </div>
        ${moving ? `<div style="
          position:absolute;inset:0;border-radius:50%;
          background:${color};opacity:0.3;
          animation:ping 1.4s cubic-bezier(0,0,0.2,1) infinite;">
        </div>` : ""}
      </div>
      <style>
        @keyframes ping{75%,100%{transform:scale(1.8);opacity:0}}
      </style>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

function getMyIcon() {
  return L.divIcon({
    className: "",
    html: `<div style="
      width:14px;height:14px;border-radius:50%;
      background:#60A5FA;border:3px solid #fff;
      box-shadow:0 0 0 5px rgba(96,165,250,0.2);">
    </div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

export default function MapView({ busLocation, busMoving, routePath, center, myLocation }) {
  const mapRef      = useRef(null);
  const mapInstance = useRef(null);
  const busMarker   = useRef(null);
  const myMarker    = useRef(null);
  const routeLayer  = useRef(null);
  const prevBusPos  = useRef(null);  // track last position to detect real movement
  const myIconRef   = useRef(null);

  const defaultCenter = center || [12.9716, 77.5946];

  // Init map once
  useEffect(() => {
    if (mapInstance.current) return;
    mapInstance.current = L.map(mapRef.current, {
      center: defaultCenter,
      zoom: 16,
      zoomControl: false,   // custom position below
      attributionControl: false,
    });

    // Cleaner tile — CartoDB dark (matches app theme)
    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      { subdomains: "abcd", maxZoom: 19 }
    ).addTo(mapInstance.current);

    // Zoom control bottom-right
    L.control.zoom({ position: "bottomright" }).addTo(mapInstance.current);

    myIconRef.current = getMyIcon();

    return () => { mapInstance.current?.remove(); mapInstance.current = null; };
  }, []);

  // Route polyline
  useEffect(() => {
    if (!mapInstance.current || !routePath?.length) return;
    routeLayer.current?.remove();
    routeLayer.current = L.polyline(routePath, {
      color: "#FF5A1F", weight: 4, opacity: 0.55, dashArray: "8 5",
    }).addTo(mapInstance.current);
  }, [routePath]);

  // Bus marker — smooth pan, accurate icon
  useEffect(() => {
    if (!mapInstance.current) return;

    if (!busLocation) {
      // Trip ended — show red stopped icon at last known position
      if (busMarker.current) {
        busMarker.current.setIcon(getBusIcon(false));
      }
      return;
    }

    const { lat, lng } = busLocation;

    // Derive actual movement from position delta (more reliable than speed field)
    let actuallyMoving = busMoving;
    if (prevBusPos.current) {
      const dlat = Math.abs(lat - prevBusPos.current.lat);
      const dlng = Math.abs(lng - prevBusPos.current.lng);
      actuallyMoving = (dlat > 0.00003 || dlng > 0.00003); // ~3m threshold
    }
    prevBusPos.current = { lat, lng };

    const icon = getBusIcon(actuallyMoving);

    if (!busMarker.current) {
      busMarker.current = L.marker([lat, lng], { icon }).addTo(mapInstance.current);
    } else {
      busMarker.current.setLatLng([lat, lng]);
      busMarker.current.setIcon(icon);
    }

    // Smooth pan (don't snap)
    mapInstance.current.panTo([lat, lng], { animate: true, duration: 0.8 });
  }, [busLocation, busMoving]);

  // My location marker
  useEffect(() => {
    if (!mapInstance.current || !myLocation) return;
    const { lat, lng } = myLocation;
    if (!myMarker.current) {
      myMarker.current = L.marker([lat, lng], { icon: myIconRef.current }).addTo(mapInstance.current);
    } else {
      myMarker.current.setLatLng([lat, lng]);
    }
  }, [myLocation]);

  return (
    <div
      ref={mapRef}
      style={{ width: "100%", height: 300, zIndex: 0, borderRadius: 14 }}
    />
  );
}
