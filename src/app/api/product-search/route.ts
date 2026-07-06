import { NextRequest, NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/errors";

async function handler(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") || req.nextUrl.searchParams.get("search");
  if (!q || q.trim().length < 2) {
    return NextResponse.json({ items: [], total: 0 });
  }
  const dbUrl = process.env.DISCOUNT_DB_URL || "https://discount-database-birdnest055s-projects.vercel.app";
  try {
    const res = await fetch(`${dbUrl}/api/products?search=${encodeURIComponent(q)}&pageSize=500`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return NextResponse.json({ items: [], total: 0 });
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ items: [], total: 0 });
  }
}
export const GET = withErrorHandling(handler);
