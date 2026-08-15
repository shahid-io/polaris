import type {
  Benefit,
  FlightSegment,
  Itinerary,
  NormalizedOffer,
  ProviderId,
  ScheduledTime,
} from '@polaris/contracts';

/**
 * Test builders.
 *
 * Domain objects here are deep and mostly irrelevant to any given test. These builders
 * supply a realistic default and let each test override only the field under examination,
 * so a test reads as the rule it is asserting rather than a wall of JSON.
 *
 * Lives in src/ rather than a test folder so the providers package can reuse it for
 * adapter contract tests.
 */

const IST = 'Asia/Kolkata';
const IST_OFFSET_MINUTES = 330;

/** Builds local/UTC/zone consistently from one IST wall-clock time. */
export function istTime(local: string): ScheduledTime {
  const [datePart = '', timePart = ''] = local.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm] = timePart.split(':').map(Number);

  const utcMs =
    Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0) - IST_OFFSET_MINUTES * 60_000;

  return {
    local: `${datePart}T${timePart.slice(0, 5)}:00`,
    utc: `${new Date(utcMs).toISOString().slice(0, 19)}Z`,
    timeZone: IST,
  };
}

export function buildSegment(overrides: Partial<FlightSegment> = {}): FlightSegment {
  return {
    marketingCarrier: '6E',
    flightNumber: '2134',
    origin: 'DEL',
    destination: 'BOM',
    departure: istTime('2026-08-20T06:15'),
    arrival: istTime('2026-08-20T08:20'),
    durationMinutes: 125,
    ...overrides,
  };
}

export function buildItinerary(overrides: Partial<Itinerary> = {}): Itinerary {
  const segments = overrides.segments ?? [buildSegment()];
  const first = segments[0]!;
  const last = segments[segments.length - 1]!;

  return {
    segments,
    origin: first.origin,
    destination: last.destination,
    totalDurationMinutes: segments.reduce((sum, s) => sum + s.durationMinutes, 0),
    stops: segments.length - 1,
    ...overrides,
  };
}

let offerCounter = 0;

export function buildOffer(
  overrides: Partial<NormalizedOffer> & { priceInr?: number } = {},
): NormalizedOffer {
  const { priceInr, ...rest } = overrides;
  const providerId: ProviderId = rest.providerId ?? 'cleartrip';

  return {
    id: rest.id ?? `offer-${++offerCounter}`,
    providerId,
    providerDisplayName: rest.providerDisplayName ?? providerId,
    integrationType: rest.integrationType ?? 'representative',
    itinerary: rest.itinerary ?? buildItinerary(),
    price: rest.price ?? {
      total: { amountMinor: (priceInr ?? 5499) * 100, currency: 'INR' },
    },
    cabinClass: rest.cabinClass ?? 'economy',
    benefits: rest.benefits ?? [],
    retrievedAt: rest.retrievedAt ?? '2026-08-09T12:00:00.000Z',
    ...rest,
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

/** Convenience: the same marketed flight sold by several providers at different prices. */
export function buildSameFlightAcrossProviders(
  prices: Partial<Record<ProviderId, number>>,
): NormalizedOffer[] {
  const itinerary = buildItinerary();

  return Object.entries(prices).map(([providerId, priceInr]) =>
    buildOffer({
      providerId: providerId as ProviderId,
      providerDisplayName: providerId,
      itinerary,
      priceInr,
    }),
  );
}
