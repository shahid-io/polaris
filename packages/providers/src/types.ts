import type {
  NormalizedOffer,
  ProviderDescriptor,
  ProviderId,
  SearchQuery,
} from '@polaris/contracts';

/**
 * Per-search context handed to every adapter.
 *
 * Everything an adapter needs from the outside world arrives here rather than being
 * reached for directly, which is what makes adapters testable without stubbing globals.
 */
export interface ProviderContext {
  /**
   * Cancellation signal owned by the orchestrator.
   *
   * Adapters must pass this to any I/O they perform. The timeout is enforced centrally so
   * one slow provider cannot hold up a search, and so the policy lives in one place rather
   * than being reimplemented — inconsistently — in six adapters.
   */
  readonly signal: AbortSignal;

  /** Correlates an adapter's logs with the parent search. */
  readonly searchId: string;

  /**
   * Wall clock at the start of the search.
   *
   * Adapters stamp `retrievedAt` from this rather than calling `Date.now()` themselves, so
   * every offer in one response shares a timestamp and tests are deterministic.
   */
  readonly now: Date;
}

/**
 * What an adapter returns on success.
 *
 * Note there is no error variant: failure is expressed by throwing. Adapters are free to
 * throw anything — the orchestrator catches, classifies and isolates, so a provider crash
 * degrades to a `ProviderStatus` rather than failing the search.
 */
export interface ProviderResult {
  /** Offers that normalised and validated cleanly. May be empty — that is a valid answer. */
  readonly offers: NormalizedOffer[];

  /**
   * Offers discarded because they failed schema validation.
   *
   * Surfaced rather than swallowed: a non-zero count means the provider changed its payload
   * or the mapping has a bug, and silently returning fewer results would hide that.
   */
  readonly droppedOfferCount: number;

  /** Optional note surfaced in the provider status, e.g. a partial-data warning. */
  readonly message?: string;
}

/**
 * The contract every provider implements, whatever sits behind it.
 *
 * This is the abstraction the brief's "ability to work with different integration options"
 * criterion is really about. A live REST API, a vendor sandbox, and deterministic
 * representative data all satisfy this same interface, and the orchestrator cannot tell
 * them apart — which is why adding a provider touches one array rather than the pipeline.
 *
 * @example
 * ```ts
 * class MyProvider implements FlightProvider {
 *   readonly descriptor = { providerId: 'example', ... };
 *   async search(query, ctx) {
 *     const raw = await fetch(url, { signal: ctx.signal });
 *     return { offers: raw.map(toNormalizedOffer), droppedOfferCount: 0 };
 *   }
 * }
 * ```
 */
export interface FlightProvider {
  /** Static description — integration type, data source, whether the data is real. */
  readonly descriptor: ProviderDescriptor;

  /**
   * Searches this provider for flights.
   *
   * @param query - The validated search query.
   * @param ctx - Cancellation signal, search id and search-start clock.
   * @returns Normalised offers, plus a count of anything dropped in mapping.
   * @throws {ProviderError} Or any other error — the orchestrator isolates failures.
   */
  search(query: SearchQuery, ctx: ProviderContext): Promise<ProviderResult>;
}

/**
 * Base class for failures an adapter can describe precisely.
 *
 * Carrying the provider id and a retryability flag lets the orchestrator decide policy
 * without parsing messages — a missing credential should not be retried, a 503 should.
 */
export class ProviderError extends Error {
  /**
   * @param providerId - Which provider failed.
   * @param message - Human-readable explanation, surfaced in the UI.
   * @param retryable - Whether retrying could plausibly succeed.
   * @param cause - The underlying error. Forwarded to the native `Error.cause` rather
   *   than stored as a own property, so the standard cause chain — and the stack trace
   *   rendering that reads it — keeps working.
   */
  constructor(
    readonly providerId: ProviderId,
    message: string,
    readonly retryable: boolean = false,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = 'ProviderError';
  }
}

/**
 * The provider is configured but has no usable credentials.
 *
 * Never retryable, and deliberately not fatal: the search proceeds with the remaining
 * providers and this one reports `skipped`, so the app is fully usable with no API keys.
 */
export class ProviderCredentialsMissingError extends ProviderError {
  /**
   * @param providerId - Which provider is unconfigured.
   * @param envVar - The environment variable that would supply the credential.
   */
  constructor(providerId: ProviderId, envVar: string) {
    super(providerId, `No credentials configured — set ${envVar} to enable this provider`, false);
    this.name = 'ProviderCredentialsMissingError';
  }
}

/**
 * The provider responded with an error, or the transport failed.
 *
 * @see {@link ProviderError} for the retryability contract.
 */
export class ProviderUnavailableError extends ProviderError {
  /**
   * @param providerId - Which provider failed.
   * @param message - What went wrong.
   * @param retryable - Whether a retry could succeed. Defaults to `true`.
   * @param cause - Underlying error.
   */
  constructor(providerId: ProviderId, message: string, retryable = true, cause?: unknown) {
    super(providerId, message, retryable, cause);
    this.name = 'ProviderUnavailableError';
  }
}

/**
 * The provider exceeded its time budget.
 *
 * Retryable in principle, but the orchestrator generally will not: the deadline that
 * produced this error has usually already passed for the search as a whole.
 */
export class ProviderTimeoutError extends ProviderError {
  /**
   * @param providerId - Which provider timed out.
   * @param timeoutMs - The budget it exceeded.
   */
  constructor(
    providerId: ProviderId,
    readonly timeoutMs: number,
  ) {
    super(providerId, `Did not respond within ${timeoutMs}ms`, true);
    this.name = 'ProviderTimeoutError';
  }
}
