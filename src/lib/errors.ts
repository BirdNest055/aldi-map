/**
 * Standardized API error handling for aldi-map.
 *
 * GOALS
 * -----
 * 1. Pinpoint WHERE errors happen (stage + code + message + timestamp)
 * 2. Anti-loop: no server-side retries (single attempt, return error to client)
 * 3. Anti-spam: errors are written to Supabase `fetch_log` table for audit
 * 4. Client can branch on `code` to show appropriate UI (retry vs. give up)
 *
 * ERROR CODES
 * -----------
 * NETWORK_ERROR       — upstream fetch failed (ALDI/REWE site unreachable)
 * PARSE_ERROR         — invalid response from upstream (HTML/JSON malformed)
 * STORAGE_ERROR       — Supabase write/read failed
 * RATE_LIMITED        — too many requests from this IP (429)
 * NOT_FOUND           — requested store/brand doesn't exist (404)
 * CONFIG_ERROR        — missing env vars or invalid configuration
 * UPSTREAM_ERROR      — GitHub Actions trigger failed
 * TIMEOUT_ERROR       — fetch took too long (>30s)
 * INTERNAL_ERROR      — unexpected server error (catch-all)
 */

export type ErrorCode =
  | "NETWORK_ERROR"
  | "PARSE_ERROR"
  | "STORAGE_ERROR"
  | "RATE_LIMITED"
  | "NOT_FOUND"
  | "CONFIG_ERROR"
  | "UPSTREAM_ERROR"
  | "TIMEOUT_ERROR"
  | "INTERNAL_ERROR";

export type ErrorStage =
  | "init"
  | "rate-limit"
  | "fetch"
  | "parse"
  | "storage"
  | "trigger"
  | "timeout"
  | "validation";

export interface ApiErrorBody {
  error: string;          // human-readable message
  code: ErrorCode;        // machine-readable
  stage: ErrorStage;      // where in the pipeline
  retryable: boolean;     // can the client retry?
  timestamp: string;      // ISO 8601
  storeId?: string;       // optional: which store the error relates to
  cause?: string;         // optional: underlying cause (e.g. "HTTP 502")
}

export class ApiError extends Error {
  code: ErrorCode;
  stage: ErrorStage;
  retryable: boolean;
  statusCode: number;
  storeId?: string;
  cause?: string;

  constructor(
    message: string,
    opts: {
      code: ErrorCode;
      stage: ErrorStage;
      retryable?: boolean;
      statusCode?: number;
      storeId?: string;
      cause?: string;
    },
  ) {
    super(message);
    this.name = "ApiError";
    this.code = opts.code;
    this.stage = opts.stage;
    this.retryable = opts.retryable ?? false;
    this.statusCode = opts.statusCode ?? 500;
    this.storeId = opts.storeId;
    this.cause = opts.cause;
  }

  toBody(): ApiErrorBody {
    return {
      error: this.message,
      code: this.code,
      stage: this.stage,
      retryable: this.retryable,
      timestamp: new Date().toISOString(),
      storeId: this.storeId,
      cause: this.cause,
    };
  }

  /** Stable signature for dedup (used by client-side error grouping if needed). */
  signature(): string {
    return `${this.code}|${this.stage}|${this.message.slice(0, 80)}`;
  }
}

// --------------------------------------------------------------------------- //
// Factory helpers — each returns a properly-typed ApiError
// --------------------------------------------------------------------------- //

export const Errors = {
  network: (msg: string, opts: { stage?: ErrorStage; storeId?: string; cause?: string } = {}) =>
    new ApiError(msg, {
      code: "NETWORK_ERROR",
      stage: opts.stage ?? "fetch",
      retryable: true,
      statusCode: 502,
      storeId: opts.storeId,
      cause: opts.cause,
    }),

  parse: (msg: string, opts: { stage?: ErrorStage; storeId?: string; cause?: string } = {}) =>
    new ApiError(msg, {
      code: "PARSE_ERROR",
      stage: opts.stage ?? "parse",
      retryable: false,
      statusCode: 502,
      storeId: opts.storeId,
      cause: opts.cause,
    }),

  storage: (msg: string, opts: { stage?: ErrorStage; storeId?: string; cause?: string } = {}) =>
    new ApiError(msg, {
      code: "STORAGE_ERROR",
      stage: opts.stage ?? "storage",
      retryable: false,
      statusCode: 500,
      storeId: opts.storeId,
      cause: opts.cause,
    }),

  rateLimited: (retryAfterSeconds: number, opts: { storeId?: string } = {}) =>
    new ApiError(`Rate limited. Try again in ${retryAfterSeconds}s.`, {
      code: "RATE_LIMITED",
      stage: "rate-limit",
      retryable: true,
      statusCode: 429,
      storeId: opts.storeId,
      cause: `retry-after=${retryAfterSeconds}s`,
    }),

  notFound: (msg: string, opts: { storeId?: string } = {}) =>
    new ApiError(msg, {
      code: "NOT_FOUND",
      stage: "validation",
      retryable: false,
      statusCode: 404,
      storeId: opts.storeId,
    }),

  config: (msg: string, opts: { storeId?: string; cause?: string } = {}) =>
    new ApiError(msg, {
      code: "CONFIG_ERROR",
      stage: "validation",
      retryable: false,
      statusCode: 500,
      storeId: opts.storeId,
      cause: opts.cause,
    }),

  upstream: (msg: string, opts: { storeId?: string; cause?: string } = {}) =>
    new ApiError(msg, {
      code: "UPSTREAM_ERROR",
      stage: "trigger",
      retryable: true,
      statusCode: 502,
      storeId: opts.storeId,
      cause: opts.cause,
    }),

  timeout: (msg: string, opts: { storeId?: string } = {}) =>
    new ApiError(msg, {
      code: "TIMEOUT_ERROR",
      stage: "timeout",
      retryable: true,
      statusCode: 504,
      storeId: opts.storeId,
    }),

  internal: (msg: string, opts: { storeId?: string; cause?: string } = {}) =>
    new ApiError(msg, {
      code: "INTERNAL_ERROR",
      stage: "init",
      retryable: false,
      statusCode: 500,
      storeId: opts.storeId,
      cause: opts.cause,
    }),
};

// --------------------------------------------------------------------------- //
// Fetch-with-timeout helper (anti-loop: single attempt, throw on timeout)
// --------------------------------------------------------------------------- //

export async function fetchWithTimeout(
  url: string,
  opts: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 30000, ...init } = opts;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    return res;
  } catch (e: any) {
    if (e?.name === "AbortError") {
      throw Errors.timeout(`Request to ${url} timed out after ${timeoutMs}ms`, {});
    }
    // Network error (DNS, connection refused, etc.)
    throw Errors.network(`Network error fetching ${url}: ${e?.message ?? e}`, {
      cause: e?.name,
    });
  } finally {
    clearTimeout(timer);
  }
}

// --------------------------------------------------------------------------- //
// Wrap an API handler: catches ApiError + unknown, returns standardized JSON
// --------------------------------------------------------------------------- //

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export type ApiHandler = (req: NextRequest, ctx?: any) => Promise<NextResponse> | NextResponse;

export function withErrorHandling(handler: ApiHandler): ApiHandler {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (e: any) {
      if (e instanceof ApiError) {
        return NextResponse.json(e.toBody(), { status: e.statusCode });
      }
      // Wrap unknown errors
      const wrapped = Errors.internal(
        `Unexpected error: ${e?.message ?? String(e)}`,
        { cause: e?.name },
      );
      console.error("[api] Unhandled error:", e);
      return NextResponse.json(wrapped.toBody(), { status: 500 });
    }
  };
}
