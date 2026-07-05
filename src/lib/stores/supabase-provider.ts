import type { StoreProvider, Store, Bounds } from "@/lib/types";
import { createClient } from "@supabase/supabase-js";
import { Errors } from "@/lib/errors";

export class SupabaseStoreProvider implements StoreProvider {
  private client: any;
  private cache: Store[] | null = null;
  private cacheTime: number = 0;
  private cacheTtlMs: number = 5 * 60 * 1000;

  constructor() {
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const key = process.env.SUPABASE_SECRET_KEY || "";
    if (!url || !key) {
      throw Errors.config("SUPABASE_URL and SUPABASE_SECRET_KEY must be set");
    }
    this.client = createClient(url, key);
  }

  private async loadStores(): Promise<Store[]> {
    if (this.cache && Date.now() - this.cacheTime < this.cacheTtlMs) {
      return this.cache;
    }

    const PAGE_SIZE = 500;
    let allData: any[] = [];
    let offset = 0;
    const seenIds = new Set<string>();

    while (true) {
      const { data, error } = await this.client
        .from("stores")
        .select("*")
        .eq("is_active", true)
        .order("brand")
        .order("name")
        .order("id")  // deterministic sort — prevents duplicate rows across pages
        .range(offset, offset + PAGE_SIZE - 1);

      if (error) {
        throw Errors.storage(`Failed to load stores: ${error.message}`, {
          cause: error.code,
        });
      }

      if (!data || data.length === 0) break;
      
      // Dedup by ID (safety net against pagination edge cases)
      for (const row of data) {
        if (!seenIds.has(row.id)) {
          seenIds.add(row.id);
          allData.push(row);
        }
      }
      
      if (data.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    this.cache = allData.map((row: any) => ({
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

let _provider: SupabaseStoreProvider | null = null;

export function getStoreProvider(): SupabaseStoreProvider {
  if (!_provider) {
    _provider = new SupabaseStoreProvider();
  }
  return _provider;
}
