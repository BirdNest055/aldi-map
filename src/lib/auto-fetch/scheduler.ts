/**
 * Scheduler: runs periodically (via Vercel Cron), finds stores due for
 * auto-fetch, triggers their fetches, and records outcomes.
 *
 * ANTI-LOOP GUARANTEES:
 * - maxFetchesPerRun caps how many fetches happen per scheduler invocation
 *   (prevents a backlog of due stores from overloading the system)
 * - delayMs between fetches prevents hammering GitHub workflow_dispatch API
 *   (limit: 15 requests/min)
 * - ALDI stores are always skipped (national, handled by discount-fetcher-cli)
 * - Each store fetched at most once per run (settings.lastAutoFetchedAt
 *   updated immediately, so listDue() won't return it again this run)
 *
 * ANTI-SPAM GUARANTEES:
 * - Scheduler runs silently (no UI feedback, no emails)
 * - Failures logged to fetch_log via the storage layer
 * - 3 consecutive failures → auto-disable (MAX_CONSECUTIVE_FAILURES)
 */

import { type AutoFetchSettingsStorage } from "./types";
import type { Store } from "@/lib/types";

/** Function that fetches a single store. Throws on failure. */
export type FetchRunner = (store: Store) => Promise<{ success: boolean; count: number }>;

/** Minimal store-provider interface (subset of StoreProvider). */
export interface SchedulerStoreProvider {
  getStores(): Promise<Store[]>;
}

export interface SchedulerOptions {
  storage: AutoFetchSettingsStorage;
  storeProvider: SchedulerStoreProvider;
  fetchRunner: FetchRunner;
  /** Max fetches per scheduler invocation. Default: 10. */
  maxFetchesPerRun?: number;
  /** Delay between fetches in ms. Default: 1000. */
  delayMs?: number;
  /** Optional: log function for visibility. Default: console.log. */
  log?: (msg: string) => void;
}

export interface SchedulerEntryResult {
  storeId: string;
  status: "success" | "failed" | "skipped-not-found" | "skipped-aldi";
  count?: number;
  error?: string;
  durationMs?: number;
}

export interface SchedulerResult {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  entries: SchedulerEntryResult[];
  startedAt: string;
  finishedAt: string;
  totalDurationMs: number;
}

/**
 * Run one scheduler pass. Returns a summary of what happened.
 * Idempotent: safe to call multiple times in succession (only due stores
 * get processed, and after a successful fetch they're no longer due).
 */
export async function runScheduler(opts: SchedulerOptions): Promise<SchedulerResult> {
  const {
    storage,
    storeProvider,
    fetchRunner,
    maxFetchesPerRun = 10,
    delayMs = 1000,
    log = (m) => console.log(`[scheduler] ${m}`),
  } = opts;

  const startedAt = new Date();
  const entries: SchedulerEntryResult[] = [];

  // Get all due stores
  const dueSettings = await storage.listDue();
  log(`Found ${dueSettings.length} due stores (max ${maxFetchesPerRun} per run)`);

  if (dueSettings.length === 0) {
    return makeEmptyResult(startedAt);
  }

  // Load all stores to look up by ID (we need brand to skip ALDI)
  const allStores = await storeProvider.getStores();
  const storeMap = new Map<string, Store>(allStores.map((s) => [s.id, s]));

  // Sort due settings by storeId for deterministic ordering in tests
  dueSettings.sort((a, b) => a.storeId.localeCompare(b.storeId));

  // Cap at maxFetchesPerRun
  const toProcess = dueSettings.slice(0, maxFetchesPerRun);
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const setting = toProcess[i];
    const store = storeMap.get(setting.storeId);

    if (!store) {
      log(`[${i + 1}/${toProcess.length}] ${setting.storeId}: skipped (not in store provider)`);
      entries.push({
        storeId: setting.storeId,
        status: "skipped-not-found",
      });
      skipped++;
      continue;
    }

    // ALDI is national — never auto-fetched here (discount-fetcher-cli handles it)
    if (store.brand === "aldi-sued") {
      log(`[${i + 1}/${toProcess.length}] ${setting.storeId}: skipped (ALDI national)`);
      entries.push({
        storeId: setting.storeId,
        status: "skipped-aldi",
      });
      skipped++;
      continue;
    }

    const fetchStart = Date.now();
    try {
      const result = await fetchRunner(store);
      const durationMs = Date.now() - fetchStart;
      await storage.recordFetchOutcome(setting.storeId, true, "success");
      log(`[${i + 1}/${toProcess.length}] ${setting.storeId}: success (${result.count} products, ${durationMs}ms)`);
      entries.push({
        storeId: setting.storeId,
        status: "success",
        count: result.count,
        durationMs,
      });
      succeeded++;
    } catch (e: any) {
      const durationMs = Date.now() - fetchStart;
      const errMsg = e?.message ?? String(e);
      await storage.recordFetchOutcome(setting.storeId, false, "failed");
      log(`[${i + 1}/${toProcess.length}] ${setting.storeId}: FAILED (${durationMs}ms) — ${errMsg}`);
      entries.push({
        storeId: setting.storeId,
        status: "failed",
        error: errMsg,
        durationMs,
      });
      failed++;
    }

    // Delay between fetches (anti-spam on GitHub API)
    if (i < toProcess.length - 1 && delayMs > 0) {
      await sleep(delayMs);
    }
  }

  const finishedAt = new Date();
  return {
    processed: succeeded + failed,
    succeeded,
    failed,
    skipped,
    entries,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    totalDurationMs: finishedAt.getTime() - startedAt.getTime(),
  };
}

function makeEmptyResult(startedAt: Date): SchedulerResult {
  const finishedAt = new Date();
  return {
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    entries: [],
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    totalDurationMs: finishedAt.getTime() - startedAt.getTime(),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
