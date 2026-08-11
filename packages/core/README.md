# @polaris/core

**The comparison engine — pure functions, no I/O, no framework.**

Everything that decides *what the user sees* lives here: recognising when several providers
are selling the same flight, scoring value, filtering and ranking. Nothing in this package
knows about HTTP, NestJS, React, or any individual provider.

Depends only on `@polaris/contracts`.

---

## Why this package exists

Every rule worth testing is a function of its arguments, so the 68 tests here run in about
20 ms with no mocks, no HTTP stubs and no Nest testing module. Had this logic lived inside
a service, the tests that matter most — the red-eye timezone case, the fare-family spread
case — would be buried under mock setup.

It is also why the frontend can import it directly: the same `sortGroups` and `filterGroups`
run in the browser and on the server, so "cheapest first" cannot mean two different things.

---

## The pipeline

```
offers  →  groupOffers  →  scoreGroups  →  filterGroups  →  sortGroups
           ─────────────   ────────────    ─────────────    ──────────
           one entry per   value score     user            presentation
           marketed        + breakdown     constraints     order
           flight
```

```ts
import { groupOffers, scoreGroups, filterGroups, sortGroups } from '@polaris/core';

const groups  = groupOffers(offers);           // 62 offers → 37 flights
const scored  = scoreGroups(groups);           // adds a transparent value score
const visible = sortGroups(filterGroups(scored, { maxStops: 0 }), 'price');
```

**Scoring runs before filtering, deliberately.** Sub-scores are normalised across the result
set, so filtering first would silently rescale every score as the user toggles a checkbox —
a flight's "value" would change because a *different* flight was hidden.

---

## Deduplication — the core idea

Two offers describe the same flight when this produces the same string:

```
{marketingCarrier}-{flightNumber}-{localDepartureDate}-{origin}-{destination}

6E-2134-2026-08-20-DEL-BOM
```

Multi-leg journeys join each segment's key, so two itineraries match only when every leg
matches in the same order.

**Marketed flight, not physical aircraft.** Marketing carrier and flight number are what a
ticket is *sold* as and what providers agree on. On a codeshare, one aircraft may be sold
under two numbers and will appear here as two flights. That is deliberate: merging them
reliably needs operating carrier and equipment data providers do not expose, and showing a
fare the user cannot buy under the number displayed is worse than showing two rows.

**The departure date is local to the origin, never UTC.** See
[`@polaris/contracts`](../contracts/README.md#scheduledtime-carries-three-representations-at-once)
for why.

---

## Value scoring

```
value = 0.45·price + 0.25·duration + 0.20·stops + 0.10·benefits
```

Every sub-score and the weights that produced it are returned with the group, so the UI can
answer *"why is this ranked first?"* rather than presenting an opaque number.

- `price`, `duration`, `benefits` are min–max normalised **within the result set** — a score
  is a statement about this search, not an absolute rating.
- `stops` is absolute, `1 / (1 + stops)`. A non-stop is objectively a non-stop; normalising
  it would score the only non-stop among two-stop options identically to the only one-stop
  among non-stops.
- **Conditional benefits are excluded.** "₹500 off with HDFC cards" is not a saving for most
  users, and counting it would systematically over-rank whichever provider advertises the
  most card promotions.
- **Benefits with no monetary value are excluded** rather than assigned an invented number.

Weights are a parameter, not a constant — callers may pass any positive weighting and it is
normalised internally.

---

## Price spread

Measured across each provider's **cheapest** offer, not across all offers.

A group can hold several fares from one seller — IndiGo SAVER at ₹5,199 and FLEXI at ₹7,499.
Spanning those would advertise a ₹2,300 "saving" from switching provider that does not
exist; both cheap fares come from the same seller.

---

## Scripts

```bash
pnpm build
pnpm test        # 68 tests, ~20ms, no mocks
pnpm typecheck
```

Several tests are named after the wrong answer they prevent — *"measures spread per
provider, not across fare families"*, *"keys an after-midnight departure to its local date,
not the UTC date"* — because those are the regressions that would otherwise return silently.
