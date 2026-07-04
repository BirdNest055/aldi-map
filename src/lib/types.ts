// =========================================================================
// Core type definitions — all modules communicate through these interfaces
// =========================================================================

/** A supermarket/store on the map */
export interface Store {
  id: string;
  name: string;
  brand: string;       // "aldi-sued", "lidl", etc.
  lat: number;
  lng: number;
  address: string;
}

/** A single discount/deal for a product at a store */
export interface Discount {
  storeId: string;
  productTitle: string;
  brand: string | null;
  price: number | null;
  regularPrice: number | null;
  currency: string;
  category: string | null;
  validFrom: string | null;
  validUntil: string | null;
  fetchedAt: string;
}

/** Geocoding search result */
export interface GeocodeResult {
  displayName: string;
  lat: number;
  lng: number;
  boundingBox: [number, number, number, number]; // south, north, west, east
}

/** Geographic bounds for viewport-based queries */
export interface Bounds {
  south: number;
  north: number;
  west: number;
  east: number;
}

// =========================================================================
// Module interfaces (swappable)
// =========================================================================

/** Module A: Store provider — where supermarket locations come from */
export interface StoreProvider {
  getStores(): Promise<Store[]>;
  getStoresInBounds(bounds: Bounds): Promise<Store[]>;
}

/** Module B: Fetcher plugin — fetches discounts for a specific brand */
export interface FetcherPlugin {
  brand: string;
  canFetch(store: Store): boolean;
  fetch(store: Store): Promise<Discount[]>;
}

/** Module C: Rate limiter — prevents abuse */
export interface RateLimiter {
  canFetch(key: string): boolean;
  recordFetch(key: string): void;
  getCooldownRemaining(key: string): number; // seconds until next fetch allowed
}

/** Module D: Discount storage — where fetched discounts are saved */
export interface DiscountStorage {
  save(storeId: string, discounts: Discount[]): Promise<void>;
  get(storeId: string): Promise<Discount[] | null>;
  getRecent(limit: number): Promise<Discount[]>;
}

/** Module E: Geocoder — city search */
export interface Geocoder {
  search(query: string): Promise<GeocodeResult[]>;
}

// =========================================================================
// Fetcher registry — manages available plugins
// =========================================================================

export interface FetcherRegistry {
  register(plugin: FetcherPlugin): void;
  getPlugin(brand: string): FetcherPlugin | null;
  getPluginForStore(store: Store): FetcherPlugin | null;
  getAvailableBrands(): string[];
}
