import { z } from 'zod';
import { iataAirportCodeSchema, isoDateSchema, timeOfDaySchema } from './common';

export const cabinClassSchema = z.enum(['economy', 'premium_economy', 'business', 'first']);

/**
 * The brief's "preferred time range".
 *
 * Modelled as an explicit window rather than fixed presets so the UI can offer friendly
 * buttons (Morning / Afternoon / Evening) while the contract stays expressive enough for
 * an arbitrary range. Interpreted as local time at the ORIGIN airport.
 */
export const timeRangeSchema = z
  .object({
    from: timeOfDaySchema,
    to: timeOfDaySchema,
  })
  .refine((r) => r.from < r.to, {
    message: 'Time range "from" must be earlier than "to"',
  });

/** UI presets that map onto timeRange. Kept in the contract so web and api agree. */
export const TIME_RANGE_PRESETS = {
  early_morning: { from: '00:00', to: '06:00' },
  morning: { from: '06:00', to: '12:00' },
  afternoon: { from: '12:00', to: '18:00' },
  evening: { from: '18:00', to: '23:59' },
} as const satisfies Record<string, { from: string; to: string }>;

export const timeRangePresetSchema = z.enum([
  'early_morning',
  'morning',
  'afternoon',
  'evening',
]);

/**
 * A flight search request.
 *
 * Scope note: one-way only, matching the brief ("travel date", singular). The shape is
 * extensible to round-trip later without a breaking change — a returnDate field slots in.
 */
export const searchQuerySchema = z
  .object({
    origin: iataAirportCodeSchema,
    destination: iataAirportCodeSchema,
    departureDate: isoDateSchema,
    /** Optional preferred departure window, local to the origin airport. */
    timeRange: timeRangeSchema.optional(),
    passengers: z.number().int().min(1).max(9).default(1),
    cabinClass: cabinClassSchema.default('economy'),
    /** Restrict the search to specific providers. Empty/omitted means all enabled. */
    providers: z.array(z.string()).optional(),
  })
  .refine((q) => q.origin !== q.destination, {
    message: 'Origin and destination must be different airports',
    path: ['destination'],
  });

export type CabinClass = z.infer<typeof cabinClassSchema>;
export type TimeRange = z.infer<typeof timeRangeSchema>;
export type TimeRangePreset = z.infer<typeof timeRangePresetSchema>;
export type SearchQuery = z.infer<typeof searchQuerySchema>;
/** Pre-parse shape — what a client sends, before defaults are applied. */
export type SearchQueryInput = z.input<typeof searchQuerySchema>;
