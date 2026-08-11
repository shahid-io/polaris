# Limitations and roadmap

What this prototype does not do, why, and what would change to address it.

Everything here is a known and deliberate boundary rather than a discovered gap. Where a
limitation was a genuine trade-off, the reasoning is recorded.

---

## Data

### Three providers use representative data

MakeMyTrip, Goibibo and Cleartrip return generated offers, not real fares. Their partner APIs
are commercially gated and unobtainable for a prototype — see
[`INTEGRATIONS.md`](./INTEGRATIONS.md#3-providers-not-integrated-and-the-reason).

The prices are plausible, not accurate. They are not scraped, not historical, and must not
inform a real purchase. They exist so aggregation, deduplication, comparison and failure
handling can be exercised against realistic-shaped input.

Provenance is never hidden: every offer carries `integrationType`, `GET /api/providers`
reports `isRealData` per provider, and the UI badges simulated data where the price is shown.

### The live data source has a hard quota

SerpApi's free tier allows 250 searches per month. The response cache mitigates this, and
`PROVIDER_MODE=fixture` replays recorded responses entirely offline, but a sustained
demonstration could exhaust it. A paid tier or a second source would remove the ceiling.

### One-way, economy-default, INR only

The brief specifies a single travel date, so only one-way search is implemented. `SearchQuery`
extends to round-trip without a breaking change — a `returnDate` field and a second leg in the
itinerary.

All prices are INR. `Money` carries a currency and refuses cross-currency comparison rather
than silently producing a meaningless number, so multi-currency is a display and conversion
problem rather than a modelling one.

### The timetable covers 13 routes

Representative providers serve 13 route pairs across 10 Indian airports. An unserved route
returns zero flights — a legitimate empty result, not an error. Live providers are not
restricted this way.

---

## Correctness

### Codeshares are not merged

The canonical key uses the **marketing** carrier and flight number. One aircraft sold as both
`6E-2134` and a partner's number appears as two flights.

This is deliberate. Collapsing codeshares reliably needs operating carrier, equipment and slot
data that providers do not consistently expose. A *wrong* merge is worse than a missed one: it
would show a user a fare they cannot actually buy under the flight number displayed. Given
partial data, the design fails toward showing two rows rather than one incorrect row.

**To fix:** require `operatingCarrier` in the offer contract, match on operating carrier plus
departure instant plus route, and merge only on full agreement.

### Airport timezones are fixed offsets

Each airport carries a fixed UTC offset. This is *correct* for every airport currently
served — India observes UTC+05:30 year-round with no daylight saving — but it is a landmine
for expansion. Adding an airport in a DST-observing country would produce silent one-hour
errors twice a year.

The offset is stored per airport rather than as a global constant specifically so this shows
up as an obviously wrong field rather than an invisible assumption.

**To fix:** replace the offset with a real IANA timezone lookup. `ScheduledTime` already
carries the zone, so no call site changes.

### Benefit scoring is approximate

Only benefits with an established monetary value contribute to the score. Lounge access and
priority boarding are real but not priceable, so they are displayed and excluded from scoring
rather than assigned an invented number.

Conditional benefits — "₹500 off with HDFC cards" — are excluded too. Most users cannot claim
them, and counting them would systematically over-rank whichever provider advertises the most
card promotions. A user who *does* hold the card sees a benefit the score ignores.

**To fix:** let users declare which cards they hold, and score conditional benefits for them.

### Value weights are a judgement

`0.45 price / 0.25 duration / 0.20 stops / 0.10 benefits` is a defensible default, not a
derived truth. The weights are exposed as a parameter and echoed in every response so a
ranking can be explained and reproduced.

**To fix:** let users adjust weights directly — the scoring function already accepts arbitrary
positive weights and normalises them.

---

## Operational

### Cache and circuit state are per-process

Both live in memory. With more than one API instance, each would keep its own cache and its
own view of provider health.

`CacheStore` is an interface precisely so this is a deployment change rather than a rewrite —
a Redis implementation and one changed line in `CacheModule`.

### No rate limiting

The API accepts unlimited requests. Fine for a prototype demonstrated locally, not for
anything exposed. `@nestjs/throttler` would address it.

### Analytics is best-effort

Writes are not awaited and failures are swallowed after one warning. A search that succeeds
may therefore not be recorded. This is the correct trade — telemetry must not fail a user's
search — but it means the analytics figures are a lower bound, not an audit.

### No authentication

Every endpoint is open. Nothing here is user-specific, so there is nothing to protect yet;
that changes the moment accounts exist.

---

## Privacy

Search analytics deliberately records **no IP address, cookie, session identifier or user
agent**.

Storing an IP alongside a search query would make this personal data under India's **DPDP Act
2023** and the GDPR, bringing obligations a prototype has no business incurring: a lawful
basis for processing, a retention policy, and subject-access handling.

Every operationally useful question — which providers are slow, how often the cache hits,
whether deduplication fires on real traffic — is answerable without knowing who searched.
Route and travel date are stored; they describe the query, not the person.

**If per-request diagnostics ever became necessary,** the design would be: truncate IPv4 to
/24, hash with a rotating salt, and expire after 30 days — a deliberate decision with a stated
basis, not a default that accumulated.

---

## Roadmap

Deliberately out of scope for the assessment, with the approach sketched.

### Booking flow
Comparison ends at a deep link. Real booking needs payment, PNR management, ticketing rules,
cancellation and refunds — and, critically, a commercial agreement with each provider. That
agreement is the same blocker preventing the OTA integrations in the first place.

### User accounts and saved searches
Needs authentication first. A user document, saved-search collection, and a re-run job would
follow naturally from the existing Mongoose setup.

### Price alerts
A scheduled job re-running saved searches and comparing against a stored baseline, with
notification on movement. The search pipeline is already deterministic and cacheable, which is
most of what this requires; the missing pieces are a scheduler and a delivery channel.

### Flexible dates
A ±3-day price matrix. Straightforward against representative providers, but it multiplies
live provider calls — and against a 250-a-month quota that is the binding constraint, not the
engineering.

### Multi-currency
`Money` already carries a currency and refuses unsafe comparison. What is missing is a rate
source and a display preference.

---

## Not defects

Two behaviours that look like bugs and are not:

**A search returns 200 even when every provider failed.** With zero flights and an honest
`providerStatuses` array. This is deliberate: a client must be able to distinguish "no flights
on this route" from "nothing answered", and an HTTP error collapses those into one
indistinguishable failure.

**Some flights show a single provider.** Representative providers list 74–90% of the timetable
because no travel agency sells every seat on every flight. Uniform coverage would make every
comparison group identical and prove nothing about deduplication.
