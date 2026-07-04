"use client";

import { useState, useMemo, useCallback } from "react";
import dynamic from "next/dynamic";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, MapPin, Package, Loader2, AlertCircle, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { Store, Discount, GeocodeResult } from "@/lib/types";
import { AutoFetchSettings } from "@/components/AutoFetchSettings";

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

const BRAND_COLORS: Record<string, string> = {
  "aldi-sued": "#1a7a3a",
  rewe: "#e30613",
};

export default function Home() {
  const queryClient = useQueryClient();
  const [selectedStore, setSelectedStore] = useState<Store | null>(null);
  const [flyTarget, setFlyTarget] = useState<{ lat: number; lng: number; zoom?: number; bounds?: [number, number, number, number] } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<GeocodeResult[]>([]);
  const [brandFilter, setBrandFilter] = useState<string>("all");
  const [discountSearch, setDiscountSearch] = useState("");
  const [asyncFetching, setAsyncFetching] = useState(false);

  const { data: stores, isLoading: storesLoading } = useQuery({
    queryKey: ["stores"],
    queryFn: () => fetch("/api/stores").then((r) => r.json() as Promise<Store[]>),
    staleTime: Infinity,
  });

  const availableBrands = useMemo(() => {
    if (!stores) return [];
    return Array.from(new Set(stores.map((s) => s.brand))).sort();
  }, [stores]);

  const filteredStores = useMemo(() => {
    if (!stores) return [];
    if (brandFilter === "all") return stores;
    return stores.filter((s) => s.brand === brandFilter);
  }, [stores, brandFilter]);

  // Determine the effective store ID for discounts (ALDI = national)
  const effectiveStoreId = useMemo(() => {
    if (!selectedStore) return null;
    if (selectedStore.brand === "aldi-sued") return "aldi-sued-national";
    return selectedStore.id;
  }, [selectedStore]);

  const { data: discounts, isLoading: discountsLoading } = useQuery({
    queryKey: ["discounts", effectiveStoreId],
    queryFn: () =>
      fetch(`/api/discounts?storeId=${effectiveStoreId}`).then((r) => r.json() as Promise<Discount[]>),
    enabled: !!effectiveStoreId,
    refetchInterval: asyncFetching ? 10000 : false,
  });

  const fetchMutation = useMutation({
    mutationFn: (storeId: string) =>
      fetch("/api/fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId }),
      }).then(async (r) => {
        const data = await r.json();
        if (!r.ok) {
          // Standardized error: { error, code, stage, retryable, timestamp }
          const err = new Error(data.error || "Fetch failed") as Error & {
            code?: string; stage?: string; retryable?: boolean;
          };
          err.code = data.code;
          err.stage = data.stage;
          err.retryable = data.retryable;
          throw err;
        }
        return data;
      }),
    onSuccess: (data) => {
      // For ALDI (national, instant): invalidate immediately to show results
      if (!data.asyncFetch) {
        queryClient.invalidateQueries({ queryKey: ["discounts", effectiveStoreId] });
      } else {
        // For REWE (async): start polling — capped at 5 minutes (anti-loop)
        setAsyncFetching(true);
        setTimeout(() => setAsyncFetching(false), 300000);
      }
    },
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

  // Sort discounts by price ascending (cheapest first)
  const sortedDiscounts = useMemo(() => {
    if (!discounts) return [];
    const filtered = discountSearch
      ? discounts.filter(
          (d) =>
            d.productTitle?.toLowerCase().includes(discountSearch.toLowerCase()) ||
            d.brand?.toLowerCase().includes(discountSearch.toLowerCase()) ||
            d.category?.toLowerCase().includes(discountSearch.toLowerCase())
        )
      : discounts;
    return [...filtered].sort((a, b) => {
      const pa = a.price ?? Infinity;
      const pb = b.price ?? Infinity;
      return pa - pb;
    });
  }, [discounts, discountSearch]);

  return (
    <div className="h-screen flex flex-col bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 bg-zinc-900/80 backdrop-blur z-[1000] px-4 py-3 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <MapPin className="w-5 h-5 text-emerald-400" />
          <h1 className="text-base font-semibold">Discount Map <span className="text-xs text-zinc-500 font-normal">v1.4.0</span></h1>
        </div>
        <div className="flex-1 flex items-center gap-2 max-w-xs">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <Input
              placeholder="Search city..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="pl-9 bg-zinc-800 border-zinc-700 h-9"
            />
            {searchResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-zinc-800 border border-zinc-700 rounded-md shadow-lg z-[1001] max-h-60 overflow-y-auto">
                {searchResults.map((r, i) => (
                  <button key={i} onClick={() => handleSelectSearchResult(r)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-700 truncate">
                    {r.displayName}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setBrandFilter("all")}
            className={`px-3 py-1.5 text-xs rounded-md font-medium transition ${brandFilter === "all" ? "bg-zinc-100 text-zinc-900" : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"}`}>
            All
          </button>
          {availableBrands.map((brand) => (
            <button key={brand} onClick={() => setBrandFilter(brand)}
              className={`px-3 py-1.5 text-xs rounded-md font-medium transition flex items-center gap-1.5 ${brandFilter === brand ? "bg-zinc-100 text-zinc-900" : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"}`}>
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: BRAND_COLORS[brand] || "#888" }} />
              {brand === "aldi-sued" ? "ALDI" : brand === "rewe" ? "REWE" : brand}
            </button>
          ))}
        </div>
        {stores && (
          <Badge variant="outline" className="text-zinc-400">{filteredStores.length} stores</Badge>
        )}
      </header>

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 relative">
          {storesLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="w-8 h-8 animate-spin text-zinc-600" />
            </div>
          ) : filteredStores.length > 0 ? (
            <MapView stores={filteredStores} selectedStore={selectedStore} onSelectStore={setSelectedStore} flyTarget={flyTarget} brandColors={BRAND_COLORS} />
          ) : (
            <div className="flex items-center justify-center h-full text-zinc-500">
              <div className="text-center">
                <MapPin className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No stores found.</p>
              </div>
            </div>
          )}
        </div>

        {selectedStore && (
          <aside className="w-full sm:w-80 border-l border-zinc-800 bg-zinc-900 overflow-y-auto flex flex-col">
            <div className="p-4 border-b border-zinc-800 relative">
              <button onClick={() => { setSelectedStore(null); setAsyncFetching(false); }}
                className="absolute top-3 right-3 p-1.5 rounded-md hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
              <div className="flex items-start gap-2 pr-8">
                <div className="flex-1 min-w-0">
                  <h2 className="font-semibold text-sm">{selectedStore.name}</h2>
                  <p className="text-xs text-zinc-500 mt-1">{selectedStore.address}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <span className="inline-block px-2 py-0.5 text-xs rounded font-medium text-white"
                  style={{ backgroundColor: BRAND_COLORS[selectedStore.brand] || "#888" }}>
                  {selectedStore.brand === "aldi-sued" ? "ALDI SÜD" : selectedStore.brand.toUpperCase()}
                </span>
                {selectedStore.brand === "aldi-sued" && (
                  <span className="text-xs text-zinc-500">National prospectus</span>
                )}
              </div>
              <Button className="w-full mt-3" size="sm"
                onClick={() => fetchMutation.mutate(selectedStore.id)} disabled={fetchMutation.isPending}>
                {fetchMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Fetching...</>
                ) : (
                  <><Package className="w-4 h-4 mr-2" /> Fetch Discounts</>
                )}
              </Button>
              {fetchMutation.isError && (() => {
                const err = fetchMutation.error as Error & {
                  code?: string; stage?: string; retryable?: boolean;
                };
                const isRetryable = err.retryable;
                const errCode = err.code || "UNKNOWN";
                const errStage = err.stage || "unknown";
                return (
                  <div className="mt-2 p-2 rounded-md bg-red-950/40 border border-red-800/50">
                    <div className="flex items-start gap-2 text-xs text-red-300">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="font-mono text-[10px] text-red-400 mb-1">
                          {errCode} @ {errStage}
                          {isRetryable && <span className="text-amber-400 ml-1">· retryable</span>}
                        </div>
                        <div className="text-red-200 break-words">{err.message}</div>
                        {isRetryable && (
                          <button
                            onClick={() => fetchMutation.mutate(selectedStore.id)}
                            disabled={fetchMutation.isPending}
                            className="mt-2 px-2 py-1 text-[10px] rounded bg-red-900/60 hover:bg-red-900 text-red-100 disabled:opacity-50 transition"
                          >
                            {fetchMutation.isPending ? "Retrying..." : "Retry fetch"}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}
              {fetchMutation.isSuccess && (
                <div className="mt-2 text-xs text-emerald-400">
                  {fetchMutation.data.asyncFetch
                    ? `✓ Fetch triggered. Checking for results...`
                    : `✓ Fetched ${fetchMutation.data.count} discounts`}
                </div>
              )}
              {asyncFetching && !discounts?.length && (
                <div className="mt-2 text-xs text-amber-400 flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> Waiting for results...
                </div>
              )}

              {/* Auto-fetch settings (component handles ALDI case internally) */}
              <AutoFetchSettings store={selectedStore} />
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {discounts && discounts.length > 0 && (
                <div className="relative mb-2">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                  <Input placeholder="Filter discounts..." value={discountSearch}
                    onChange={(e) => setDiscountSearch(e.target.value)}
                    className="pl-8 bg-zinc-800 border-zinc-700 h-8 text-xs" />
                </div>
              )}
              <div className="flex items-center justify-between">
                <h3 className="text-xs uppercase text-zinc-500 font-medium">Discounts</h3>
                {discounts && discounts.length > 0 && (
                  <span className="text-xs text-zinc-500">{sortedDiscounts.length} / {discounts.length}</span>
                )}
              </div>
              {discountsLoading ? (
                [...Array(3)].map((_, i) => (<Skeleton key={i} className="h-16 w-full bg-zinc-800" />))
              ) : sortedDiscounts.length > 0 ? (
                sortedDiscounts.map((d, i) => (
                  <Card key={i} className="bg-zinc-800/50 border-zinc-700/50">
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{d.productTitle}</p>
                          {d.brand && <p className="text-xs text-emerald-400 mt-0.5">{d.brand}</p>}
                          {d.category && <p className="text-xs text-zinc-500 mt-0.5 truncate">{d.category}</p>}
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-mono font-semibold">{fmtPrice(d.price, d.currency)}</p>
                          {d.regularPrice !== null && d.price !== null && d.regularPrice > d.price && (
                            <p className="text-xs text-zinc-500 line-through">{fmtPrice(d.regularPrice, d.currency)}</p>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              ) : discounts && discounts.length === 0 ? (
                <div className="text-center py-8 text-zinc-500">
                  <Package className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-xs">No discounts yet. Click "Fetch Discounts" to load.</p>
                  {selectedStore.brand === "rewe" && (
                    <p className="text-xs mt-1 text-amber-500">REWE takes ~60s (async fetch).</p>
                  )}
                </div>
              ) : null}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
