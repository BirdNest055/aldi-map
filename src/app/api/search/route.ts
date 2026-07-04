import { NextRequest, NextResponse } from "next/server";
import { getGeocoder } from "@/lib/geocoder/nominatim";
import { withErrorHandling, Errors, fetchWithTimeout } from "@/lib/errors";

/**
 * GET /api/search?q=<query>
 * Geocodes a city/address query via Nominatim (OpenStreetMap).
 */
async function handler(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q");
  if (!q || q.trim().length < 2) {
    return NextResponse.json([]);
  }

  const geocoder = getGeocoder();
  try {
    const results = await geocoder.search(q);
    return NextResponse.json(results);
  } catch (e: any) {
    // Nominatim failures are non-fatal — return empty results so the UI
    // doesn't break, but log the error
    console.error("[search] Geocoder failed:", e?.message);
    return NextResponse.json([]);
  }
}

export const GET = withErrorHandling(handler);
