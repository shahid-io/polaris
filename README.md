# Polaris

**Find your bearing on every fare.**

A flight comparison prototype that searches multiple providers, aggregates their offers, and,
critically, recognises when several providers are selling **the same marketed flight**. The
result is a list of flights with a price range attached, not a list of near-duplicate rows.

Built for the North Star Identity Full Stack Developer assessment.

![Searching DEL to BOM, comparing one flight across three providers, filtering to non-stop and sorting by price](./docs/demo.gif)

---

## Quickstart

Requires Node 20+ and pnpm.

```bash
npm i -g pnpm

pnpm install
cp .env.example .env     # optional, the app runs fine with no credentials
pnpm build
pnpm dev                 # api :4000 · web :3000
```

Search from the command line:

```bash
curl -X POST http://localhost:4000/api/search \
  -H 'Content-Type: application/json' \
  -d '{"query":{"origin":"DEL","destination":"BOM","departureDate":"2026-08-20"}}'
```

**No API keys are required.** Providers without credentials report status `skipped` and the
search proceeds with the rest, the same partial-results path used when a provider fails.
Optional extras:

| Variable              | Enables                                         |
| --------------------- | ----------------------------------------------- |
| `SERPAPI_KEY`         | Live IndiGo and Air India Express fares         |
| `DUFFEL_ACCESS_TOKEN` | The Duffel sandbox adapter                      |
| `MONGODB_URI`         | Search analytics (`docker compose up -d mongo`) |

MongoDB is optional by design: with it stopped, searches still work and analytics silently
no-ops.

---

## What it does

- **Searches six providers concurrently**, with a ten-second budget each
- **Deduplicates across providers**: one row per marketed flight, with every seller's price
- **Ranks by transparent value score**, returning the sub-scores and weights that produced it
- **Filters and sorts** on price, duration, departure, stops, airline, provider and benefits
- **Degrades honestly**: a failed provider becomes a visible status, never a failed search

A real search, DEL→BOM:

```
24 offers from 3 providers  →  8 distinct flights

IX-1592  07:40   ₹4,724  score 0.97  2×  spread ₹384 (8.1%)
6E-2134  00:45   ₹4,614  score 0.94  3×  spread  ₹90 (2.0%)
6E-2456  13:05   ₹5,103  score 0.83  2×  spread ₹329 (6.4%)
…
6 flights sold by more than one provider
```

---

## Stack

Versions are the ones this was built and verified against, not floors.

|             |              |                                                           |
| ----------- | ------------ | --------------------------------------------------------- |
| **Runtime** | Node         | 20+ (developed on 26)                                     |
|             | pnpm         | 11.21                                                     |
|             | TypeScript   | 5.9                                                       |
| **API**     | NestJS       | 11.1                                                      |
|             | Mongoose     | 9.9 (optional, analytics only)                            |
| **Web**     | Next.js      | 16.3 (App Router)                                         |
|             | React        | 19.2                                                      |
|             | Tailwind CSS | 4.3 (CSS-first `@theme`, no config file)                  |
| **Shared**  | Zod          | 4.4 (schemas are the source of truth; types are inferred) |
| **Tooling** | Turborepo    | 2.10                                                      |
|             | Vitest       | 4.1                                                       |
|             | Playwright   | 1.62 (Chromium)                                           |
|             | ESLint       | 9.39 (held below 10, see `eslint.config.mjs`)             |
|             | Prettier     | 3.9                                                       |

---

## Layout

| Package                                                | Purpose                                      |          |
| ------------------------------------------------------ | -------------------------------------------- | -------- |
| [`apps/api`](./apps/api/README.md)                     | NestJS (fan-out, caching, analytics)         | 41 tests |
| [`apps/web`](./apps/web/README.md)                     | Next.js (search, results, comparison)        | 52 tests |
| [`packages/contracts`](./packages/contracts/README.md) | Zod schemas shared across the boundary       | 15 tests |
| [`packages/core`](./packages/core/README.md)           | group · score · filter · sort (pure, no I/O) | 79 tests |
| [`packages/providers`](./packages/providers/README.md) | 6 adapters + resilience primitives           | 76 tests |

Each package has its own README covering what it does and why it is built that way.

Dependencies point inward only:

```
apps/web ─┐
          ├─→ contracts
apps/api ─┼─→ core ──→ contracts
          └─→ providers ─→ core ─→ contracts
```

