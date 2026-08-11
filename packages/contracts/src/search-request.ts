import { z } from 'zod';
import { iataAirlineCodeSchema } from './common';
import { providerIdSchema } from './provider';
import { searchQuerySchema, timeRangeSchema } from './search-query';
import { sortDirectionSchema, sortKeySchema } from './search-response';

/**
 * Constraints a user can apply to a result set.
 *
 * Every field is optional; an omitted field places no constraint on that dimension.
 * Filters combine with AND, they only ever narrow.
 *
 * These live in the shared contract rather than inside the domain package because they
 * cross the service boundary twice: the client sends them for deep-linkable searches, and
 * the same schema types the client-side filtering that gives instant feedback without a
 * round trip.
 */
export const flightFiltersSchema = z.object({
  /** Maximum stops. `0` means non-stop only. */
  maxStops: z.number().int().nonnegative().optional(),
  /** Keep only flights departing within this window, local to the origin airport. */
  departureWindow: timeRangeSchema.optional(),
  /** Keep only these marketing carriers. */
  airlines: z.array(iataAirlineCodeSchema).optional(),
  /** Keep only flights with an offer from at least one of these providers. */
  providers: z.array(providerIdSchema).optional(),
  /** Maximum price in minor units, compared against the group's cheapest offer. */
  maxPriceMinor: z.number().int().nonnegative().optional(),
  /** Maximum gate-to-gate duration. */
  maxDurationMinutes: z.number().int().positive().optional(),
  /** Keep only flights where at least one offer is refundable. */
  refundableOnly: z.boolean().optional(),
});

/** How the client wants results ordered. */
export const sortSpecSchema = z.object({
  key: sortKeySchema.default('value'),
  /** Omitted means the natural direction for the key, best value, cheapest, earliest. */
  direction: sortDirectionSchema.optional(),
});

/**
 * The full body of `POST /api/search`.
 *
 * Filters and sort are optional. Omitting them returns every flight found, ranked by
 * value, which is what the UI requests on first load before the user narrows anything.
 */
export const searchRequestSchema = z.object({
  query: searchQuerySchema,
  filters: flightFiltersSchema.optional(),
  sort: sortSpecSchema.optional(),
});

export type FlightFilters = z.infer<typeof flightFiltersSchema>;
export type SortSpec = z.infer<typeof sortSpecSchema>;
export type SearchRequest = z.infer<typeof searchRequestSchema>;
export type SearchRequestInput = z.input<typeof searchRequestSchema>;
