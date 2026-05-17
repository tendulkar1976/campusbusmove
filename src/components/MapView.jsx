import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

function getBusIcon(moving) {
  const color = moving ? "#4ADE80" : "#F87171";
  const shadow = moving ? "0 0 12px rgba(74,222,128,0.6)" : "0 0 12px rgba(248,113,113,0.6)";
  return L.divIcon({
    className: "",
    html: `<div style="width:20px;height:20px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:${shadow};transition:background 0.3s;"></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

const myIcon = L.divIcon({
  className: "",
  html: `<div style="background:#60A5FA;width:14px;height:14px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 0 4px rgba(96,165,250,0.25);"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

export default function MapView({ busLocation, busMoving, routePath, center, myLocation }) {
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const busMarker = useRef(null);
  const myMarker = useRef(null);
  const routeLayer = useRef(null);

  const defaultCenter = center || [12.9716, 77.5946];

  useEffect(() => {
    if (mapInstance.current) return;
    mapInstance.current = L.map(mapRef.current, { center: defaultCenter, zoom: 15, zoomControl: true });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OSM" }).addTo(mapInstance.current);
    return () => { mapInstance.current?.remove(); mapInstance.current = null; };
  }, []);

  useEffect(() => {
    if (!mapInstance.current || !routePath?.length) return;
    routeLayer.current?.remove();
    routeLayer.current = L.polyline(routePath, { color: "#FF5A1F", weight: 3, opacity: 0.4, dashArray: "6 4" }).addTo(mapInstance.current);
  }, [routePath]);

  useEffect(() => {
    if (!mapInstance.current || !busLocation) return;
    const { lat, lng } = busLocation;
    const icon = getBusIcon(busMoving);
    if (!busMarker.current) {
      busMarker.current = L.marker([lat, lng], { icon }).addTo(mapInstance.current);
    } else {
      busMarker.current.setLatLng([lat, lng]);
      busMarker.current.setIcon(icon);
    }
    mapInstance.current.panTo([lat, lng]);
  }, [busLocation, busMoving]);

  useEffect(() => {
    if (!mapInstance.current || !myLocation) return;
    const { lat, lng } = myLocation;
    if (!myMarker.current) myMarker.current = L.marker([lat, lng], { icon: myIcon }).addTo(mapInstance.current);
    else myMarker.current.setLatLng([lat, lng]);
  }, [myLocation]);

  return <div ref={mapRef} style={{ width: "100%", height: 320, zIndex: 0 }} />;
}
