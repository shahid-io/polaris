# Flight Comparison Prototype — Build Plan

**Assessment:** North Star Identity — Full Stack Developer
**Demo:** Thursday, 13 August 2026
**Build window:** Sun 9 Aug (evening) → Wed 12 Aug. No slack.

---

## 1. What is actually being graded

The brief lists ten evaluation criteria. Three of them are where submissions separate,
and all three are easy to underweight:

**a) "Ability to work with different integration options"** — scored *separately* from
"actual provider integration". The brief's section 4 pre-authorises representative data
where integration is impossible, and demands you document what was and wasn't integrated
and why. The assessors know MMT/Cleartrip/Goibibo are not integrable. They are testing
whether you discover that, document it rigorously, and design an abstraction that handles
heterogeneous integration mechanisms behind one contract.

**b) "Handle the same flight available through multiple providers"** — the intellectual
core. IndiGo 6E-2134 DEL→BOM sold by MakeMyTrip, Goibibo and IndiGo direct is **one flight
with three offers**. The comparison value is the price spread across those offers. A flat
list of 40 rows fails this requirement while appearing to satisfy the brief.

**c) "Handle unavailable providers / partial results"** — a resilience story that must be
*visible in the UI*, not just handled in a try/catch. Partial success surfaced honestly
("4 of 5 providers responded; Cleartrip timed out") beats a silently shorter list.

Also note: **AI usage is explicitly graded** (section 5 + evaluation list). Most candidates
will hand-wave this. A real `docs/AI-USAGE.md` is cheap and differentiating.

---

## 2. Integration reality (verified 9 Aug 2026)

| Provider | Status | Decision |
|---|---|---|
| MakeMyTrip | B2B Partner API, commercially gated (signed agreement + account manager). Affiliate programs are link/commission only — no data feed. | Representative adapter |
| Goibibo | Same parent company as MMT; same gate. | Representative adapter |
| Cleartrip | REST partner API, commercially gated. | Representative adapter |
| IndiGo | No public developer API. Navitaire PSS, partner-only access. | Live via SerpApi |
| Air India Express | No public developer API. | Live via SerpApi |

**Critical finding:** Amadeus Self-Service — the default free real-flight-data source, and
what most prior knowledge points to — **was decommissioned 17 July 2026**. Registrations
paused, portal shut for existing users. Any plan built on it is dead on arrival.

**Live sources selected:**
- **SerpApi Google Flights** — 250 free queries/month, real live data, real Indian carriers,
  per-booking-option pricing. Primary real integration.
- **Duffel** — free signup; test mode returns synthetic "Duffel Airways" data only. Used as a
  *second vendor contract shape* to prove the adapter abstraction generalises.

**Explicitly rejected:** scraping MMT/Cleartrip/Goibibo. Breaches ToS, heavy bot protection,
and can break live on stage. The brief's phrase "legitimate integration options" reads as a
nudge away from it. Architecture stays scrape-*ready*; no scraper ships.

---

## 3. Stack & structure

TypeScript end-to-end, pnpm workspaces + Turborepo.

```
apps/
  web/          Next.js 15 App Router · Tailwind · shadcn/ui
  api/          NestJS — search orchestration
packages/
  contracts/    Zod schemas — single source of truth, shared web ⇄ api
  core/         normalize · canonical key · group · score · filter · sort  (PURE, no I/O)
  providers/    adapter registry + 5 adapters + resilient HTTP client
```

**Why a separate API service rather than Next.js route handlers:** it's a Full Stack
assessment; a real service boundary demonstrates backend depth, tests independently, and
makes the provider fan-out legible in the walkthrough.

**Why NestJS:** familiarity first — you must defend every line on Thursday, and fighting an
unfamiliar framework under a four-day clock is the wrong risk. But it is also genuinely the
better fit here: Nest's DI container maps directly onto the provider-adapter pattern (see §4),
dynamic modules let `PROVIDER_MODE` decide which adapters are registered, and
`Test.createTestingModule` makes orchestrator tests clean by overriding provider tokens with
fakes. The framework earns its keep rather than just costing boilerplate.

**Why `core/` stays pure and framework-free:** every interesting rule (dedup, scoring,
grouping) becomes trivially unit-testable with zero mocking and zero Nest bootstrapping.
NestJS wraps it; it never leaks into it. This is where coverage should be near-total.

**Frontend — Next.js over Angular:** you know both, but under this clock Tailwind + shadcn/ui
turns the UI into component *assembly* rather than authorship, and Wednesday is the tightest
day. Say the word if you're materially faster in Angular and I'll re-shape Phase 3.

---

## 4. The adapter contract

