import { NextRequest, NextResponse } from "next/server";
import { getAutoFetchSettingsStorage } from "@/lib/auto-fetch/supabase-storage";
import { getStoreProvider } from "@/lib/stores/json-provider";
import { withErrorHandling, Errors } from "@/lib/errors";
import {
  intervalOptionToHours,
  hoursToIntervalOption,
  type IntervalOption,
} from "@/lib/auto-fetch/types";

/**
 * GET /api/auto-fetch/settings?storeId=<id>
 * Returns the auto-fetch settings for a store, or null if not configured.
 * For ALDI stores, returns a static "not applicable" response.
 */
async function getHandler(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const storeId = sp.get("storeId");
  if (!storeId) {
    throw Errors.config("storeId required");
  }

  // Check store brand — ALDI is exempt
  const provider = getStoreProvider();
  try {
    const stores = await provider.getStores();
    const store = stores.find((s: any) => s.id === storeId);
    if (!store) {
      throw Errors.notFound(`Store not found: ${storeId}`);
    }
    if (store.brand === "aldi-sued") {
      // ALDI is national — auto-fetch handled by discount-fetcher-cli
      return NextResponse.json({
        storeId,
        applicable: false,
        reason: "ALDI SÜD is national — auto-fetched by discount-fetcher-cli when the prospectus expires.",
      });
    }
  } catch (e: any) {
    if (e?.code === "NOT_FOUND" || e?.statusCode === 404) throw e;
    // Non-fatal — fall through
    console.warn("[auto-fetch/settings] Could not check store brand:", e?.message);
  }

  const storage = getAutoFetchSettingsStorage();
  const settings = await storage.get(storeId);

  if (!settings) {
    return NextResponse.json({
      storeId,
      applicable: true,
      configured: false,
      // Defaults shown in UI before user saves
      enabled: false,
      intervalOption: "24h" as IntervalOption,
    });
  }

  return NextResponse.json({
    storeId: settings.storeId,
    applicable: true,
    configured: true,
    enabled: settings.enabled,
    intervalOption: settings.enabled
      ? hoursToIntervalOption(settings.intervalHours)
      : "off",
    lastAutoFetchedAt: settings.lastAutoFetchedAt,
    lastAutoFetchStatus: settings.lastAutoFetchStatus,
    consecutiveFailures: settings.consecutiveFailures,
    autoDisabled: !settings.enabled && settings.consecutiveFailures >= 3,
    createdAt: settings.createdAt,
    updatedAt: settings.updatedAt,
  });
}

/**
 * PUT /api/auto-fetch/settings
 * Body: { storeId: string, intervalOption: "24h" | "3d" | "1w" | "off" }
 *
 * Creates or updates the auto-fetch settings for a store.
 * - "off" sets enabled=false (the row stays so the user's choice is remembered)
 * - Other options set enabled=true with the corresponding intervalHours
 */
async function putHandler(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { storeId, intervalOption } = body as {
    storeId?: string;
    intervalOption?: IntervalOption;
  };

  if (!storeId) {
    throw Errors.config("storeId required", { cause: "missing-body-field" });
  }
  if (!intervalOption) {
    throw Errors.config("intervalOption required", { cause: "missing-body-field" });
  }

  // Validate intervalOption
  const validOptions: IntervalOption[] = ["24h", "3d", "1w", "off"];
  if (!validOptions.includes(intervalOption)) {
    throw Errors.config(
      `Invalid intervalOption: ${intervalOption}. Must be one of: ${validOptions.join(", ")}`,
      { cause: "invalid-value" },
    );
  }

  // Check store brand — ALDI is exempt
  const provider = getStoreProvider();
  try {
    const stores = await provider.getStores();
    const store = stores.find((s: any) => s.id === storeId);
    if (!store) {
      throw Errors.notFound(`Store not found: ${storeId}`);
    }
    if (store.brand === "aldi-sued") {
      throw Errors.config(
        `Cannot set auto-fetch for ALDI store ${storeId} — ALDI is national and auto-fetched by discount-fetcher-cli.`,
        { storeId, cause: "aldi-not-applicable" },
      );
    }
  } catch (e: any) {
    if (e instanceof Error && (e as any).code === "NOT_FOUND") throw e;
    if (e instanceof Error && (e as any).statusCode === 404) throw e;
    if (e instanceof Error && (e as any).code === "CONFIG_ERROR") throw e;
    // Non-fatal — fall through
    console.warn("[auto-fetch/settings] Could not check store brand:", e?.message);
  }

  const intervalHours = intervalOptionToHours(intervalOption);
  const enabled = intervalOption !== "off";

  const storage = getAutoFetchSettingsStorage();
  const saved = await storage.upsert(storeId, enabled, intervalHours);

  return NextResponse.json({
    storeId: saved.storeId,
    enabled: saved.enabled,
    intervalOption: saved.enabled
      ? hoursToIntervalOption(saved.intervalHours)
      : "off",
    intervalHours: saved.intervalHours,
    lastAutoFetchedAt: saved.lastAutoFetchedAt,
    lastAutoFetchStatus: saved.lastAutoFetchStatus,
    consecutiveFailures: saved.consecutiveFailures,
    updatedAt: saved.updatedAt,
  });
}

export const GET = withErrorHandling(getHandler);
export const PUT = withErrorHandling(putHandler);
