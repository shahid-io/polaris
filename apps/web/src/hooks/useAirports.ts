'use client';

import { useEffect, useState } from 'react';
import { fetchAirports, type AirportSummary } from '@/lib/fetch';

/** What {@link useAirports} returns. */
export interface UseAirportsResult {
  airports: AirportSummary[];
  /** Destinations reachable from each origin, keyed by origin code. */
  routes: Record<string, string[]>;
  isLoading: boolean;
  error?: string;
}

/**
 * Loads the airport list once on mount.
 *
 * The list is static in practice, airports do not change while a page is open, so this
 * fetches once rather than on every render, and the request is aborted on unmount so a
 * navigation away does not leave a pending state update targeting an unmounted component.
 *
 * @returns Airports, route adjacency, and load state.
 */
export function useAirports(): UseAirportsResult {
  const [airports, setAirports] = useState<AirportSummary[]>([]);
  const [routes, setRoutes] = useState<Record<string, string[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();

    fetchAirports({ signal: controller.signal }).then(({ data, error: apiError }) => {
      if (controller.signal.aborted) return;

      if (data) {
        setAirports(data.airports);
        setRoutes(data.routes);
      } else {
        setError(apiError?.message ?? 'Could not load airports');
      }
      setIsLoading(false);
    });

    return () => controller.abort();
  }, []);

  return { airports, routes, isLoading, error };
}
