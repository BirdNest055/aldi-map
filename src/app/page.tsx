"use client";

import { useState, useMemo, useCallback } from "react";
import dynamic from "next/dynamic";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Search, MapPin, Package, Loader2, AlertCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { Store, Discount, GeocodeResult } from "@/lib/types";

// Lazy-load the map (Leaflet needs window — can't SSR)
const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full">
      <Loader2 className="w-8 h-8 animate-spin text-zinc-600" />
    </div>
  ),
});

const fmtPrice = (n: number | null, cur = "EUR") => {
  if (n === null) return "—";
  return `${n.toFixed(2)} ${cur === "EUR" ? "€" : cur}`;
};

export default function Home() {
  const [selectedStore, setSelectedStore] = useState<Store | null>(null);
  const [flyTarget, setFlyTarget] = useState<{ lat: number; lng: number; zoom?: number; bounds?: [number, number, number, number] } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<GeocodeResult[]>([]);

  const { data: stores, isLoading: storesLoading } = useQuery({
    queryKey: ["stores"],
    queryFn: () => fetch("/api/stores").then((r) => r.json() as Promise<Store[]>),
    staleTime: Infinity,
  });

  const { data: discounts, isLoading: discountsLoading } = useQuery({
    queryKey: ["discounts", selectedStore?.id],
    queryFn: () =>
      fetch(`/api/discounts?storeId=${selectedStore!.id}`).then((r) => r.json() as Promise<Discount[]>),
    enabled: !!selectedStore,
  });

  const fetchMutation = useMutation({
    mutationFn: (storeId: string) =>
      fetch("/api/fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId }),
      }).then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "Fetch failed");
        return data;
      }),
  });

  const handleSearch = useCallback(async () => {
    if (!searchQuery || searchQuery.trim().length < 2) return;
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}`);
      const results = await res.json();
      setSearchResults(results);
    } catch {
      setSearchResults([]);
    }
  }, [searchQuery]);

  const handleSelectSearchResult = (result: GeocodeResult) => {
    setFlyTarget({ lat: result.lat, lng: result.lng, bounds: result.boundingBox });
    setSearchResults([]);
    setSearchQuery(result.displayName.split(",")[0]);
  };

  return (
    <div className="h-screen flex flex-col bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-900/80 backdrop-blur z-[1000] px-4 py-3 flex items-center gap-4">
        <div className="flex items-center gap-2">
          <MapPin className="w-5 h-5 text-emerald-400" />
          <h1 className="text-base font-semibold">Discount Map</h1>
        </div>
        <div className="flex-1 flex items-center gap-2 max-w-md">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <Input
              placeholder="Search city..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="pl-9 bg-zinc-800 border-zinc-700"
            />
            {searchResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-zinc-800 border border-zinc-700 rounded-md shadow-lg z-[1001] max-h-60 overflow-y-auto">
                {searchResults.map((r, i) => (
                  <button
                    key={i}
                    onClick={() => handleSelectSearchResult(r)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-700 truncate"
                  >
                    {r.displayName}
                  </button>
                ))}
              </div>
            )}
          </div>
          <Button size="sm" variant="secondary" onClick={handleSearch}>
            <Search className="w-4 h-4" />
          </Button>
        </div>
        {stores && (
          <Badge variant="outline" className="text-zinc-400">
            {stores.length} stores
          </Badge>
        )}
      </header>

      {/* Main: map + sidebar */}
      <div className="flex-1 flex overflow-hidden">
        {/* Map */}
        <div className="flex-1 relative">
          {storesLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="w-8 h-8 animate-spin text-zinc-600" />
            </div>
          ) : stores && stores.length > 0 ? (
            <MapView
              stores={stores}
              selectedStore={selectedStore}
              onSelectStore={setSelectedStore}
              flyTarget={flyTarget}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-zinc-500">
              <div className="text-center">
                <MapPin className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No stores found. Add stores to data/stores.json</p>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        {selectedStore && (
          <aside className="w-80 border-l border-zinc-800 bg-zinc-900 overflow-y-auto flex flex-col">
            <div className="p-4 border-b border-zinc-800">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="font-semibold text-sm">{selectedStore.name}</h2>
                  <p className="text-xs text-zinc-500 mt-1">{selectedStore.address}</p>
                </div>
                <Badge className="bg-emerald-900 text-emerald-300 border-emerald-700 shrink-0">
                  {selectedStore.brand}
                </Badge>
              </div>
              <Button
                className="w-full mt-3"
                size="sm"
                onClick={() => fetchMutation.mutate(selectedStore.id)}
                disabled={fetchMutation.isPending}
              >
                {fetchMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Fetching...</>
                ) : (
                  <><Package className="w-4 h-4 mr-2" /> Fetch Discounts</>
                )}
              </Button>
              {fetchMutation.isError && (
                <div className="mt-2 flex items-start gap-2 text-xs text-red-400">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{(fetchMutation.error as Error).message}</span>
                </div>
              )}
              {fetchMutation.isSuccess && (
                <div className="mt-2 text-xs text-emerald-400">
                  ✓ Fetched {fetchMutation.data.count} discounts
                </div>
              )}
            </div>

            {/* Discount list */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              <h3 className="text-xs uppercase text-zinc-500 font-medium mb-2">Discounts</h3>
              {discountsLoading ? (
                [...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full bg-zinc-800" />
                ))
              ) : discounts && discounts.length > 0 ? (
                discounts.map((d, i) => (
                  <Card key={i} className="bg-zinc-800/50 border-zinc-700/50">
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{d.productTitle}</p>
                          {d.brand && <p className="text-xs text-emerald-400 mt-0.5">{d.brand}</p>}
                          {d.category && <p className="text-xs text-zinc-500 mt-0.5 truncate">{d.category}</p>}
                        </div>
                        <div className="text-right shrink-0">
                          {d.price !== null && d.regularPrice !== null && d.price < d.regularPrice ? (
                            <>
                              <p className="text-sm font-mono font-semibold text-emerald-400">
                                {fmtPrice(d.price, d.currency)}
                              </p>
                              <p className="text-xs text-zinc-500 line-through">
                                {fmtPrice(d.regularPrice, d.currency)}
                              </p>
                            </>
                          ) : (
                            <p className="text-sm font-mono font-semibold">{fmtPrice(d.price, d.currency)}</p>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              ) : (
                <div className="text-center py-8 text-zinc-500">
                  <Package className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-xs">No discounts yet. Click "Fetch Discounts" to load.</p>
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
