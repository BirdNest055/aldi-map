import { NextRequest, NextResponse } from "next/server";
import { withErrorHandling, Errors } from "@/lib/errors";

/**
 * GET /api/product-search?q=<query>
 * Proxies product search to the discount-database API (server-side, no CORS issues).
 * Returns: [{ store_id, price, product_title }] — only store_id + lowest price per store.
 */
async function handler(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q");
  if (!q || q.trim().length < 2) {
    return NextResponse.json({ items: [], total: 0 });
  }

  const dbUrl = process.env.DISCOUNT_DB_URL || "https://aldi-web-git-main-birdnest055s-projects.vercel.app";
  
  try {
    const res = await fetch(`${dbUrl}/api/products?search=${encodeURIComponent(q)}&pageSize=500`, {
      signal: AbortSignal.timeout(10000), // 10s timeout
    });
    if (!res.ok) {
      return NextResponse.json({ items: [], total: 0, error: `DB API returned ${res.status}` });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (e: any) {
    // Return empty instead of erroring — the map app shouldn't break if the DB is down
    return NextResponse.json({ items: [], total: 0, error: e?.message });
  }
}

export const GET = withErrorHandling(handler);