```ts
type IntegrationType = 'live-api' | 'sandbox-api' | 'affiliate-api' | 'representative';

interface FlightProvider {
  id: ProviderId;
  displayName: string;
  integrationType: IntegrationType;   // surfaced in UI + docs — honesty by construction
  search(query: SearchQuery, ctx: ProviderContext): Promise<ProviderResult>;
  health(): Promise<HealthStatus>;
}
```

Adapters may throw freely — the orchestrator owns timeout, isolation and circuit breaking.
Every adapter runs against **the same contract test suite**; that suite passing across four
different integration mechanisms *is* the evidence for evaluation criterion (a).

### DI registry (NestJS)

Each adapter is an `@Injectable()`; all are collected under one multi-provider token, so the
orchestrator depends on the *abstraction* and never names a concrete provider:

```ts
export const FLIGHT_PROVIDERS = Symbol('FLIGHT_PROVIDERS');

@Module({})
export class ProvidersModule {
  static forRoot(mode: ProviderMode): DynamicModule {
    return {
      module: ProvidersModule,
      providers: [
        SerpApiProvider, DuffelProvider,
        MakeMyTripProvider, GoibiboProvider, CleartripProvider,
        {
          provide: FLIGHT_PROVIDERS,
          inject: [SerpApiProvider, DuffelProvider, /* … */],
          useFactory: (...all: FlightProvider[]) => selectForMode(all, mode),
        },
      ],
      exports: [FLIGHT_PROVIDERS],
    };
  }
}

// orchestrator
constructor(@Inject(FLIGHT_PROVIDERS) private readonly providers: FlightProvider[]) {}
```

Two payoffs worth naming in the demo: adding a sixth provider touches exactly one array, and
`PROVIDER_MODE=fixture` swaps every live adapter for a recorded-fixture one with no change to
the orchestrator. Tests override `FLIGHT_PROVIDERS` with deliberately failing fakes to drive
the partial-results and circuit-breaker paths.

---

## 5. Aggregation pipeline — the core

```
SearchQuery
  → fan-out            Promise.allSettled · per-provider AbortController timeout · circuit breaker
  → normalize          each adapter maps its native shape → NormalizedOffer
  → validate           Zod; drop malformed, count as a provider warning (never fail the search)
  → canonical key      {carrierIata}-{flightNo}-{depDateLocalToOrigin}-{origin}-{dest}
                       multi-leg: stable hash of the ordered segment list
  → group              ComparisonGroup { key, itinerary, offers[], cheapest, priceSpread }
  → score              transparent weighted value score, breakdown retained
  → filter → sort → paginate
  → SearchResponse     { groups, providerStatuses[], meta }
```

### Dedup edge cases (raise these in the demo — they show depth)
- **Timezone:** departure date must be resolved in the *origin's local time*. Use UTC and the
  same flight groups inconsistently across providers. A real bug, deliberately handled.
- **Fare families:** IndiGo Saver vs Flexi on the same flight are *different offers within the
  same group*. The group displays the range. Correct by design.
- **Codeshare:** same physical flight, different marketing carrier/number. Matched via
  operating carrier where providers expose it; otherwise kept separate and **documented as a
  known limitation**. Stating this honestly scores better than pretending it's solved.

### Value score
Min-max normalise each sub-score within the result set, then weight:

```
value = w_price·price + w_duration·duration + w_stops·stops + w_benefits·benefits
```

Return the **breakdown** in the API response so the UI can answer "why did this rank #1?".
Directly serves the brief's "compare … overall value" and makes a strong demo beat.

---

## 6. Resilience

- Per-provider timeout (~6s) via `AbortController`
- `Promise.allSettled` — one provider can never kill a search
- Circuit breaker per provider: open after N consecutive failures, half-open probe
- Retry with jittered backoff on 5xx/network **only** — never on 4xx
- Response cache keyed on normalised query, behind a `CacheStore` interface (in-memory LRU now,
  Redis a one-line swap). Also protects the SerpApi monthly quota.
- Every response carries:
  ```ts
  providerStatuses: { id, status: 'ok'|'timeout'|'error'|'circuit_open', latencyMs, offerCount, message? }[]
  ```
  The UI renders this. Partial results are made visible, never hidden.

### Demo safety (non-negotiable — live walkthrough)
`PROVIDER_MODE=live | fixture | hybrid`. Record real SerpApi responses to fixtures on **day 0**.
If network or quota fails on stage, flip to `fixture` and the app behaves identically. This is
sound engineering, not a hack: it's also what makes the test suite deterministic.

---

## 7. Phases

