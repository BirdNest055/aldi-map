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

// ─────────────────────────────────────────────────────────────────────────────
// Size / quantity extraction
// ─────────────────────────────────────────────────────────────────────────────
// Extracts size/weight/volume info from a product description and appends it
// to the product title. This is critical for the discount-database UI to show
// meaningful size badges (e.g. "250 g", "1 L", "4x150 g") alongside prices.
//
// ALDI's hotspot JSON has a `description` field that often contains text like
// "4x150g", "1L", "500 g", etc. — but it was previously discarded. We now
// extract the size pattern and append it to the title.

const MULTI_RE = /(\d+)\s*[x×]\s*(\d+(?:[,.]\d+)?)\s*(l|liter|ml|g|kg|gramm)\b/i;
const SINGLE_RE = /(\d+(?:[,.]\d+)?)\s*(l|liter|ml|g|kg|gramm)\b/i;
const COUNT_RE = /(\d+)\s*(stk|stück|stueck|st)\b/i;
const PACK_RE = /(\d+)er\s*(pack|packung|pck|tabletten|kapseln|beutel|tüten|rolls?|rolle)\b/i;

function extractSize(text: string | undefined | null): string | null {
  if (!text) return null;

  // Multipack: "6 x 1,5 l"
  let m = text.match(MULTI_RE);
  if (m) {
    const count = m[1], each = m[2], unit = m[3].toLowerCase();
    const unitNorm = unit === "l" || unit === "liter" ? "L" : unit;
    return `${count}x${each} ${unitNorm}`;
  }

  // Single quantity: "500g", "1L", "0,5 l"
  m = text.match(SINGLE_RE);
  if (m) {
    const value = m[1], unit = m[2].toLowerCase();
    const unitNorm = unit === "l" || unit === "liter" ? "L" : unit;
    return `${value} ${unitNorm}`;
  }

  // Count: "10 Stück", "6 Stk"
  m = text.match(COUNT_RE);
  if (m) {
    return `${m[1]} Stk`;
  }

  // Pack: "6er Packung", "10er Pack"
  m = text.match(PACK_RE);
  if (m) {
    return m[0].trim();
  }

  return null;
}

/**
 * Append size info from description to the product title if not already present.
 * Example: title="Almighurt", description="4x150g" → "Almighurt 4x150 g"
 */
function enrichTitleWithSize(title: string, description?: string): string {
  if (!title) return title;

  // If size is already in the title, don't duplicate
  if (extractSize(title)) return title;

  // Try to extract from description
  const size = extractSize(description);
  if (size) {
    return `${title} ${size}`;
  }

  return title;
}

export class AldiSuedFetcher implements FetcherPlugin {
  brand = "aldi-sued";

  canFetch(store: Store): boolean {
    return store.brand === "aldi-sued";
  }

  async fetch(store: Store): Promise<Discount[]> {
    // Step 1: Follow redirect to get current week URL
    const landingRes = await fetch(LANDING_URL, {
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; discount-map/1.0)" },
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
          headers: { "User-Agent": "Mozilla/5.0 (compatible; discount-map/1.0)" },
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

    // Step 5: Convert to standardized Discount format, tagged with store ID.
    // Enrich each title with size info extracted from the description field.
    const now = new Date().toISOString();
    return allProducts.map((p) => ({
      storeId: store.id,
      productTitle: enrichTitleWithSize(
        p.title?.trim() || "(unknown)",
        p.description,
      ),
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
import { getRegistry } from "../registry";
getRegistry().register(new AldiSuedFetcher());
