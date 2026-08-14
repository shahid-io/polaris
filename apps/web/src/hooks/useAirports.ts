'use client';

import { useEffect, useState } from 'react';
import { fetchAirports, type AirportSummary } from '@/lib/fetch';

/** What {@link useAirports} returns. */
export interface UseAirportsResult {
  airports: AirportSummary[];
  isLoading: boolean;
  error?: string;
}

/** Result of the one airport request this process makes. */
type AirportsLoad = { airports?: AirportSummary[]; error?: string };

/**
 * The in-flight or completed request, shared by every caller.
 *
 * The airport list is static for the lifetime of the page, so it is fetched once per
 * process rather than once per mount. Storing the *promise* rather than the result is what
 * makes that work: a second caller usually arrives while the first request is still open,
 * and sharing the promise means it awaits that request instead of starting another.
 *
 * This also removes a real papercut. React StrictMode deliberately mounts every component
 * twice in development, so an effect that fetched and aborted on cleanup would cancel its
 * own first request every time, leaving a failed entry in the network panel that looks like
 * a broken API and is not. Sharing one promise means there is nothing to cancel.
 */
let pending: Promise<AirportsLoad> | undefined;

/**
 * Fetches the airport list, or returns the request already in flight.
 *
 * A failure is not cached: the entry is cleared so a later mount, or a retry after the API
 * comes up, can try again rather than replaying the original error forever.
 *
 * @returns The airports, or a message explaining why they could not be loaded.
 * @internal
 */
function loadAirports(): Promise<AirportsLoad> {
  pending ??= fetchAirports().then(({ data, error }) => {
    if (!data) {
      pending = undefined;
      return { error: error?.message ?? 'Could not load airports' };
    }
    return { airports: data.airports };
  });

  return pending;
}

/**
 * Clears the shared request. Intended for tests.
 *
 * Process-lifetime caching is right in a browser and wrong in a test runner, where every
 * case needs to start from nothing rather than inherit the previous case's response.
 * Mirrors `resetRequestCoalescing` in `@polaris/providers`.
 */
export function resetAirportsCache(): void {
  pending = undefined;
}

/**
 * Loads the airport list.
 *
 * Deliberately no `AbortController`. The request is shared between callers, so cancelling
 * it on one component's unmount would break every other consumer, and the response is a
 * few kilobytes of static data that is about to be wanted again anyway. The stale-update
 * problem it would otherwise solve is handled by the `active` flag instead, which stops the
 * state write without touching the request.
 *
 * @returns Airports and load state.
 */
export function useAirports(): UseAirportsResult {
  const [airports, setAirports] = useState<AirportSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;

    loadAirports().then((result) => {
      // The component may have unmounted while the shared request was open; the request
      // itself is left alone for whoever else is waiting on it.
      if (!active) return;

      if (result.airports) setAirports(result.airports);
      else setError(result.error);
      setIsLoading(false);
    });

    return () => {
      active = false;
    };
  }, []);

  return { airports, isLoading, error };
}
