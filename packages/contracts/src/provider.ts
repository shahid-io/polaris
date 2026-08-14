import { z } from 'zod';

/**
 * The five providers named in the assessment brief, plus three added deliberately.
 *
 * Duffel proves the adapter abstraction generalises to a vendor contract we did not design
 * around. EaseMyTrip and Ixigo exist for a sharper reason: MakeMyTrip and Goibibo refuse
 * automated clients at their CDN edge, so real agency fares could not be obtained from
 * them at all. Rather than let the OTA side of the comparison rest entirely on generated
 * data, two agencies that *do* serve their public search were integrated for real.
 *
 * Adding each of the three touched one array and one adapter file, nothing else.
 */
export const providerIdSchema = z.enum([
  'makemytrip',
  'goibibo',
  'cleartrip',
  'indigo',
  'airindiaexpress',
  'duffel',
  'easemytrip',
  'ixigo',
]);

/**
 * How a provider's data is actually obtained.
 *
 * This is surfaced in the API response and badged in the UI, so the distinction between
 * real and representative data is visible in the product rather than buried in a README.
 * The assessment brief asks us to document exactly this (section 4).
 */
export const integrationTypeSchema = z.enum([
  /** Live third-party API returning real market data. */
  'live-api',
  /** Vendor sandbox: real API contract, synthetic data. */
  'sandbox-api',
  /** Affiliate/partner feed. */
  'affiliate-api',
  /**
   * Real, current data read from the provider's own public search page by driving it in a
   * browser and capturing the JSON its own front end receives.
   *
   * Deliberately *not* folded into `live-api`. The data is genuinely the provider's own
   * and current, but it arrives through an interface nobody has promised to keep stable
   * and outside any commercial agreement, so its reliability and its standing are both
   * different from a contracted API. Collapsing the two would hide exactly the distinction
   * a reader needs to judge the number.
   */
  'browser-automation',
  /**
   * Deterministic representative data. Used where a provider's API is commercially
   * gated and genuinely unobtainable for a prototype. Always badged as simulated.
   */
  'representative',
]);

/** Underlying data source, which is not always the provider itself. */
export const dataSourceSchema = z.enum([
  'serpapi-google-flights',
  'duffel-api',
  'recorded-fixture',
  'generated-representative',
  /** The provider's own public web search, read through a headless browser session. */
  'provider-web-session',
]);

/** Outcome of calling one provider during a single search. */
export const providerCallStatusSchema = z.enum([
  /** Responded successfully. */
  'ok',
  /** Responded successfully, but with zero offers for this query. */
  'empty',
  /** Exceeded the per-provider timeout. */
  'timeout',
  /** Responded with an error, or the transport failed. */
  'error',
  /** Not called, the circuit breaker is open after repeated failures. */
  'circuit_open',
  /** Not called: missing credentials or disabled by configuration. */
  'skipped',
]);

/**
 * Per-provider outcome, returned with every search response.
 *
 * The brief requires handling unavailable providers and partial results. Returning this
 * array on every response, success or failure, is what lets the UI say "4 of 5 providers
 * responded, Cleartrip timed out" instead of silently showing a shorter list.
 */
export const providerStatusSchema = z.object({
  providerId: providerIdSchema,
  displayName: z.string(),
  integrationType: integrationTypeSchema,
  dataSource: dataSourceSchema,
  status: providerCallStatusSchema,
  /** Wall-clock duration of the call, including retries. */
  latencyMs: z.number().int().nonnegative(),
  /** Offers contributed after normalisation and validation. */
  offerCount: z.number().int().nonnegative(),
  /** Offers dropped because they failed schema validation. Non-zero means a mapping bug. */
  droppedOfferCount: z.number().int().nonnegative().default(0),
  /** Human-readable explanation, shown in the UI when status is not ok. */
  message: z.string().optional(),
});

/** Static provider description, served by GET /api/providers. */
export const providerDescriptorSchema = z.object({
  providerId: providerIdSchema,
  displayName: z.string(),
  integrationType: integrationTypeSchema,
  dataSource: dataSourceSchema,
  /** False for representative providers, drives the "simulated" badge in the UI. */
  isRealData: z.boolean(),
  /** Why this provider is integrated the way it is. Feeds docs/INTEGRATIONS.md. */
  integrationNote: z.string(),
  enabled: z.boolean(),
});

export type ProviderId = z.infer<typeof providerIdSchema>;
export type IntegrationType = z.infer<typeof integrationTypeSchema>;
export type DataSource = z.infer<typeof dataSourceSchema>;
export type ProviderCallStatus = z.infer<typeof providerCallStatusSchema>;
export type ProviderStatus = z.infer<typeof providerStatusSchema>;
export type ProviderDescriptor = z.infer<typeof providerDescriptorSchema>;
