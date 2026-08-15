# Provider integrations

This document answers the four questions the assessment brief asks for in section 4:
providers integrated, the integration option used for each, providers **not** integrated and
why, and any representative data used.

> **Summary.** Every price Polaris shows is a price that seller's own website is showing,
> and every offer carries a link back to the page that quoted it. Nothing is generated.
>
> Of the five providers named in the brief, only Cleartrip could be integrated. MakeMyTrip
> and Goibibo refuse automated clients at their CDN edge; IndiGo and Air India Express
> publish no API, and the third-party source that could price them proved against Google
> rather than against the airline. EaseMyTrip and Ixigo were integrated in their place so
> the comparison rests on three real agencies rather than on one.
>
> **No representative data ships.** A seller that cannot be sourced truthfully is absent
> rather than filled in.

---

## 1. Providers integrated

| Provider   | Integration type     | Data source           | Named in the brief |
| ---------- | -------------------- | --------------------- | ------------------ |
| Cleartrip  | `browser-automation` | cleartrip.com         | Yes                |
| EaseMyTrip | `browser-automation` | flight.easemytrip.com | No, added          |
| Ixigo      | `browser-automation` | ixigo.com             | No, added          |

All three implement the same `FlightProvider` interface and are registered under a single
dependency-injection token. The orchestrator cannot tell them apart, which is the point.

---

## 2. The integration option used

All three agencies publish partner APIs and gate every one of them behind a signed
commercial agreement with no self-service tier. What they also publish is a **client-rendered
search page**: the site asks its own backend for JSON and renders what comes back.

The adapter drives that page in a headless browser and captures the response the site's own
front end receives. That is a different proposition from scraping rendered markup: the
fields are named, the numbers are typed rather than parsed out of `"₹5,942"`, and there are
no selectors to break.

### Why this is its own provenance class

Offers are reported as `browser-automation`, never `live-api`. The data is genuinely the
seller's own and current, so calling it representative would understate it. But the
endpoints are undocumented, unversioned and outside any commercial agreement, so calling it
a live API would overstate it and imply a stability nobody has promised.

### Deliberately conservative

One search at a time, serialised, at the rate a person would search. No credentials, no
login, and no attempt to defeat a challenge: a site that refuses is reported as a provider
failure and the search degrades, exactly as any other outage would.

### The three payloads share nothing

Which is what the site abstraction exists for. Each agency supplies only a URL builder and a
mapper; the browser lifecycle, fixture rules, provenance downgrade and validation loop are
written once.

| Contributes                   | Cleartrip     | EaseMyTrip     | Ixigo      |
| ----------------------------- | ------------- | -------------- | ---------- |
| Response shape                | lookup tables | packed strings | SSE stream |
| Fare/tax breakdown            | Yes           | Yes (1 pax)    | No         |
| Operating carrier (codeshare) | Yes           | No             | No         |
| Real IANA zone per airport    | Yes           | No             | No         |
| Seats remaining               | No            | Yes            | Yes        |
| Baggage allowance             | No            | Yes            | Yes        |
| Connecting itineraries        | Yes           | Yes            | **No**     |

**Ixigo maps non-stop flights only.** It describes a connection as one end-to-end entry with
every flight number joined into a single string and layovers named by city rather than
airport code. Its legs cannot be recovered from that, and the canonical key that drives
deduplication is built from them, so synthesising segments would put invented airport codes
behind a real price. Those itineraries are declined and the count is reported in the
provider status rather than passing silently.

### Two details that would be wrong if handled naively

1. **Nearby airports are dropped.** All three answer a Delhi search with departures from
   DXN. Helpful on their own sites, wrong in a comparison where the other providers answered
   the route exactly as asked: a flight from a different airport is not the same flight at a
   better price.
2. **Cleartrip is priced on the undiscounted total.** Every Cleartrip fare carries a coupon,
   and a coupon needs a code not everyone can use; ranking on it would push whichever seller
   advertises the most promotions to the top on a price most users cannot get. The coupon is
   carried as a `conditional` benefit, which scoring excludes, and the discounted figure is
   shown beside the comparable one because their page shows it the same way: the fare in the
   price column, the coupon on a line beneath it.

### When the live session fails

`BROWSER_PROVIDER_MODE=hybrid` replays a recorded response so a demonstration survives a
network failure or a changed page. Three rules keep that honest:

