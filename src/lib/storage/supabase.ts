import { createClient } from "@supabase/supabase-js";
import type { DiscountStorage, Discount } from "@/lib/types";
import { Errors, ApiError } from "@/lib/errors";

/**
 * Discount storage backed by Supabase (PostgreSQL).
 * Uses the service role key for server-side writes (bypasses RLS).
 *
 * Also writes a `fetch_log` row for every save attempt — success OR failure —
 * so we have an audit trail of every fetch with error category + stage.
 */
export class SupabaseDiscountStorage implements DiscountStorage {
  private client;

  constructor(url: string, key: string) {
    this.client = createClient(url, key);
  }

  /**
   * Record a fetch attempt in the fetch_log table (for audit/debugging).
   * Best-effort — never throws if logging fails.
   */
  async logFetch(
    storeId: string,
    success: boolean,
    error: string | null,
    clientIp: string | null,
    durationMs: number,
    count: number | null,
  ): Promise<void> {
    try {
      await this.client.from("fetch_log").insert({
        store_id: storeId,
        fetched_at: new Date().toISOString(),
        success,
        error,
        client_ip: clientIp,
        duration_ms: durationMs,
        count,
      });
    } catch (e) {
      // Logging is best-effort — don't fail the request because of it
      console.error("[storage] Failed to write fetch_log:", e);
    }
  }

  async save(storeId: string, discounts: Discount[]): Promise<void> {
    if (discounts.length === 0) {
      // Nothing to save — but this is suspicious, log it
      console.warn(`[storage] save() called with 0 discounts for store ${storeId}`);
      return;
    }

    try {
      // Delete old discounts for this store, then insert new ones
      const { error: delErr } = await this.client
        .from("discounts")
        .delete()
        .eq("store_id", storeId);
      if (delErr) {
        throw Errors.storage(`Failed to delete old discounts: ${delErr.message}`, {
          storeId,
          cause: delErr.code,
        });
      }

      const rows = discounts.map((d) => ({
        store_id: d.storeId,
        product_title: d.productTitle,
        brand: d.brand,
        price: d.price,
        regular_price: d.regularPrice,
        currency: d.currency,
        category: d.category,
        valid_from: d.validFrom,
        valid_until: d.validUntil,
        fetched_at: d.fetchedAt,
      }));

      const { error: insErr } = await this.client.from("discounts").insert(rows);
      if (insErr) {
        throw Errors.storage(`Supabase insert failed: ${insErr.message}`, {
          storeId,
          cause: insErr.code,
        });
      }
    } catch (e) {
      // Already an ApiError — re-throw
      if (e instanceof ApiError) throw e;
      // Wrap unknown
      throw Errors.storage(`Unexpected storage error: ${(e as Error)?.message ?? e}`, {
        storeId,
        cause: (e as Error)?.name,
      });
    }
  }

  async get(storeId: string): Promise<Discount[] | null> {
    try {
      const { data, error } = await this.client
        .from("discounts")
        .select("*")
        .eq("store_id", storeId)
        .order("fetched_at", { ascending: false });

      if (error) {
        throw Errors.storage(`Failed to fetch discounts: ${error.message}`, {
          storeId,
          cause: error.code,
        });
      }
      if (!data || data.length === 0) return null;

      return data.map((row: any) => ({
        storeId: row.store_id,
        productTitle: row.product_title,
        brand: row.brand,
        price: row.price,
        regularPrice: row.regular_price,
        currency: row.currency || "EUR",
        category: row.category,
        validFrom: row.valid_from,
        validUntil: row.valid_until,
        fetchedAt: row.fetched_at,
      }));
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw Errors.storage(`Unexpected storage error: ${(e as Error)?.message ?? e}`, {
        storeId,
        cause: (e as Error)?.name,
      });
    }
  }

  async getRecent(limit: number): Promise<Discount[]> {
    try {
      const { data, error } = await this.client
        .from("discounts")
        .select("*")
        .order("fetched_at", { ascending: false })
        .limit(limit);

      if (error) {
        throw Errors.storage(`Failed to fetch recent discounts: ${error.message}`, {
          cause: error.code,
        });
      }
      if (!data) return [];

      return data.map((row: any) => ({
        storeId: row.store_id,
        productTitle: row.product_title,
        brand: row.brand,
        price: row.price,
        regularPrice: row.regular_price,
        currency: row.currency || "EUR",
        category: row.category,
        validFrom: row.valid_from,
        validUntil: row.valid_until,
        fetchedAt: row.fetched_at,
      }));
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw Errors.storage(`Unexpected storage error: ${(e as Error)?.message ?? e}`, {
        cause: (e as Error)?.name,
      });
    }
  }
}

let _storage: SupabaseDiscountStorage | null = null;

export function getStorage(): SupabaseDiscountStorage {
  if (!_storage) {
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const key = process.env.SUPABASE_SECRET_KEY || "";
    if (!url || !key) {
      throw Errors.config("SUPABASE_URL and SUPABASE_SECRET_KEY must be set");
    }
    _storage = new SupabaseDiscountStorage(url, key);
  }
  return _storage;
}
