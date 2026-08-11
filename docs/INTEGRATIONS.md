# Provider integrations

This document answers the four questions the assessment brief asks for in section 4:
providers integrated, the integration option used for each, providers **not** integrated and
why, and any representative data used.

> **Summary.** Of the five providers named in the brief, none expose a self-service API.
> Three are online travel agencies whose partner APIs sit behind signed commercial
> agreements; two are airlines with no public developer programme. Real market data is
> obtained for the two airlines through a legitimate third-party source. The three OTAs use
> documented representative data. Every offer carries its provenance in the API response, and
> simulated data is labelled as such wherever a price is shown.

---

## 1. Providers successfully integrated

| Provider | Integration type | Data source | Real market data |
|---|---|---|---|
| IndiGo | `live-api` | SerpApi (Google Flights) | Yes |
| Air India Express | `live-api` | SerpApi (Google Flights) | Yes |
| Duffel *(beyond the brief)* | `sandbox-api` | Duffel API | No — vendor sandbox |
| MakeMyTrip | `representative` | Generated from shared timetable | No |
| Goibibo | `representative` | Generated from shared timetable | No |
| Cleartrip | `representative` | Generated from shared timetable | No |

All six implement the same `FlightProvider` interface and are registered under a single
dependency-injection token. The orchestrator cannot tell them apart — which is the point.

---

## 2. Integration option used for each provider

### IndiGo and Air India Express — live third-party API

Neither airline publishes a developer API. IndiGo runs on a Navitaire passenger service
system with partner-only access; Air India Express has no public programme. Both sell through
Google Flights, so their live schedules and fares are obtainable through **SerpApi's Google
Flights endpoint** — a commercial API with a free tier of 250 searches per month.

This is a legitimate route to current data: SerpApi is a paid service operating under its own
terms, not scraping performed by this application.

**Constraint:** 250 searches/month is a hard ceiling. The response cache exists partly to
protect it — repeated searches and filter changes are served from cache rather than
re-querying.

### Duffel — vendor sandbox

Not named in the brief. Included deliberately as a sixth provider to demonstrate that the
adapter abstraction generalises to a vendor contract the system was not designed around:
adding it touched one array and one adapter file, and nothing in the orchestration or domain
layer changed.

Duffel's test mode returns synthetic data from a fictional carrier, so it contributes no real
fares. Its value here is architectural evidence, and it is labelled `sandbox-api` rather than
being presented as real.

### MakeMyTrip, Goibibo and Cleartrip — representative data

See sections 3 and 4.

---

## 3. Providers not integrated, and the reason

### MakeMyTrip

A partner API exists but is **commercially gated**: access requires a signed agreement and an
assigned account manager. There is no self-service tier and no trial. The affiliate
programmes that are open to individuals (via networks such as Cuelinks and INRDeals) are
link-and-commission arrangements — they pay for referred bookings and expose **no flight data
feed**, so they cannot answer "what does this flight cost on MakeMyTrip".

### Goibibo

Owned by the same parent company as MakeMyTrip and gated identically. No public developer API.

### Cleartrip

Offers a REST partner API, also behind a commercial agreement. No self-service access.

### A finding worth recording

**Amadeus Self-Service — the standard free source of real flight data — was decommissioned on
17 July 2026**, three weeks before this build started. New registrations were paused and the
portal was shut down for existing users.

This matters beyond trivia: it is the API almost any prior knowledge would point to first, and
a plan written from memory rather than verification would have been built on a dead
dependency and discovered the problem mid-implementation. Alternatives were evaluated
against what is actually live now:

| Option | Verdict |
|---|---|
| Amadeus Self-Service | Decommissioned 17 July 2026 |
| **SerpApi Google Flights** | **Selected** — free tier, real data, real Indian carriers |
| Duffel | Free signup, but test mode is synthetic; live mode needs payment details and verification, and Indian low-cost coverage is thin |
| Travelpayouts / Aviasales | Affiliate model, free registration, viable — held as a fallback |
| Scraping the OTAs | **Rejected** — see below |

### Why scraping was rejected

Scraping MakeMyTrip, Goibibo or Cleartrip would breach their terms of service, and all three
run commercial bot protection that a prototype would be fighting rather than building against.
The brief's own wording — "legitimate integration options" — reads as a steer away from it,
and section 4 explicitly pre-authorises representative data where access is not obtainable.

There is also a practical argument: a scraper is the single most likely component to break
during a live demonstration, because it depends on markup nobody has promised to keep stable.

The architecture remains scrape-*ready* — a scraping adapter would implement the same
`FlightProvider` interface as everything else — but none ships.

---

## 4. Representative data used

The three OTAs are served by a `RepresentativeProvider`, which generates offers rather than
fetching them.

### How it works

All three price the **same shared timetable**. This is the design decision that makes the
whole thing meaningful: had each provider invented its own flights, nothing would ever
deduplicate and the comparison this application exists to perform would have had nothing to
compare. Because they share a timetable, the same physical flight genuinely appears across
providers at different prices.

The timetable models real Indian domestic patterns — 13 routes across 10 airports, IndiGo
dominating frequency with Air India Express thinner, morning and evening peaks, one
weekend-only service, and a deliberate 00:45 red-eye on Delhi–Mumbai.

Each provider is given a distinct market position so comparison surfaces meaningful
differences rather than noise:

| Provider | Price position | Inventory coverage | Competes on |
|---|---|---|---|
| MakeMyTrip | +3.5% | 90% | Wallet cashback, date-change flexibility |
| Goibibo | −1.5% | 82% | goCash, fee waivers |
| Cleartrip | +1.2% | 74% | Instant discount, free cancellation, baggage |

Inventory coverage is deliberately below 100%: no OTA sells every seat on every flight.
Without that, every comparison group would contain all three providers and look identical.

### Determinism

Every value derives from a seed built from the search query — never `Math.random()`. The same
search returns the same fares on every run. This is not cosmetic: without it the cache would
be meaningless, tests would be flaky, and prices would visibly shift between refreshes during
a demonstration.

### Honesty

Representative data is never presented as real:

- Every offer carries `integrationType: 'representative'` in the API response.
- `GET /api/providers` reports `isRealData: false` with an explanatory note per provider.
- The UI badges simulated data at the point a price is displayed, not in a footnote.

### What representative data does *not* claim

The prices are plausible, not accurate. They are not scraped from these providers, not
historical, and should not be used to make a real purchasing decision. They exist to exercise
aggregation, deduplication, comparison and failure handling against realistic-shaped input.

---

## 5. Configuration

The application runs with **no credentials at all**. Providers without configuration report
status `skipped` and the search proceeds with the rest — the same partial-results path used
when a provider fails.

```bash
cp .env.example .env

SERPAPI_KEY=            # optional — enables live IndiGo / Air India Express data
DUFFEL_ACCESS_TOKEN=    # optional — enables the sandbox adapter
MONGODB_URI=            # optional — enables search analytics
```

See [`LIMITATIONS.md`](./LIMITATIONS.md) for what this design does not handle.
