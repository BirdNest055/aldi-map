import { createClient } from "@supabase/supabase-js";
import type { DiscountStorage, Discount } from "@/lib/types";

/**
 * Discount storage backed by Supabase (PostgreSQL).
 * Uses the service role key for server-side writes (bypasses RLS).
 */
export class SupabaseDiscountStorage implements DiscountStorage {
  private client;

  constructor(url: string, key: string) {
    this.client = createClient(url, key);
  }

  async save(storeId: string, discounts: Discount[]): Promise<void> {
    if (discounts.length === 0) return;

    // Delete old discounts for this store, then insert new ones
    await this.client.from("discounts").delete().eq("store_id", storeId);

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

    const { error } = await this.client.from("discounts").insert(rows);
    if (error) throw new Error(`Supabase insert failed: ${error.message}`);
  }

  async get(storeId: string): Promise<Discount[] | null> {
    const { data, error } = await this.client
      .from("discounts")
      .select("*")
      .eq("store_id", storeId)
      .order("fetched_at", { ascending: false });

    if (error || !data || data.length === 0) return null;

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
  }

  async getRecent(limit: number): Promise<Discount[]> {
    const { data, error } = await this.client
      .from("discounts")
      .select("*")
      .order("fetched_at", { ascending: false })
      .limit(limit);

    if (error || !data) return [];

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
  }
}

let _storage: SupabaseDiscountStorage | null = null;

export function getStorage(): SupabaseDiscountStorage {
  if (!_storage) {
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const key = process.env.SUPABASE_SECRET_KEY || "";
    if (!url || !key) {
      throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY must be set");
    }
    _storage = new SupabaseDiscountStorage(url, key);
  }
  return _storage;
}
