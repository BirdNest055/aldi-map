import { NextRequest, NextResponse } from "next/server";
import { getRegistry } from "@/lib/fetcher/registry";
import { getStoreProvider } from "@/lib/stores/json-provider";
import { getStorage } from "@/lib/storage/supabase";
import { MemoryRateLimiter } from "@/lib/fetcher/rate-limiter";
import "@/lib/fetcher/plugins/aldi-sued"; // auto-registers the ALDI plugin

// Singleton rate limiter — 30 second cooldown
let _limiter: MemoryRateLimiter | null = null;
function getLimiter() {
  if (!_limiter) _limiter = new MemoryRateLimiter(30);
  return _limiter;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { storeId } = body;
  if (!storeId) {
    return NextResponse.json({ error: "storeId required" }, { status: 400 });
  }

  // Rate limit check (per client IP)
  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limiter = getLimiter();
  if (!limiter.canFetch(clientIp)) {
    const remaining = limiter.getCooldownRemaining(clientIp);
    return NextResponse.json(
      { error: `Rate limited. Try again in ${remaining}s.` },
      { status: 429 }
    );
  }

  // Find the store
  const provider = getStoreProvider();
  const stores = await provider.getStores();
  const store = stores.find((s) => s.id === storeId);
  if (!store) {
    return NextResponse.json({ error: "Store not found" }, { status: 404 });
  }

  // Find the fetcher plugin for this store's brand
  const registry = getRegistry();
  const plugin = registry.getPluginForStore(store);
  if (!plugin) {
    return NextResponse.json(
      { error: `No fetcher available for brand "${store.brand}"` },
      { status: 400 }
    );
  }

  // Record the fetch attempt (rate limit)
  limiter.recordFetch(clientIp);

  // Fetch discounts
  try {
    const discounts = await plugin.fetch(store);

    // Save to Supabase (if configured)
    try {
      const storage = getStorage();
      await storage.save(store.id, discounts);
    } catch (storageErr) {
      // Storage failure is non-fatal — we still return the discounts
      console.error("Storage error:", storageErr);
    }

    return NextResponse.json({
      success: true,
      storeId: store.id,
      count: discounts.length,
      discounts,
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Fetch failed: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
