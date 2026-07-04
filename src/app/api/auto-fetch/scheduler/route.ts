import { NextRequest, NextResponse } from "next/server";
import { getAutoFetchSettingsStorage } from "@/lib/auto-fetch/supabase-storage";
import { getStoreProvider } from "@/lib/stores/json-provider";
import { runScheduler, type FetchRunner, type SchedulerStoreProvider } from "@/lib/auto-fetch/scheduler";
import { withErrorHandling, Errors, fetchWithTimeout } from "@/lib/errors";
import { getStorage } from "@/lib/storage/supabase";
import type { Store } from "@/lib/types";

/**
 * POST /api/auto-fetch/scheduler
 *
 * Called by Vercel Cron every hour. Finds all REWE stores whose auto-fetch
 * is due and triggers their GHA workflow.
 *
 * AUTH: requires `Authorization: Bearer $CRON_SECRET` header.
 * This prevents public abuse while allowing Vercel Cron to call it.
 *
 * ANTI-LOOP:
 * - maxFetchesPerRun = 10 (caps work per invocation)
 * - delayMs = 2000 (2s between fetches — GitHub workflow_dispatch limit: 15/min)
 * - Each store fetched at most once per run (settings.lastAutoFetchedAt updated immediately)
 *
 * ANTI-SPAM:
 * - Silent (no UI feedback, no emails)
 * - 3 consecutive failures → auto-disable (handled in storage layer)
 * - All outcomes logged to fetch_log table
 */
async function handler(req: NextRequest) {
  // Auth check
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    throw Errors.config("CRON_SECRET env var is not set — scheduler cannot run", {
      cause: "missing-env",
    });
  }
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (token !== cronSecret) {
    throw Errors.config("Invalid or missing CRON_SECRET", {
      cause: "auth-failed",
    });
  }

  // Build the fetch runner: triggers GHA workflow for REWE stores
  const ghToken = process.env.GITHUB_TOKEN;
  const repo = "BirdNest055/discount-map";
  const workflowId = "rewe-fetch.yml";
  if (!ghToken) {
    throw Errors.config("GITHUB_TOKEN env var is not set — cannot trigger REWE workflow",
      { cause: "missing-env" });
  }

  const fetchRunner: FetchRunner = async (store: Store): Promise<{ success: boolean; count: number }> => {
    const offersUrl = (store as any).offersUrl;
    if (!offersUrl) {
      throw new Error(`No offers URL configured for store ${store.id}`);
    }

    // Trigger GHA workflow
    const triggerRes = await fetchWithTimeout(
      `https://api.github.com/repos/${repo}/actions/workflows/${workflowId}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ghToken}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ref: "main",
          inputs: { store_url: offersUrl, store_id: store.id },
        }),
        timeoutMs: 15000,
      },
    );

    if (!triggerRes.ok) {
      const errText = await triggerRes.text().catch(() => "");
      throw new Error(
        `GitHub workflow trigger failed (HTTP ${triggerRes.status}): ${errText.slice(0, 200)}`,
      );
    }

    // Note: the actual fetch happens asynchronously in GHA (~60-90s).
    // The scheduler records "success" = "trigger successfully sent".
    // The GHA workflow itself writes results to Supabase + fetch_log.
    return { success: true, count: 0 }; // count unknown at trigger time
  };

  // Build a SchedulerStoreProvider wrapper around our existing StoreProvider
  const storeProvider: SchedulerStoreProvider = {
    getStores: async () => {
      const provider = getStoreProvider();
      return await provider.getStores();
    },
  };

  // Also log scheduler start to fetch_log for audit
  const discountStorage = getStorage();
  const t0 = Date.now();

  try {
    const result = await runScheduler({
      storage: getAutoFetchSettingsStorage(),
      storeProvider,
      fetchRunner,
      maxFetchesPerRun: 10,
      delayMs: 2000,
      log: (m) => console.log(`[scheduler] ${m}`),
    });

    // Log scheduler invocation to fetch_log (store_id="__scheduler__")
    await discountStorage.logFetch(
      "__scheduler__",
      true,
      `processed=${result.processed} succeeded=${result.succeeded} failed=${result.failed} skipped=${result.skipped}`,
      "vercel-cron",
      Date.now() - t0,
      result.processed,
    );

    return NextResponse.json(result);
  } catch (e: any) {
    // Log scheduler failure
    await discountStorage.logFetch(
      "__scheduler__",
      false,
      `${e?.code ?? "INTERNAL"}@${e?.stage ?? "init"}: ${e?.message ?? String(e)}`,
      "vercel-cron",
      Date.now() - t0,
      null,
    );
    throw e;
  }
}

export const POST = withErrorHandling(handler);
