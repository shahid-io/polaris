# @polaris/providers

**Six provider adapters behind one interface, plus the primitives that isolate their
failures.**

A live third-party API, a vendor sandbox and deterministic generated data all satisfy the
same `FlightProvider` contract. The orchestrator cannot tell them apart, which is why adding
a provider touches one array.

Depends on `@polaris/contracts` and `@polaris/core`.

---

## The contract

```ts
interface FlightProvider {
  readonly descriptor: ProviderDescriptor; // integration type, data source, provenance
  search(query: SearchQuery, ctx: ProviderContext): Promise<ProviderResult>;
}
```

There is no error variant in `ProviderResult`. **Adapters signal failure by throwing** and
may throw anything, the orchestrator catches, classifies and isolates, so a provider crash
degrades to a status line rather than failing the search.

`ProviderError` carries a `retryable` flag so policy decisions are made on data rather than
by parsing messages: a missing credential is never retried, a 503 is.

Everything an adapter needs from outside arrives through `ProviderContext`, the abort
signal, a search id, and the search-start clock, which is what makes adapters testable
without stubbing globals.

---

## The six providers

| Provider          | Integration      | Source                 | Real data      |
| ----------------- | ---------------- | ---------------------- | -------------- |
| IndiGo            | `live-api`       | SerpApi Google Flights | Yes            |
| Air India Express | `live-api`       | SerpApi Google Flights | Yes            |
| Duffel            | `sandbox-api`    | Duffel API             | No (synthetic) |
| MakeMyTrip        | `representative` | Shared timetable       | No             |
| Goibibo           | `representative` | Shared timetable       | No             |
| Cleartrip         | `representative` | Shared timetable       | No             |

**No airline's own API is integrated, because none of them publish one.** IndiGo and Air
India Express fares are real live Google Flights results obtained through SerpApi, a
commercial API operating under its own terms. The three OTAs have partner APIs behind signed
commercial agreements, unobtainable for a prototype, see
[`docs/INTEGRATIONS.md`](../../docs/INTEGRATIONS.md).

Every offer carries its `integrationType`, and simulated data is badged in the UI at the
point a price is shown. Provenance is never hidden.

---

## Representative data

The three OTAs price **the same shared timetable**. That is the whole design: had each
invented its own flights, nothing would ever deduplicate and the comparison this application
exists to make would have nothing to compare.

38 routes across 22 airports, modelled on real Indian domestic patterns, IndiGo dominating
frequency, Air India Express thinner, morning and evening peaks, one weekend-only service,
and a deliberate 00:45 red-eye on Delhi–Mumbai so the local-date canonical key has a real
case to prove itself against.

Each provider gets a distinct market position so comparison surfaces meaningful differences
rather than noise:

| Provider   | Price position | Inventory coverage | Competes on                         |
| ---------- | -------------- | ------------------ | ----------------------------------- |
| MakeMyTrip | +3.5%          | 90%                | Wallet cashback, flexibility        |
| Goibibo    | −1.5%          | 82%                | goCash, fee waivers                 |
| Cleartrip  | +1.2%          | 74%                | Instant discount, free cancellation |

Coverage is below 100% on purpose: no travel agency sells every seat on every flight, and
uniform coverage would make every comparison group identical.

**Everything is seeded from the query, never `Math.random()`.** The same search returns the
same fares every run, otherwise the cache would be meaningless, tests would flake, and
prices would visibly shift between refreshes during a demonstration.

---

## Resilience primitives

### `withTimeout`

Passes an `AbortSignal` into the operation **and** races a rejecting deadline. Each covers
the other's blind spot: the signal stops the underlying work (racing alone leaves the
request running and leaks sockets), while the race bounds the wait (an adapter that ignores
its signal would otherwise hang the entire search on the one provider the timeout exists to
contain).

### `CircuitBreaker`

A provider that has failed three times running will fail the fourth, and each attempt costs
the full timeout in latency the user pays for nothing. The breaker turns slow failure into
instant failure, and into an honest `circuit_open` status.

A failed half-open probe re-opens immediately, ignoring the threshold, the probe exists to
ask whether the provider recovered, and a failure answers no.

### `withRetry`

Retries only what can succeed, and uses **full jitter** rather than fixed backoff: when a
provider recovers from an outage, every client retrying in lockstep would knock it straight
back over.

---

## Provider modes

```bash
PROVIDER_MODE=live      # call the API
PROVIDER_MODE=fixture   # replay a recorded response, offline, deterministic
PROVIDER_MODE=hybrid    # live, falling back to a fixture on failure  (default)
```

Hybrid keeps a live demonstration working when the network drops or SerpApi's 250-a-month
free tier is exhausted. The same recordings make tests deterministic, the SerpApi adapter
was developed entirely against real captured responses rather than by iterating against a
metered API.

### Recording fixtures

A recording is a snapshot of one route on one day, and is only ever replayed for the exact
date it was captured for, so the date you record has to be the date you intend to search.
Replayed offers are labelled `representative`, never `live-api`; real data that is no longer
current is closer to representative than to live.

```bash
pnpm fixtures:record --date 2026-08-27                        # the default routes
pnpm fixtures:record --date 2026-08-27 --routes DEL-BOM,DEL-MAA
pnpm fixtures:record --date 2026-08-27 --force                # re-record existing
```

Each route costs one of the 250 monthly credits. The script reports what it will spend and
skips anything already recorded.

Currently recorded: `DEL-BOM`, `DEL-BLR`, `BOM-GOI` and `DEL-HYD` for both **2026-08-25**
and **2026-08-27**, plus `DEL-BOM` for `2026-09-15`. Any other route or date correctly
reports having no data rather than substituting the wrong day.

Both airline providers are backed by the same endpoint, so identical concurrent requests are
**coalesced into a single upstream call**. Without that, one user search would spend two of
the 250 monthly credits on byte-identical data.

---

## Adding a provider

1. Implement `FlightProvider`.
2. Add it to the array in `apps/api/src/providers/providers.module.ts`.

Nothing in the orchestration or domain layer changes. Duffel exists specifically to prove
that: it is not in the assessment brief and was added to demonstrate the abstraction is not
coupled to the original five.

---

## Scripts

```bash
pnpm build
pnpm test        # 67 tests
pnpm typecheck
```
