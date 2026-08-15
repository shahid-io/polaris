# Limitations and roadmap

What this prototype does not do, why, and what would change to address it.

Everything here is a known and deliberate boundary rather than a discovered gap. Where a
limitation was a genuine trade-off, the reasoning is recorded.

---

## Data

### Two of the brief's providers are absent entirely

MakeMyTrip and Goibibo have no adapter. Their partner APIs are commercially gated and their
public sites refuse automated clients at the CDN edge, so neither route is open, and a
generated stand-in under a real company's name is not an acceptable substitute. See
[`INTEGRATIONS.md`](./INTEGRATIONS.md#3-providers-not-integrated-and-the-reason).

IndiGo and Air India Express are absent for a subtler reason: they could be priced through
a third-party aggregator, but that price could only ever be checked against the aggregator,
not against the airline. A row nobody can verify against the seller it names does not meet
the standard the rest of the product holds to.

The cost is real and worth stating: the comparison covers three online travel agencies and
no airline direct channel, so a fare available only on an airline's own site will not appear.

### Recordings age, and a replayed price is not a current one

`BROWSER_PROVIDER_MODE=hybrid` replays a recorded response when a live session fails, so a
demonstration survives a changed page or a dropped network. A recording is real data that
has stopped being current.

That is handled rather than hidden: replayed offers are downgraded so they cannot claim to
be live, they are excluded from cheapest and best-value ranking, and a flight whose prices
are all replayed is badged "Prices not current". But the ceiling stands, a replayed price
tells you roughly what a flight costs, not what you can buy it for.

### One-way, economy-default, INR only

The brief specifies a single travel date, so only one-way search is implemented. `SearchQuery`
extends to round-trip without a breaking change, a `returnDate` field and a second leg in the
itinerary.

All prices are INR. `Money` carries a currency and refuses cross-currency comparison rather
than silently producing a meaningless number, so multi-currency is a display and conversion
problem rather than a modelling one.

### Ixigo contributes non-stop flights only

Ixigo describes a connecting itinerary as a single end-to-end entry: every flight number
joined into one string, and layovers named by city rather than airport code. The individual
legs cannot be recovered from that, and the canonical key that drives deduplication is built
from them.

Synthesising the legs would put invented airport codes and times behind a real price, so
those itineraries are declined and the count is reported in the provider status. Ixigo
therefore lists fewer flights than the other agencies on the same route, which is visible
rather than silent.

**To fix:** follow the per-itinerary detail call its own UI makes when a card is expanded.
That returns the legs, at the cost of one request per itinerary.

### Route coverage is whatever the agencies sell

There is no route table any more. Each provider is asked the route the user typed and
answers for itself, so an unserved route returns an honest empty result rather than being
greyed out on a guess. The airport picker offers every airport it knows, for the same reason.

---

## Correctness

### Codeshares are not merged

The canonical key uses the **marketing** carrier and flight number. One aircraft sold as both
`6E-2134` and a partner's number appears as two flights.

This is deliberate. Collapsing codeshares reliably needs operating carrier, equipment and slot
data that providers do not consistently expose. A _wrong_ merge is worse than a missed one: it
would show a user a fare they cannot actually buy under the flight number displayed. Given
partial data, the design fails toward showing two rows rather than one incorrect row.

**One source does supply it.** The Cleartrip browser session reports `operatingAirlineCode`
separately from the marketing carrier, and the adapter records it whenever the two differ. So
the data needed for the fix below now exists on that path, and the contract field is already
populated; what is still missing is the same field from enough _other_ providers for a merge
to be agreed rather than asserted by one seller.

**To fix:** require `operatingCarrier` in the offer contract, match on operating carrier plus
departure instant plus route, and merge only on full agreement.

### Airport timezones are fixed offsets

Each airport carries a fixed UTC offset. This is _correct_ for every airport currently
served: India observes UTC+05:30 year-round with no daylight saving, but it is a landmine
for expansion. Adding an airport in a DST-observing country would produce silent one-hour
errors twice a year.

The offset is stored per airport rather than as a global constant specifically so this shows
up as an obviously wrong field rather than an invisible assumption.

The Cleartrip browser path is the exception: its response carries a real IANA zone and a
full offset per timestamp, so offers from it make no assumption at all.

**To fix:** replace the offset with a real IANA timezone lookup. `ScheduledTime` already
carries the zone, so no call site changes.

### Benefit scoring is approximate

Only benefits with an established monetary value contribute to the score. Lounge access and
priority boarding are real but not priceable, so they are displayed and excluded from scoring
rather than assigned an invented number.

Conditional benefits: "₹500 off with HDFC cards", are excluded too. Most users cannot claim
them, and counting them would systematically over-rank whichever provider advertises the most
card promotions. A user who _does_ hold the card sees a benefit the score ignores.

**To fix:** let users declare which cards they hold, and score conditional benefits for them.

### Value weights are a judgement

`0.45 price / 0.25 duration / 0.20 stops / 0.10 benefits` is a defensible default, not a
derived truth. The weights are exposed as a parameter and echoed in every response so a
ranking can be explained and reproduced.

**To fix:** let users adjust weights directly, the scoring function already accepts arbitrary
positive weights and normalises them.

---

## Operational

### Cache and circuit state are per-process

Both live in memory. With more than one API instance, each would keep its own cache and its
own view of provider health.

`CacheStore` is an interface precisely so this is a deployment change rather than a rewrite,
a Redis implementation and one changed line in `CacheModule`.

### One page at a time per seller

Browser work is serialised **per host**: a given seller is never asked two things at once,
because driving its public search is only defensible at the rate a person would use it.
Different sellers run concurrently, since that constraint says nothing about them.

An earlier revision used a single global queue, which conflated the two. Providers were
dispatched concurrently but their browser work ran end to end, so the last agency spent most
of its per-provider timeout waiting rather than searching, and that budget measured queueing
rather than the thing it was meant to bound. Measured on DEL-BOM, the search went from
roughly 10s to 4.5s when the queue became per-host.

What remains is a memory ceiling: one Chromium tab per registered provider during a search.
Bounded and small, but it grows with the provider list, and a bounded context pool is the
obvious next step if that list ever gets long.

### No rate limiting

The API accepts unlimited requests. Fine for a prototype demonstrated locally, not for
anything exposed. `@nestjs/throttler` would address it.

### Analytics is best-effort

Writes are not awaited and failures are swallowed after one warning. A search that succeeds
may therefore not be recorded. This is the correct trade, telemetry must not fail a user's
search, but it means the analytics figures are a lower bound, not an audit.

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

Every operationally useful question, which providers are slow, how often the cache hits,
whether deduplication fires on real traffic, is answerable without knowing who searched.
Route and travel date are stored; they describe the query, not the person.

**If per-request diagnostics ever became necessary,** the design would be: truncate IPv4 to
/24, hash with a rotating salt, and expire after 30 days, a deliberate decision with a stated
basis, not a default that accumulated.

### Why there is no cookie banner

Because there is nothing to consent to. The app sets **no cookies at all**, no session, no
`Set-Cookie`, no `document.cookie`, and loads **no third-party scripts**: no analytics tag,
no pixel, no tag manager.

The only thing written to the browser is a single `localStorage` entry holding the theme you
picked. It never leaves the device and is never sent to the API.

Consent obligations attach to what is stored or read on someone's device, not to being a
website. The EU ePrivacy rule that drives most banners exempts storage that is strictly
necessary for something the user explicitly asked for, and a preference set by pressing a
toggle is squarely that. India's DPDP Act, the regime that actually applies here, has no
cookie-consent mechanism at all; it governs the processing of personal data, which a theme
string on a laptop is not.

The reason most sites show a banner is advertising and cross-site tracking. This has neither,
so adding one would ask permission for something that does not happen, and put a dialog
between the user and the search box.

**This changes** the moment there are accounts (a session cookie is still exempt as strictly
necessary, but the surrounding obligations grow) or any third-party analytics is added, at
which point non-essential tracking needs real consent before it loads, not after.

---

## Roadmap

Deliberately out of scope for the assessment, with the approach sketched.

### Booking flow

Comparison ends at a deep link. Real booking needs payment, PNR management, ticketing rules,
cancellation and refunds, and, critically, a commercial agreement with each provider. That
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
live provider calls, and against a 250-a-month quota that is the binding constraint, not the
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

**Some flights show a single provider.** No travel agency sells every seat on every flight,
and Ixigo contributes non-stop itineraries only, so a flight appearing under one seller is
ordinary rather than a deduplication failure.
