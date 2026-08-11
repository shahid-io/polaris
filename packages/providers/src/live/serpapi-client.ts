import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** One flown leg as SerpApi's Google Flights engine returns it. */
export interface SerpApiSegment {
  departure_airport: { name: string; id: string; time: string };
  arrival_airport: { name: string; id: string; time: string };
  duration: number;
  airplane?: string;
  airline: string;
  airline_logo?: string;
  travel_class?: string;
  /** Carrier and number with a space, e.g. `6E 6107`. */
  flight_number: string;
  legroom?: string;
  extensions?: string[];
}

/** One purchasable itinerary. */
export interface SerpApiItinerary {
  flights: SerpApiSegment[];
  total_duration: number;
  /** Whole currency units — rupees when the request asks for INR. */
  price: number;
  type?: string;
  airline_logo?: string;
  booking_token?: string;
  carbon_emissions?: { this_flight?: number };
}

/** The subset of the response this adapter consumes. */
export interface SerpApiResponse {
  search_metadata?: { status?: string; id?: string };
  /** Echoed request parameters. `outbound_date` is what a fixture is validated against. */
  search_parameters?: { outbound_date?: string };
  /** Google's own picks. Overlaps with other_flights, so the two are deduplicated. */
  best_flights?: SerpApiItinerary[];
  other_flights?: SerpApiItinerary[];
  error?: string;
}

/** Parameters for a one-way search. */
export interface SerpApiSearchParams {
  origin: string;
  destination: string;
  /** `YYYY-MM-DD`. */
  departureDate: string;
  adults: number;
  /** Google Flights cabin codes: 1 economy, 2 premium economy, 3 business, 4 first. */
  travelClass: 1 | 2 | 3 | 4;
}

const SERPAPI_ENDPOINT = 'https://serpapi.com/search.json';

/**
 * In-flight and recently-completed requests, keyed by search parameters.
 *
 * One SerpApi response contains every carrier on a route, and Polaris registers two
 * providers backed by it — IndiGo and Air India Express. Without this, a single user
 * search would issue two identical HTTP calls and consume two of the 250 credits the free
 * tier allows each month, for data that is byte-identical.
 *
 * Storing the *promise* rather than the result is what makes it work: both providers are
 * dispatched concurrently, so the second arrives while the first is still in flight and
 * there is no result to share yet. Sharing the promise means the second call awaits the
 * first rather than starting its own.
 *
 * The shared request deliberately runs on its **own** AbortSignal rather than the signal
 * of whichever caller happened to arrive first. Otherwise the first provider's timeout
 * would abort a request the second provider is still legitimately waiting on, inside its
 * own untouched budget — one provider's deadline silently failing another, which is
 * exactly the coupling the per-provider isolation exists to prevent.
 *
 * Deliberately short-lived. This coalesces concurrent callers within one search; caching
 * results across searches is the orchestrator's job, at a layer that knows about TTLs.
 */
const inFlight = new Map<
  string,
  { promise: Promise<SerpApiResponse>; controller: AbortController; expiresAtMs: number }
>();

/** How long a shared response stays available to a late-arriving sibling provider. */
const COALESCE_WINDOW_MS = 30_000;

/**
 * Calls SerpApi's Google Flights engine, coalescing identical concurrent requests.
 *
 * `type=2` requests a one-way search; the default is a round trip, which returns a
 * different response shape and would silently produce wrong durations.
 *
 * @param params - Route, date, passengers and cabin.
 * @param apiKey - SerpApi key.
 * @param signal - Cancellation signal from the orchestrator's deadline.
 * @returns The parsed response, possibly shared with a concurrent caller.
 * @throws {Error} On a non-2xx response or an error field in the body.
 */
export function fetchGoogleFlights(
  params: SerpApiSearchParams,
  apiKey: string,
  signal: AbortSignal,
): Promise<SerpApiResponse> {
  const key = [
    params.origin,
    params.destination,
    params.departureDate,
    params.adults,
    params.travelClass,
  ].join(':');

  const now = Date.now();
  const existing = inFlight.get(key);
  if (existing && existing.expiresAtMs > now) {
    return existing.promise;
  }

  // Its own controller: the shared request outlives any individual caller's deadline.
  const shared = new AbortController();
  const promise = performRequest(params, apiKey, shared.signal);
  inFlight.set(key, { promise, controller: shared, expiresAtMs: now + COALESCE_WINDOW_MS });

  // A failure must not be cached — the next search should be free to retry rather than
  // replaying a rejection for the whole window.
  promise.catch(() => inFlight.delete(key));

  return raceCallerCancellation(promise, signal);
}

/**
 * Lets a caller stop waiting without stopping the shared request.
 *
 * The caller's signal ends *its* wait; the underlying HTTP call continues for whoever else
 * is still listening. If nobody is, the entry expires from the coalescing window shortly
 * afterwards.
 *
 * @param promise - The shared in-flight request.
 * @param signal - The individual caller's cancellation signal.
 * @returns The response, or a rejection once the caller aborts.
 * @internal
 */