Nothing points back. `core` imports no framework, no HTTP client and no provider, which is
why its 79 tests run in ~20 ms with no mocks, and why the browser can run the same
comparison functions the server does.

---

## API

| Endpoint             | Purpose                                                          |
| -------------------- | ---------------------------------------------------------------- |
| `POST /api/search`   | Search, aggregate, compare                                       |
| `GET /api/providers` | Each provider's integration type, data provenance, circuit state |
| `GET /api/analytics` | Recorded search performance                                      |
| `GET /api/health`    | Liveness, provider mode, credential and analytics status         |

Every response carries `providerStatuses`, so partial results are visible rather than silent:

```json
{
  "meta": { "partial": true, "providersSucceeded": 2, "providersAttempted": 3 },
  "providerStatuses": [
    { "providerId": "makemytrip", "status": "ok", "latencyMs": 454, "offerCount": 11 },
    { "providerId": "goibibo", "status": "ok", "latencyMs": 396, "offerCount": 9 },
    {
      "providerId": "cleartrip",
      "status": "timeout",
      "latencyMs": 10003,
      "message": "Did not respond within 10000ms"
    }
  ]
}
```

To demonstrate that path deliberately:

```bash
SIMULATED_FAILURES=cleartrip:timeout pnpm dev
```

---

## Provider integrations

None of the five providers named in the brief expose a self-service API. Two airlines are
served with real live data through a legitimate third-party source; three OTAs whose partner
APIs are commercially gated use documented representative data.

| Provider                         | Integration                    | Source                 | Direct airline/OTA API? |
| -------------------------------- | ------------------------------ | ---------------------- | ----------------------- |
| IndiGo                           | Third-party live flight search | SerpApi Google Flights | No (none published)     |
| Air India Express                | Third-party live flight search | SerpApi Google Flights | No (none published)     |
| MakeMyTrip · Goibibo · Cleartrip | Representative data            | Generated              | No (commercially gated) |

To be unambiguous: **no airline's own API was integrated**, because none of them publish
one. IndiGo and Air India Express fares are real live Google Flights results obtained
through SerpApi, a commercial API operating under its own terms.

Provenance is never hidden, every offer carries its `integrationType` in the API response,
and simulated data is badged in the UI at the point a price is shown. Full matrix and reasoning: [`docs/INTEGRATIONS.md`](./docs/INTEGRATIONS.md).

---

## Testing

```bash
pnpm test
```

263 tests across the workspace, plus a Playwright smoke test in a real browser:

```bash
pnpm test        # 263 unit, component and integration tests
pnpm --filter @polaris/web test:e2e   # browser smoke test (needs both servers running)
```

Several tests are named after the wrong answer they prevent, _"measures spread per provider,
not across fare families"_, because those are the regressions that would otherwise return
silently.

---

## Assumptions

- **Indian domestic routes, priced in INR**, consistent with the five named providers
- **One-way search**: the brief specifies a single travel date; the contract extends to
  round-trip without a breaking change
- Money is integer minor units (paise); float arithmetic would surface as off-by-one-paisa
  errors in cross-provider spreads
- **No cookies, no third-party scripts, and no personal data in analytics**: searches are
  recorded by route and timing, never by who ran them, so there is nothing a consent banner
  would be asking about. Reasoning in [Limitations](./docs/LIMITATIONS.md#privacy)

---

## Documentation

|                                        |                                                              |
| -------------------------------------- | ------------------------------------------------------------ |
| [Architecture](./docs/ARCHITECTURE.md) | How it fits together and why each decision went that way     |
| [Integrations](./docs/INTEGRATIONS.md) | Provider matrix, what is real, what is not, and why          |
| [Limitations](./docs/LIMITATIONS.md)   | Known boundaries, privacy stance, roadmap                    |
| [AI usage](./docs/AI-USAGE.md)         | Where AI helped, where it was wrong, and how that was caught |

---

## Scripts

| Command          | Does                                         |
| ---------------- | -------------------------------------------- |
| `pnpm dev`       | Run api and web together                     |
| `pnpm build`     | Build all packages and apps                  |
| `pnpm test`      | Run all tests                                |
| `pnpm typecheck` | Type-check everything                        |
| `pnpm lint`      | Lint everything (`pnpm lint:fix` to autofix) |
| `pnpm format`    | Format with Prettier                         |
