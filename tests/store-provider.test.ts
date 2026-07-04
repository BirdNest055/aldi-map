import { describe, it, expect, beforeEach } from "vitest";
import { JsonStoreProvider } from "@/lib/stores/json-provider";
import type { Store } from "@/lib/types";

const mockStores: Store[] = [
  { id: "s1", name: "ALDI SÜD München", brand: "aldi-sued", lat: 48.13, lng: 11.58, address: "Marienplatz 1" },
  { id: "s2", name: "ALDI SÜD Berlin", brand: "aldi-sued", lat: 52.52, lng: 13.40, address: "Alexanderplatz 1" },
  { id: "s3", name: "ALDI SÜD Hamburg", brand: "aldi-sued", lat: 53.55, lng: 9.99, address: "Mönckebergstr 1" },
  { id: "s4", name: "Lidl Köln", brand: "lidl", lat: 50.94, lng: 6.96, address: "Domkloster 1" },
];

describe("JsonStoreProvider", () => {
  let provider: JsonStoreProvider;

  beforeEach(() => {
    provider = new JsonStoreProvider(mockStores);
  });

  it("returns all stores", async () => {
    const stores = await provider.getStores();
    expect(stores).toHaveLength(4);
    expect(stores[0]).toHaveProperty("id");
    expect(stores[0]).toHaveProperty("lat");
    expect(stores[0]).toHaveProperty("lng");
  });

  it("filters stores within bounds", async () => {
    // Bounds covering southern Germany (München)
    const stores = await provider.getStoresInBounds({
      south: 47.5,
      north: 49.0,
      west: 11.0,
      east: 12.0,
    });
    expect(stores).toHaveLength(1);
    expect(stores[0].name).toContain("München");
  });

  it("returns empty array for bounds with no stores", async () => {
    const stores = await provider.getStoresInBounds({
      south: 0,
      north: 1,
      west: 0,
      east: 1,
    });
    expect(stores).toHaveLength(0);
  });

  it("includes all stores within large bounds", async () => {
    const stores = await provider.getStoresInBounds({
      south: 47,
      north: 54,
      west: 6,
      east: 14,
    });
    expect(stores).toHaveLength(4);
  });
});
