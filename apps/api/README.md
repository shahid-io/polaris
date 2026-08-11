# @polaris/api

**NestJS service that fans out to every provider, aggregates the results and returns one
comparison.**

Owns the three concerns adapters must not duplicate: the time budget, failure isolation, and
deciding when a provider has failed often enough to skip. The comparison logic itself lives
in [`@polaris/core`](../../packages/core/README.md); this service orchestrates.

Runs on `:4000`.

---

## Endpoints

| Method | Path             | Purpose                                                        |
| ------ | ---------------- | -------------------------------------------------------------- |
| `POST` | `/api/search`    | Search, aggregate, compare                                     |
| `GET`  | `/api/providers` | Each provider's integration type, provenance and circuit state |
| `GET`  | `/api/airports`  | Served airports and origin→destination adjacency               |
| `GET`  | `/api/analytics` | Recorded search performance                                    |
| `GET`  | `/api/health`    | Liveness, provider mode, credential and analytics status       |

### Searching

```bash
curl -X POST http://localhost:4000/api/search \
  -H 'Content-Type: application/json' \
  -d '{
    "query": {
      "origin": "DEL",
      "destination": "BOM",
      "departureDate": "2026-09-15",
      "timeRange": { "from": "06:00", "to": "12:00" }
    }
  }'
```

Every response carries `providerStatuses`, so partial results are visible rather than
silent:

```json
{
  "meta": { "partial": true, "providersSucceeded": 2, "providersAttempted": 3 },
  "providerStatuses": [
    { "providerId": "makemytrip", "status": "ok", "latencyMs": 454, "offerCount": 11 },
    {
      "providerId": "cleartrip",
      "status": "timeout",
      "latencyMs": 6002,
      "message": "Did not respond within 10000ms"
    }
  ]
}
```

---

## How a search runs

```
POST /api/search
  → ZodValidationPipe        validates against the shared contract; 400 names the field
  → SearchOrchestrator
      cache lookup           hit? skip the fan-out entirely
      Promise.allSettled     every provider concurrently, 6s budget each
      circuit breakers       consulted before each call
      per-provider status    ok · empty · timeout · error · circuit_open · skipped
  → @polaris/core            group → score → filter → sort
  → SearchResponse           always 200 when the request is valid
```

**`Promise.all` would be actively wrong here.** It rejects on first failure, discarding
results providers had already returned. Settling every promise is what makes partial results
possible.

**A search never fails because a provider did.** Even with every provider down the response
is a 200 with zero flights and an honest account of why — so a client can distinguish "no
flights on this route" from "nothing answered". An HTTP error collapses those into one
indistinguishable failure.

---

## Design decisions

### Zod schemas instead of class-validator DTOs

Nest conventionally validates with decorated DTO classes. That would be a second description
of every request shape alongside the one the frontend already uses, and two descriptions of
one contract drift apart. A twenty-line `ZodValidationPipe` validates against
`@polaris/contracts` directly.

`nestjs-zod` was the first choice and was rejected on inspection: its `createZodDto` expects
a `ZodObject`, and several schemas end in `.refine(...)` — origin must differ from
destination — producing a wrapped effect type the library does not accept.

### Providers register under one DI token

`ProvidersModule.forRoot()` collects every adapter under `FLIGHT_PROVIDERS`. The orchestrator
depends on the array and never names a concrete provider, so adding one touches a single
line. Tests override the token with deliberately failing fakes — the only practical way to
exercise the failure paths, since waiting for a real provider to break is not a test
strategy.

### The cache stores the unfiltered result

Toggling a filter is served from the same entry rather than re-querying every provider,
which also protects SerpApi's 250-a-month free tier.

**The key must contain every field that changes what providers return.** `timeRange` is
deliberately absent because adapters fetch a whole day and the window is applied afterwards —
so one fetch serves morning, evening and unfiltered searches alike. A test pins this: if
anyone pushes time-filtering down into an adapter, `timeRange` must join the key in the same
change.

`CacheStore` is an interface, so moving to Redis is another implementation and one changed
line in `CacheModule`.

### A search that partly failed is cached only briefly

The cached value carries the provider statuses as well as the offers, and a cache hit
returns before the fan-out — so a cached timeout is a failure the circuit breaker never gets
to reconsider. At the full 300s that would turn a blip into an apparent five-minute outage.

Such a search is kept for `CACHE_PARTIAL_TTL_SECONDS` instead: long enough that the
providers that _did_ answer are not re-fetched on every filter toggle, short enough that the
one that did not is retried while the user is still on the page. A provider that is merely
unconfigured does not count — it cannot recover without a restart, so shortening the window
on its account would buy nothing.

Caching each provider's result under its own key would be more precise, and is the right
shape once there is a shared store behind more than one instance. It is not worth the extra
key surface while the whole fan-out is a few hundred milliseconds.

### Analytics fails open

Writes are not awaited and the service swallows its own errors. With no `MONGODB_URI` the
module registers without a model and every method no-ops. Mongoose is configured with
`bufferCommands: false` and a 2-second server-selection timeout, because the default queues
operations indefinitely against a dead connection — turning "Mongo is not running" into "the
search hangs".

**No IP address, cookie or session is recorded.** See
[`docs/LIMITATIONS.md`](../../docs/LIMITATIONS.md#privacy).

---

## Configuration

Every variable has a default; the service runs with an empty `.env`. Providers without
credentials report `skipped` and the search continues with the rest.

| Variable                    | Default  | Purpose                                                 |
| --------------------------- | -------- | ------------------------------------------------------- |
| `API_PORT`                  | `4000`   |                                                         |
| `PROVIDER_MODE`             | `hybrid` | `live` · `fixture` · `hybrid`                           |
| `PROVIDER_TIMEOUT_MS`       | `10000`  | Per-provider ceiling                                    |
| `CACHE_TTL_SECONDS`         | `300`    | Lifetime of a search where every provider answered      |
| `CACHE_PARTIAL_TTL_SECONDS` | `30`     | Lifetime when one failed, so it is retried soon         |
| `CIRCUIT_FAILURE_THRESHOLD` | `3`      | Failures before a provider is skipped                   |
| `CIRCUIT_RESET_MS`          | `30000`  | Before a half-open probe                                |
| `SERPAPI_KEY`               | —        | Enables live airline fares                              |
| `DUFFEL_ACCESS_TOKEN`       | —        | Enables the sandbox adapter                             |
| `MONGODB_URI`               | —        | Enables search analytics                                |
| `SIMULATED_FAILURES`        | —        | e.g. `cleartrip:timeout` — demonstrates partial results |

Environment is validated with Zod at boot, so a malformed value fails immediately rather
than surfacing later as a provider returning nothing.

### Demonstrating failure handling

```bash
SIMULATED_FAILURES=cleartrip:timeout pnpm dev
```

Explicit rather than a random failure rate: a demonstration whose key moment depends on a
coin toss is not a demonstration.

---

## Scripts

```bash
pnpm dev         # watch mode
pnpm build
pnpm start       # node dist/main.js
pnpm test        # 38 tests, orchestration through real DI
pnpm typecheck
```
