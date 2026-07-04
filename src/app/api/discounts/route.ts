import { NextRequest, NextResponse } from "next/server";
import { getStorage } from "@/lib/storage/supabase";

export async function GET(req: NextRequest) {
  const storeId = req.nextUrl.searchParams.get("storeId");
  if (!storeId) {
    return NextResponse.json({ error: "storeId required" }, { status: 400 });
  }
  try {
    const storage = getStorage();
    const discounts = await storage.get(storeId);
    return NextResponse.json(discounts || []);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
