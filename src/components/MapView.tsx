"use client";

import { useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
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
      width: 24px; height: 24px;
      border-radius: 50% 50% 50% 0;
      transform: rotate(-45deg);
      border: 2px solid white;
      box-shadow: 0 2px 6px rgba(0,0,0,0.4);
      display: flex; align-items: center; justify-content: center;
    "><span style="transform: rotate(45deg); color: white; font-weight: bold; font-size: 11px;">${label}</span></div>`,
    className: "brand-marker",
    iconSize: [24, 24],
    iconAnchor: [12, 24],
    popupAnchor: [0, -24],
  });
}

/** Custom cluster icon that shows count + brand-colored outer ring */
function createClusterIcon(cluster: L.MarkerCluster, brandColors?: Record<string, string>) {
  const count = cluster.getChildCount();
  // Determine dominant brand in cluster
  const brands: Record<string, number> = {};
  cluster.getAllChildMarkers().forEach((m: any) => {
    const brand = m?.options?.icon?.options?.className || "other";
    brands[brand] = (brands[brand] || 0) + 1;
  });
  const dominantBrand = Object.entries(brands).sort((a, b) => b[1] - a[1])[0]?.[0] || "other";
  const color = brandColors?.[dominantBrand] || "#666";

  const size = count < 10 ? 36 : count < 100 ? 44 : count < 1000 ? 52 : 60;

  return L.divIcon({
    html: `<div style="
      background: ${color};
      width: ${size}px; height: ${size}px;
      border-radius: 50%;
      border: 3px solid rgba(255,255,255,0.85);
      box-shadow: 0 2px 8px rgba(0,0,0,0.5);
      display: flex; align-items: center; justify-content: center;
      color: white; font-weight: 700; font-size: ${size < 44 ? 12 : 14}px;
      font-family: system-ui, sans-serif;
    ">${count}</div>`,
    className: "brand-cluster",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
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
      <MarkerClusterGroup
        chunkedLoading
        maxClusterRadius={50}
        showCoverageOnHover={false}
        spiderfyOnMaxZoom={true}
        iconCreateFunction={(cluster: L.MarkerCluster) => createClusterIcon(cluster, brandColors)}
      >
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
                {store.openingHours && (
                  <p className="text-xs text-zinc-400 mt-2 font-mono">{store.openingHours}</p>
                )}
              </div>
            </Popup>
          </Marker>
        ))}
      </MarkerClusterGroup>
    </MapContainer>
  );
}
