import type { StoreProvider, Store, Bounds } from "@/lib/types";
import fs from "fs";
import path from "path";

/**
 * Store provider that reads from a static JSON file at runtime.
 * Uses fs.readFileSync (not import) to avoid build-time caching issues
 * with large JSON files in standalone builds.
 */
export class JsonStoreProvider implements StoreProvider {
  private stores: Store[] | null = null;

  constructor(stores?: Store[]) {
    if (stores) this.stores = stores;
  }

  private loadStores(): Store[] {
    if (this.stores) return this.stores;
    try {
      // Try multiple paths (works in both dev and standalone production builds)
      const possiblePaths = [
        path.join(process.cwd(), "data", "stores.json"),
        path.join(__dirname, "data", "stores.json"),
        "/data/stores.json",
      ];
      for (const p of possiblePaths) {
        try {
          const raw = fs.readFileSync(p, "utf-8");
          this.stores = JSON.parse(raw) as Store[];
          return this.stores;
        } catch {
          // try next path
        }
      }
      // Fallback: empty array (shouldn't happen in production)
      console.error("[json-provider] Could not find stores.json in any location");
      this.stores = [];
      return this.stores;
    } catch (e) {
      console.error("[json-provider] Failed to load stores.json:", e);
      this.stores = [];
      return this.stores;
    }
  }

  async getStores(): Promise<Store[]> {
    return this.loadStores();
  }

  async getStoresInBounds(bounds: Bounds): Promise<Store[]> {
    return this.loadStores().filter(
      (s) =>
        s.lat >= bounds.south &&
        s.lat <= bounds.north &&
        s.lng >= bounds.west &&
        s.lng <= bounds.east
    );
  }
}

// Singleton
let _provider: JsonStoreProvider | null = null;

export function getStoreProvider(): JsonStoreProvider {
  if (!_provider) {
    _provider = new JsonStoreProvider();
  }
  return _provider;
}
