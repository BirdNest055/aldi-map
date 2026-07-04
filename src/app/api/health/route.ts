import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * GET /api/health
 *
 * Health check endpoint — verifies Supabase is reachable.
 * Used by uptime monitors and Vercel deployment checks.
 *
 * Returns 200 if healthy, 503 if any dependency is down.
 */
export async function GET() {
  const checks: Record<string, { ok: boolean; latencyMs?: number; error?: string }> = {};

  // Check Supabase
  const t0 = Date.now();
  try {
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;
    if (!url || !key) {
      checks.supabase = { ok: false, error: "SUPABASE_URL or SUPABASE_SECRET_KEY not set" };
    } else {
      const client = createClient(url, key);
      const { error } = await client
        .from("stores")
        .select("id")
        .limit(1);
      if (error) {
        checks.supabase = { ok: false, error: error.message, latencyMs: Date.now() - t0 };
      } else {
        checks.supabase = { ok: true, latencyMs: Date.now() - t0 };
      }
    }
  } catch (e: any) {
    checks.supabase = { ok: false, error: e?.message ?? String(e), latencyMs: Date.now() - t0 };
  }

  // Check GITHUB_TOKEN presence (for REWE fetches)
  checks.githubToken = {
    ok: !!process.env.GITHUB_TOKEN,
    error: process.env.GITHUB_TOKEN ? undefined : "GITHUB_TOKEN not set (REWE fetches will fail)",
  };

  const allOk = Object.values(checks).every((c) => c.ok);
  return NextResponse.json(
    {
      status: allOk ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      version: "1.4.0",
      checks,
    },
    { status: allOk ? 200 : 503 },
  );
}