1. **A recording is only used for the exact date it was captured for.** A snapshot of one
   route on one day cannot stand in for another; the response's own echoed date is verified,
   so a file renamed by hand cannot slip through.
2. **Replayed data is never labelled current.** It carries `integrationType:
   'representative'` and the provider status says so.
3. **Replayed prices do not compete.** They are excluded from cheapest and best-value
   ranking, and a flight whose prices are all replayed is badged "Prices not current". A
   stale price that wins "cheapest" puts the most misleading number in the most prominent
   position on screen.

---

## 3. Providers not integrated, and the reason

### MakeMyTrip and Goibibo: refused at the edge

Both terminate the connection after the TLS handshake with `ERR_HTTP2_PROTOCOL_ERROR`,
before serving any page. Their partner APIs are commercially gated, and the affiliate
programmes open to individuals are link-and-commission arrangements that expose no flight
data feed.

**Measured, not assumed.** The identical URL renders 104 flights in an ordinary desktop
Chrome on the same machine and network, so this is automation detection rather than a
network or geographic block. A real-Chrome channel, a persistent profile and cookie warming
were all tried and all still refused at the results page.

Closing that gap would require forging a TLS fingerprint or routing through residential
proxies. **That line is not crossed here**, on three grounds and any one would be enough. It
circumvents an access control the operator deliberately placed. It is not a durable
engineering answer, since it breaks silently the next time their edge configuration changes.
And a system that quietly evades detection is harder to defend in review than one that
detects a refusal and degrades honestly, which is what this does.

### IndiGo and Air India Express: no API, and no honest proxy

Neither publishes a developer API. IndiGo runs a Navitaire system with partner-only access;
Air India Express has no public programme. Their own sites refuse automated clients the same
way MakeMyTrip does.

They were initially served through SerpApi's Google Flights engine, which is real data
obtained legitimately. That was removed. A row labelled "IndiGo" whose price came from
Google can only be checked against Google, and airlines routinely price their direct channel
differently from what aggregators surface, so the row could not meet the standard the rest
of the product holds to.

### Measured results, DEL-BOM, one search per site

Every one of these sits behind the same CDN, so the split is a per-customer bot-management
policy rather than a property of the technology.

| Site              | Automated browser        | Outcome                    |
| ----------------- | ------------------------ | -------------------------- |
| Cleartrip         | Served normally          | **Integrated**, 190 offers |
| EaseMyTrip        | Served normally          | **Integrated**, 140 offers |
| Ixigo             | Served normally          | **Integrated**, 65 offers  |
| MakeMyTrip        | Connection refused       | Not obtainable             |
| Goibibo           | Connection refused       | Not obtainable             |
| IndiGo (goindigo) | Connection refused       | Not obtainable             |
| Air India Express | Site loads, no fare feed | Not obtainable             |

### A finding worth recording

Amadeus Self-Service was evaluated as a source of live flight data and excluded: the
Self-Service developer portal was **decommissioned on 17 July 2026**, with existing keys
disabled.

This matters beyond trivia. It is the API almost any prior knowledge would point to first,
and a plan written from memory rather than verification would have been built on a dead
dependency and discovered the problem mid-implementation.

---

## 4. Representative data used

**None.**

Earlier revisions served MakeMyTrip, Goibibo and Cleartrip with generated offers drawn from
a shared timetable, badged as simulated. That was removed. A generated fare under a real
company's name is the exact error a price-comparison product exists to catch, and a badge
does not make it true.

The only thing that still generates offers is a set of deterministic test doubles under
`@polaris/providers/testing`, absent from the package's main barrel so they cannot be
imported into the application by accident. They exist because partial results, per-provider
timeouts and the circuit breaker need a provider that fails exactly when asked, and a live
site cannot be made to.

---

## 5. Verifying a price

Two ways, one for a person and one for the build.

### By hand

1. Run a search.
2. Expand a flight and click **Check on <provider>** on any seller's row.
3. A new tab opens on that seller's own results for the same route, date, passenger count
   and cabin.
4. Find the flight number shown on the Polaris row and compare the price.

None of the three sites supports linking to a single itinerary: their result cards are
script-driven with no per-flight URL, and only Ixigo honours an airline filter in the query
string. So the link lands on a list, and the UI names the flight, departure time and price
to look for, which turns verification into a scan rather than a hunt.

### By command

```bash
pnpm verify:prices --route DEL-BOM --date 2026-08-27
```

