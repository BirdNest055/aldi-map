import { describe, it, expect, beforeEach, vi } from "vitest";
import { InMemoryAutoFetchSettingsStorage } from "@/lib/auto-fetch/in-memory-storage";
import { runScheduler, type SchedulerResult } from "@/lib/auto-fetch/scheduler";
import type { Store } from "@/lib/types";
import { MAX_CONSECUTIVE_FAILURES } from "@/lib/auto-fetch/types";

// Mock store provider
class MockStoreProvider {
  constructor(private stores: Store[]) {}
  async getStores() { return this.stores; }
  async getStoresInBounds() { return this.stores; }
}

// Mock fetcher: tracks which stores were "fetched" and configurable per-store outcomes
class MockFetchRunner {
  public calls: string[] = [];
  public outcomes = new Map<string, "success" | "failed">();

  setOutcome(storeId: string, outcome: "success" | "failed") {
    this.outcomes.set(storeId, outcome);
  }

  // This is the function the scheduler will call
  fn = async (store: Store): Promise<{ success: boolean; count: number }> => {
    this.calls.push(store.id);
    const outcome = this.outcomes.get(store.id) ?? "success";
    if (outcome === "failed") {
      throw new Error(`Mock fetch failure for ${store.id}`);
    }
    return { success: true, count: 10 };
  };
}

function makeStore(id: string, brand: string = "rewe"): Store {
  return {
    id, name: `Store ${id}`, brand,
    lat: 50, lng: 10, address: "Test address",
  };
}

