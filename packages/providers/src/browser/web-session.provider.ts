import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProviderDescriptor, SearchQuery } from '@polaris/contracts';
import type { FlightProvider, ProviderContext, ProviderResult } from '../types';
import { ProviderUnavailableError } from '../types';
import { BrowserUnavailableError, withPage } from './browser-session';
import type { WebSearchSite } from './web-session-site';

/**
 * @packageDocumentation
 * The one provider implementation shared by every browser-read travel agency.
 *
 * Everything that has to be got right, and would be got subtly differently if written three
 * times, lives here: the fixture date guard, the provenance downgrade on replay, the
 * validation loop, and the classification of a missing browser as configuration rather than
 * a fault. A {@link WebSearchSite} supplies only what genuinely differs.
 */

/** Where a browser-backed provider takes its data from. */
export type BrowserProviderMode = 'live' | 'fixture' | 'hybrid';

/** How long to wait for a site's search response once the page starts loading. */
const SEARCH_TIMEOUT_MS = 40_000;

/**
 * A travel agency read from its own public search page.
 *
 * ### Why this is its own provenance class
 * The data is real and current, so calling it representative would understate it. But the
 * endpoints are undocumented, unversioned and outside any commercial agreement, so calling
 * it `live-api` would overstate it and imply a stability nobody has promised.
 * `browser-automation` says exactly what happened, which is the only claim that survives
 * scrutiny.
 *
 * ### Deliberately conservative
 * One search at a time, serialised by the browser session, at the rate a person would
 * search. No credentials, no login, and no attempt to defeat a challenge: a site that
 * refuses is reported as a provider failure and the search degrades, exactly as any other
 * provider outage would. Two of the five agencies in the brief refuse on exactly this
 * basis, and that refusal is respected rather than worked around.
 *
 * @typeParam TResponse - The site's payload shape.
 * @see docs/INTEGRATIONS.md
 */
export class WebSessionProvider<TResponse> implements FlightProvider {
  readonly descriptor: ProviderDescriptor;

  /**
   * @param site - The agency to read.
   * @param mode - `live` drives the browser, `fixture` replays a recording, `hybrid` tries
   *   live and falls back. Hybrid is the default: a browser session is the most fragile
   *   thing in this system, and a demonstration should survive it failing.
   */
  constructor(
    private readonly site: WebSearchSite<TResponse>,
    private readonly mode: BrowserProviderMode = 'hybrid',
  ) {
    this.descriptor = {
      providerId: site.providerId,
      displayName: site.displayName,
      integrationType: 'browser-automation',
      dataSource: 'provider-web-session',
      isRealData: true,
      integrationNote: site.integrationNote,
      enabled: true,
    };
  }

  /**
   * Searches this agency for the requested route.
   *
   * @param query - The validated search query.
   * @param ctx - Cancellation signal and search-start clock.
   * @returns Normalised offers, one per fare product per itinerary.
   * @throws {ProviderUnavailableError} When the browser cannot run or the site does not
   *   answer, and no recording covers the query.
   */
  async search(query: SearchQuery, ctx: ProviderContext): Promise<ProviderResult> {
    const sourced = await this.loadResponse(query, ctx);

    if (!sourced) {
      return {
        offers: [],
        droppedOfferCount: 0,
        message: `No data available for ${query.origin}-${query.destination} on ${query.departureDate}`,
      };
    }

    const { response, live, afterFailure } = sourced;
    const { offers, droppedOfferCount, message } = this.site.toOffers(response, query, ctx, live);

    // A replay note takes precedence: it changes how every price on screen should be read,
    // which matters more than a note about which inventory was skipped. The two replay
    // cases are distinguished because only one of them describes something going wrong.
    const note = live
      ? message
      : afterFailure
        ? 'Live browser session failed, replayed a recorded response'
        : 'Replayed a recorded response, browser sessions are disabled';

    return {
      offers,
      droppedOfferCount,
      // Surfaced in the provider status so a viewer can tell a degraded search from a
      // healthy one, not only from the per-offer badge.
      ...(note ? { message: note } : {}),
    };
  }

  /**
   * Obtains a response according to the configured mode.
   *
   * @param query - The search query.
   * @param ctx - Supplies the cancellation signal.
   * @returns The payload and whether it is live, or `undefined` when nothing covers it.
   * @internal
   */
  private async loadResponse(
    query: SearchQuery,
    ctx: ProviderContext,
  ): Promise<{ response: TResponse; live: boolean; afterFailure: boolean } | undefined> {
    const replay = async (
      afterFailure: boolean,
    ): Promise<{ response: TResponse; live: boolean; afterFailure: boolean } | undefined> => {
      const response = await this.loadFixture(query);
      return response ? { response, live: false, afterFailure } : undefined;
    };

    // Configured replay is not a failure, and must not be reported as one: a viewer
    // reading "live request failed" would be told about an outage that never happened.
    if (this.mode === 'fixture') return replay(false);

    try {
      const response = await this.fetchLive(query, ctx);
      return { response, live: true, afterFailure: false };
    } catch (error) {
      if (this.mode === 'hybrid') {
        const fixture = await replay(true);
        if (fixture) return fixture;
      }

      // A missing browser is a configuration fact, not a transient fault, so it is marked
      // unretryable: retrying cannot install Chromium, and the circuit breaker should not
      // spend attempts discovering that.
      const unavailable = error instanceof BrowserUnavailableError;
      throw new ProviderUnavailableError(
        this.site.providerId,
        error instanceof Error ? error.message : 'Browser session failed',
        !unavailable,
        error,
      );
    }
  }

