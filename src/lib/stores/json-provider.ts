import type { StoreProvider, Store, Bounds } from "@/lib/types";
import storeData from "@/data/stores.json";

/**
 * Store provider that reads from a static JSON array.
 * This is the MVP implementation — future versions can query a database.
 */
export class JsonStoreProvider implements StoreProvider {
  private stores: Store[];

  constructor(stores: Store[]) {
    this.stores = stores;
  }

  async getStores(): Promise<Store[]> {
    return this.stores;
  }

  async getStoresInBounds(bounds: Bounds): Promise<Store[]> {
    return this.stores.filter(
      (s) =>
        s.lat >= bounds.south &&
        s.lat <= bounds.north &&
        s.lng >= bounds.west &&
        s.lng <= bounds.east
    );
  }
}

// Singleton — data is imported at build time
let _provider: JsonStoreProvider | null = null;

export function getStoreProvider(): JsonStoreProvider {
  if (!_provider) {
    _provider = new JsonStoreProvider(storeData as Store[]);
  }
  return _provider;
}
