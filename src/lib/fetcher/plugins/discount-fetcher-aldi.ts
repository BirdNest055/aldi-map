import type { FetcherPlugin, Store, Discount } from "@/lib/types";

/**
 * Discount fetcher for ALDI SÜD.
 *
 * ALDI's prospectus is national (same products in every store across Germany),
 * so this plugin fetches the same national data regardless of which store was
 * clicked. The store ID is tagged onto every discount for traceability.
 *
 * This plugin reuses the XHR discovery logic from the aldi-cli tool:
 *   1. Follow redirect from https://prospekt.aldi-sued.de/ to get current week URL
 *   2. Extract publication config from the HTML page
 *   3. Fetch spreads.json for page layout
 *   4. Fetch hotspots_data.json per spread to get product data
 *
 * Future plugins (Lidl, Netto, etc.) will implement the same FetcherPlugin
 * interface with their own XHR/API logic.
 */

const LANDING_URL = "https://prospekt.aldi-sued.de/";
const CONFIG_RE = /var\s+data\s*=\s*(\{.*?\});\s*\n/;

interface AldiProduct {
  id: number;
  title: string;
  brand?: string;
  price?: string;
  discountedPrice?: string;
  productType?: string;
  description?: string;
  customLabel1?: string;
  customLabel8?: string;
}

function parsePrice(p: string | undefined): number | null {
  if (!p || p === "") return null;
  try {
    return parseFloat(p.replace(",", "."));
  } catch {
    return null;
  }
}

export class AldiSuedFetcher implements FetcherPlugin {
  brand = "aldi";

  canFetch(store: Store): boolean {
    return store.brand === "aldi";
  }

  async fetch(store: Store): Promise<Discount[]> {
    // Step 1: Follow redirect to get current week URL
    const landingRes = await fetch(LANDING_URL, {
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; aldi-map/1.0)" },
    });
    const currentUrl = landingRes.url;

    // Step 2: Fetch HTML and extract publication config
    const html = await landingRes.text();
    const match = CONFIG_RE.exec(html);
    if (!match) throw new Error("Could not find publication config in ALDI page");
    const cfg = JSON.parse(match[1]);
    const slug = cfg.slug;
    const cacheToken = cfg.cacheToken || "";
    const numPages = cfg.numPages || 0;

    // Step 3: Determine spreads (page layout: 1, then 2-3, 4-5, ...)
    const spreads: string[] = ["1"];
    let i = 2;
    while (i <= numPages) {
      spreads.push(i + 1 <= numPages ? `${i}-${i + 1}` : `${i}`);
      i += 2;
    }

    // Step 4: Fetch hotspots for each spread
    const allProducts: AldiProduct[] = [];
    const base = "https://prospekt.aldi-sued.de";

    for (const spread of spreads) {
      const hotspotUrl = `${base}/${slug}/page/${spread}/hotspots_data.json?version=${cacheToken}&page=1`;
      try {
        const res = await fetch(hotspotUrl, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; aldi-map/1.0)" },
        });
        if (!res.ok) continue;
        const hotspots = await res.json();
        if (!Array.isArray(hotspots)) continue;

        for (const h of hotspots) {
          if (h.type !== "product") continue;
          for (const prod of h.products || []) {
            allProducts.push(prod);
          }
        }
      } catch {
        // Skip failed spreads
      }
    }

    // Step 5: Convert to standardized Discount format, tagged with store ID
    const now = new Date().toISOString();
    return allProducts.map((p) => ({
      storeId: store.id,
      productTitle: p.title?.trim() || "(unknown)",
      brand: p.brand || null,
      price: parsePrice(p.discountedPrice || p.price),
      regularPrice: parsePrice(p.price),
      currency: "EUR",
      category: p.productType || null,
      validFrom: p.customLabel1 || null,
      validUntil: null, // ALDI doesn't provide per-product expiry in the hotspot data
      fetchedAt: now,
    }));
  }
}

// Auto-register on import
import { getRegistry } from "./registry";
getRegistry().register(new AldiSuedFetcher());