### Phase 0 — Sun 9 Aug, evening (~2h) · DE-RISK
- pnpm workspace + Turborepo skeleton, TS config, lint
- `nest new apps/api` + `create-next-app apps/web` — get both bootstrapping cleanly inside the
  workspace tonight, so Tuesday and Wednesday are feature work, not tooling debt
- `packages/contracts` — Zod: `SearchQuery`, `NormalizedOffer`, `ComparisonGroup`,
  `ProviderStatus`, `SearchResponse`
- **Create SerpApi account, obtain key, capture 3–5 real responses to `fixtures/`**

> Doing the signup and fixture capture tonight removes the single biggest external risk.
> Monorepo + NestJS wiring is the second — Nest's default tsconfig/build setup needs a small
> amount of coaxing to consume workspace packages, and that is much better discovered tonight
> than on Tuesday morning.

### Phase 1 — Mon 10 Aug, day + night · DOMAIN + PROVIDERS
**Day**
- `packages/core`: normalization, canonical key, grouping, scoring, filters, sorters —
  fully unit-tested, zero I/O

**Night**
- `packages/providers`: adapter interface, resilient HTTP client, SerpApi adapter (live),
  Duffel sandbox adapter, representative adapters for MMT/Goibibo/Cleartrip (seeded from real
  schedules, realistic per-provider price deltas, injectable latency + failure)
- Shared adapter contract test suite — all five adapters, one suite

### Phase 2 — Tue 11 Aug, day + night · API (NestJS)
**Day**
- `SearchModule` — controller + `SearchOrchestrator` service (fan-out, timeouts, circuit
  breaker, cache, provider status assembly)
- `ProvidersModule.forRoot(mode)` — DI registry per §4
- `CacheModule` (`CacheStore` interface, in-memory LRU impl), `HealthModule`
- `ZodValidationPipe` wrapping `packages/contracts` — one schema validates request *and* types
  the handler, no DTO duplication
- `AllExceptionsFilter` for a consistent error envelope; logging/timing interceptor
- `POST /api/search`, `GET /api/providers`, `GET /api/health`
- Integration tests via `Test.createTestingModule`, overriding `FLIGHT_PROVIDERS` with fakes:
  partial failure, total failure, zero results, malformed provider data, circuit-open path

> Nest's class-validator DTO convention is deliberately skipped — the Zod contracts package is
> the single source of truth shared with the frontend, and duplicating it as DTOs would defeat
> that. Be ready to explain this choice; it's the kind of deviation they may probe.

**Night** — pull Phase 3 forward
- Next.js app shell, API client typed off `packages/contracts`, search form, raw results list

### Phase 3 — Wed 12 Aug, day · WEB
- Search form: origin/destination (local airport dataset — no external dependency), date,
  time-range preference
- Grouped result cards: one flight, provider offers beneath, cheapest highlighted,
  spread badge ("₹4,120 spread across 3 providers")
- Provider status strip; simulated-data badge on representative providers
- Sort: price · duration · departure · value. Filter: stops, airlines, providers, time window,
  price range, max duration
- Compare tray: up to 3 flights side by side
- States: loading skeletons · empty · error · partial

### Phase 4 — Wed 12 Aug, afternoon → 18:00 · SHIP
- Playwright e2e: search → filter → compare, plus a forced provider-failure path
- Docker compose one-command run
- All five docs (§8)
- Stretch features from §10, in listed priority order, only as capacity allows

### 🔒 FEATURE FREEZE — start of the evening before the demo
Not a deadline, a discipline. Once rehearsal starts, no new features. Anything unfinished moves
to the roadmap section of `LIMITATIONS.md`, where it reads as considered scope rather than a
gap. If the build finishes early, the freeze simply starts early.

### Phase 5 — Wed 12 Aug, night · REHEARSE
- Full run: `git clone` → documented quickstart → working app, on a clean checkout.
  Catches the "works on my machine" failure that ruins demos.
- Seed fixtures for the exact routes you will demo; verify `PROVIDER_MODE=fixture` is a
  clean instant fallback
- Rehearse the four-beat narrative (§9) out loud, timed
- Prepare the forced-failure trigger and practise it
- Sleep. A rested walkthrough beats one more feature.

### Thu 13 Aug — demo.

**Cut list, in this order:** stretch features → compare tray → Docker (plain `pnpm dev` is
fine) → airport autocomplete (a select of ~40 Indian airports works).
**Never cut:** provider status UI, grouping/dedup, the five docs, fixture fallback, rehearsal.

---

## 8. Docs (three of five deliverable bullets are documentation)

- `README.md` — what it is, one-command quickstart, architecture at a glance
- `docs/INTEGRATIONS.md` — the provider matrix, structured to section 4's four bullets verbatim:
  integrated / mechanism used / not integrated + reason / representative data used
