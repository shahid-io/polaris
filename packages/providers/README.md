# @polaris/providers

**Three travel agencies behind one interface, plus the primitives that isolate their
failures.**

Each is read from that seller's own public search, and each answers with a completely
different payload, normalised lookup tables, packed strings, and a server-sent event
stream. All three satisfy the same `FlightProvider` contract and the orchestrator cannot
tell them apart, which is why adding a provider touches a registry entry and a mapper.

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

## The three providers

| Provider   | Integration          | Source                | Real data |
| ---------- | -------------------- | --------------------- | --------- |
| Cleartrip  | `browser-automation` | cleartrip.com         | Yes       |
| EaseMyTrip | `browser-automation` | flight.easemytrip.com | Yes       |
| Ixigo      | `browser-automation` | ixigo.com             | Yes       |

**Nothing here generates a price.** Every adapter reports what a real seller quoted, and
every offer carries a link back to the page that quoted it.

MakeMyTrip, Goibibo, IndiGo and Air India Express have no adapter: the first three refuse
automated clients at their CDN edge, and the airlines could only be priced through an
aggregator, which is not the same as being priced by the airline. Reasoning and measurements
in [`docs/INTEGRATIONS.md`](../../docs/INTEGRATIONS.md).

Deterministic fakes live in `@polaris/providers/testing`, deliberately outside this
package's main barrel: partial results and the circuit breaker need a provider that fails
exactly when asked, and a live site cannot be made to.

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
BROWSER_PROVIDER_MODE=live      # drive the seller's site
BROWSER_PROVIDER_MODE=fixture   # replay a recorded response, offline, deterministic
BROWSER_PROVIDER_MODE=hybrid    # live, falling back to a recording on failure  (default)
```

Hybrid keeps a demonstration working when the network drops or a seller changes its page,
which is the most fragile dependency here. The same recordings make tests deterministic:
every mapper was developed against real captured responses rather than by hammering a live
site.

A replayed offer is downgraded to `representative`, excluded from cheapest and best-value
ranking, and surfaced in the provider status. Real data that is no longer current must not
be allowed to win on price.

### Recording fixtures

A recording is a snapshot of one route on one day, and is only ever replayed for the exact
date it was captured for, so the date you record has to be the date you intend to search.
Replayed offers are labelled `representative`, never `live-api`; real data that is no longer
current is closer to representative than to live.

```bash
pnpm fixtures:record:web --date 2026-08-27                          # every agency
pnpm fixtures:record:web --date 2026-08-27 --sites cleartrip,ixigo
pnpm fixtures:record:web --date 2026-08-27 --routes DEL-BOM --force
```

The script drives each site once per route, then immediately maps what it captured, so a
recording that cannot be normalised is caught at record time rather than at demo time.

Currently recorded: `DEL-BOM` for all three agencies on **2026-08-27**, plus Cleartrip on
**2026-08-28**. Any other route or date correctly reports having no data rather than
substituting the wrong day.

Browser sessions are **serialised**, one page at a time. Two independent reasons: each page
is a real Chromium tab rendering a heavy commercial site, and driving a seller's public
search is only defensible at the rate a person would use it. The cost is that their
latencies are cumulative, which is why `PROVIDER_TIMEOUT_MS` defaults to 20s.

---

## Adding a provider

1. Implement `FlightProvider`.
2. Add it to the array in `apps/api/src/providers/providers.module.ts`.

Nothing in the orchestration or domain layer changes. EaseMyTrip and Ixigo prove that: both
are outside the assessment brief and were added after the fact, each costing a registry
entry and a mapper.

For an agency read from its own web search, implement `WebSearchSite` instead and register
it in `browser/web-session-providers.ts`, the browser lifecycle, fixture rules and
provenance downgrade are already written.

---

## Scripts

```bash
pnpm build
pnpm test        # 79 tests
pnpm typecheck
```
