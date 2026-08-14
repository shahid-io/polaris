import type { NormalizedOffer, ProviderId, SearchQuery } from '@polaris/contracts';
import type { ProviderContext } from '../types';

/**
 * @packageDocumentation
 * The contract one travel agency's public web search satisfies.
 *
 * Three agencies are read this way and they agree on almost nothing: Cleartrip answers with
 * normalised lookup tables, EaseMyTrip with abbreviated keys and packed strings, Ixigo with
 * a server-sent event stream. What they *do* share is the shape of the problem: build a
 * URL, recognise the response among the page's traffic, and turn it into offers.
 *
 * Isolating those three things means the browser lifecycle, the fixture rules, the
 * provenance downgrade and the validation loop are written once. A fourth agency is a URL
 * builder and a mapper, not another provider.
 */

/** What a site needs in order to build its search URL. */
export interface WebSearchParams {
  origin: string;
  destination: string;
  /** `YYYY-MM-DD`. */
  departureDate: string;
  adults: number;
  cabinClass: SearchQuery['cabinClass'];
  /**
   * Narrow the results page to one airline, where the site supports it.
   *
   * Used only when building an offer's verification link, so a reader lands on a short
   * list containing the flight rather than a hundred rows. Sites that ignore it still
   * land on the right search, which is what actually has to be true.
   */
  carrier?: string;
}

/** Offers produced from one response, with anything that failed validation counted. */
export interface SiteMappingResult {
  offers: NormalizedOffer[];
  /**
   * Offers discarded because they failed schema validation.
   *
   * Distinct from inventory a mapper deliberately declines to map. A non-zero count here
   * means the payload changed shape or the mapping is wrong, so it must not be used to
   * account for known, explained omissions: those go in {@link SiteMappingResult.message}.
   */
  droppedOfferCount: number;
  /** Note surfaced in the provider status, e.g. which inventory was deliberately omitted. */
  message?: string;
}

/**
 * One agency's public search, described well enough to be driven generically.
 *
 * @typeParam TResponse - The site's own payload shape, opaque to everything but its mapper.
 */
export interface WebSearchSite<TResponse> {
  readonly providerId: ProviderId;
  readonly displayName: string;
  /** Why this provider is integrated this way. Surfaced by `GET /api/providers`. */
  readonly integrationNote: string;

  /**
   * Builds the public results URL for a search.
   *
   * This is the same URL a person reaches through the site's own search form, and it is
   * also the offer's verification link: following it must land on this provider's own page
   * showing this flight, so the quoted price can be checked against the source rather than
   * taken on trust. That check is the product's core claim, so the URL is part of the
   * contract, not a convenience.
   */
  buildUrl(params: WebSearchParams): string;

  /**
   * Recognises the search response among everything else the page loads.
   *
   * A results page issues dozens of requests: analytics, ads, fare calendars, coupon
   * lookups. This picks out the one carrying inventory.
   */
  matchesSearchResponse(url: string, method: string): boolean;

  /**
   * Parses the captured response body.
   *
   * Kept separate from `toOffers` because the bodies are not uniformly JSON: Ixigo's is an
   * event stream that has to be unwrapped first.
   *
   * @param body - Raw response text.
   * @returns The site's payload, or `undefined` when the body is unusable.
   */
  parse(body: string): TResponse | undefined;

  /**
   * Reads the date the response was captured for.
   *
   * Every one of these payloads echoes the request, which is what allows a recording to be
   * validated against its own contents rather than trusted because of its filename.
   *
   * @returns `YYYY-MM-DD`, or `undefined` when the response does not echo a date.
   */
  recordedDateOf(response: TResponse): string | undefined;

  /**
   * Maps the payload into canonical offers.
   *
   * @param response - The site's payload.
   * @param query - The search being answered.
   * @param ctx - Supplies the search-start clock.
   * @param live - False when replaying a recording, which downgrades provenance.
   * @returns Offers, and a count of anything that failed validation.
   */
  toOffers(
    response: TResponse,
    query: SearchQuery,
    ctx: ProviderContext,
    live: boolean,
  ): SiteMappingResult;
}
