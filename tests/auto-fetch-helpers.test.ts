import { describe, it, expect } from "vitest";
import {
  intervalOptionToHours,
  hoursToIntervalOption,
  validateIntervalHours,
  nextFetchDueAt,
  isDue,
  MAX_CONSECUTIVE_FAILURES,
  type AutoFetchSettings,
} from "@/lib/auto-fetch/types";

describe("intervalOptionToHours", () => {
  it("converts '24h' to 24", () => {
    expect(intervalOptionToHours("24h")).toBe(24);
  });
  it("converts '3d' to 72", () => {
    expect(intervalOptionToHours("3d")).toBe(72);
  });
  it("converts '1w' to 168", () => {
    expect(intervalOptionToHours("1w")).toBe(168);
  });
  it("converts 'off' to 0", () => {
    expect(intervalOptionToHours("off")).toBe(0);
  });
});

describe("hoursToIntervalOption", () => {
  it("converts 0 to 'off'", () => {
    expect(hoursToIntervalOption(0)).toBe("off");
  });
  it("converts 24 to '24h'", () => {
    expect(hoursToIntervalOption(24)).toBe("24h");
  });
  it("converts 72 to '3d'", () => {
    expect(hoursToIntervalOption(72)).toBe("3d");
  });
  it("converts 168 to '1w'", () => {
    expect(hoursToIntervalOption(168)).toBe("1w");
  });
  it("is round-trip stable for all valid values", () => {
    for (const opt of ["24h", "3d", "1w", "off"] as const) {
      expect(hoursToIntervalOption(intervalOptionToHours(opt))).toBe(opt);
    }
  });
});

describe("validateIntervalHours", () => {
  it("accepts 0, 24, 72, 168", () => {
    expect(() => validateIntervalHours(0)).not.toThrow();
    expect(() => validateIntervalHours(24)).not.toThrow();
    expect(() => validateIntervalHours(72)).not.toThrow();
    expect(() => validateIntervalHours(168)).not.toThrow();
  });
  it("rejects invalid values", () => {
    expect(() => validateIntervalHours(1)).toThrow(/Invalid intervalHours/);
    expect(() => validateIntervalHours(48)).toThrow(/Invalid intervalHours/);
    expect(() => validateIntervalHours(-1)).toThrow(/Invalid intervalHours/);
    expect(() => validateIntervalHours(100)).toThrow(/Invalid intervalHours/);
  });
});

describe("MAX_CONSECUTIVE_FAILURES", () => {
  it("is 3", () => {
    expect(MAX_CONSECUTIVE_FAILURES).toBe(3);
  });
});

describe("isDue", () => {
  const now = new Date("2026-07-04T12:00:00Z");

  it("returns false when disabled", () => {
    const s: AutoFetchSettings = makeSettings({ enabled: false, intervalHours: 24 });
    expect(isDue(s, now)).toBe(false);
  });

  it("returns false when intervalHours is 0 (off)", () => {
    const s: AutoFetchSettings = makeSettings({ enabled: true, intervalHours: 0 });
    expect(isDue(s, now)).toBe(false);
  });

  it("returns true when never fetched yet", () => {
    const s: AutoFetchSettings = makeSettings({
      enabled: true,
      intervalHours: 24,
      lastAutoFetchedAt: null,
    });
    expect(isDue(s, now)).toBe(true);
  });

  it("returns false when fetched recently (within interval)", () => {
    const s: AutoFetchSettings = makeSettings({
      enabled: true,
      intervalHours: 24,
      lastAutoFetchedAt: "2026-07-04T10:00:00Z", // 2 hours ago
    });
    expect(isDue(s, now)).toBe(false);
  });

  it("returns true when interval has elapsed", () => {
    const s: AutoFetchSettings = makeSettings({
      enabled: true,
      intervalHours: 24,
      lastAutoFetchedAt: "2026-07-03T10:00:00Z", // 26 hours ago
    });
    expect(isDue(s, now)).toBe(true);
  });

  it("returns true exactly at the boundary (interval = elapsed)", () => {
    const s: AutoFetchSettings = makeSettings({
      enabled: true,
      intervalHours: 24,
      lastAutoFetchedAt: "2026-07-03T12:00:00Z", // exactly 24h ago
    });
    expect(isDue(s, now)).toBe(true);
  });

  it("works with 1-week interval", () => {
    const s: AutoFetchSettings = makeSettings({
      enabled: true,
      intervalHours: 168,
      lastAutoFetchedAt: "2026-06-27T12:00:00Z", // exactly 7 days ago
    });
    expect(isDue(s, now)).toBe(true);
  });
});

describe("nextFetchDueAt", () => {
  const now = new Date("2026-07-04T12:00:00Z");

  it("returns null when disabled", () => {
    const s: AutoFetchSettings = makeSettings({ enabled: false, intervalHours: 24 });
    expect(nextFetchDueAt(s, now)).toBeNull();
  });

  it("returns null when intervalHours is 0", () => {
    const s: AutoFetchSettings = makeSettings({ enabled: true, intervalHours: 0 });
    expect(nextFetchDueAt(s, now)).toBeNull();
  });

  it("returns now when never fetched yet", () => {
    const s: AutoFetchSettings = makeSettings({
      enabled: true,
      intervalHours: 24,
      lastAutoFetchedAt: null,
    });
    expect(nextFetchDueAt(s, now)).toEqual(now);
  });

  it("returns lastFetched + interval", () => {
    const s: AutoFetchSettings = makeSettings({
      enabled: true,
      intervalHours: 24,
      lastAutoFetchedAt: "2026-07-03T12:00:00Z",
    });
    const expected = new Date("2026-07-04T12:00:00Z");
    expect(nextFetchDueAt(s, now)).toEqual(expected);
  });
});

// Helper: create a settings object with defaults
function makeSettings(overrides: Partial<AutoFetchSettings>): AutoFetchSettings {
  return {
    storeId: "test-store",
    enabled: true,
    intervalHours: 24,
    lastAutoFetchedAt: null,
    lastAutoFetchStatus: null,
    consecutiveFailures: 0,
    createdAt: "2026-07-04T00:00:00Z",
    updatedAt: "2026-07-04T00:00:00Z",
    ...overrides,
  };
}
