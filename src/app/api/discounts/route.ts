import { NextRequest, NextResponse } from "next/server";
import { getStorage } from "@/lib/storage/supabase";
import { getStoreProvider } from "@/lib/stores/json-provider";
import { withErrorHandling, Errors } from "@/lib/errors";

/**
 * GET /api/discounts?storeId=<id>
 *
 * Returns discounts for a store. ALDI SÜD is national — all ALDI stores
 * share the "aldi-sued-national" store_id.
 */
async function handler(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  let storeId = sp.get("storeId");
  if (!storeId) {
    throw Errors.config("storeId required");
  }

  // ALDI is national — all ALDI stores share one set of discounts
  const provider = getStoreProvider();
  try {
    const stores = await provider.getStores();
    const store = stores.find((s: any) => s.id === storeId);
    if (store && store.brand === "aldi-sued") {
      storeId = "aldi-sued-national";
    }
  } catch (e: any) {
    // Store provider failure is non-fatal for discounts query — fall through
    console.warn("[discounts] Could not check store brand:", e?.message);
  }

  const storage = getStorage();
  const discounts = await storage.get(storeId);
  return NextResponse.json(discounts || []);
}

export const GET = withErrorHandling(handler);
