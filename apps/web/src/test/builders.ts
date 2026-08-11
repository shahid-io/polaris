import type {
  Benefit,
  ComparisonGroup,
  NormalizedOffer,
  ProviderStatus,
  SearchResponse,
} from '@polaris/contracts';

/**
 * @packageDocumentation
 * Builders for view-layer tests.
 *
 * Response objects are deep and mostly irrelevant to any given assertion, so these supply a
 * realistic default and let each test override only what it is actually about. A test then
 * reads as the behaviour it pins rather than a wall of JSON.
 */

/** Builds a scheduled time from an IST wall clock, deriving the UTC instant. */
export function istTime(local: string) {
  const [datePart = '', timePart = ''] = local.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm] = timePart.split(':').map(Number);
  const utcMs = Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0) - 330 * 60_000;

  return {
    local: `${datePart}T${timePart}:00`,
    utc: `${new Date(utcMs).toISOString().slice(0, 19)}Z`,
    timeZone: 'Asia/Kolkata',
  };
}

export function buildOffer(overrides: Partial<NormalizedOffer> = {}): NormalizedOffer {
  return {
    id: `offer-${Math.random().toString(36).slice(2, 8)}`,
    providerId: 'makemytrip',
    providerDisplayName: 'MakeMyTrip',
    integrationType: 'representative',
    itinerary: buildItinerary(),
    price: { total: { amountMinor: 549_900, currency: 'INR' } },
    cabinClass: 'economy',
    benefits: [],
    retrievedAt: '2026-08-11T12:00:00.000Z',
    ...overrides,
  };
}

export function buildBenefit(overrides: Partial<Benefit> = {}): Benefit {
  return {
    type: 'cashback',
    label: '₹500 cashback',
    value: { amountMinor: 50_000, currency: 'INR' },
    conditional: false,
    ...overrides,
  };
}

export function buildItinerary(
  overrides: Partial<ComparisonGroup['itinerary']> = {},
): ComparisonGroup['itinerary'] {
  const segments = overrides.segments ?? [
    {
      marketingCarrier: '6E',
      flightNumber: '2134',
      origin: 'DEL',
      destination: 'BOM',
      departure: istTime('2026-08-20T06:15'),
      arrival: istTime('2026-08-20T08:20'),
      durationMinutes: 125,
    },
  ];

  return {
    segments,
    origin: segments[0]!.origin,
    destination: segments[segments.length - 1]!.destination,
    totalDurationMinutes: segments.reduce((sum, s) => sum + s.durationMinutes, 0),
    stops: segments.length - 1,
    ...overrides,
  };
}

/**
 * Builds a comparison group from a set of provider prices.
 *
 * Derives cheapest-first ordering and the price spread the same way the domain does, so a
 * test never asserts against a group the real pipeline could not produce.
 *
 * @param prices - Display name and price in rupees, per provider.
 * @param overrides - Anything else to change.
 */
export function buildGroup(
  prices: { providerId: string; displayName: string; priceInr: number; offer?: Partial<NormalizedOffer> }[] = [
    { providerId: 'goibibo', displayName: 'Goibibo', priceInr: 4614 },
    { providerId: 'makemytrip', displayName: 'MakeMyTrip', priceInr: 4704 },
  ],
  overrides: Partial<ComparisonGroup> = {},
): ComparisonGroup {
  const itinerary = overrides.itinerary ?? buildItinerary();

  const offers = [...prices]
    .sort((a, b) => a.priceInr - b.priceInr)
    .map(({ providerId, displayName, priceInr, offer }) =>
      buildOffer({
        providerId: providerId as NormalizedOffer['providerId'],
        providerDisplayName: displayName,
        itinerary,
        price: { total: { amountMinor: priceInr * 100, currency: 'INR' } },
        ...offer,
      }),
    );

  const providerIds = [...new Set(offers.map((o) => o.providerId))];
  const perProvider = providerIds.map((id) =>
    Math.min(...offers.filter((o) => o.providerId === id).map((o) => o.price.total.amountMinor)),
  );
  const min = Math.min(...perProvider);
  const max = Math.max(...perProvider);

  return {
    canonicalKey: `${itinerary.segments[0]!.marketingCarrier}-${itinerary.segments[0]!.flightNumber}-2026-08-20-${itinerary.origin}-${itinerary.destination}`,
    itinerary,
    offers,
    cheapestOfferId: offers[0]!.id,
    providerIds,
    providerCount: providerIds.length,
    priceSpread: {
      min: { amountMinor: min, currency: 'INR' },
      max: { amountMinor: max, currency: 'INR' },
      delta: { amountMinor: max - min, currency: 'INR' },
      percentage: min === 0 ? 0 : Math.round(((max - min) / min) * 1000) / 10,
    },
    score: {
      total: 0.87,
      breakdown: { price: 1, duration: 0.8, stops: 1, benefits: 0.5 },
      weights: { price: 0.45, duration: 0.25, stops: 0.2, benefits: 0.1 },
    },
    ...overrides,
  };
}

export function buildProviderStatus(overrides: Partial<ProviderStatus> = {}): ProviderStatus {
  return {
    providerId: 'makemytrip',
    displayName: 'MakeMyTrip',
    integrationType: 'representative',
    dataSource: 'generated-representative',
    status: 'ok',
    latencyMs: 420,
    offerCount: 12,
    droppedOfferCount: 0,
    ...overrides,
  };
}

export function buildSearchResponse(overrides: Partial<SearchResponse> = {}): SearchResponse {
  const groups = overrides.groups ?? [buildGroup()];
  const providerStatuses = overrides.providerStatuses ?? [buildProviderStatus()];
  const succeeded = providerStatuses.filter(
    (s) => s.status === 'ok' || s.status === 'empty',
  ).length;

  return {
    query: {
      origin: 'DEL',
      destination: 'BOM',
      departureDate: '2026-08-20',
      passengers: 1,
      cabinClass: 'economy',
    },
    groups,
    providerStatuses,
    meta: {
      searchId: 'test-search',
      totalOffers: groups.reduce((sum, g) => sum + g.offers.length, 0),
      totalGroups: groups.length,
      multiProviderGroups: groups.filter((g) => g.providerCount > 1).length,
      tookMs: 640,
      cached: false,
      currency: 'INR',
      providersSucceeded: succeeded,
      providersAttempted: providerStatuses.length,
      partial: succeeded < providerStatuses.length,
    },
    ...overrides,
  };
}
