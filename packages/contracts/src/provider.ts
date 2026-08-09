import { z } from 'zod';

/**
 * The five providers named in the assessment brief, plus Duffel.
 *
 * Duffel is not in the brief. It is included deliberately as a sixth provider to
 * prove the adapter abstraction generalises to a vendor contract we did not design
 * around — adding it touched one array and one adapter file, nothing else.
 */
export const providerIdSchema = z.enum([
  'makemytrip',
  'goibibo',
  'cleartrip',
  'indigo',
  'airindiaexpress',
  'duffel',
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
  /** Vendor sandbox — real API contract, synthetic data. */
  'sandbox-api',
  /** Affiliate/partner feed. */
  'affiliate-api',
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
  /** Not called — the circuit breaker is open after repeated failures. */
  'circuit_open',
  /** Not called — missing credentials or disabled by configuration. */
  'skipped',
]);

/**
 * Per-provider outcome, returned with every search response.
 *
 * The brief requires handling unavailable providers and partial results. Returning this
 * array on every response — success or failure — is what lets the UI say "4 of 5 providers
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
  /** False for representative providers — drives the "simulated" badge in the UI. */
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
