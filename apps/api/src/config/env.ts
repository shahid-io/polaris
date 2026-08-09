import { z } from 'zod';

/**
 * Environment is validated at boot with the same Zod approach used for API contracts.
 *
 * Failing fast on a malformed or missing variable is deliberate: the alternative is a
 * provider silently returning zero offers at demo time because a key was absent, which
 * looks like a bug in the aggregation rather than a configuration problem.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  /** Selects which adapters ProvidersModule registers. See docs/ARCHITECTURE.md. */
  PROVIDER_MODE: z.enum(['live', 'fixture', 'hybrid']).default('hybrid'),

  API_PORT: z.coerce.number().int().positive().default(4000),
  API_CORS_ORIGIN: z.string().default('http://localhost:3000'),

  /** Per-provider ceiling. One slow provider must never hold up the whole search. */
  PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().default(6000),
  CACHE_TTL_SECONDS: z.coerce.number().int().nonnegative().default(300),

  CIRCUIT_FAILURE_THRESHOLD: z.coerce.number().int().positive().default(3),
  CIRCUIT_RESET_MS: z.coerce.number().int().positive().default(30_000),

  /**
   * Demo failure injection, as comma-separated `provider:mode` pairs —
   * e.g. `cleartrip:timeout,goibibo:error`.
   *
   * Exists so the partial-results path can be shown deliberately rather than waited for.
   * Explicit configuration rather than a random failure rate: a demo whose key moment
   * depends on a coin toss is not a demo.
   */
  SIMULATED_FAILURES: z.string().optional(),

  /** Absent keys are tolerated — the affected adapter reports status "skipped". */
  SERPAPI_KEY: z.string().optional(),
  DUFFEL_ACCESS_TOKEN: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);

  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${detail}`);
  }

  return result.data;
}
