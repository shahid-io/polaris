import { z } from 'zod';
import {
  iataAirlineCodeSchema,
  iataAirportCodeSchema,
  moneySchema,
  scheduledTimeSchema,
} from './common';
import { cabinClassSchema } from './search-query';
import { integrationTypeSchema, providerIdSchema } from './provider';

/**
 * One flown leg.
 *
 * marketingCarrier/flightNumber are what the ticket is sold as and what providers agree on;
 * operatingCarrier is who actually flies it. They differ on codeshares — see canonical key
 * notes in @polaris/core.
 */
export const flightSegmentSchema = z.object({
  marketingCarrier: iataAirlineCodeSchema,
  operatingCarrier: iataAirlineCodeSchema.optional(),
  /** Digits only, without the carrier prefix — "2134", not "6E-2134". */
  flightNumber: z.string().regex(/^\d{1,4}[A-Z]?$/, 'Flight number without carrier prefix'),
  origin: iataAirportCodeSchema,
  destination: iataAirportCodeSchema,
  departure: scheduledTimeSchema,
  arrival: scheduledTimeSchema,
  durationMinutes: z.number().int().positive(),
  aircraft: z.string().optional(),
});

/** A full journey from origin to destination — one segment when non-stop. */
export const itinerarySchema = z.object({
  segments: z.array(flightSegmentSchema).min(1),
  origin: iataAirportCodeSchema,
  destination: iataAirportCodeSchema,
  /** Gate to gate including layovers. */
  totalDurationMinutes: z.number().int().positive(),
  /** segments.length - 1 */
  stops: z.number().int().nonnegative(),
});

/**
 * The brief's "benefits or offers".
 *
 * Typed rather than free text so benefits can be scored comparably across providers —
 * "₹500 cashback" on MakeMyTrip and "free meal" on IndiGo have to be weighable against
 * each other for the value score to mean anything.
 */
export const benefitTypeSchema = z.enum([
  'cashback',
  'discount',
  'free_meal',
  'free_seat',
  'extra_baggage',
  'free_cancellation',
  'free_date_change',
  'lounge_access',
  'priority_boarding',
  'reward_points',
  'no_convenience_fee',
  'other',
]);

export const benefitSchema = z.object({
  type: benefitTypeSchema,
  /** Display text as the provider phrases it, e.g. "₹500 off with HDFC cards". */
  label: z.string().min(1),
  /**
   * Monetary value where one can be established — enables benefits to contribute to the
   * value score. Left absent when the benefit is real but not priceable.
   */
  value: moneySchema.optional(),
  /** True when the benefit needs a coupon, specific card, or similar. */
  conditional: z.boolean().default(false),
});

export const baggageAllowanceSchema = z.object({
  cabinKg: z.number().nonnegative().optional(),
  checkedKg: z.number().nonnegative().optional(),
  checkedPieces: z.number().int().nonnegative().optional(),
});

export const priceBreakdownSchema = z.object({
  /** What the user actually pays, all-in. This is the field used for comparison. */
  total: moneySchema,
  baseFare: moneySchema.optional(),
  taxesAndFees: moneySchema.optional(),
  /** Provider-specific booking/convenience fee, where disclosed. */
  convenienceFee: moneySchema.optional(),
});

/**
 * A single purchasable offer from one provider, in Polaris's canonical shape.
 *
 * Every adapter's job is to produce this from its provider's native payload. Nothing
 * downstream — grouping, scoring, filtering, the UI — knows about provider-native formats.
 */
export const normalizedOfferSchema = z.object({
  /** Stable within a single search response. */
  id: z.string().min(1),
  providerId: providerIdSchema,
  providerDisplayName: z.string(),
  /** Duplicated onto the offer so the UI can badge simulated data per row. */
  integrationType: integrationTypeSchema,

  itinerary: itinerarySchema,
  price: priceBreakdownSchema,
  cabinClass: cabinClassSchema,
  /** Provider's fare product, e.g. "SAVER", "FLEXI". Same flight, different fare = separate offers. */
  fareFamily: z.string().optional(),

  benefits: z.array(benefitSchema).default([]),
  baggage: baggageAllowanceSchema.optional(),
  refundable: z.boolean().optional(),
  seatsAvailable: z.number().int().nonnegative().optional(),

  /** Where a user would go to book. Absent for representative providers. */
  deepLink: z.string().url().optional(),
  /** When this offer was fetched — fares are volatile and the UI shows staleness. */
  retrievedAt: z.string(),
});

export type FlightSegment = z.infer<typeof flightSegmentSchema>;
export type Itinerary = z.infer<typeof itinerarySchema>;
export type BenefitType = z.infer<typeof benefitTypeSchema>;
export type Benefit = z.infer<typeof benefitSchema>;
export type BaggageAllowance = z.infer<typeof baggageAllowanceSchema>;
export type PriceBreakdown = z.infer<typeof priceBreakdownSchema>;
export type NormalizedOffer = z.infer<typeof normalizedOfferSchema>;
