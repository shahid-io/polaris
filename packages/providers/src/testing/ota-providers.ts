import type { Benefit } from '@polaris/contracts';
import {
  RepresentativeProvider,
  type RepresentativeProviderConfig,
  type SimulatedFailure,
} from './representative-provider';

/**
 * @packageDocumentation
 * The three online travel agencies from the brief, as representative providers.
 *
 * All three have partner APIs, and all three gate them behind a signed commercial
 * agreement with an account manager, genuinely unobtainable for a prototype. Rather than
 * omit them and answer only two thirds of the brief, they are modelled with representative
 * data, documented as such in `docs/INTEGRATIONS.md`, and badged as simulated in the UI.
 *
 * Each is given a distinct market position, margin, inventory breadth, and the kind of
 * perk it competes on, so the comparison surfaces meaningful differences rather than
 * three providers that only differ by a random number.
 */

/** Fare products shared by the OTAs, which resell the same airline fare buckets. */
const STANDARD_FARE_FAMILIES = [
  { name: 'SAVER', multiplier: 1, refundable: false, checkedKg: 15 },
  { name: 'FLEX', multiplier: 1.38, refundable: true, checkedKg: 20 },
] as const;

const makeMyTripBenefits: readonly Benefit[] = [
  {
    type: 'cashback',
    label: '₹500 MMT wallet cashback',
    value: { amountMinor: 50_000, currency: 'INR' },
    conditional: false,
  },
  {
    type: 'discount',
    label: '₹750 off with HDFC credit cards',
    value: { amountMinor: 75_000, currency: 'INR' },
    // Card-gated, so scoring excludes it, most users cannot actually claim it.
    conditional: true,
  },
  {
    type: 'free_date_change',
    label: 'Free date change up to 24h before departure',
    conditional: false,
  },
  { type: 'reward_points', label: 'MMTBLACK loyalty points', conditional: false },
];

const goibiboBenefits: readonly Benefit[] = [
  {
    type: 'cashback',
    label: '₹400 goCash on booking',
    value: { amountMinor: 40_000, currency: 'INR' },
    conditional: false,
  },
  {
    type: 'no_convenience_fee',
    label: 'Zero convenience fee',
    value: { amountMinor: 29_900, currency: 'INR' },
    conditional: false,
  },
  {
    type: 'discount',
    label: '₹600 off with ICICI cards',
    value: { amountMinor: 60_000, currency: 'INR' },
    conditional: true,
  },
  { type: 'priority_boarding', label: 'Priority check-in on select fares', conditional: false },
];

const cleartripBenefits: readonly Benefit[] = [
  {
    type: 'discount',
    label: '₹350 instant discount',
    value: { amountMinor: 35_000, currency: 'INR' },
    conditional: false,
  },
  {
    type: 'free_cancellation',
    label: 'Free cancellation within 24h of booking',
    conditional: false,
  },
  {
    type: 'extra_baggage',
    label: '5 kg extra check-in baggage',
    value: { amountMinor: 60_000, currency: 'INR' },
    conditional: false,
  },
  { type: 'free_seat', label: 'Complimentary seat selection', conditional: false },
];

/**
 * MakeMyTrip: India's largest OTA.
 *
 * Modelled as broad inventory at a slight premium, competing on wallet cashback and
 * flexibility rather than headline price.
 */
export const MAKEMYTRIP_CONFIG: RepresentativeProviderConfig = {
  providerId: 'makemytrip',
  displayName: 'MakeMyTrip',
  integrationNote:
    'Partner API exists but is commercially gated, requires a signed agreement and an ' +
    'assigned account manager. Affiliate programmes are link-and-commission only and expose ' +
    'no flight data feed. Represented with generated data drawn from the shared timetable.',
  priceMultiplier: 1.035,
  inventoryCoverage: 0.9,
  benefitPool: makeMyTripBenefits,
  maxBenefitsPerOffer: 2,
  latencyMsRange: [180, 520],
  fareFamilies: STANDARD_FARE_FAMILIES,
};

/**
 * Goibibo, same parent company as MakeMyTrip.
 *
 * Modelled as the aggressive-pricing sibling: slightly cheaper, marginally thinner
 * inventory, competing on goCash and fee waivers. Being the cheapest seller on many
 * flights is what makes the price-spread badge worth showing.
 */
export const GOIBIBO_CONFIG: RepresentativeProviderConfig = {
  providerId: 'goibibo',
  displayName: 'Goibibo',
  integrationNote:
    'Owned by the same parent company as MakeMyTrip and gated identically. No public ' +
    'developer API. Represented with generated data drawn from the shared timetable.',
  priceMultiplier: 0.985,
  inventoryCoverage: 0.82,
  benefitPool: goibiboBenefits,
  maxBenefitsPerOffer: 2,
  latencyMsRange: [220, 610],
  fareFamilies: STANDARD_FARE_FAMILIES,
};

/**
 * Cleartrip: Flipkart-owned, positioned around a cleaner booking experience.
 *
 * Modelled with the narrowest inventory and the slowest responses, which also makes it the
 * natural provider to fail on demand when demonstrating partial results.
 */
export const CLEARTRIP_CONFIG: RepresentativeProviderConfig = {
  providerId: 'cleartrip',
  displayName: 'Cleartrip',
  integrationNote:
    'Offers a REST partner API, also behind a commercial agreement. No self-service ' +
    'access. Represented with generated data drawn from the shared timetable.',
  priceMultiplier: 1.012,
  inventoryCoverage: 0.74,
  benefitPool: cleartripBenefits,
  maxBenefitsPerOffer: 2,
  latencyMsRange: [340, 900],
  fareFamilies: STANDARD_FARE_FAMILIES,
};

/** Which OTA to force into failure, for demonstrating partial results. */
export type OtaProviderId = 'makemytrip' | 'goibibo' | 'cleartrip';

/** Options for {@link createOtaProviders}. */
export interface CreateOtaProvidersOptions {
  /** Forces specific providers to fail. Omitted providers behave normally. */
  failureModes?: Partial<Record<OtaProviderId, SimulatedFailure>>;
  /** Whether to simulate realistic response times. Off in tests. */
  simulateLatency?: boolean;
  /**
   * Providers to leave out because a real integration is serving them instead.
   *
   * Representative data is the fallback for a provider we cannot reach, so the moment one
   * becomes reachable its stand-in has to go. Registering both would put the same seller
   * in a comparison twice, once with real fares and once with invented ones, which is
   * worse than either alone.
   */
  exclude?: readonly OtaProviderId[];
}

/**
 * Builds the three OTA adapters.
 *
 * @param options - Failure simulation and latency behaviour.
 * @returns The three adapters, ready to register.
 *
 * @example
 * ```ts
 * createOtaProviders();                                        // normal operation
 * createOtaProviders({ failureModes: { cleartrip: 'timeout' } }); // for the demo
 * createOtaProviders({ simulateLatency: false });               // for tests
 * ```
 */
export function createOtaProviders(
  options: CreateOtaProvidersOptions = {},
): RepresentativeProvider[] {
  const { failureModes = {}, simulateLatency, exclude = [] } = options;
  const excluded = new Set(exclude);

  return (
    [
      [MAKEMYTRIP_CONFIG, failureModes.makemytrip],
      [GOIBIBO_CONFIG, failureModes.goibibo],
      [CLEARTRIP_CONFIG, failureModes.cleartrip],
    ] as const
  )
    .filter(([config]) => !excluded.has(config.providerId as OtaProviderId))
    .map(
      ([config, failureMode]) =>
        new RepresentativeProvider(config, { failureMode, simulateLatency }),
    );
}
