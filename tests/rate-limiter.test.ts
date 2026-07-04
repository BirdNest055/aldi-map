import { describe, it, expect, beforeEach } from "vitest";
import { MemoryRateLimiter } from "@/lib/fetcher/rate-limiter";

describe("MemoryRateLimiter", () => {
  let limiter: MemoryRateLimiter;

  beforeEach(() => {
    // 30-second cooldown, as specified
    limiter = new MemoryRateLimiter(30);
  });

  it("allows the first fetch for a new key", () => {
    expect(limiter.canFetch("user-1")).toBe(true);
  });

  it("blocks a second fetch within the cooldown period", () => {
    limiter.recordFetch("user-1");
    expect(limiter.canFetch("user-1")).toBe(false);
  });

  it("allows fetch after cooldown expires", () => {
    limiter = new MemoryRateLimiter(0); // 0-second cooldown = immediate
    limiter.recordFetch("user-1");
    expect(limiter.canFetch("user-1")).toBe(true);
  });

  it("isolates rate limits per key (different users)", () => {
    limiter.recordFetch("user-1");
    expect(limiter.canFetch("user-1")).toBe(false);
    expect(limiter.canFetch("user-2")).toBe(true);
  });

  it("reports cooldown remaining time", () => {
    limiter.recordFetch("user-1");
    const remaining = limiter.getCooldownRemaining("user-1");
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(30);
  });

  it("reports 0 cooldown for keys that haven't fetched", () => {
    expect(limiter.getCooldownRemaining("user-99")).toBe(0);
  });
});
