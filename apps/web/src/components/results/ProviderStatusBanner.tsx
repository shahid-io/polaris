'use client';

import { AlertTriangleIcon, CheckCircle2Icon } from 'lucide-react';
import type { ProviderStatus, SearchMeta } from '@polaris/contracts';

import { Badge } from '@/components/ui/badge';

/** Human-readable explanation for each non-successful outcome. */
const STATUS_LABEL: Record<string, string> = {
  timeout: 'Timed out',
  error: 'Unavailable',
  circuit_open: 'Temporarily skipped',
  skipped: 'Not configured',
  empty: 'No flights',
  ok: 'Responded',
};

/**
 * Shows which providers answered and which did not.
 *
 * The brief requires handling unavailable providers and partial results. Handling them
 * silently is not enough: a user comparing prices needs to know that the cheapest seller
 * may simply not have been asked. Returning a shorter list without saying so is the one
 * behaviour this component exists to prevent.
 */
export function ProviderStatusBanner({
  statuses,
  meta,
}: {
  statuses: readonly ProviderStatus[];
  meta: SearchMeta;
}) {
  const failed = statuses.filter((status) => !isSuccess(status.status));

  if (failed.length === 0) {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <CheckCircle2Icon className="size-3.5 shrink-0 text-success" aria-hidden="true" />
          All {meta.providersAttempted} providers responded
        </span>
        {statuses.map((status) => (
          <Badge key={status.providerId} variant="outline" title={`${status.latencyMs} ms`}>
            {status.displayName}
            <span className="tabular opacity-70">{status.offerCount}</span>
          </Badge>
        ))}
      </div>
    );
  }

  return (
    <div role="status" className="rounded-lg border border-warning/40 bg-warning/5 p-3">
      <p className="flex items-center gap-2 text-sm font-medium">
        <AlertTriangleIcon className="size-4 shrink-0 text-warning" aria-hidden="true" />
        Showing results from {meta.providersSucceeded} of {meta.providersAttempted} providers
      </p>

      <ul className="mt-2 flex flex-col gap-1">
        {failed.map((status) => (
          <li key={status.providerId} className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{status.displayName}</span>
            {': '}
            {STATUS_LABEL[status.status] ?? status.status}
            {status.message ? `: ${status.message}` : ''}
          </li>
        ))}
      </ul>

      <p className="mt-2 text-xs text-muted-foreground">
        Prices from the unavailable providers are not included, so a cheaper fare may exist.
      </p>
    </div>
  );
}

/** @returns Whether a provider outcome counts as a successful call. */
function isSuccess(status: string): boolean {
  return status === 'ok' || status === 'empty';
}
