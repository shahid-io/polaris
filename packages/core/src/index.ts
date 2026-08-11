/**
 * @packageDocumentation
 * Pure domain logic for Polaris.
 *
 * No I/O, no framework, no provider awareness — every export is a function of its
 * arguments, which is why this package is tested without mocks or a running Nest context.
 *
 * The search pipeline runs in this order:
 * `groupOffers` → `scoreGroups` → `filterGroups` → `sortGroups`.
 *
 * Scoring happens before filtering deliberately: sub-scores are normalised across the
 * result set, so filtering first would rescale every score as the user toggles a checkbox.
 */
export * from './canonical-key';
export * from './money';
export * from './grouping';
export * from './scoring';
export * from './filtering';
export * from './sorting';
export * from './itinerary';
