import { describe, it, expect, beforeEach } from "vitest";
import {
  InMemoryAutoFetchSettingsStorage,
} from "@/lib/auto-fetch/in-memory-storage";
import { MAX_CONSECUTIVE_FAILURES, type AutoFetchSettings } from "@/lib/auto-fetch/types";

describe("InMemoryAutoFetchSettingsStorage", () => {
  let storage: InMemoryAutoFetchSettingsStorage;

  beforeEach(() => {
    storage = new InMemoryAutoFetchSettingsStorage();
  });

  describe("get", () => {
    it("returns null for unknown store", async () => {
      expect(await storage.get("unknown")).toBeNull();
    });

    it("returns the settings after upsert", async () => {
      await storage.upsert("rewe-1", true, 24);
      const s = await storage.get("rewe-1");
      expect(s).not.toBeNull();
      expect(s!.storeId).toBe("rewe-1");
      expect(s!.enabled).toBe(true);
      expect(s!.intervalHours).toBe(24);
      expect(s!.lastAutoFetchedAt).toBeNull();
      expect(s!.consecutiveFailures).toBe(0);
    });
  });

  describe("upsert", () => {
    it("creates a new settings row", async () => {
      const s = await storage.upsert("rewe-1", true, 24);
      expect(s.storeId).toBe("rewe-1");
      expect(s.enabled).toBe(true);
      expect(s.intervalHours).toBe(24);
      expect(s.createdAt).toBe(s.updatedAt);
    });

    it("updates an existing settings row (preserves createdAt, updates updatedAt)", async () => {
      const original = await storage.upsert("rewe-1", true, 24);
      await delay(5);
      const updated = await storage.upsert("rewe-1", false, 0);
      expect(updated.createdAt).toBe(original.createdAt);
      expect(updated.updatedAt).not.toBe(original.updatedAt);
      expect(updated.enabled).toBe(false);
      expect(updated.intervalHours).toBe(0);
    });

    it("rejects invalid intervalHours values", async () => {
      await expect(storage.upsert("rewe-1", true, 1)).rejects.toThrow(/Invalid intervalHours/);
      await expect(storage.upsert("rewe-1", true, 48)).rejects.toThrow(/Invalid intervalHours/);
      await expect(storage.upsert("rewe-1", true, -1)).rejects.toThrow(/Invalid intervalHours/);
      await expect(storage.upsert("rewe-1", true, 100)).rejects.toThrow(/Invalid intervalHours/);
    });

    it("accepts 0 (off) when disabled", async () => {
      const s = await storage.upsert("rewe-1", false, 0);
      expect(s.enabled).toBe(false);
      expect(s.intervalHours).toBe(0);
    });

    it("rejects intervalHours=0 when enabled=true (off means disabled)", async () => {
      await expect(storage.upsert("rewe-1", true, 0)).rejects.toThrow(/enabled.*intervalHours/);
    });
  });

  describe("recordFetchOutcome", () => {
    it("returns null for unknown store", async () => {
      expect(await storage.recordFetchOutcome("unknown", true, "success")).toBeNull();
    });

    it("sets lastAutoFetchedAt and status='success' on success", async () => {
      await storage.upsert("rewe-1", true, 24);
      const before = new Date();
      const s = await storage.recordFetchOutcome("rewe-1", true, "success");
      const after = new Date();
      expect(s!.lastAutoFetchStatus).toBe("success");
      expect(s!.consecutiveFailures).toBe(0);
      expect(s!.lastAutoFetchedAt).not.toBeNull();
      const fetchedAt = new Date(s!.lastAutoFetchedAt!);
      expect(fetchedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(fetchedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it("increments consecutiveFailures on failure", async () => {
      await storage.upsert("rewe-1", true, 24);
      const s1 = await storage.recordFetchOutcome("rewe-1", false, "failed");
      expect(s1!.consecutiveFailures).toBe(1);
      expect(s1!.lastAutoFetchStatus).toBe("failed");
      const s2 = await storage.recordFetchOutcome("rewe-1", false, "failed");
      expect(s2!.consecutiveFailures).toBe(2);
    });

    it("resets consecutiveFailures to 0 on success after failures", async () => {
      await storage.upsert("rewe-1", true, 24);
      await storage.recordFetchOutcome("rewe-1", false, "failed");
      await storage.recordFetchOutcome("rewe-1", false, "failed");
      const s = await storage.recordFetchOutcome("rewe-1", true, "success");
      expect(s!.consecutiveFailures).toBe(0);
    });

    it("auto-disables after MAX_CONSECUTIVE_FAILURES consecutive failures", async () => {
      await storage.upsert("rewe-1", true, 24);
      for (let i = 1; i < MAX_CONSECUTIVE_FAILURES; i++) {
        const s = await storage.recordFetchOutcome("rewe-1", false, "failed");
        expect(s!.enabled).toBe(true); // still enabled before hitting the limit
      }
      const s = await storage.recordFetchOutcome("rewe-1", false, "failed");
      expect(s!.consecutiveFailures).toBe(MAX_CONSECUTIVE_FAILURES);
      expect(s!.enabled).toBe(false); // auto-disabled
    });

    it("records 'skipped-rate-limit' as a non-failure (does not increment)", async () => {
      await storage.upsert("rewe-1", true, 24);
      const s = await storage.recordFetchOutcome("rewe-1", false, "skipped-rate-limit");
      expect(s!.lastAutoFetchStatus).toBe("skipped-rate-limit");
      expect(s!.consecutiveFailures).toBe(0); // not counted as a failure
      expect(s!.enabled).toBe(true);
    });
  });

  describe("listDue", () => {
    it("returns empty when no settings exist", async () => {
      expect(await storage.listDue()).toEqual([]);
    });

    it("includes enabled stores that have never been fetched", async () => {
      await storage.upsert("rewe-1", true, 24);
      const due = await storage.listDue();
      expect(due.length).toBe(1);
      expect(due[0].storeId).toBe("rewe-1");
    });

    it("excludes disabled stores", async () => {
      await storage.upsert("rewe-1", false, 0);
      const due = await storage.listDue();
      expect(due).toEqual([]);
    });

    it("excludes stores fetched within the interval", async () => {
      await storage.upsert("rewe-1", true, 24);
      await storage.recordFetchOutcome("rewe-1", true, "success");
      const due = await storage.listDue();
      expect(due).toEqual([]);
    });

    it("includes stores whose interval has elapsed", async () => {
      await storage.upsert("rewe-1", true, 24);
      // simulate a fetch 26 hours ago
      const oldDate = new Date(Date.now() - 26 * 3600_000);
      await storage.recordFetchOutcome("rewe-1", true, "success", oldDate);
      const due = await storage.listDue();
      expect(due.length).toBe(1);
      expect(due[0].storeId).toBe("rewe-1");
    });

    it("excludes auto-disabled stores (after MAX_CONSECUTIVE_FAILURES)", async () => {
      await storage.upsert("rewe-1", true, 24);
      for (let i = 0; i < MAX_CONSECUTIVE_FAILURES; i++) {
        await storage.recordFetchOutcome("rewe-1", false, "failed");
      }
      const due = await storage.listDue();
      expect(due).toEqual([]);
    });

    it("handles multiple stores with mixed states", async () => {
      await storage.upsert("rewe-1", true, 24);  // due (never fetched)
      await storage.upsert("rewe-2", true, 24);  // not due (fetched just now)
      await storage.recordFetchOutcome("rewe-2", true, "success");
      await storage.upsert("rewe-3", false, 0);  // excluded (disabled)
      await storage.upsert("rewe-4", true, 72);  // due (never fetched)
      const due = await storage.listDue();
      expect(due.length).toBe(2);
      const ids = due.map((s) => s.storeId).sort();
      expect(ids).toEqual(["rewe-1", "rewe-4"]);
    });
  });

  describe("listAll", () => {
    it("returns all settings regardless of state", async () => {
      await storage.upsert("rewe-1", true, 24);
      await storage.upsert("rewe-2", false, 0);
      const all = await storage.listAll();
      expect(all.length).toBe(2);
    });
  });

  describe("delete", () => {
    it("removes the settings row", async () => {
      await storage.upsert("rewe-1", true, 24);
      await storage.delete("rewe-1");
      expect(await storage.get("rewe-1")).toBeNull();
    });

    it("is idempotent (no error if store doesn't exist)", async () => {
      await expect(storage.delete("never-existed")).resolves.toBeUndefined();
    });
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
