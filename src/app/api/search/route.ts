import { NextRequest, NextResponse } from "next/server";
import { getGeocoder } from "@/lib/geocoder/nominatim";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q");
  if (!q || q.trim().length < 2) {
    return NextResponse.json([]);
  }
  const geocoder = getGeocoder();
  const results = await geocoder.search(q);
  return NextResponse.json(results);
}
