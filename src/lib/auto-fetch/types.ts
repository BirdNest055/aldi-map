/**
 * Auto-fetch settings for regional stores (REWE, etc).
 *
 * Each row represents a user-configured auto-fetch schedule for one store.
 * ALDI stores are exempt — they share a national prospectus that's auto-fetched
 * by the discount-fetcher-cli tool's expiry mode.
 *
 * Interval options (user-facing):
 *   24h   → intervalHours = 24
 *   3d    → intervalHours = 72
 *   1w    → intervalHours = 168
 *   off   → enabled = false (row may still exist, scheduler skips it)
 */

export type IntervalOption = "24h" | "3d" | "1w" | "off";

/** Convert a user-facing interval option to hours (0 for "off"). */
export function intervalOptionToHours(opt: IntervalOption): number {
  switch (opt) {
    case "24h": return 24;
    case "3d": return 72;
    case "1w": return 168;
    case "off": return 0;
  }
}

/** Convert hours back to the canonical option label. */
export function hoursToIntervalOption(h: number): IntervalOption {
  if (h <= 0) return "off";
  if (h <= 24) return "24h";
  if (h <= 72) return "3d";
  return "1w";
}

export interface AutoFetchSettings {
  storeId: string;
  enabled: boolean;
  intervalHours: number;             // 24, 72, 168 (0 only if disabled)
  lastAutoFetchedAt: string | null;  // ISO timestamp
  lastAutoFetchStatus: "success" | "failed" | "skipped-rate-limit" | null;
  consecutiveFailures: number;
  createdAt: string;
  updatedAt: string;
}

/** Max consecutive failures before auto-disabling. */
export const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * Storage interface for auto-fetch settings.
 * Implementation must use Supabase; tests use an in-memory mock.
 */
export interface AutoFetchSettingsStorage {
  /** Get settings for a store. Returns null if not configured. */
  get(storeId: string): Promise<AutoFetchSettings | null>;

  /** Create or update settings. Validates intervalHours ∈ {0, 24, 72, 168}. */
  upsert(
    storeId: string,
    enabled: boolean,
    intervalHours: number,
  ): Promise<AutoFetchSettings>;

  /** Update fetch outcome (called by scheduler after each fetch attempt). */
  recordFetchOutcome(
    storeId: string,
    success: boolean,
    status: "success" | "failed" | "skipped-rate-limit",
    customTimestamp?: Date,
  ): Promise<AutoFetchSettings | null>;

  /** List all enabled settings that are due for a fetch (lastAutoFetchedAt + intervalHours <= now). */
  listDue(now?: Date): Promise<AutoFetchSettings[]>;

  /** List all settings (admin/debug view). */
  listAll(): Promise<AutoFetchSettings[]>;

  /** Delete settings for a store (used when a store is removed). */
  delete(storeId: string): Promise<void>;
}

/** Validate interval hours. Throws on invalid value. */
export function validateIntervalHours(h: number): void {
  if (![0, 24, 72, 168].includes(h)) {
    throw new Error(
      `Invalid intervalHours: ${h}. Must be one of: 0 (off), 24, 72, 168.`,
    );
  }
}

/**
 * Compute the next-fetch-due timestamp for a settings row.
 * Returns null if disabled or never fetched yet (treats as due immediately).
 */
export function nextFetchDueAt(s: AutoFetchSettings, now: Date = new Date()): Date | null {
  if (!s.enabled || s.intervalHours <= 0) return null;
  if (!s.lastAutoFetchedAt) return now; // never fetched → due now
  const last = new Date(s.lastAutoFetchedAt).getTime();
  return new Date(last + s.intervalHours * 3600_000);
}

/**
 * Check if a settings row is due for a fetch.
 * A row is due if: enabled AND intervalHours > 0 AND
 *   (lastAutoFetchedAt is null OR lastAutoFetchedAt + intervalHours <= now)
 */
export function isDue(s: AutoFetchSettings, now: Date = new Date()): boolean {
  if (!s.enabled || s.intervalHours <= 0) return false;
  if (!s.lastAutoFetchedAt) return true;
  const due = nextFetchDueAt(s, now);
  return due !== null && due.getTime() <= now.getTime();
}
