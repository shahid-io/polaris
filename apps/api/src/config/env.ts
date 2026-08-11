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

  /**
   * Per-provider ceiling. One slow provider must never hold up the whole search.
   *
   * 10s rather than something tighter because the live source is genuinely slow on a cold
   * query — SerpApi caches server-side, so the first request for a route takes around five
   * seconds and repeats take under one. A 6s budget fitted the repeats and cut off the
   * first, which meant the live providers timed out on exactly the search a user runs
   * first.
   *
   * The cost is that a genuinely dead provider is waited on for 10s. That is bounded, runs
   * concurrently with the others, and the circuit breaker stops it recurring after a few
   * failures — whereas losing live data on every first search is not recoverable.
   */
  PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  CACHE_TTL_SECONDS: z.coerce.number().int().nonnegative().default(300),

  /**
   * Shorter lifetime for a search where some provider failed.
   *
   * A cached response carries the provider statuses alongside the offers, so caching a
   * timeout at the full TTL would suppress the retry for five minutes: the second search
   * is served from cache, never reaches the fan-out, and the circuit breaker — the
   * component whose actual job is deciding when to stop calling a broken provider — is
   * never consulted. A transient blip would look like a five-minute outage.
   *
   * 30s is short enough that the failed provider is retried while the user is still
   * looking at the page, and long enough that the providers that *did* answer are not
   * re-fetched on every keystroke — which matters against a live source capped at 250
   * searches a month.
   */
  CACHE_PARTIAL_TTL_SECONDS: z.coerce.number().int().nonnegative().default(30),

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

  /**
   * MongoDB connection string for search analytics.
   *
   * Optional. Absent means analytics is disabled and every search still works — the app
   * must run on a clean checkout with nothing else started.
   */
  MONGODB_URI: z.string().optional(),

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
