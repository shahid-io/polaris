# Architecture

How Polaris is put together, and why each significant decision went the way it did.

---

## The shape

```
apps/
  web/          Next.js — search, results, comparison UI
  api/          NestJS — orchestration, caching, analytics
packages/
  contracts/    Zod schemas — the single source of truth across the service boundary
  core/         normalize · group · score · filter · sort   (pure, no I/O, no framework)
  providers/    6 adapters + resilience primitives
```

Dependencies point inward only:

```
apps/web ─┐
          ├─→ contracts
apps/api ─┼─→ core ──→ contracts
          └─→ providers ─→ core ─→ contracts
```

Nothing points back. `core` imports no framework, no HTTP client and no provider, which is
why its 68 tests run in roughly 20 ms with no mocks and no Nest context. That is the entire
return on splitting the packages — the rest is convention.

---

## A search, end to end

```
POST /api/search
  │
  ▼ SearchController
     ZodValidationPipe parses the body with searchRequestSchema
     invalid → 400 with the offending field path
  │
  ▼ SearchOrchestrator
     1. cache lookup on a normalised key → hit? skip to step 5
     2. FlightProvider[] injected via the FLIGHT_PROVIDERS token
     3. Promise.allSettled — every provider concurrently, 6 s budget each,
        circuit breaker consulted before each call
     4. each outcome becomes a ProviderStatus (ok · empty · timeout · error ·
        circuit_open · skipped)
  │
  ▼ @polaris/core
     groupOffers    canonical key → one entry per physical flight
     scoreGroups    weighted value score, normalised across the result set
     filterGroups   user constraints
     sortGroups     requested ordering
  │
  ▼ SearchResponse { query, groups, providerStatuses, meta }
     recorded to analytics — not awaited, failures swallowed
```

---

## Decisions worth explaining

### The canonical key

Two offers describe the same flight when this produces the same string:

```
{marketingCarrier}-{flightNumber}-{localDepartureDate}-{origin}-{destination}
```

**The departure date is local to the origin airport, never UTC.** A 00:45 IST departure on
20 August is 19:15 UTC on the 19th. Providers differ in which representation they return, so
a UTC-derived key splits one flight into two groups whenever they disagree — silently, and
only for after-midnight departures, which is exactly when nobody notices.

`ScheduledTime` therefore carries local time, UTC and the IANA zone together, so every call
site makes the choice explicitly rather than accidentally.

**Marketing carrier, not operating carrier.** Marketing carrier and flight number are what a
ticket is *sold* as and what providers agree on. On a codeshare the operating carrier differs,
so one aircraft sold under two numbers appears as two flights. That is a documented
limitation, not an oversight — see [`LIMITATIONS.md`](./LIMITATIONS.md).

### Money is integer minor units

Prices are stored as integer paise, never floats. Cross-provider spreads are summed and
compared constantly, and float drift would surface as off-by-one-paisa errors in a
user-visible number. Comparing amounts in different currencies throws rather than silently
producing a meaningless figure.

### Price spread is measured per provider, not per offer

A comparison group can hold several fares from one seller — IndiGo SAVER at ₹5,199 and IndiGo
FLEXI at ₹7,499. Measuring the spread across every offer would report a ₹2,300 difference and
imply a provider choice worth ₹2,300, when both cheap fares come from the same seller. The
spread compares each provider's *cheapest* offer, which answers the question the user
actually has: where should I book this flight?

### Scoring is transparent, and runs before filtering

"Overall value" is inherently a judgement, so rather than hide it behind one number, every
sub-score and the weights that produced it are returned with each group. The UI can answer
"why is this ranked first?".

```
value = 0.45·price + 0.25·duration + 0.20·stops + 0.10·benefits
```

`price`, `duration` and `benefits` are min-max normalised **within the result set** — a score
is a statement about this search, not an absolute rating. `stops` is absolute (`1/(1+stops)`),
because a non-stop is objectively a non-stop; normalising it would score the only non-stop
among two-stop options identically to the only one-stop among non-stops.

Two deliberate exclusions:

- **Conditional benefits** ("₹500 off with HDFC cards") are shown but not scored. Most users
  cannot claim them, and counting them would systematically over-rank whichever provider
  advertises the most card promotions.
- **Benefits with no monetary value** (lounge access) are shown but not scored, rather than
  assigned an invented number.

