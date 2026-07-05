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

const GERMANY_CENTER: [number, number] = [49.5, 11.0];
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

function createBrandIcon(brand: string, brandColors?: Record<string, string>, highlighted?: boolean, price?: number) {
  const color = brandColors?.[brand] || "#3b82f6";
  const label = brand === "aldi-sued" ? "A" : brand === "rewe" ? "R" : brand.charAt(0).toUpperCase();

  // Highlighted markers: bigger, golden ring, pulsing shadow
  if (highlighted) {
    const priceText = price !== undefined ? `<div style="background:#fbbf24;color:#000;font-size:10px;font-weight:700;padding:1px 4px;border-radius:3px;margin-top:2px;">${price.toFixed(2)}€</div>` : "";
    return L.divIcon({
      html: `<div style="display:flex;flex-direction:column;align-items:center;">
        <div style="
          background: ${color};
          width: 32px; height: 32px;
          border-radius: 50% 50% 50% 0;
          transform: rotate(-45deg);
          border: 3px solid #fbbf24;
          box-shadow: 0 0 0 2px rgba(251,191,36,0.4), 0 3px 8px rgba(0,0,0,0.3);
          display: flex; align-items: center; justify-content: center;
          z-index: 1000;
        "><span style="transform: rotate(45deg); color: white; font-weight: bold; font-size: 13px;">${label}</span></div>
        ${priceText}
      </div>`,
      className: "brand-marker-highlighted",
      iconSize: [32, 42],
      iconAnchor: [16, 32],
      popupAnchor: [0, -32],
    });
  }

  // Normal markers
  return L.divIcon({
    html: `<div style="
      background: ${color};
      width: 24px; height: 24px;
      border-radius: 50% 50% 50% 0;
      transform: rotate(-45deg);
      border: 2px solid white;
      box-shadow: 0 2px 4px rgba(0,0,0,0.3);
      display: flex; align-items: center; justify-content: center;
    "><span style="transform: rotate(45deg); color: white; font-weight: bold; font-size: 11px;">${label}</span></div>`,
    className: "brand-marker",
    iconSize: [24, 24],
    iconAnchor: [12, 24],
    popupAnchor: [0, -24],
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
  const size = count < 10 ? 40 : count < 100 ? 48 : count < 1000 ? 56 : 64;

  return L.divIcon({
    html: `<div style="
      background: ${color};
      width: ${size}px; height: ${size}px;
      border-radius: 50%;
      border: 3px solid rgba(255,255,255,0.95);
      box-shadow: 0 2px 8px rgba(0,0,0,0.35);
      display: flex; align-items: center; justify-content: center;
      color: white;
      font-weight: 800;
      font-size: ${size < 48 ? 14 : 16}px;
      font-family: system-ui, -apple-system, sans-serif;
      opacity: 0.92;
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
      preferCanvas={true} className="w-full h-full" style={{ background: "#e8e8e8" }}>
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
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
              icon={createBrandIcon(store.brand, brandColors, isHighlighted, price)}
              eventHandlers={{ click: () => onSelectStore(store) }}
              zIndexOffset={isHighlighted ? 1000 : 0}
            >
              <Popup>
                <div className="min-w-[200px]" style={{ color: "#333" }}>
                  <p className="font-semibold text-sm" style={{ color: "#111" }}>{store.name}</p>
                  <p className="text-xs mt-1" style={{ color: "#666" }}>{store.address}</p>
                  {price !== undefined && (
                    <p className="text-sm font-bold mt-1" style={{ color: "#16a34a" }}>ab {price.toFixed(2)} €</p>
                  )}
                  <span className="inline-block mt-2 px-2 py-0.5 text-xs rounded text-white"
                    style={{ backgroundColor: brandColors?.[store.brand] || "#888" }}>
                    {store.brand === "aldi-sued" ? "ALDI SÜD" : store.brand.toUpperCase()}
                  </span>
                  {store.openingHours && (
                    <p className="text-xs mt-2 font-mono" style={{ color: "#888" }}>{store.openingHours}</p>
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
