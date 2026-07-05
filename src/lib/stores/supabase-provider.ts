import type { StoreProvider, Store, Bounds } from "@/lib/types";
import { createClient } from "@supabase/supabase-js";
import { Errors } from "@/lib/errors";

/**
 * Store provider that reads from Supabase stores table.
 * This is the production provider — replaces JsonStoreProvider.
 * 
 * Caches stores in-memory for 5 minutes to avoid hitting Supabase on every request.
 */
export class SupabaseStoreProvider implements StoreProvider {
  private client: any;
  private cache: Store[] | null = null;
  private cacheTime: number = 0;
  private cacheTtlMs: number = 5 * 60 * 1000; // 5 minutes

  constructor() {
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const key = process.env.SUPABASE_SECRET_KEY || "";
    if (!url || !key) {
      throw Errors.config("SUPABASE_URL and SUPABASE_SECRET_KEY must be set");
    }
    this.client = createClient(url, key);
  }

  private async loadStores(): Promise<Store[]> {
    // Check cache
    if (this.cache && Date.now() - this.cacheTime < this.cacheTtlMs) {
      return this.cache;
    }

    // Fetch from Supabase
    const { data, error } = await this.client
      .from("stores")
      .select("*")
      .eq("is_active", true)
      .order("brand")
      .order("name")
      .limit(10000);

    if (error) {
      throw Errors.storage(`Failed to load stores: ${error.message}`, {
        cause: error.code,
      });
    }

    // Map to Store interface
    this.cache = (data || []).map((row: any) => ({
      id: row.id,
      name: row.name,
      brand: row.brand,
      lat: row.lat,
      lng: row.lng,
      address: row.address || "",
      offersUrl: row.offers_url || null,
      openingHours: row.opening_hours || null,
      source: row.source || "supabase",
      osmId: row.osm_id || undefined,
    }));

    this.cacheTime = Date.now();
    return this.cache;
  }

  async getStores(): Promise<Store[]> {
    return this.loadStores();
  }

  async getStoresInBounds(bounds: Bounds): Promise<Store[]> {
    const stores = await this.loadStores();
    return stores.filter(
      (s) =>
        s.lat >= bounds.south &&
        s.lat <= bounds.north &&
        s.lng >= bounds.west &&
        s.lng <= bounds.east
    );
  }
}

// Singleton
let _provider: SupabaseStoreProvider | null = null;

export function getStoreProvider(): SupabaseStoreProvider {
  if (!_provider) {
    _provider = new SupabaseStoreProvider();
  }
  return _provider;
}
