import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const busIcon = L.divIcon({ className: "", html: `<div style="background:#FF5A1F;width:34px;height:34px;border-radius:50%;border:3px solid #fff;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 10px rgba(255,90,31,0.5);font-size:17px;">🚌</div>`, iconSize:[34,34], iconAnchor:[17,17] });
const stopIcon = L.divIcon({ className: "", html: `<div style="background:#1A1A1A;width:12px;height:12px;border-radius:50%;border:2px solid #FF5A1F;box-shadow:0 1px 4px rgba(0,0,0,0.6);"></div>`, iconSize:[12,12], iconAnchor:[6,6] });
const myIcon = L.divIcon({ className: "", html: `<div style="background:#60A5FA;width:16px;height:16px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 0 4px rgba(96,165,250,0.3);"></div>`, iconSize:[16,16], iconAnchor:[8,8] });

export default function MapView({ busLocation, routePath, stops, center, myLocation }) {
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
    routeLayer.current = L.polyline(routePath, { color: "#FF5A1F", weight: 4, opacity: 0.6, dashArray: "8 5" }).addTo(mapInstance.current);
  }, [routePath]);

  useEffect(() => {
    if (!mapInstance.current || !stops?.length) return;
    stops.forEach(stop => L.marker([stop.lat, stop.lng], { icon: stopIcon }).addTo(mapInstance.current).bindPopup(`<b style="font-family:sans-serif">${stop.name}</b>`));
  }, [stops]);

  useEffect(() => {
    if (!mapInstance.current || !busLocation) return;
    const { lat, lng } = busLocation;
    if (!busMarker.current) busMarker.current = L.marker([lat, lng], { icon: busIcon }).addTo(mapInstance.current).bindPopup("Bus location");
    else busMarker.current.setLatLng([lat, lng]);
    mapInstance.current.panTo([lat, lng]);
  }, [busLocation]);

  useEffect(() => {
    if (!mapInstance.current || !myLocation) return;
    const { lat, lng } = myLocation;
    if (!myMarker.current) myMarker.current = L.marker([lat, lng], { icon: myIcon }).addTo(mapInstance.current).bindPopup("You are here");
    else myMarker.current.setLatLng([lat, lng]);
  }, [myLocation]);

  return <div ref={mapRef} style={{ width: "100%", height: 320, zIndex: 0 }} />;
}
