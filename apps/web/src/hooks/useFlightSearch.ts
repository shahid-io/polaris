'use client';

import { useCallback, useRef, useState } from 'react';
import type { SearchQueryInput, SearchResponse } from '@polaris/contracts';

import { searchFlights } from '@/lib/fetch';

/** What {@link useFlightSearch} exposes. */
export interface UseFlightSearchResult {
  response?: SearchResponse;
  isSearching: boolean;
  error?: string;
  /** True once a search has been run, so the empty state can distinguish first load. */
  hasSearched: boolean;
  search: (query: SearchQueryInput) => Promise<void>;
}

/**
 * Runs a flight search and holds the result.
 *
 * Only the query is sent. Filtering and sorting happen client-side against the returned
 * result, so toggling a checkbox is instant rather than another provider fan-out, which
 * also avoids spending a SerpApi credit per interaction against a 250-a-month quota.
 *
 * A search in flight is aborted when a new one starts. Without that, a slow first request
 * can resolve after a fast second one and overwrite newer results with stale ones, a race
 * that shows up exactly when a user corrects a mistyped route.
 */
export function useFlightSearch(): UseFlightSearchResult {
  const [response, setResponse] = useState<SearchResponse>();
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string>();
  const [hasSearched, setHasSearched] = useState(false);

  const inFlight = useRef<AbortController>(null);

  const search = useCallback(async (query: SearchQueryInput) => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    setIsSearching(true);
    setError(undefined);

    const { data, error: apiError } = await searchFlights({ query }, { signal: controller.signal });

    // A superseded request must not touch state, its result is already obsolete.
    if (controller.signal.aborted) return;

    if (data) {
      setResponse(data);
    } else {
      setError(apiError?.message ?? 'Search failed');
      setResponse(undefined);
    }

    setIsSearching(false);
    setHasSearched(true);
  }, []);

  return { response, isSearching, error, hasSearched, search };
}
