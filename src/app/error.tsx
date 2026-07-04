"use client";

/**
 * Route-level error boundary.
 * Catches errors thrown during render of any page in this segment.
 * Does NOT catch errors in root layout (see global-error.tsx for that).
 */
import { AlertCircle, RefreshCw, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-100 p-4">
      <Card className="max-w-md w-full bg-zinc-900 border-zinc-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-red-400">
            <AlertCircle className="w-5 h-5" />
            Something went wrong
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-zinc-400">
            An unexpected error occurred while rendering this page. The error
            has been logged.
          </p>
          {error?.message && (
            <div className="p-3 rounded-md bg-zinc-800/50 border border-zinc-700/50">
              <p className="text-xs font-mono text-zinc-300 break-words">
                {error.message}
              </p>
              {error.digest && (
                <p className="text-xs text-zinc-500 mt-1">digest: {error.digest}</p>
              )}
            </div>
          )}
          <div className="flex gap-2">
            <Button onClick={reset} size="sm" className="gap-1.5">
              <RefreshCw className="w-3.5 h-3.5" />
              Try again
            </Button>
            <Link href="/">
              <Button variant="outline" size="sm" className="gap-1.5">
                <Home className="w-3.5 h-3.5" />
                Home
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
