import { NextRequest, NextResponse } from "next/server";
import { getRegistry } from "@/lib/fetcher/registry";
import { getStoreProvider } from "@/lib/stores/json-provider";
import { getStorage } from "@/lib/storage/supabase";
import { MemoryRateLimiter } from "@/lib/fetcher/rate-limiter";
import { Errors, ApiError, withErrorHandling, fetchWithTimeout } from "@/lib/errors";
import "@/lib/fetcher/plugins/discount-fetcher-aldi";

let _limiter: MemoryRateLimiter | null = null;
function getLimiter() {
  if (!_limiter) _limiter = new MemoryRateLimiter(30);
  return _limiter;
}

// ALDI SÜD is national — all stores share the same prospectus.
// REWE is regional — each store has different offers.
function getEffectiveStoreId(store: any): string {
  if (store.brand === "aldi-sued") return "aldi-sued-national";
  return store.id;
}

/**
 * POST /api/fetch
 * Body: { storeId: string }
 *
 * Triggers a discount fetch for the given store.
 * - ALDI SÜD: synchronous fetch via XHR API (~5s), saved to Supabase under
 *   the "aldi-sued-national" store_id (one set for all ALDI stores).
 * - REWE: async — triggers a GitHub Actions workflow that uses CloakBrowser
 *   to bypass Cloudflare. Results appear in Supabase in ~60-90s.
 *
 * ANTI-LOOP: this route does NOT retry. Single attempt per call. The client
 * may retry on retryable errors (network, timeout), but the rate limiter
 * enforces a 30s cooldown per IP.
 *
 * ANTI-SPAM: every fetch attempt is logged to `fetch_log` with success/error,
 * client IP, duration, and count. No emails are sent — the UI is the
 * notification mechanism.
 */