Runs a real search, then independently opens each seller's page, reads the fares a human
would see, and reports every flight where the two disagree. Exits non-zero on any mismatch.

```
Scope: non-stop itineraries only. Connecting itineraries are not verified,
because one flight number does not identify a multi-leg journey.

PASS      Cleartrip    65/66   verified (98% coverage), 0 mismatched
WARN      EaseMyTrip   49/66   verified (74% coverage), 0 mismatched
WARN      Ixigo        45/65   verified (69% coverage), 0 mismatched

159 of 197 non-stop fares verified (81% coverage), 0 mismatched.
PASSED WITH INCOMPLETE COVERAGE.
```

**Coverage is graded, because a check that verified almost nothing must not read as a
pass.** `PASS` needs 90% of quoted fares compared, `WARN` is a genuine pass with fares left
unchecked, and below 60% the run exits non-zero as `INCONCLUSIVE`: verifying eight flights
out of a hundred is not evidence, and a green tick on it would turn an unanswered question
into a false answer.

**The parser fails closed.** A flight the page showed but whose fare could not be read
confidently, no price in range, or different prices across scroll passes, is reported as
ambiguous rather than guessed at or silently dropped. Silently dropping is the dangerous
one: it shrinks the denominator until the check verifies nothing while still reporting
success.


### Across many routes

```bash
pnpm qa:sweep --routes DEL-BOM,DEL-BLR,BOM-BLR,PAT-BLR --dates 2026-08-22,2026-09-05
```

Runs the same check over a matrix and adds one thing the single-route command structurally
cannot do: **cross-referencing the sellers against each other**.

Per-seller verification proves Polaris reports what a seller's page says. It cannot prove
the seller was read correctly in a deeper sense, because a mapper that consistently picks
the wrong field will match the page every time and still produce a wrong comparison. Three
independent sellers pricing the same flight is the check on that.

When one seller sits far from the median of its peers, the sweep flags it. It does **not**
fail the run, because it genuinely cannot tell the two explanations apart: either that
seller really is cheaper, which is the entire point of the product, or a mapper is wrong.
Only a human can say which, and pretending otherwise would turn the product working as
intended into a red build.

Only a disagreement with a seller's own page, an error, or schema drift fails the sweep.

The 20% threshold is calibrated against a real observation, not chosen for neatness:
EaseMyTrip was seen selling IX-1584 PAT-BLR at ₹8,216 while both peers had ₹10,736, a
-23.5% gap. An earlier 25% default would have stayed silent through exactly the finding
this check exists to surface.

That fare had returned to ₹10,736 within the hour, which is its own lesson: these are
snapshots of a volatile market, and it is the reason offers carry `retrievedAt` and a
replayed price is never allowed to claim it is current.

**It reads the rendered page, not the JSON.** The adapters work by capturing the JSON a
site's front end receives; a harness doing the same would compare the pipeline against
itself and pass even if every mapping were wrong. Reading rendered text checks the whole
chain against what the seller actually shows a customer, which is the only version of this
check worth having.

That makes the harness deliberately fragile where the product is not. It depends on page
layout, and it is meant to: when a seller redesigns, this should start failing and say so.

Two constraints worth knowing:

- **Non-stop itineraries only.** A flight number identifies a journey only when it has no
  stops; a connection renders both leg numbers, so keying on either would pair a price with
  a journey that may not match. Same reasoning as the canonical key.
- **Only what the page renders.** These lists load lazily, and Ixigo's is virtualised inside
  an inner scroll container, so the harness scrolls whichever element actually overflows and
  accumulates text as it goes. Flights that never render are reported as unchecked rather
  than counted as passing.

It has already earned its place. It caught that the verification link was telling readers to
look for a coupon-discounted figure, when these pages print the undiscounted fare in the
price column and show the coupon on a separate line beneath.

---

## 6. Configuration

The application runs with **no credentials at all**.

```bash
cp .env.example .env
pnpm browsers:install    # Chromium, usually already present

BROWSER_PROVIDERS=          # omit entirely to enable all three agencies
BROWSER_PROVIDER_MODE=hybrid
MONGODB_URI=                # optional: enables search analytics
```

Browser sessions are serialised deliberately, so their latency is cumulative and
`PROVIDER_TIMEOUT_MS` defaults to 20s to accommodate the agency that runs last.

See [`LIMITATIONS.md`](./LIMITATIONS.md) for what this design does not handle.