function raceCallerCancellation(
  promise: Promise<SerpApiResponse>,
  signal: AbortSignal,
): Promise<SerpApiResponse> {
  if (!signal) return promise;

  return new Promise<SerpApiResponse>((resolve, reject) => {
    const onAbort = () => reject(new Error('Request cancelled by caller'));

    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });

    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/** Clears the coalescing map, aborting anything still in flight. Intended for tests. */
export function resetRequestCoalescing(): void {
  for (const entry of inFlight.values()) entry.controller.abort();
  inFlight.clear();
}

/**
 * Performs the actual HTTP call.
 *
 * @param params - Route, date, passengers and cabin.
 * @param apiKey - SerpApi key.
 * @param signal - Cancellation signal.
 * @returns The parsed response.
 * @throws {Error} On a non-2xx response or an error field in the body.
 * @internal
 */
async function performRequest(
  params: SerpApiSearchParams,
  apiKey: string,
  signal: AbortSignal,
): Promise<SerpApiResponse> {
  const query = new URLSearchParams({
    engine: 'google_flights',
    departure_id: params.origin,
    arrival_id: params.destination,
    outbound_date: params.departureDate,
    adults: String(params.adults),
    travel_class: String(params.travelClass),
    type: '2',
    currency: 'INR',
    hl: 'en',
    gl: 'in',
    api_key: apiKey,
  });

  const response = await fetch(`${SERPAPI_ENDPOINT}?${query.toString()}`, { signal });

  if (!response.ok) {
    throw new Error(`SerpApi responded ${response.status}`);
  }

  const body = (await response.json()) as SerpApiResponse;

  // SerpApi reports quota exhaustion and bad parameters as a 200 with an error field,
  // so status alone is not enough to tell success from failure.
  if (body.error) {
    throw new Error(body.error);
  }

  return body;
}

/** A recorded response, with the date it was actually captured for. */
export interface LoadedFixture {
  response: SerpApiResponse;
  /** The `outbound_date` the recording was made against. */
  recordedDate: string;
}

/**
 * Loads a previously recorded response from `fixtures/`.
 *
 * Recorded responses exist for two reasons that happen to coincide. They make tests
 * deterministic, and they make a live demonstration independent of the network and of a
 * free tier capped at 250 searches a month.
 *
 * ### The date must match
 * A recording is a snapshot of one route on one specific day, and the flight times inside
 * it are that day's. Returning it for a different date would present September departures
 * as though they were August's — the offer would carry the requested date in its id while
 * every timestamp inside it disagreed.
 *
 * So a fixture is only usable for the exact date it was captured for. The date is part of
 * the filename — `serpapi-del-bom-2026-08-27.json` — so several dates can be recorded for
 * one route, and a lookup for an unrecorded date simply finds nothing. The recorded
 * `outbound_date` is still verified afterwards, so a mislabelled file cannot slip through.
 *
 * @param origin - Origin IATA code.
 * @param destination - Destination IATA code.
 * @param departureDate - The date being searched, `YYYY-MM-DD`.
 * @returns The recording and its date, or `undefined` when no fixture exists for the route
 *   or the one that exists was captured for a different date.
 */
export async function loadFixture(
  origin: string,
  destination: string,
  departureDate: string,
): Promise<LoadedFixture | undefined> {
  // Resolved from the compiled file's location up to the repository root.
  const path = join(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    'fixtures',
    fixtureFileName(origin, destination, departureDate),
  );

  let response: SerpApiResponse;
  try {
    response = JSON.parse(await readFile(path, 'utf8')) as SerpApiResponse;
  } catch {
    return undefined;
  }

  // Belt and braces: the filename says which date this is for, but a file copied or
  // renamed by hand could disagree with its own contents.
  const recordedDate = response.search_parameters?.outbound_date;
  if (!recordedDate || recordedDate !== departureDate) {
    return undefined;
  }

  return { response, recordedDate };
}

/**
 * Builds the filename a recording is stored under.
 *
 * Exported so the recording script and the loader cannot disagree about where fixtures
 * live — a mismatch would show up as "no data" with no obvious cause.
 *
 * @param origin - Origin IATA code.
 * @param destination - Destination IATA code.
 * @param departureDate - `YYYY-MM-DD`.
 * @returns e.g. `serpapi-del-bom-2026-08-27.json`.
 */
export function fixtureFileName(
  origin: string,
  destination: string,
  departureDate: string,
): string {
  return `serpapi-${origin.toLowerCase()}-${destination.toLowerCase()}-${departureDate}.json`;
}

/**
 * Collects every itinerary, removing the overlap between Google's picks and the full list.
 *
 * `best_flights` is a curated subset that also appears in `other_flights`. Concatenating
 * them naively would list those itineraries twice — which the comparison engine would then
 * group into one flight with a phantom second "offer" at an identical price.
 *
 * @param response - A SerpApi response.
 * @returns Unique itineraries.
 */
export function collectItineraries(response: SerpApiResponse): SerpApiItinerary[] {
  const seen = new Set<string>();
  const unique: SerpApiItinerary[] = [];

  for (const itinerary of [...(response.best_flights ?? []), ...(response.other_flights ?? [])]) {
    const key = `${itinerary.flights.map((s) => s.flight_number).join('|')}-${itinerary.price}`;
    if (seen.has(key)) continue;

    seen.add(key);
    unique.push(itinerary);
  }

  return unique;
}
