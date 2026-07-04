"use client";

import { useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Store } from "@/lib/types";

delete (L.Icon.Default.prototype as any)._getIconUrl;

const GERMANY_CENTER: [number, number] = [51.16, 10.45];
const GERMANY_BOUNDS = L.latLngBounds([47.27, 5.87], [55.06, 15.04]);

interface MapViewProps {
  stores: Store[];
  selectedStore: Store | null;
  onSelectStore: (store: Store) => void;
  flyTarget: { lat: number; lng: number; zoom?: number; bounds?: [number, number, number, number] } | null;
  brandColors?: Record<string, string>;
}

function FlyTo({ target }: { target: NonNullable<MapViewProps["flyTarget"]> | null }) {
  const map = useMap();
  useMemo(() => {
    if (!target) return;
    if (target.bounds) {
      const [south, north, west, east] = target.bounds;
      map.fitBounds([[south, west], [north, east]]);
    } else {
      map.flyTo([target.lat, target.lng], target.zoom || 13);
    }
  }, [target, map]);
  return null;
}

function createBrandIcon(brand: string, brandColors?: Record<string, string>) {
  const color = brandColors?.[brand] || "#3b82f6";
  const label = brand === "aldi-sued" ? "A" : brand === "rewe" ? "R" : brand.charAt(0).toUpperCase();
  return L.divIcon({
    html: `<div style="
      background: ${color};
      width: 28px; height: 28px;
      border-radius: 50% 50% 50% 0;
      transform: rotate(-45deg);
      border: 2px solid white;
      box-shadow: 0 2px 6px rgba(0,0,0,0.4);
      display: flex; align-items: center; justify-content: center;
    "><span style="transform: rotate(45deg); color: white; font-weight: bold; font-size: 12px;">${label}</span></div>`,
    className: "brand-marker",
    iconSize: [28, 28],
    iconAnchor: [14, 28],
    popupAnchor: [0, -28],
  });
}

export default function MapView({ stores, onSelectStore, flyTarget, brandColors }: MapViewProps) {
  return (
    <MapContainer
      center={GERMANY_CENTER} zoom={6} minZoom={5} maxZoom={18}
      maxBounds={GERMANY_BOUNDS} maxBoundsViscosity={1.0}
      preferCanvas={true} className="w-full h-full" style={{ background: "#1a1a1a" }}>
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        attribution='&copy; OpenStreetMap &copy; CARTO'
      />
      <FlyTo target={flyTarget} />
      {stores.map((store) => (
        <Marker
          key={store.id}
          position={[store.lat, store.lng]}
          icon={createBrandIcon(store.brand, brandColors)}
          eventHandlers={{ click: () => onSelectStore(store) }}>
          <Popup>
            <div className="min-w-[180px]">
              <p className="font-semibold text-sm">{store.name}</p>
              <p className="text-xs text-zinc-500 mt-1">{store.address}</p>
              <span className="inline-block mt-2 px-2 py-0.5 text-xs rounded text-white"
                style={{ backgroundColor: brandColors?.[store.brand] || "#888" }}>
                {store.brand === "aldi-sued" ? "ALDI SÜD" : store.brand.toUpperCase()}
              </span>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
