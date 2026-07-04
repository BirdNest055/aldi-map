"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw, Clock, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { useState } from "react";
import type { Store } from "@/lib/types";

interface AutoFetchResponse {
  storeId: string;
  applicable: boolean;
  reason?: string;
  configured?: boolean;
  enabled?: boolean;
  intervalOption?: "24h" | "3d" | "1w" | "off";
  lastAutoFetchedAt?: string | null;
  lastAutoFetchStatus?: "success" | "failed" | "skipped-rate-limit" | null;
  consecutiveFailures?: number;
  autoDisabled?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

const INTERVAL_OPTIONS: Array<{ value: "24h" | "3d" | "1w" | "off"; label: string; hours: number }> = [
  { value: "24h", label: "Every 24 hours", hours: 24 },
  { value: "3d", label: "Every 3 days", hours: 72 },
  { value: "1w", label: "Every week", hours: 168 },
  { value: "off", label: "Off", hours: 0 },
];

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "never";
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

function formatNext(iso: string | null | undefined, intervalHours: number): string {
  if (!iso) return "now (first fetch)";
  const d = new Date(iso);
  const next = new Date(d.getTime() + intervalHours * 3600_000);
  const diffMs = next.getTime() - Date.now();
  if (diffMs <= 0) return "due now";
  const diffHr = Math.floor(diffMs / 3600_000);
  const diffMin = Math.floor((diffMs % 3600_000) / 60_000);
  if (diffHr >= 1) return `in ${diffHr}h ${diffMin}m`;
  return `in ${diffMin}m`;
}

export function AutoFetchSettings({ store }: { store: Store }) {
  const queryClient = useQueryClient();
  const [selectedOption, setSelectedOption] = useState<"24h" | "3d" | "1w" | "off" | null>(null);

  // Fetch settings
  const { data, isLoading } = useQuery({
    queryKey: ["auto-fetch-settings", store.id],
    queryFn: async () => {
      const r = await fetch(`/api/auto-fetch/settings?storeId=${store.id}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed to load");
      return d as AutoFetchResponse;
    },
    staleTime: 30_000,
  });

  // Save settings
  const saveMutation = useMutation({
    mutationFn: async (intervalOption: "24h" | "3d" | "1w" | "off") => {
      const r = await fetch("/api/auto-fetch/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId: store.id, intervalOption }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed to save");
      return d;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auto-fetch-settings", store.id] });
      setSelectedOption(null);
    },
  });

  // ALDI is exempt
  if (data?.applicable === false) {
    return (
      <div className="mt-3 p-2 rounded-md bg-zinc-800/40 border border-zinc-700/50">
        <div className="flex items-start gap-2 text-xs text-zinc-400">
          <Clock className="w-3.5 h-3.5 shrink-0 mt-0.5 text-zinc-500" />
          <div>
            <p className="font-medium text-zinc-300">Auto-fetch</p>
            <p className="mt-0.5 text-zinc-500">{data.reason}</p>
          </div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="mt-3 p-2 flex items-center gap-2 text-xs text-zinc-500">
        <Loader2 className="w-3 h-3 animate-spin" />
        Loading auto-fetch settings…
      </div>
    );
  }

  // Determine current display option
  const currentOption = selectedOption ?? data?.intervalOption ?? "24h";
  const isEnabled = currentOption !== "off";
  const intervalHours = INTERVAL_OPTIONS.find((o) => o.value === currentOption)?.hours ?? 24;

  // Status info
  const lastStatus = data?.lastAutoFetchStatus;
  const autoDisabled = data?.autoDisabled === true;
  const consecutiveFailures = data?.consecutiveFailures ?? 0;

  return (
    <div className="mt-3 p-2 rounded-md bg-zinc-800/40 border border-zinc-700/50">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-300">
          <Clock className="w-3.5 h-3.5 text-zinc-400" />
          Auto-fetch
        </div>
        {autoDisabled && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-950/60 text-red-300 border border-red-800/50 flex items-center gap-1">
            <AlertTriangle className="w-2.5 h-2.5" />
            Auto-disabled
          </span>
        )}
      </div>

      {/* Status row */}
      {data?.configured && (
        <div className="mb-2 space-y-1 text-[11px] text-zinc-500">
          <div className="flex items-center justify-between">
            <span>Last:</span>
            <span className="flex items-center gap-1 text-zinc-400 font-mono">
              {lastStatus === "success" && <CheckCircle2 className="w-2.5 h-2.5 text-emerald-500" />}
              {lastStatus === "failed" && <XCircle className="w-2.5 h-2.5 text-red-500" />}
              {formatRelative(data.lastAutoFetchedAt)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>Next:</span>
            <span className="text-zinc-400 font-mono">
              {data.enabled
                ? formatNext(data.lastAutoFetchedAt, data.intervalOption === "24h" ? 24 : data.intervalOption === "3d" ? 72 : data.intervalOption === "1w" ? 168 : 0)
                : "—"}
            </span>
          </div>
          {consecutiveFailures > 0 && (
            <div className="text-amber-500/80 text-[10px]">
              {consecutiveFailures} consecutive failure{consecutiveFailures === 1 ? "" : "s"}
            </div>
          )}
        </div>
      )}

      {/* Interval selector */}
      <select
        value={currentOption}
        onChange={(e) => setSelectedOption(e.target.value as "24h" | "3d" | "1w" | "off")}
        disabled={saveMutation.isPending}
        className="w-full h-7 bg-zinc-800 border border-zinc-700 text-xs rounded px-2 text-zinc-200 focus:outline-none focus:border-emerald-500"
      >
        {INTERVAL_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      {/* Save button (only shows if user changed the option) */}
      {selectedOption !== null && selectedOption !== (data?.intervalOption ?? "24h") && (
        <div className="mt-2 flex gap-1.5">
          <button
            onClick={() => saveMutation.mutate(selectedOption)}
            disabled={saveMutation.isPending}
            className="flex-1 px-2 py-1 text-[11px] rounded bg-emerald-700 hover:bg-emerald-600 text-white disabled:opacity-50 transition flex items-center justify-center gap-1"
          >
            {saveMutation.isPending ? (
              <><Loader2 className="w-3 h-3 animate-spin" /> Saving…</>
            ) : (
              <><RefreshCw className="w-3 h-3" /> Save</>
            )}
          </button>
          <button
            onClick={() => setSelectedOption(null)}
            disabled={saveMutation.isPending}
            className="px-2 py-1 text-[11px] rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300 disabled:opacity-50 transition"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Error display */}
      {saveMutation.isError && (
        <div className="mt-2 text-[10px] text-red-400 flex items-start gap-1">
          <AlertTriangle className="w-2.5 h-2.5 shrink-0 mt-0.5" />
          <span>{(saveMutation.error as Error).message}</span>
        </div>
      )}

      {/* Success toast (brief) */}
      {saveMutation.isSuccess && selectedOption === null && (
        <div className="mt-1 text-[10px] text-emerald-400 flex items-center gap-1">
          <CheckCircle2 className="w-2.5 h-2.5" />
          Saved
        </div>
      )}

      {/* Auto-disabled warning + re-enable hint */}
      {autoDisabled && (
        <p className="mt-1 text-[10px] text-amber-500/80">
          Disabled after 3 failures. Choose an interval to re-enable.
        </p>
      )}

      {/* Hint about default behavior on first fetch */}
      {!data?.configured && (
        <p className="mt-1 text-[10px] text-zinc-500">
          Will auto-enable at 24h on first fetch.
        </p>
      )}
    </div>
  );
}
