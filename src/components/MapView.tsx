"use client";

import { useMemo } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Store } from "@/lib/types";

// Fix Leaflet default icon issue
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const GERMANY_CENTER: [number, number] = [51.16, 10.45];
const GERMANY_BOUNDS = L.latLngBounds([47.27, 5.87], [55.06, 15.04]);

interface MapViewProps {
  stores: Store[];
  selectedStore: Store | null;
  onSelectStore: (store: Store) => void;
  flyTarget: { lat: number; lng: number; zoom?: number; bounds?: [number, number, number, number] } | null;
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

export default function MapView({ stores, onSelectStore, flyTarget }: MapViewProps) {
  return (
    <MapContainer
      center={GERMANY_CENTER}
      zoom={6}
      minZoom={5}
      maxZoom={18}
      maxBounds={GERMANY_BOUNDS}
      maxBoundsViscosity={1.0}
      preferCanvas={true}
      className="w-full h-full"
      style={{ background: "#1a1a1a" }}
    >
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        attribution='&copy; OpenStreetMap &copy; CARTO'
      />
      <FlyTo target={flyTarget} />
      {stores.map((store) => (
        <Marker
          key={store.id}
          position={[store.lat, store.lng]}
          eventHandlers={{ click: () => onSelectStore(store) }}
        >
          <Popup>
            <div className="min-w-[180px]">
              <p className="font-semibold text-sm">{store.name}</p>
              <p className="text-xs text-zinc-500 mt-1">{store.address}</p>
              <span className="inline-block mt-2 px-2 py-0.5 text-xs rounded bg-emerald-900 text-emerald-300 border border-emerald-700">
                {store.brand}
              </span>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
