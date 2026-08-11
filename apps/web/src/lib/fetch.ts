import type { ApiError, SearchRequestInput, SearchResponse } from '@polaris/contracts';

/** Result of any API call — either data or a structured error, never both. */
export interface ApiResult<T> {
  data?: T;
  error?: ApiError['error'];
}

/** Options accepted by the low-level request helper. */
export interface HttpOptions {
  signal?: AbortSignal;
  additionalHeaders?: Record<string, string>;
}

/**
 * Base URL of the Polaris API.
 *
 * Falls back to localhost so a clean checkout runs without a `.env`.
 */
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

/**
 * Performs a request and normalises every outcome into {@link ApiResult}.
 *
 * Components never call `fetch` directly. Centralising it means one place decides how a
 * network failure, a non-2xx response and a malformed body are represented — and callers
 * get the same shape from all three instead of having to handle a rejected promise, a
 * falsy `ok` and a parse error separately.
 *
 * Nothing here throws. A thrown network error inside a React event handler is easy to
 * leave unhandled; a returned error object is not.
 *
 * @typeParam T - Expected response type.
 * @param path - Path beginning with `/`.
 * @param init - Fetch init, merged with JSON headers.
 * @param options - Abort signal and any extra headers.
 * @returns The parsed body, or a structured error.
 * @internal
 */
async function request<T>(
  path: string,
  init: RequestInit = {},
  options: HttpOptions = {},
): Promise<ApiResult<T>> {
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      signal: options.signal,
      headers: {
        'Content-Type': 'application/json',
        ...options.additionalHeaders,
        ...init.headers,
      },
    });

    const body = await response.json().catch(() => undefined);

    if (!response.ok) {
      // The API returns a canonical { error: { code, message } } envelope. Fall back
      // only when something upstream — a proxy, say — returned a non-conforming body.
      return {
        error: (body as ApiError | undefined)?.error ?? {
          code: 'INTERNAL_ERROR',
          message: `Request failed with status ${response.status}`,
        },
      };
    }

    return { data: body as T };
  } catch (error) {
    // An abort is a deliberate cancellation, not a failure worth showing the user.
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { error: { code: 'INTERNAL_ERROR', message: 'Request cancelled' } };
    }

    return {
      error: {
        code: 'UPSTREAM_FAILURE',
        message: 'Could not reach the Polaris API. Is it running on port 4000?',
      },
    };
  }
}

/**
 * Searches for flights.
 *
 * @param body - Query, plus optional filters and sort.
 * @param options - Abort signal, so a superseded search can be cancelled when the user
 *   changes their mind mid-request.
 * @returns Comparison groups, provider statuses and search metadata.
 *
 * @example
 * ```ts
 * const { data, error } = await searchFlights({
 *   query: { origin: 'DEL', destination: 'BOM', departureDate: '2026-08-20' },
 * });
 * ```
 */
export function searchFlights(
  body: SearchRequestInput,
  options: HttpOptions = {},
): Promise<ApiResult<SearchResponse>> {
  return request<SearchResponse>('/api/search', { method: 'POST', body: JSON.stringify(body) }, options);
}

/** One provider as reported by `GET /api/providers`. */
export interface ProviderInfo {
  providerId: string;
  displayName: string;
  integrationType: string;
  dataSource: string;
  isRealData: boolean;
  integrationNote: string;
  enabled: boolean;
  circuit: string;
  failures: number;
}

/**
 * Lists registered providers with their integration type and circuit state.
 *
 * @param options - Abort signal and extra headers.
 * @returns Provider descriptors.
 */
export function fetchProviders(
  options: HttpOptions = {},
): Promise<ApiResult<{ providers: ProviderInfo[] }>> {
  return request<{ providers: ProviderInfo[] }>('/api/providers', { method: 'GET' }, options);
}

/** An airport offered in the search form. */
export interface AirportSummary {
  code: string;
  city: string;
  name: string;
}

/** Airports plus which destinations each origin reaches. */
export interface AirportsResponse {
  airports: AirportSummary[];
  routes: Record<string, string[]>;
}

/**
 * Lists served airports and the origin-to-destination adjacency.
 *
 * Fetched rather than bundled so the picker cannot drift out of sync with the timetable —
 * an airport offered in the UI but absent from the schedule would give the user a search
 * that silently returns nothing.
 *
 * @param options - Abort signal and extra headers.
 * @returns Airports and route adjacency.
 */
export function fetchAirports(options: HttpOptions = {}): Promise<ApiResult<AirportsResponse>> {
  return request<AirportsResponse>('/api/airports', { method: 'GET' }, options);
}
