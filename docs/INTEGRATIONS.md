# Provider integrations

This document answers the four questions the assessment brief asks for in section 4:
providers integrated, the integration option used for each, providers **not** integrated and
why, and any representative data used.

> **Summary.** Of the five providers named in the brief, none expose a self-service API.
> Three are online travel agencies whose partner APIs sit behind signed commercial
> agreements; two are airlines with no public developer programme.
>
> Real market data is obtained for both airlines through a legitimate third-party source,
> and for Cleartrip by reading its own public search. MakeMyTrip and Goibibo could not be
> obtained by any legitimate route: both refuse automated clients at their CDN edge, which
> was measured rather than assumed. Rather than leave the agency side of the comparison
> resting entirely on generated data, **EaseMyTrip and Ixigo were integrated for real** in
> their place.
>
> The result is six providers carrying real fares and two carrying documented representative
> data. Every offer carries its provenance in the API response, and anything not real is
> labelled wherever a price is shown.

---

## 1. Providers successfully integrated

| Provider                        | Integration type     | Data source                     | Real market data    |
| ------------------------------- | -------------------- | ------------------------------- | ------------------- |
| IndiGo                          | `live-api`           | SerpApi (Google Flights)        | Yes                 |
| Air India Express               | `live-api`           | SerpApi (Google Flights)        | Yes                 |
| Cleartrip                       | `browser-automation` | Cleartrip's own web search      | Yes                 |
| EaseMyTrip _(beyond the brief)_ | `browser-automation` | EaseMyTrip's own web search     | Yes                 |
| Ixigo _(beyond the brief)_      | `browser-automation` | Ixigo's own web search          | Yes                 |
| Duffel _(beyond the brief)_     | `sandbox-api`        | Duffel API                      | No (vendor sandbox) |
| MakeMyTrip                      | `representative`     | Generated from shared timetable | No                  |
| Goibibo                         | `representative`     | Generated from shared timetable | No                  |