  /**
   * Loads the results page and returns the search response its front end received.
   *
   * The response listener is registered **before** navigation, because on a fast connection
   * the search fires and completes during `goto`, and a listener attached afterwards would
   * wait forever for a response that already arrived.
   *
   * @param query - The search query.
   * @param ctx - Supplies the cancellation signal.
   * @returns The parsed payload.
   * @throws {Error} When the page fails, or no usable search response arrives in time.
   * @internal
   */
  private fetchLive(query: SearchQuery, ctx: ProviderContext): Promise<TResponse> {
    const url = this.site.buildUrl(toParams(query));

    return withPage(async ({ page }) => {
      const awaited = page.waitForResponse(
        (response) =>
          response.status() === 200 &&
          this.site.matchesSearchResponse(response.url(), response.request().method()),
        { timeout: SEARCH_TIMEOUT_MS },
      );

      // `domcontentloaded` rather than `networkidle`: a page carrying analytics and ad
      // pixels may never go idle, and the data we want does not depend on it doing so.
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: SEARCH_TIMEOUT_MS });

      const response = await awaited.catch(() => undefined);
      if (!response) {
        // Distinguish "nothing answered" from "answered with no flights". A challenge page
        // is the likeliest cause and needs a different response from a quiet route.
        const text = await page
          .locator('body')
          .innerText({ timeout: 5_000 })
          .catch(() => '');
        if (/captcha|unusual traffic|access denied|are you a human/i.test(text)) {
          throw new Error(`${this.site.displayName} served a bot challenge instead of results`);
        }
        throw new Error(
          `${this.site.displayName} did not return a search response within the time budget`,
        );
      }

      const parsed = this.site.parse(await response.text());
      if (!parsed) throw new Error(`${this.site.displayName} returned an unreadable response`);

      return parsed;
    }, ctx.signal);
  }

  /**
   * Loads a previously recorded response from `fixtures/`.
   *
   * A live browser session is the single most fragile thing in this system: it depends on a
   * third party's markup, their bot posture, and a working network, none of which are under
   * our control and any of which can change between rehearsal and demonstration. Recording
   * makes the capability demonstrable without betting the demonstration on all three.
   *
   * **A recording is only valid for the exact date it was captured for.** A snapshot of one
   * route on one day cannot stand in for another day; the flight times inside it are that
   * day's, and returning it for a different date would present one date's departures as
   * another's while the offer id claimed the date requested. The date is part of the
   * filename, and the response's own echoed date is verified afterwards, so a file renamed
   * by hand cannot slip through.
   *
   * @param query - The search query.
   * @returns The recorded payload, or `undefined` when none matches.
   * @internal
   */
  private async loadFixture(query: SearchQuery): Promise<TResponse | undefined> {
    const path = join(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      'fixtures',
      webSessionFixtureFileName(
        this.site.providerId,
        query.origin,
        query.destination,
        query.departureDate,
      ),
    );

    let response: TResponse | undefined;
    try {
      response = this.site.parse(await readFile(path, 'utf8'));
    } catch {
      return undefined;
    }
    if (!response) return undefined;

    const recorded = this.site.recordedDateOf(response);
    if (!recorded || recorded !== query.departureDate) return undefined;

    return response;
  }
}

/**
 * Builds the filename a recording is stored under.
 *
 * Exported so the recording script and the loader cannot disagree about where fixtures
 * live, a mismatch would show up as "no data" with no obvious cause.
 *
 * @param providerId - Which agency the recording is from.
 * @param origin - Origin IATA code.
 * @param destination - Destination IATA code.
 * @param departureDate - `YYYY-MM-DD`.
 * @returns e.g. `cleartrip-del-bom-2026-08-28.json`.
 */
export function webSessionFixtureFileName(
  providerId: string,
  origin: string,
  destination: string,
  departureDate: string,
): string {
  return `${providerId}-${origin.toLowerCase()}-${destination.toLowerCase()}-${departureDate}.json`;
}

/**
 * Narrows a search query to what a site needs to build its URL.
 *
 * @param query - The full query.
 * @returns Route, date, passengers and cabin.
 * @internal
 */
function toParams(query: SearchQuery) {
  return {
    origin: query.origin,
    destination: query.destination,
    departureDate: query.departureDate,
    adults: query.passengers,
    cabinClass: query.cabinClass,
  };
}
