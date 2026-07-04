import { NextRequest, NextResponse } from "next/server";
import { getRegistry } from "@/lib/fetcher/registry";
import { getStoreProvider } from "@/lib/stores/json-provider";
import { getStorage } from "@/lib/storage/supabase";
import { MemoryRateLimiter } from "@/lib/fetcher/rate-limiter";
import "@/lib/fetcher/plugins/aldi-sued";

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

  // Rate limit
  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limiter = getLimiter();
  if (!limiter.canFetch(clientIp)) {
    const remaining = limiter.getCooldownRemaining(clientIp);
    return NextResponse.json(
      { error: `Rate limited. Try again in ${remaining}s.` },
      { status: 429 }
    );
  }

  // Find store
  const provider = getStoreProvider();
  const stores = await provider.getStores();
  const store = stores.find((s: any) => s.id === storeId);
  if (!store) {
    return NextResponse.json({ error: "Store not found" }, { status: 404 });
  }

  // Record fetch attempt
  limiter.recordFetch(clientIp);

  // Route based on brand
  if (store.brand === "rewe") {
    // REWE: trigger GitHub Actions workflow (CloakBrowser can't run on Vercel)
    const ghToken = process.env.GITHUB_TOKEN;
    const repo = "BirdNest055/aldi-map";
    const workflowId = "rewe-fetch.yml";
    const offersUrl = (store as any).offersUrl;
    
    if (!offersUrl) {
      return NextResponse.json(
        { error: "No offers URL configured for this REWE store" },
        { status: 400 }
      );
    }

    try {
      // Trigger the workflow
      const triggerRes = await fetch(
        `https://api.github.com/repos/${repo}/actions/workflows/${workflowId}/dispatches`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${ghToken}`,
            Accept: "application/vnd.github+json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ref: "main",
            inputs: {
              store_url: offersUrl,
              store_id: storeId,
            },
          }),
        }
      );

      if (!triggerRes.ok) {
        const errText = await triggerRes.text();
        return NextResponse.json(
          { error: `Failed to trigger REWE fetch workflow: ${errText}` },
          { status: 502 }
        );
      }

      return NextResponse.json({
        success: true,
        storeId: store.id,
        message: "REWE fetch triggered. Results will appear in ~60 seconds.",
        asyncFetch: true,
        estimatedTime: 60,
      });
    } catch (e: any) {
      return NextResponse.json(
        { error: `Workflow trigger failed: ${e.message}` },
        { status: 500 }
      );
    }
  }

  // ALDI (and other direct-fetch brands): run fetcher inline
  const registry = getRegistry();
  const plugin = registry.getPluginForStore(store);
  if (!plugin) {
    return NextResponse.json(
      { error: `No fetcher available for brand "${store.brand}"` },
      { status: 400 }
    );
  }

  try {
    const discounts = await plugin.fetch(store);
    try {
      const storage = getStorage();
      await storage.save(store.id, discounts);
    } catch (storageErr) {
      console.error("Storage error:", storageErr);
    }

    return NextResponse.json({
      success: true,
      storeId: store.id,
      count: discounts.length,
      discounts,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: `Fetch failed: ${e.message}` },
      { status: 500 }
    );
  }
}