The three browser-read agencies are enabled with `BROWSER_PROVIDERS=all` and are **off by
default**; without it Cleartrip falls back to representative data and the other two are
absent. See [section 3](#browser-based-integration-investigated-and-measured).
Neither airline publishes a developer API, so both are sourced through a third party.

All eight implement the same `FlightProvider` interface and are registered under a single
dependency-injection token. The orchestrator cannot tell them apart, which is the point.

---

## 2. Integration option used for each provider

### IndiGo and Air India Express, live third-party API

Neither airline publishes a developer API. IndiGo runs on a Navitaire passenger service
system with partner-only access; Air India Express has no public programme. Both sell through
Google Flights, so their live schedules and fares are obtainable through **SerpApi's Google
Flights endpoint**, a commercial API with a free tier of 250 searches per month.

This is a legitimate route to current data: SerpApi is a paid service operating under its own
terms, not scraping performed by this application.

**Constraint:** 250 searches/month is a hard ceiling. The response cache exists partly to
protect it: repeated searches and filter changes are served from cache rather than
re-querying. Both airline providers are backed by the same endpoint, so their concurrent
requests are coalesced into one upstream call rather than spending two credits on identical
data.

### When the live call fails

`PROVIDER_MODE=hybrid` falls back to a recorded response so a demonstration survives a
network failure or an exhausted quota. Two rules keep that honest:

1. **A recording is only used for the exact date it was captured for.** A snapshot of one
   route on one day cannot stand in for another day; a mismatch returns no data rather than
   presenting one date's departures as another's.
2. **Replayed data is never labelled live.** Offers sourced from a recording carry
   `integrationType: 'representative'` and the provider status reads _"Live request failed,
   replayed a recorded response"_. Real data that is no longer current is closer to
   representative than to live, and a "Live" badge on a stale price would be worse than no
   badge at all.

### Duffel: vendor sandbox

Not named in the brief. Included deliberately to demonstrate that the
adapter abstraction generalises to a vendor contract the system was not designed around:
adding it touched one array and one adapter file, and nothing in the orchestration or domain
layer changed.

Duffel's test mode returns synthetic data from a fictional carrier, so it contributes no real
fares. Its value here is architectural evidence, and it is labelled `sandbox-api` rather than
being presented as real.

### The travel agencies

Cleartrip, EaseMyTrip and Ixigo are read from their own public search; MakeMyTrip and Goibibo
fall back to representative data because they cannot be read at all. See sections 3 and 4.

---

## 3. Providers not integrated, and the reason

### MakeMyTrip

A partner API exists but is **commercially gated**: access requires a signed agreement and an
assigned account manager. There is no self-service tier and no trial. The affiliate
programmes that are open to individuals (via networks such as Cuelinks and INRDeals) are
link-and-commission arrangements, they pay for referred bookings and expose **no flight data
feed**, so they cannot answer "what does this flight cost on MakeMyTrip".

### Goibibo

Owned by the same parent company as MakeMyTrip and gated identically. No public developer API.

### Cleartrip

Offers a REST partner API, also behind a commercial agreement. No self-service access. Its
public web search is reachable, so it is integrated that way instead, see below.

### A finding worth recording

Amadeus Self-Service was evaluated as a source of live flight data and excluded: the
Self-Service developer portal was **decommissioned on 17 July 2026**, with existing keys
disabled. Enterprise access remains contract-based and was outside the scope of this
assessment.

This matters beyond trivia: it is the API almost any prior knowledge would point to first, and
a plan written from memory rather than verification would have been built on a dead
dependency and discovered the problem mid-implementation. Alternatives were evaluated
against what is actually live now:

| Option                     | Verdict                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Amadeus Self-Service       | Decommissioned 17 July 2026                                                                                                     |
| **SerpApi Google Flights** | **Selected** (free tier, real data, real Indian carriers)                                                                       |
| Duffel                     | Free signup, but test mode is synthetic; live mode needs payment details and verification, and Indian low-cost coverage is thin |
| Travelpayouts / Aviasales  | Affiliate model, free registration, viable (held as a fallback)                                                                 |
| Scraping the OTAs          | **Rejected** (see below)                                                                                                        |

### Browser-based integration: investigated and measured

Where an OTA publishes no API, the remaining option is to drive its own public search page in
a browser. This was tested against all five providers rather than reasoned about, and the
results split cleanly.

All five results pages are client-rendered: the page asks its own backend for JSON and
renders it. So the target is never the markup. Capturing the response the site's own front
end receives gives named, typed fields with no selectors to break, which is a materially
different proposition from scraping rendered HTML.

**Measured result, DEL-BOM, one search per site:**

| Site              | Edge   | Automated browser        | Outcome                      |
| ----------------- | ------ | ------------------------ | ---------------------------- |
| Cleartrip         | Akamai | Served normally          | **Integrated**, 190 offers   |
| EaseMyTrip        | Akamai | Served normally          | **Integrated**, 140 offers   |
| Ixigo             | Akamai | Served normally          | **Integrated**, 65 offers    |
| MakeMyTrip        | Akamai | Connection refused       | Not obtainable               |
| Goibibo           | Akamai | Connection refused       | Not obtainable               |
| IndiGo (goindigo) | Akamai | Connection refused       | Not needed, live via SerpApi |
| Air India Express | Akamai | Site loads, no fare feed | Not needed, live via SerpApi |

Every one of these sits behind the same CDN, so the split is a per-customer bot-management
policy rather than a property of the technology. Three tenants serve an automated client and
three refuse; each answer is taken at face value.

MakeMyTrip and Goibibo terminate the connection after the TLS handshake with
`ERR_HTTP2_PROTOCOL_ERROR`, before any page is served. This is Akamai Bot Manager
fingerprinting the client, not a rate limit and not a challenge page. It was confirmed to be
automation detection rather than a network or geographic block: the identical URL renders
104 flights in an ordinary desktop Chrome from the same machine and network.

**Getting past that would mean defeating the bot protection**, by forging a TLS fingerprint
or routing through residential proxies. That line is not crossed here, on three grounds and
any one of them would be enough. It circumvents an access control the operator has
deliberately placed. It is not a durable engineering answer, since it breaks silently the
next time their edge configuration changes. And a system that quietly evades detection is
harder to defend in review than one that detects a refusal and degrades honestly, which is
what this does: a blocked provider becomes a visible `providerStatuses` entry.

### Why EaseMyTrip and Ixigo were added

MakeMyTrip and Goibibo are two of the brief's three agencies. Losing both would have left
the entire agency side of the comparison resting on generated data, which demonstrates
nothing about aggregating real sellers. EaseMyTrip and Ixigo are comparable Indian OTAs that
do serve their public search, so they were integrated to carry real agency fares in their
place. Adding each one touched a registry entry and a mapper, nothing else.

### What the three agencies each contribute

All three are reported as `browser-automation` rather than `live-api`: the endpoints are
undocumented, unversioned and outside any commercial agreement, and a badge implying a
contracted API would claim a stability nobody has promised.

They disagree about almost everything else, which is the point of the site abstraction.
Cleartrip answers with normalised lookup tables, EaseMyTrip with abbreviated keys and packed
strings, Ixigo with a server-sent event stream.

| Contributes                   | Cleartrip | EaseMyTrip | Ixigo |
| ----------------------------- | --------- | ---------- | ----- |
| Fare/tax breakdown            | Yes       | Yes (1 pax) | No    |
| Operating carrier (codeshare) | Yes       | No         | No    |
| Real IANA zone per airport    | Yes       | No         | No    |
| Seats remaining               | No        | Yes        | Yes   |
| Baggage allowance             | No        | Yes        | Yes   |
| Connecting itineraries        | Yes       | Yes        | **No** |

**Ixigo maps non-stop flights only.** It describes a connection as one end-to-end entry with
every flight number joined into a single string and layovers named by city rather than
airport code. Its individual legs cannot be recovered from that, and the canonical key that
drives deduplication is built from them, so synthesising segments would put invented airport
codes behind a real price. Those itineraries are declined and the omission is reported in the
provider status rather than passing silently.

### Cleartrip specifically

What its response supplies that no other source here does:

- `operatingAirlineCode` separately from the marketing carrier, so codeshares are visible
- a real IANA zone per airport, so no fixed-offset assumption is needed
- `totalBaseFare` and `totalTax`, so `price.total` reconciles rather than being trusted

Three limitations in [`LIMITATIONS.md`](./LIMITATIONS.md) exist because no other source
supplies those fields. On this path they do not apply.

Two details worth recording, because both would be wrong if handled naively:

1. **Nearby airports are dropped.** All three agencies answer a Delhi search with departures
   from DXN. Helpful on their own sites, wrong in a comparison where every other provider
   answered the route exactly as asked: a flight from a different airport is not the same
   flight at a better price.
2. **The quoted price is the undiscounted total.** Every Cleartrip fare carries a coupon.
   Pricing on the discounted figure would rank it above sellers quoting honestly, on a price
   most users cannot obtain. The coupon is carried as a `conditional` benefit instead, which
   scoring already excludes. Ixigo's promotional copy is treated the same way.

Recordings are replayed exactly as on the SerpApi path, under the same two rules: valid only
for the date captured, and never labelled with the live provenance.

---

## 4. Representative data used

The three OTAs are served by a `RepresentativeProvider`, which generates offers rather than
fetching them.

### How it works

All three price the **same shared timetable**. This is the design decision that makes the
whole thing meaningful: had each provider invented its own flights, nothing would ever
deduplicate and the comparison this application exists to perform would have had nothing to
compare. Because they share a timetable, the same marketed flight genuinely appears across
providers at different prices.

The timetable models real Indian domestic patterns, 13 routes across 10 airports, IndiGo
dominating frequency with Air India Express thinner, morning and evening peaks, one
weekend-only service, and a deliberate 00:45 red-eye on Delhi–Mumbai.

Each provider is given a distinct market position so comparison surfaces meaningful
differences rather than noise:

| Provider   | Price position | Inventory coverage | Competes on                                  |
| ---------- | -------------- | ------------------ | -------------------------------------------- |
| MakeMyTrip | +3.5%          | 90%                | Wallet cashback, date-change flexibility     |
| Goibibo    | −1.5%          | 82%                | goCash, fee waivers                          |
| Cleartrip  | +1.2%          | 74%                | Instant discount, free cancellation, baggage |

Inventory coverage is deliberately below 100%: no OTA sells every seat on every flight.
Without that, every comparison group would contain all three providers and look identical.

### Overlap with live data

Several Delhi–Mumbai services carry **real IndiGo flight numbers, departure times and block
times**, taken from a recorded Google Flights response for the route.

This matters for what the product demonstrates. The live adapter returns the flights that
genuinely operate; the representative providers price a timetable. If those two sets never
intersect, a live fare can never appear on the same card as an agency fare, and every
cross-provider comparison comes from simulated data alone, the deduplication would never be
shown working on anything real.

It is also the more plausible arrangement. Travel agencies sell real airline services; an
agency offering flights that do not exist was the less realistic of the two options, not the
more.

### Determinism

Every value derives from a seed built from the search query, never `Math.random()`. The same
search returns the same fares on every run. This is not cosmetic: without it the cache would
be meaningless, tests would be flaky, and prices would visibly shift between refreshes during
a demonstration.

### Honesty

Representative data is never presented as real:

- Every offer carries `integrationType: 'representative'` in the API response.
- `GET /api/providers` reports `isRealData: false` with an explanatory note per provider.
- The UI badges simulated data at the point a price is displayed, not in a footnote.

### What representative data does _not_ claim

The prices are plausible, not accurate. They are not scraped from these providers, not
historical, and should not be used to make a real purchasing decision. They exist to exercise
aggregation, deduplication, comparison and failure handling against realistic-shaped input.

---

## 5. Configuration

The application runs with **no credentials at all**. Providers without configuration report
status `skipped` and the search proceeds with the rest, the same partial-results path used
when a provider fails.

```bash
cp .env.example .env

SERPAPI_KEY=            # optional: enables live IndiGo / Air India Express data
DUFFEL_ACCESS_TOKEN=    # optional: enables the sandbox adapter
MONGODB_URI=            # optional: enables search analytics
```

See [`LIMITATIONS.md`](./LIMITATIONS.md) for what this design does not handle.