- `docs/ARCHITECTURE.md` — pipeline diagram, key decisions and trade-offs
- `docs/AI-USAGE.md` — how AI was used across research, development, tests, docs (graded)
- `docs/LIMITATIONS.md` — codeshare, timezone assumptions, quota ceiling, no booking flow,
  representative-data caveats

---

## 9. Demo narrative (rehearse Wed evening)

The email names four things they will ask. Prepare each as a ~2 minute beat:

1. **Integrations completed** — walk the provider matrix. Lead with the Amadeus decommission
   finding and how you re-planned around it. Show the adapter contract test suite passing across
   four different integration mechanisms.
2. **Key implementation decisions** — pure framework-free domain core; the DI-based adapter
   registry (adding a provider touches one array); canonical-key grouping; transparent value
   score with visible breakdown; Zod contracts shared across the service boundary instead of
   duplicated DTOs.
3. **Challenges** — Amadeus shutdown; OTAs commercially gated; timezone bug in canonical keys;
   codeshare ambiguity.
4. **AI usage** — research into integration options (which caught the Amadeus shutdown),
   adapter scaffolding, test generation, docs. Own every line.

Have a forced-failure scenario ready to trigger live: kill one provider and show the partial
results UI. It is the single most persuasive 20 seconds in the demo.

---

## 10. Stretch features — strict priority order

The brief asks for a prototype; extras only count if the core is airtight. Work down this list
and stop at the freeze. Each is chosen because it maps onto a *stated evaluation criterion*
rather than being decoration.

1. **Provider health dashboard** (`/providers` page) — integration type, live/simulated badge,
   latency, circuit state, last error per provider. Makes "ability to work with different
   integration options" *visible* instead of buried in a README. Highest value on this list.
2. **Score breakdown popover** — "why did this rank #1?" showing the weighted sub-scores.
   Serves "compare … overall value" directly, and demos beautifully.
3. **Shareable search URLs** — state in query params, deep-linkable and reloadable. Cheap;
   reads as product sense.
4. **OpenAPI + Swagger UI generated from the Zod contracts** (`zod-to-openapi`) — resolves the
   no-DTO trade-off elegantly and gives you a live API doc to show. Scores on documentation.
5. **CI pipeline** (GitHub Actions: lint · test · build) — proves the test suite genuinely
   passes rather than merely existing. Cheap, strong quality signal.
6. **Structured logging + request IDs + per-provider latency metrics** — feeds the health
   dashboard; scores on error handling.
7. **Rate limiting** (`@nestjs/throttler`) **+ Redis-backed cache** swapped in behind the
   existing `CacheStore` interface — proves the abstraction was real, not decorative.
8. **Accessibility pass** — keyboard navigation, focus management, ARIA on the results list.
   Quiet quality signal; a11y is where most prototypes are visibly weak.
9. **Flexible dates (±3 days) price matrix** — genuinely useful, but multiplies provider calls.
   Representative providers only, never against the SerpApi quota. Last for a reason.

**Deferred to Phase 6 (post-assessment), not abandoned** — booking/payment flow, user accounts,
price-alert jobs, multi-currency. None appear in the brief and each would consume a day, so
they stay out of the assessment build. They are documented in `LIMITATIONS.md` as a **roadmap
with a sketched approach for each**, which reads as forward-thinking rather than as gaps — and
gives you a ready answer if they ask "how would you extend this?". We pick them up after the
required scope is complete.

---

## 11. Working agreement (decided)

- **Git** — private GitHub repo. `develop` is the working branch; all phase commits land there.
  At the end of each phase, `develop` → `main` via merge, giving `main` a clean
  one-commit-per-phase history that reads well to a reviewer.
- **Branch per phase** — `phase/0-scaffold`, `phase/1-core` … merged into `develop`. Costs
  nothing and makes the build story legible if they browse the repo.
- **Demo** — local, screen-shared in the meeting. Deployment is explicitly **out of scope** for
  the assessment; revisit later if wanted.
- **Pace** — the work is well understood and the scope is fixed; build it properly rather than
  racing the clock. The only timing discipline retained: **stop adding features the evening
  before the demo and reserve that block for rehearsal** (§Phase 5). Not deadline pressure —
  just that an unrehearsed walkthrough wastes good work.
- **Market/currency** — Indian domestic routes priced in INR, consistent with the five named
  providers. Stated in the README as an explicit assumption.

### Still to confirm with North Star (non-blocking)
- **Delivery format** — GitHub repo link vs zip. *Proceeding with: private repo + zip fallback.*
- **Demo time on Thursday** — affects how Wednesday is split, nothing else.
