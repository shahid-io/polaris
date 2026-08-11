import { z } from 'zod';
import { comparisonGroupSchema } from './comparison';
import { providerStatusSchema } from './provider';
import { currencyCodeSchema } from './common';
import { searchQuerySchema } from './search-query';

export const sortKeySchema = z.enum(['value', 'price', 'duration', 'departure', 'arrival']);
export const sortDirectionSchema = z.enum(['asc', 'desc']);

export const searchMetaSchema = z.object({
  /** Correlates the response with server logs, useful when debugging live. */
  searchId: z.string(),
  /** Total offers across all providers, before grouping. */
  totalOffers: z.number().int().nonnegative(),
  /** Distinct marketed flights after grouping. Lower than totalOffers when dedup fired. */
  totalGroups: z.number().int().nonnegative(),
  /** Groups sold by more than one provider, the dedup working, quantified. */
  multiProviderGroups: z.number().int().nonnegative(),
  /** End-to-end server time. */
  tookMs: z.number().int().nonnegative(),
  /** True when served from cache rather than fresh provider calls. */
  cached: z.boolean(),
  currency: currencyCodeSchema,
  /** Providers that returned usable offers, out of those attempted. */
  providersSucceeded: z.number().int().nonnegative(),
  providersAttempted: z.number().int().nonnegative(),
  /**
   * True when at least one provider failed. The UI uses this to show the partial-results
   * banner, the brief requires partial results be handled visibly, not silently.
   */
  partial: z.boolean(),
});

/**
 * The single response shape for POST /api/search.
 *
 * Note there is no error variant for provider failure: a search where four of six providers
 * fail is still a 200 with results and an honest providerStatuses array. Only a malformed
 * request or a total internal failure is a non-2xx.
 */
export const searchResponseSchema = z.object({
  /** Echo of the parsed query, post-defaults, lets the client render exactly what ran. */
  query: searchQuerySchema,
  groups: z.array(comparisonGroupSchema),
  providerStatuses: z.array(providerStatusSchema),
  meta: searchMetaSchema,
});

/** Machine-readable error codes, so the UI can branch without string matching. */
export const apiErrorCodeSchema = z.enum([
  'VALIDATION_ERROR',
  'NO_PROVIDERS_AVAILABLE',
  'UPSTREAM_FAILURE',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
]);

export const apiErrorSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string(),
    /** Field-level detail for VALIDATION_ERROR. */
    details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
    searchId: z.string().optional(),
  }),
});

export type SortKey = z.infer<typeof sortKeySchema>;
export type SortDirection = z.infer<typeof sortDirectionSchema>;
export type SearchMeta = z.infer<typeof searchMetaSchema>;
export type SearchResponse = z.infer<typeof searchResponseSchema>;
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