async function handler(req: NextRequest) {
  const t0 = Date.now();
  const body = await req.json().catch(() => ({}));
  const { storeId } = body;
  if (!storeId) {
    throw Errors.config("storeId required", { cause: "missing-body-field" });
  }

  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limiter = getLimiter();
  if (!limiter.canFetch(clientIp)) {
    const remaining = limiter.getCooldownRemaining(clientIp);
    throw Errors.rateLimited(remaining, { storeId });
  }

  const provider = getStoreProvider();
  let store: any;
  try {
    const stores = await provider.getStores();
    store = stores.find((s: any) => s.id === storeId);
  } catch (e: any) {
    throw Errors.internal(`Failed to load stores: ${e?.message ?? e}`, {
      storeId, cause: e?.name,
    });
  }
  if (!store) {
    throw Errors.notFound(`Store not found: ${storeId}`, { storeId });
  }

  limiter.recordFetch(clientIp);

  // ─── ALDI SÜD: synchronous national fetch ──────────────────────────────
  if (store.brand === "aldi-sued") {
    const registry = getRegistry();
    const plugin = registry.getPluginForStore(store);
    if (!plugin) {
      throw Errors.config(`No fetcher registered for brand "${store.brand}"`, { storeId });
    }

    let discounts: any[] = [];
    try {
      // fetchWithTimeout enforces 30s ceiling — anti-hang
      // The plugin's internal fetches don't have timeouts, so we wrap the
      // whole call. If it times out, we throw TIMEOUT_ERROR (retryable).
      discounts = await Promise.race([
        plugin.fetch(store),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(Errors.timeout(
            "ALDI fetch timed out after 30s", { storeId }
          )), 30000)
        ),
      ]);
    } catch (e: any) {
      if (e instanceof ApiError) {
        // Log to fetch_log and re-throw
        const storage = getStorage();
        await storage.logFetch(
          "aldi-sued-national", false,
          `${e.code}@${e.stage}: ${e.message}`,
          clientIp, Date.now() - t0, null,
        );
        throw e;
      }
      // Wrap unknown
      const wrapped = Errors.network(
        `ALDI fetch failed: ${e?.message ?? e}`,
        { storeId: "aldi-sued-national", cause: e?.name },
      );
      const storage = getStorage();
      await storage.logFetch(
        "aldi-sued-national", false,
        `${wrapped.code}@${wrapped.stage}: ${wrapped.message}`,
        clientIp, Date.now() - t0, null,
      );
      throw wrapped;
    }

    // Tag all discounts with the national store ID
    const nationalDiscounts = discounts.map((d: any) => ({
      ...d,
      storeId: "aldi-sued-national",
    }));

    // Persist to Supabase
    const storage = getStorage();
    try {
      await storage.save("aldi-sued-national", nationalDiscounts);
    } catch (e: any) {
      // Storage error — already typed as ApiError by SupabaseDiscountStorage
      await storage.logFetch(
        "aldi-sued-national", false,
        `${e.code ?? "STORAGE_ERROR"}@${e.stage ?? "storage"}: ${e.message}`,
        clientIp, Date.now() - t0, null,
      );
      throw e;
    }

    // Success — log it
    await storage.logFetch(
      "aldi-sued-national", true, null,
      clientIp, Date.now() - t0, nationalDiscounts.length,
    );

    return NextResponse.json({
      success: true,
      storeId: "aldi-sued-national",
      count: nationalDiscounts.length,
      discounts: nationalDiscounts,
      national: true,
      durationMs: Date.now() - t0,
    });
  }

  // ─── REWE: async GitHub Actions trigger ────────────────────────────────
  if (store.brand === "rewe") {
    const ghToken = process.env.GITHUB_TOKEN;
    const repo = "BirdNest055/aldi-map";
    const workflowId = "rewe-fetch.yml";
    const offersUrl = (store as any).offersUrl;
    if (!offersUrl) {
      throw Errors.config(`No offers URL configured for REWE store ${storeId}`, { storeId });
    }
    if (!ghToken) {
      throw Errors.config(
        "GITHUB_TOKEN env var is not set — cannot trigger REWE workflow",
        { storeId, cause: "missing-env" },
      );
    }

    try {
      const triggerRes = await fetchWithTimeout(
        `https://api.github.com/repos/${repo}/actions/workflows/${workflowId}/dispatches`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${ghToken}`,
            Accept: "application/vnd.github+json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ref: "main",
            inputs: { store_url: offersUrl, store_id: storeId },
          }),
          timeoutMs: 15000,
        },
      );

      if (!triggerRes.ok) {
        const errText = await triggerRes.text().catch(() => "");
        // 401 = bad token (config), 404 = wrong repo/workflow (config),
        // 5xx = GitHub down (upstream, retryable)
        if (triggerRes.status === 401 || triggerRes.status === 403) {
          throw Errors.config(
            `GitHub token rejected (HTTP ${triggerRes.status}): ${errText}`,
            { storeId, cause: "auth-failed" },
          );
        }
        if (triggerRes.status === 404) {
          throw Errors.config(
            `Workflow or repo not found (HTTP 404). Check repo name and workflow file.`,
            { storeId, cause: "not-found" },
          );
        }
        throw Errors.upstream(
          `GitHub workflow trigger failed (HTTP ${triggerRes.status}): ${errText}`,
          { storeId, cause: `HTTP ${triggerRes.status}` },
        );
      }

      // Success — log the trigger (success=true, count=null because async)
      const storage = getStorage();
      await storage.logFetch(
        storeId, true, null,
        clientIp, Date.now() - t0, null,
      );

      return NextResponse.json({
        success: true,
        storeId: storeId,
        message: "REWE fetch triggered. Results will appear in ~60 seconds.",
        asyncFetch: true,
        estimatedTime: 60,
        durationMs: Date.now() - t0,
      });
    } catch (e: any) {
      if (e instanceof ApiError) {
        const storage = getStorage();
        await storage.logFetch(
          storeId, false,
          `${e.code}@${e.stage}: ${e.message}`,
          clientIp, Date.now() - t0, null,
        );
        throw e;
      }
      const wrapped = Errors.upstream(
        `Workflow trigger failed: ${e?.message ?? e}`,
        { storeId, cause: e?.name },
      );
      const storage = getStorage();
      await storage.logFetch(
        storeId, false,
        `${wrapped.code}@${wrapped.stage}: ${wrapped.message}`,
        clientIp, Date.now() - t0, null,
      );
      throw wrapped;
    }
  }

  throw Errors.config(`Unsupported brand: ${store.brand}`, { storeId });
}

export const POST = withErrorHandling(handler);
