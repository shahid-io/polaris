import type { FlightProvider } from '../types';
import { cleartripSite } from './sites/cleartrip.site';
import { easeMyTripSite } from './sites/easemytrip.site';
import { ixigoSite } from './sites/ixigo.site';
import { WebSessionProvider, type BrowserProviderMode } from './web-session.provider';

/**
 * @packageDocumentation
 * The travel agencies that can be read from their own public search.
 *
 * Which agencies appear here was decided by testing rather than by preference. Of the five
 * providers named in the brief, only Cleartrip serves an automated client; MakeMyTrip and
 * Goibibo terminate the connection at their CDN edge before a page is served. EaseMyTrip
 * and Ixigo were added because two of the brief's three agencies were unreachable, and an
 * OTA comparison built entirely on generated data would demonstrate nothing.
 *
 * @see docs/INTEGRATIONS.md for the measured results and the reasoning.
 */

/** Agencies with a working browser-session integration. */
export const WEB_SESSION_SITE_IDS = ['cleartrip', 'easemytrip', 'ixigo'] as const;

/** One of the agencies readable through a browser session. */
export type WebSessionSiteId = (typeof WEB_SESSION_SITE_IDS)[number];

/**
 * Builds the browser-backed adapters for the requested agencies.
 *
 * @param ids - Which agencies to enable. Unknown ids are ignored.
 * @param mode - Live, fixture replay, or hybrid.
 * @returns Adapters, ready to register.
 *
 * @example
 * ```ts
 * createWebSessionProviders(['cleartrip', 'ixigo'], 'hybrid');
 * ```
 */
export function createWebSessionProviders(
  ids: Iterable<string>,
  mode: BrowserProviderMode = 'hybrid',
): FlightProvider[] {
  const wanted = new Set(ids);

  return REGISTRY.filter(({ id }) => wanted.has(id)).map(({ create }) => create(mode));
}

/**
 * The registry adding an agency touches.
 *
 * Each entry closes over its own site rather than the array holding them together, because
 * the three payload types are unrelated: a shared array would widen them into a union and
 * lose the type safety that keeps a mapper honest about its own payload.
 *
 * @internal
 */
const REGISTRY: { id: WebSessionSiteId; create: (mode: BrowserProviderMode) => FlightProvider }[] = [
  { id: 'cleartrip', create: (mode) => new WebSessionProvider(cleartripSite, mode) },
  { id: 'easemytrip', create: (mode) => new WebSessionProvider(easeMyTripSite, mode) },
  { id: 'ixigo', create: (mode) => new WebSessionProvider(ixigoSite, mode) },
];

/**
 * Parses the configured agency list.
 *
 * Unknown ids are ignored rather than rejected: the setting names agencies that *may* be
 * served this way, and a typo should leave that provider on its fallback rather than
 * refuse to boot the API.
 *
 * @param raw - Comma-separated ids, e.g. `cleartrip,ixigo`. `all` enables every agency.
 * @returns The recognised ids.
 */
export function parseWebSessionSites(raw: string | undefined): Set<WebSessionSiteId> {
  const trimmed = raw?.trim().toLowerCase();
  if (!trimmed) return new Set();
  if (trimmed === 'all') return new Set(WEB_SESSION_SITE_IDS);

  const supported = new Set<string>(WEB_SESSION_SITE_IDS);
  const selected = new Set<WebSessionSiteId>();

  for (const id of trimmed.split(',')) {
    const value = id.trim();
    if (supported.has(value)) selected.add(value as WebSessionSiteId);
  }

  return selected;
}
