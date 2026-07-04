import type { FetcherRegistry, FetcherPlugin, Store } from "@/lib/types";

/**
 * Registry for fetcher plugins. Each plugin handles a specific supermarket brand.
 * To add a new chain: register a new plugin that implements FetcherPlugin.
 */
export class FetcherRegistryImpl implements FetcherRegistry {
  private plugins = new Map<string, FetcherPlugin>();

  register(plugin: FetcherPlugin): void {
    this.plugins.set(plugin.brand, plugin);
  }

  getPlugin(brand: string): FetcherPlugin | null {
    return this.plugins.get(brand) ?? null;
  }

  getPluginForStore(store: Store): FetcherPlugin | null {
    return this.getPlugin(store.brand);
  }

  getAvailableBrands(): string[] {
    return Array.from(this.plugins.keys());
  }
}

// Singleton instance — shared across API routes
let _registry: FetcherRegistryImpl | null = null;

export function getRegistry(): FetcherRegistryImpl {
  if (!_registry) {
    _registry = new FetcherRegistryImpl();
  }
  return _registry;
}
