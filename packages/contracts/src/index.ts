/**
 * @polaris/contracts
 *
 * The single source of truth for every shape crossing a boundary in Polaris:
 * web ⇄ api, api ⇄ provider adapters, and the pure domain core.
 *
 * Schemas are defined once in Zod and types are derived with z.infer, so a contract
 * cannot drift from its validator. This is why the NestJS app deliberately does not use
 * class-validator DTOs: duplicating these as decorated classes would reintroduce exactly
 * the drift this package exists to prevent.
 */
export * from './common';
export * from './provider';
export * from './search-query';
export * from './offer';
export * from './comparison';
export * from './search-response';
export * from './search-request';
