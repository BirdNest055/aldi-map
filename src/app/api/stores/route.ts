import { NextResponse } from "next/server";
import { getStoreProvider } from "@/lib/stores/json-provider";
import { withErrorHandling, Errors } from "@/lib/errors";

/**
 * GET /api/stores
 * Returns the static list of stores from stores.json.
 */
async function handler() {
  const provider = getStoreProvider();
  try {
    const stores = await provider.getStores();
    return NextResponse.json(stores);
  } catch (e: any) {
    throw Errors.internal(`Failed to load stores: ${e?.message ?? e}`, {
      cause: e?.name,
    });
  }
}

export const GET = withErrorHandling(handler);
