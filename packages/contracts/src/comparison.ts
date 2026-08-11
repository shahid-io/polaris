import { z } from 'zod';
import { moneySchema } from './common';
import { itinerarySchema, normalizedOfferSchema } from './offer';
import { providerIdSchema } from './provider';

/**
 * Transparent value score.
 *
 * The brief asks users to compare on "overall value", which is inherently a judgement call.
 * Rather than hide that behind one opaque number, every sub-score and the weights that
 * produced it are returned, so the UI can answer "why is this ranked first?".
 *
 * Sub-scores are min-max normalised to 0..1 WITHIN the current result set — a score is a
 * statement about this search, not an absolute rating.
 */
export const scoreBreakdownSchema = z.object({
  /** 1 = cheapest in the result set. */
  price: z.number().min(0).max(1),
  /** 1 = shortest total duration. */
  duration: z.number().min(0).max(1),
  /** 1 = non-stop. */
  stops: z.number().min(0).max(1),
  /** 1 = richest quantified benefits. */
  benefits: z.number().min(0).max(1),
});

export const valueScoreSchema = z.object({
  /** Weighted total, 0..1. Higher is better. */
  total: z.number().min(0).max(1),
  breakdown: scoreBreakdownSchema,
  /** The weights actually applied — echoed so the UI can explain and the result reproduce. */
  weights: scoreBreakdownSchema,
});

/** How much the same flight varies in price across providers. */
export const priceSpreadSchema = z.object({
  min: moneySchema,
  max: moneySchema,
  /** max - min. Zero when only one provider sells it. */
  delta: moneySchema,
  /** delta as a percentage of min, rounded to one decimal. */
  percentage: z.number().nonnegative(),
});

/**
 * THE core abstraction of Polaris.
 *
 * The brief requires handling "the same flight available through multiple providers".
 * A ComparisonGroup is one marketed flight with every provider's offer for it attached.
 * IndiGo 6E-2134 DEL→BOM sold by MakeMyTrip, Goibibo and IndiGo direct is ONE group with
 * three offers — not three rows in a list. The price spread across those offers is the
 * comparison value the product exists to surface.
 */
export const comparisonGroupSchema = z.object({
  /**
   * Deterministic identity of the marketed flight:
   *   {carrier}-{flightNumber}-{localDepartureDate}-{origin}-{destination}
   * Multi-segment itineraries hash the ordered segment list. Computed in @polaris/core.
   */
  canonicalKey: z.string().min(1),
  /** Shared itinerary. Offers within a group agree on this by construction. */
  itinerary: itinerarySchema,
  /** Every provider offer for this flight, cheapest first. Always at least one. */
  offers: z.array(normalizedOfferSchema).min(1),

  /** Convenience pointers so the UI does not recompute. */
  cheapestOfferId: z.string(),
  providerIds: z.array(providerIdSchema),
  providerCount: z.number().int().positive(),
  priceSpread: priceSpreadSchema,

  score: valueScoreSchema,
});

export type ScoreBreakdown = z.infer<typeof scoreBreakdownSchema>;
export type ValueScore = z.infer<typeof valueScoreSchema>;
export type PriceSpread = z.infer<typeof priceSpreadSchema>;
export type ComparisonGroup = z.infer<typeof comparisonGroupSchema>;
