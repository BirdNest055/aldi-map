/**
 * In-memory implementation of AutoFetchSettingsStorage.
 *
 * Used for:
 * - Unit tests (deterministic, no network)
 * - Local development (state lost on restart)
 *
 * Production uses SupabaseAutoFetchSettingsStorage (separate file).
 */

import {
  AutoFetchSettings,
  AutoFetchSettingsStorage,
  MAX_CONSECUTIVE_FAILURES,
  validateIntervalHours,
} from "./types";

export class InMemoryAutoFetchSettingsStorage implements AutoFetchSettingsStorage {
  private map = new Map<string, AutoFetchSettings>();

  async get(storeId: string): Promise<AutoFetchSettings | null> {
    return this.map.get(storeId) ?? null;
  }

  async upsert(
    storeId: string,
    enabled: boolean,
    intervalHours: number,
  ): Promise<AutoFetchSettings> {
    validateIntervalHours(intervalHours);
    // Business rule: enabled=true requires intervalHours > 0 (off means disabled)
    if (enabled && intervalHours === 0) {
      throw new Error(
        "Invalid combination: enabled=true with intervalHours=0. " +
        "Use enabled=false (off) instead.",
      );
    }
    const now = new Date().toISOString();
    const existing = this.map.get(storeId);
    const row: AutoFetchSettings = {
      storeId,
      enabled,
      intervalHours,
      lastAutoFetchedAt: existing?.lastAutoFetchedAt ?? null,
      lastAutoFetchStatus: existing?.lastAutoFetchStatus ?? null,
      consecutiveFailures: existing?.consecutiveFailures ?? 0,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.map.set(storeId, row);
    return row;
  }

  async recordFetchOutcome(
    storeId: string,
    success: boolean,
    status: "success" | "failed" | "skipped-rate-limit",
    customTimestamp?: Date,
  ): Promise<AutoFetchSettings | null> {
    const existing = this.map.get(storeId);
    if (!existing) return null;
    const now = (customTimestamp ?? new Date()).toISOString();
    let consecutiveFailures = existing.consecutiveFailures;
    let enabled = existing.enabled;

    if (success) {
      consecutiveFailures = 0;
    } else if (status === "failed") {
      consecutiveFailures += 1;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        enabled = false; // auto-disable
      }
    }
    // status === "skipped-rate-limit" → don't touch consecutiveFailures

    const updated: AutoFetchSettings = {
      ...existing,
      lastAutoFetchedAt: now,
      lastAutoFetchStatus: status,
      consecutiveFailures,
      enabled,
      updatedAt: now,
    };
    this.map.set(storeId, updated);
    return updated;
  }

  async listDue(now: Date = new Date()): Promise<AutoFetchSettings[]> {
    const due: AutoFetchSettings[] = [];
    for (const s of this.map.values()) {
      if (this.isDue(s, now)) due.push(s);
    }
    return due;
  }

  async listAll(): Promise<AutoFetchSettings[]> {
    return Array.from(this.map.values());
  }

  async delete(storeId: string): Promise<void> {
    this.map.delete(storeId);
  }

  /** Test helper: directly set lastAutoFetchedAt to simulate a past fetch. */
  setLastFetchedAt(storeId: string, isoTimestamp: string): void {
    const existing = this.map.get(storeId);
    if (!existing) return;
    this.map.set(storeId, {
      ...existing,
      lastAutoFetchedAt: isoTimestamp,
    });
  }

  private isDue(s: AutoFetchSettings, now: Date): boolean {
    if (!s.enabled || s.intervalHours <= 0) return false;
    if (!s.lastAutoFetchedAt) return true;
    const last = new Date(s.lastAutoFetchedAt).getTime();
    return last + s.intervalHours * 3600_000 <= now.getTime();
  }
}
