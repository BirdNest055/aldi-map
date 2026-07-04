import { NextRequest, NextResponse } from "next/server";
import { getStorage } from "@/lib/storage/supabase";
import { getStoreProvider } from "@/lib/stores/json-provider";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  let storeId = sp.get("storeId");
  if (!storeId) {
    return NextResponse.json({ error: "storeId required" }, { status: 400 });
  }

  // ALDI is national — all ALDI stores share one set of discounts
  const provider = getStoreProvider();
  const stores = await provider.getStores();
  const store = stores.find((s: any) => s.id === storeId);
  if (store && store.brand === "aldi-sued") {
    storeId = "aldi-sued-national";
  }

  try {
    const storage = getStorage();
    const discounts = await storage.get(storeId);
    return NextResponse.json(discounts || []);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
