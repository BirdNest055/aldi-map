import { describe, it, expect, beforeEach } from "vitest";
import { FetcherRegistryImpl } from "@/lib/fetcher/registry";
import type { FetcherPlugin, Store, Discount } from "@/lib/types";

// Mock fetcher plugin for testing
class MockFetcher implements FetcherPlugin {
  constructor(public brand: string) {}
  canFetch(store: Store): boolean {
    return store.brand === this.brand;
  }
  async fetch(store: Store): Promise<Discount[]> {
    return [
      {
        storeId: store.id,
        productTitle: `Test Product from ${this.brand}`,
        brand: this.brand,
        price: 1.99,
        regularPrice: 2.99,
        currency: "EUR",
        category: "Test",
        validFrom: "2026-07-01",
        validUntil: "2026-07-07",
        fetchedAt: new Date().toISOString(),
      },
    ];
  }
}

describe("FetcherRegistry", () => {
  let registry: FetcherRegistryImpl;

  beforeEach(() => {
    registry = new FetcherRegistryImpl();
  });

  it("registers and retrieves a plugin by brand", () => {
    const plugin = new MockFetcher("aldi-sued");
    registry.register(plugin);
    expect(registry.getPlugin("aldi-sued")).toBe(plugin);
  });

  it("returns null for unregistered brand", () => {
    expect(registry.getPlugin("unknown-brand")).toBeNull();
  });

  it("finds the right plugin for a store", () => {
    const aldi = new MockFetcher("aldi-sued");
    const lidl = new MockFetcher("lidl");
    registry.register(aldi);
    registry.register(lidl);

    const store: Store = {
      id: "1",
      name: "ALDI SÜD",
      brand: "aldi-sued",
      lat: 48.13,
      lng: 11.58,
      address: "Test",
    };
    expect(registry.getPluginForStore(store)).toBe(aldi);
  });

  it("returns null for a store with no matching plugin", () => {
    const store: Store = {
      id: "1",
      name: "Unknown Mart",
      brand: "unknown",
      lat: 0,
      lng: 0,
      address: "Test",
    };
    expect(registry.getPluginForStore(store)).toBeNull();
  });

  it("lists all available brands", () => {
    registry.register(new MockFetcher("aldi-sued"));
    registry.register(new MockFetcher("lidl"));
    expect(registry.getAvailableBrands()).toEqual(
      expect.arrayContaining(["aldi-sued", "lidl"])
    );
  });
});
