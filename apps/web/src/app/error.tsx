'use client';

import { useEffect } from 'react';
import { AlertTriangleIcon, RotateCcwIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * Route-level error boundary.
 *
 * Catches anything thrown while rendering the search page, so a single bad response cannot
 * leave the user staring at a blank white screen — the worst failure mode, because it gives
 * them nothing to act on and no way to tell a crash from a slow network.
 *
 * `reset` re-renders the segment, which is genuinely useful here: most failures at this
 * layer are transient, and retrying is cheaper than a full reload.
 *
 * The message shown is deliberately generic. React error digests can carry internal detail,
 * and the digest is surfaced separately as a reference rather than inlined into the copy.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Replace with a real reporter (Sentry and similar) in production.
    console.error('Unhandled error in search route:', error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <AlertTriangleIcon className="size-10 text-warning" aria-hidden="true" />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The search could not be displayed. This is usually temporary — trying again often
          works.
        </p>
        {error.digest && (
          <p className="mt-3 font-mono text-xs text-muted-foreground">
            Reference: {error.digest}
          </p>
        )}
      </div>
      <Button onClick={reset}>
        <RotateCcwIcon aria-hidden="true" />
        Try again
      </Button>
    </main>
  );
}
