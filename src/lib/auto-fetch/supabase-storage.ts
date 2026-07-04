/**
 * Supabase implementation of AutoFetchSettingsStorage.
 *
 * Mirrors the in-memory implementation but persists to PostgreSQL.
 * All methods throw typed ApiError on failure (caught by withErrorHandling).
 */

import { createClient } from "@supabase/supabase-js";
import {
  AutoFetchSettings,
  AutoFetchSettingsStorage,
  MAX_CONSECUTIVE_FAILURES,
  validateIntervalHours,
} from "./types";
import { Errors, ApiError } from "@/lib/errors";

export class SupabaseAutoFetchSettingsStorage implements AutoFetchSettingsStorage {
  private client;

  constructor(url: string, key: string) {
    this.client = createClient(url, key);
  }

  async get(storeId: string): Promise<AutoFetchSettings | null> {
    try {
      const { data, error } = await this.client
        .from("auto_fetch_settings")
        .select("*")
        .eq("store_id", storeId)
        .maybeSingle();

      if (error) {
        throw Errors.storage(`get auto_fetch_settings failed: ${error.message}`, {
          cause: error.code,
        });
      }
      if (!data) return null;
      return rowToSettings(data);
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw Errors.storage(`Unexpected error in get: ${(e as Error)?.message ?? e}`, {
        cause: (e as Error)?.name,
      });
    }
  }

  async upsert(
    storeId: string,
    enabled: boolean,
    intervalHours: number,
  ): Promise<AutoFetchSettings> {
    validateIntervalHours(intervalHours);
    if (enabled && intervalHours === 0) {
      throw Errors.config(
        "Invalid combination: enabled=true with intervalHours=0. Use enabled=false (off) instead.",
        { cause: "invalid-combination" },
      );
    }

    try {
      const now = new Date().toISOString();
      const { data, error } = await this.client
        .from("auto_fetch_settings")
        .upsert(
          {
            store_id: storeId,
            enabled,
            interval_hours: intervalHours,
            // Don't overwrite lastAutoFetchedAt etc. — use upsert with onConflict preserve
            // Supabase upsert by default updates ALL columns; we need to preserve these.
            // Solution: select first, then update only the user-facing fields.
          },
          { onConflict: "store_id", ignoreDuplicates: false },
        )
        .select()
        .single();

      if (error) {
        throw Errors.storage(`upsert auto_fetch_settings failed: ${error.message}`, {
          cause: error.code,
        });
      }

      // Now do a targeted update preserving the audit fields
      const { data: updated, error: updErr } = await this.client
        .from("auto_fetch_settings")
        .update({
          enabled,
          interval_hours: intervalHours,
          updated_at: now,
        })
        .eq("store_id", storeId)
        .select()
        .single();

      if (updErr) {
        throw Errors.storage(`update auto_fetch_settings failed: ${updErr.message}`, {
          cause: updErr.code,
        });
      }

      return rowToSettings(updated);
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw Errors.storage(`Unexpected error in upsert: ${(e as Error)?.message ?? e}`, {
        cause: (e as Error)?.name,
      });
    }
  }

  async recordFetchOutcome(
    storeId: string,
    success: boolean,
    status: "success" | "failed" | "skipped-rate-limit",
    customTimestamp?: Date,
  ): Promise<AutoFetchSettings | null> {
    try {
      // Read existing to compute new consecutiveFailures
      const existing = await this.get(storeId);
      if (!existing) return null;

      let consecutiveFailures = existing.consecutiveFailures;
      let enabled = existing.enabled;

      if (success) {
        consecutiveFailures = 0;
      } else if (status === "failed") {
        consecutiveFailures += 1;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          enabled = false;
        }
      }

      const now = (customTimestamp ?? new Date()).toISOString();

      const { data, error } = await this.client
        .from("auto_fetch_settings")
        .update({
          last_auto_fetched_at: now,
          last_auto_fetch_status: status,
          consecutive_failures: consecutiveFailures,
          enabled,
        })
        .eq("store_id", storeId)
        .select()
        .single();

      if (error) {
        throw Errors.storage(`recordFetchOutcome failed: ${error.message}`, {
          cause: error.code,
        });
      }

      return rowToSettings(data);
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw Errors.storage(`Unexpected error in recordFetchOutcome: ${(e as Error)?.message ?? e}`, {
        cause: (e as Error)?.name,
      });
    }
  }

  async listDue(now: Date = new Date()): Promise<AutoFetchSettings[]> {
    try {
      // Postgres can compute "due" via: last_auto_fetched_at + interval_hours * INTERVAL '1 hour' <= NOW()
      // Or last_auto_fetched_at IS NULL
      // Use raw SQL via RPC or filter in JS. Simpler: select all enabled, filter in JS.
      const { data, error } = await this.client
        .from("auto_fetch_settings")
        .select("*")
        .eq("enabled", true)
        .gt("interval_hours", 0);

      if (error) {
        throw Errors.storage(`listDue query failed: ${error.message}`, {
          cause: error.code,
        });
      }
      if (!data) return [];

      const nowMs = now.getTime();
      return data
        .map(rowToSettings)
        .filter((s) => {
          if (!s.lastAutoFetchedAt) return true; // never fetched → due
          const lastMs = new Date(s.lastAutoFetchedAt).getTime();
          return lastMs + s.intervalHours * 3600_000 <= nowMs;
        });
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw Errors.storage(`Unexpected error in listDue: ${(e as Error)?.message ?? e}`, {
        cause: (e as Error)?.name,
      });
    }
  }

  async listAll(): Promise<AutoFetchSettings[]> {
    try {
      const { data, error } = await this.client
        .from("auto_fetch_settings")
        .select("*")
        .order("updated_at", { ascending: false });

      if (error) {
        throw Errors.storage(`listAll failed: ${error.message}`, {
          cause: error.code,
        });
      }
      return (data ?? []).map(rowToSettings);
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw Errors.storage(`Unexpected error in listAll: ${(e as Error)?.message ?? e}`, {
        cause: (e as Error)?.name,
      });
    }
  }

  async delete(storeId: string): Promise<void> {
    try {
      const { error } = await this.client
        .from("auto_fetch_settings")
        .delete()
        .eq("store_id", storeId);
      if (error) {
        throw Errors.storage(`delete failed: ${error.message}`, {
          cause: error.code,
        });
      }
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw Errors.storage(`Unexpected error in delete: ${(e as Error)?.message ?? e}`, {
        cause: (e as Error)?.name,
      });
    }
  }
}

function rowToSettings(row: any): AutoFetchSettings {
  return {
    storeId: row.store_id,
    enabled: row.enabled,
    intervalHours: row.interval_hours,
    lastAutoFetchedAt: row.last_auto_fetched_at ?? null,
    lastAutoFetchStatus: row.last_auto_fetch_status ?? null,
    consecutiveFailures: row.consecutive_failures ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Singleton accessor (reuses the same Supabase URL/key as the discount storage)
let _storage: SupabaseAutoFetchSettingsStorage | null = null;

export function getAutoFetchSettingsStorage(): SupabaseAutoFetchSettingsStorage {
  if (!_storage) {
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const key = process.env.SUPABASE_SECRET_KEY || "";
    if (!url || !key) {
      throw Errors.config("SUPABASE_URL and SUPABASE_SECRET_KEY must be set");
    }
    _storage = new SupabaseAutoFetchSettingsStorage(url, key);
  }
  return _storage;
}