Scoring runs **before** filtering. Sub-scores are normalised across the result set, so
filtering first would silently rescale every score as the user toggles a checkbox — a
flight's "value" would change because a different flight was hidden.

### The provider registry is a DI token

Every adapter registers under one `FLIGHT_PROVIDERS` symbol. The orchestrator depends on the
array and never names a concrete provider, so adding one touches a single line. Tests
override the token with deliberately failing fakes, which is the only practical way to
exercise the failure paths — waiting for a real provider to break is not a test strategy.

### Failure isolation

**`Promise.all` would be actively wrong here.** It rejects on first failure, discarding
results providers had already returned successfully. `Promise.allSettled` is what makes
partial results possible.

A search never fails because a provider did. Even with every provider down, the response is a
200 carrying zero flights and an honest account of why — so a client can distinguish "no
flights on this route" from "nothing answered". A thrown error collapses those into one
indistinguishable failure. An empty provider result is likewise recorded as success, not
failure.

### Timeouts abort *and* race

`withTimeout` passes an `AbortSignal` into the operation **and** races a rejecting deadline.
Each covers the other's blind spot: the signal stops the underlying work (racing alone would
leave the request running and leak sockets), while the race bounds the wait (an adapter that
ignores its signal would otherwise hang the entire search on the one provider the timeout
exists to contain). Neither alone is sufficient.

### Circuit breakers

A provider that has failed three times running will fail the fourth, and each attempt costs
the full six-second budget in latency the user pays for nothing. The breaker converts slow
failure into instant failure, and into an honest `circuit_open` status.

A failed half-open probe re-opens immediately, ignoring the threshold: the probe exists to ask
whether the provider has recovered, and a failure answers no.

Breakers are held per provider for the process lifetime. State that did not outlive a request
would defeat the purpose.

### Caching

The cache stores the **unfiltered** result set, so toggling a filter is served from the same
entry rather than re-querying every provider. This also protects SerpApi's 250-searches-a-month
free tier.

Cache keys fix field order explicitly rather than stringifying an object, whose key order
depends on insertion — two identical searches arriving with differently-ordered JSON would
otherwise miss the cache and cost a full fan-out.

The store sits behind a `CacheStore` interface. Moving to Redis means another implementation
and one changed line in the module.

### Retries

Only errors marked retryable are retried, so a missing credential fails immediately instead of
burning the time budget proving three times that it cannot succeed. Backoff uses **full
jitter** rather than a fixed interval: when a provider recovers from an outage, every
in-flight client retrying in lockstep would knock it straight back over.

### Zod contracts instead of DTOs

NestJS conventionally validates with decorated DTO classes. That would mean a second
description of every request shape alongside the Zod schema the frontend already uses, and two
descriptions of one contract drift apart. Validating directly against the shared schema means
the API and client cannot disagree about what a valid request is, because there is only one
definition.

`nestjs-zod` was the first choice and was rejected on inspection: its `createZodDto` expects a
`ZodObject`, and several schemas end in `.refine(...)` — origin must differ from destination, a
time range's start must precede its end — producing a wrapped effect type the library does not
accept. A twenty-line pipe handles every Zod type with no dependency.

### Analytics fails open

Search analytics never affects a search. Writes are not awaited, the service swallows its own
errors, and with no `MONGODB_URI` the module registers without a model and every method
no-ops.

Mongoose is configured with `bufferCommands: false` and a 2-second server-selection timeout,
because the default is to queue operations indefinitely against a dead connection — which
would turn "Mongo is not running" into "the search hangs", the opposite of degrading
gracefully.

No IP address, cookie or session is recorded. See [`LIMITATIONS.md`](./LIMITATIONS.md#privacy).

---

## Testing

| Package | Tests | What they cover |
|---|---|---|
| `core` | 68 | Canonical keys, grouping, scoring, filtering, sorting — pure functions, no mocks |
| `providers` | 54 | Circuit breaker, timeout, retry, representative adapters, cross-provider grouping |
| `api` | 18 | Orchestration through real DI: partial results, total failure, circuit opening, caching |
| `contracts` | 7 | Schema validation and defaults |

Several tests are named after the wrong answer they prevent — *"measures spread per provider,
not across fare families"*, *"keys an after-midnight departure to its local date, not the UTC
date"* — because those are the regressions that would otherwise return silently.

Simulated provider latency is on by default so timeout and circuit-breaker paths are
exercised by ordinary development use, and off in tests, where it was costing 13 seconds a
run for no coverage.