describe("runScheduler", () => {
  let storage: InMemoryAutoFetchSettingsStorage;
  let stores: Store[];
  let provider: MockStoreProvider;
  let runner: MockFetchRunner;

  beforeEach(() => {
    storage = new InMemoryAutoFetchSettingsStorage();
    stores = [
      makeStore("rewe-1"),
      makeStore("rewe-2"),
      makeStore("rewe-3"),
      makeStore("aldi-1", "aldi-sued"), // ALDI should be skipped
    ];
    provider = new MockStoreProvider(stores);
    runner = new MockFetchRunner();
  });

  it("returns empty result when no settings exist", async () => {
    const result = await runScheduler({
      storage, storeProvider: provider, fetchRunner: runner.fn,
    });
    expect(result.processed).toBe(0);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(0);
    expect(runner.calls).toEqual([]);
  });

  it("skips ALDI stores even if they have a settings row", async () => {
    // Manually insert an ALDI setting (shouldn't happen in production, but test the safety)
    await storage.upsert("aldi-1", true, 24);
    const result = await runScheduler({
      storage, storeProvider: provider, fetchRunner: runner.fn,
    });
    expect(result.processed).toBe(0);
    expect(result.skipped).toBe(1);
    expect(runner.calls).toEqual([]);
  });

  it("fetches due REWE stores and records success", async () => {
    await storage.upsert("rewe-1", true, 24);
    const result = await runScheduler({
      storage, storeProvider: provider, fetchRunner: runner.fn,
    });
    expect(result.processed).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
    expect(runner.calls).toEqual(["rewe-1"]);
    const s = await storage.get("rewe-1");
    expect(s!.lastAutoFetchStatus).toBe("success");
    expect(s!.consecutiveFailures).toBe(0);
    expect(s!.lastAutoFetchedAt).not.toBeNull();
  });

  it("records failure when fetch throws", async () => {
    await storage.upsert("rewe-1", true, 24);
    runner.setOutcome("rewe-1", "failed");
    const result = await runScheduler({
      storage, storeProvider: provider, fetchRunner: runner.fn,
    });
    expect(result.processed).toBe(1);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(1);
    const s = await storage.get("rewe-1");
    expect(s!.lastAutoFetchStatus).toBe("failed");
    expect(s!.consecutiveFailures).toBe(1);
    expect(s!.enabled).toBe(true); // still enabled (1 < MAX)
  });

  it("auto-disables store after MAX_CONSECUTIVE_FAILURES failures", async () => {
    await storage.upsert("rewe-1", true, 24);
    runner.setOutcome("rewe-1", "failed");

    // Run MAX_CONSECUTIVE_FAILURES times — but with custom "now" to make each run due
    for (let i = 1; i <= MAX_CONSECUTIVE_FAILURES; i++) {
      // Advance lastAutoFetchedAt backwards so the store is "due" again
      const s = await storage.get("rewe-1");
      if (s!.lastAutoFetchedAt) {
        // Move lastAutoFetchedAt back 25 hours so it's due again
        const oldDate = new Date(Date.now() - 25 * 3600_000);
        await (storage as any).setLastFetchedAt("rewe-1", oldDate.toISOString());
      }
      await runScheduler({ storage, storeProvider: provider, fetchRunner: runner.fn });
    }

    const s = await storage.get("rewe-1");
    expect(s!.consecutiveFailures).toBe(MAX_CONSECUTIVE_FAILURES);
    expect(s!.enabled).toBe(false);
  });

  it("resets consecutiveFailures on success after failures", async () => {
    await storage.upsert("rewe-1", true, 24);
    runner.setOutcome("rewe-1", "failed");
    // Fail twice
    for (let i = 0; i < 2; i++) {
      await (storage as any).setLastFetchedAt("rewe-1", new Date(Date.now() - 25 * 3600_000).toISOString());
      await runScheduler({ storage, storeProvider: provider, fetchRunner: runner.fn });
    }
    let s = await storage.get("rewe-1");
    expect(s!.consecutiveFailures).toBe(2);
    expect(s!.enabled).toBe(true);

    // Now succeed
    runner.setOutcome("rewe-1", "success");
    await (storage as any).setLastFetchedAt("rewe-1", new Date(Date.now() - 25 * 3600_000).toISOString());
    await runScheduler({ storage, storeProvider: provider, fetchRunner: runner.fn });
    s = await storage.get("rewe-1");
    expect(s!.consecutiveFailures).toBe(0);
    expect(s!.lastAutoFetchStatus).toBe("success");
  });

  it("skips stores that are not due (recently fetched)", async () => {
    await storage.upsert("rewe-1", true, 24);
    await storage.recordFetchOutcome("rewe-1", true, "success"); // just fetched
    const result = await runScheduler({
      storage, storeProvider: provider, fetchRunner: runner.fn,
    });
    expect(result.processed).toBe(0);
    expect(runner.calls).toEqual([]);
  });

  it("skips stores that are disabled", async () => {
    await storage.upsert("rewe-1", false, 0);
    const result = await runScheduler({
      storage, storeProvider: provider, fetchRunner: runner.fn,
    });
    expect(result.processed).toBe(0);
    expect(runner.calls).toEqual([]);
  });

  it("skips stores not in the store provider (orphaned settings)", async () => {
    await storage.upsert("orphaned-store", true, 24);
    const result = await runScheduler({
      storage, storeProvider: provider, fetchRunner: runner.fn,
    });
    expect(result.processed).toBe(0);
    expect(result.skipped).toBe(1); // skipped because not found in store provider
    expect(runner.calls).toEqual([]);
  });

  it("processes multiple due stores sequentially", async () => {
    await storage.upsert("rewe-1", true, 24);
    await storage.upsert("rewe-2", true, 24);
    await storage.upsert("rewe-3", true, 24);
    const result = await runScheduler({
      storage, storeProvider: provider, fetchRunner: runner.fn,
    });
    expect(result.processed).toBe(3);
    expect(result.succeeded).toBe(3);
    expect(runner.calls.sort()).toEqual(["rewe-1", "rewe-2", "rewe-3"]);
  });

  it("continues processing other stores after one fails", async () => {
    await storage.upsert("rewe-1", true, 24);
    await storage.upsert("rewe-2", true, 24);
    runner.setOutcome("rewe-1", "failed");
    const result = await runScheduler({
      storage, storeProvider: provider, fetchRunner: runner.fn,
    });
    expect(result.processed).toBe(2);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
    expect(runner.calls.sort()).toEqual(["rewe-1", "rewe-2"]);
  });

  it("returns detailed per-store result entries", async () => {
    await storage.upsert("rewe-1", true, 24);
    await storage.upsert("rewe-2", true, 24);
    runner.setOutcome("rewe-2", "failed");
    const result = await runScheduler({
      storage, storeProvider: provider, fetchRunner: runner.fn,
    });
    expect(result.entries).toHaveLength(2);
    const rewe1 = result.entries.find((e) => e.storeId === "rewe-1");
    const rewe2 = result.entries.find((e) => e.storeId === "rewe-2");
    expect(rewe1!.status).toBe("success");
    expect(rewe2!.status).toBe("failed");
    expect(rewe2!.error).toContain("Mock fetch failure");
  });

  it("respects maxFetchesPerRun limit (anti-loop)", async () => {
    // 5 due stores, but limit to 3 per run
    for (let i = 1; i <= 5; i++) {
      await storage.upsert(`rewe-${i}`, true, 24);
    }
    const result = await runScheduler({
      storage, storeProvider: provider, fetchRunner: runner.fn,
      maxFetchesPerRun: 3,
    });
    expect(result.processed).toBe(3);
    expect(runner.calls).toHaveLength(3);
  });

  it("uses configurable inter-fetch delay", async () => {
    await storage.upsert("rewe-1", true, 24);
    await storage.upsert("rewe-2", true, 24);
    const sleepSpy = vi.spyOn(global, "setTimeout");
    await runScheduler({
      storage, storeProvider: provider, fetchRunner: runner.fn,
      delayMs: 10,
    });
    // setTimeout should have been called with the delay between fetches
    expect(sleepSpy).toHaveBeenCalledWith(expect.any(Function), 10);
    sleepSpy.mockRestore();
  });
});
