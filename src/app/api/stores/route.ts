import { NextResponse } from "next/server";
import { getStoreProvider } from "@/lib/stores/json-provider";

export async function GET() {
  const provider = getStoreProvider();
  const stores = await provider.getStores();
  return NextResponse.json(stores);
}
