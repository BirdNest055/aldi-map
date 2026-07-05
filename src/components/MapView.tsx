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
  highlightedStoreIds?: Set<string> | null;
  storePrices?: Map<string, number> | null;
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

function createBrandIcon(brand: string, brandColors?: Record<string, string>, highlighted?: boolean, hasPrice?: boolean) {
  const color = brandColors?.[brand] || "#3b82f6";
  const label = brand === "aldi-sued" ? "A" : brand === "rewe" ? "R" : brand.charAt(0).toUpperCase();
  const size = highlighted ? 30 : 22;
  const ring = highlighted ? `box-shadow: 0 0 0 3px #fbbf24, 0 2px 6px rgba(0,0,0,0.4);` : `box-shadow: 0 1px 4px rgba(0,0,0,0.3);`;
  return L.divIcon({
    html: `<div style="
      background: ${color};
      width: ${size}px; height: ${size}px;
      border-radius: 50% 50% 50% 0;
      transform: rotate(-45deg);
      border: 2px solid white;
      ${ring}
      display: flex; align-items: center; justify-content: center;
      ${highlighted ? 'z-index: 1000;' : ''}
    "><span style="transform: rotate(45deg); color: white; font-weight: bold; font-size: ${size < 26 ? 10 : 12}px;">${label}</span></div>`,
    className: "brand-marker",
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size],
  });
}

function createClusterIcon(cluster: L.MarkerCluster, brandColors?: Record<string, string>) {
  const count = cluster.getChildCount();
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
      background: ${color}aa;
      width: ${size}px; height: ${size}px;
      border-radius: 50%;
      border: 3px solid rgba(255,255,255,0.9);
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      display: flex; align-items: center; justify-content: center;
      color: white; font-weight: 700; font-size: ${size < 44 ? 12 : 14}px;
      font-family: system-ui, sans-serif;
      backdrop-filter: blur(2px);
    ">${count}</div>`,
    className: "brand-cluster",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

export default function MapView({ stores, onSelectStore, flyTarget, brandColors, highlightedStoreIds, storePrices }: MapViewProps) {
  return (
    <MapContainer
      center={GERMANY_CENTER} zoom={6} minZoom={5} maxZoom={18}
      maxBounds={GERMANY_BOUNDS} maxBoundsViscosity={1.0}
      preferCanvas={true} className="w-full h-full" style={{ background: "#f5f5f5" }}>
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
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
        {stores.map((store) => {
          const isHighlighted = highlightedStoreIds?.has(store.id) ?? false;
          const price = storePrices?.get(store.id);
          return (
            <Marker
              key={store.id}
              position={[store.lat, store.lng]}
              icon={createBrandIcon(store.brand, brandColors, isHighlighted, price !== undefined)}
              eventHandlers={{ click: () => onSelectStore(store) }}
              zIndexOffset={isHighlighted ? 1000 : 0}
            >
              <Popup>
                <div className="min-w-[180px]">
                  <p className="font-semibold text-sm">{store.name}</p>
                  <p className="text-xs text-zinc-500 mt-1">{store.address}</p>
                  {price !== undefined && (
                    <p className="text-sm font-bold text-emerald-600 mt-1">ab {price.toFixed(2)} €</p>
                  )}
                  <span className="inline-block mt-2 px-2 py-0.5 text-xs rounded text-white"
                    style={{ backgroundColor: brandColors?.[store.brand] || "#888" }}>
                    {store.brand === "aldi-sued" ? "ALDI SÜD" : store.brand.toUpperCase()}
                  </span>
                  {store.openingHours && (
                    <p className="text-xs text-zinc-500 mt-2 font-mono">{store.openingHours}</p>
                  )}
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MarkerClusterGroup>
    </MapContainer>
  );
}
