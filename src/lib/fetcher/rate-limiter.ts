import type { RateLimiter } from "@/lib/types";

/**
 * Simple in-memory rate limiter.
 * Enforces a minimum cooldown between fetches per key (e.g. per IP or per store).
 */
export class MemoryRateLimiter implements RateLimiter {
  private lastFetch = new Map<string, number>();
  private cooldownMs: number;

  constructor(cooldownSeconds: number) {
    this.cooldownMs = cooldownSeconds * 1000;
  }

  canFetch(key: string): boolean {
    const last = this.lastFetch.get(key);
    if (!last) return true;
    return Date.now() - last >= this.cooldownMs;
  }

  recordFetch(key: string): void {
    this.lastFetch.set(key, Date.now());
  }

  getCooldownRemaining(key: string): number {
    const last = this.lastFetch.get(key);
    if (!last) return 0;
    const elapsed = Date.now() - last;
    const remaining = Math.ceil((this.cooldownMs - elapsed) / 1000);
    return remaining > 0 ? remaining : 0;
  }
}
