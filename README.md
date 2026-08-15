# Polaris

**Find your bearing on every fare.**

A flight comparison prototype that searches multiple providers, aggregates their offers, and,
critically, recognises when several providers are selling **the same marketed flight**. The
result is a list of flights with a price range attached, not a list of near-duplicate rows.

Built for the North Star Identity Full Stack Developer assessment.

![Searching DEL to BOM, expanding one flight to show its journey and every seller's fare, filtering to non-stop, sorting by price, and opening the breakdown behind a flight's value score](./docs/demo.gif)

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

**No API keys are required.** Every provider is read from that seller's own public search
through a headless browser, so there is nothing to sign up for. Chromium is needed once:

```bash
pnpm browsers:install   # usually already present
```

Optional extras:

| Variable       | Enables                                         |
| -------------- | ----------------------------------------------- |
| `MONGODB_URI`  | Search analytics (`docker compose up -d mongo`) |

MongoDB is optional by design: with it stopped, searches still work and analytics silently
no-ops.

---

## What it does

- **Searches three travel agencies**, each read from its own public search
- **Deduplicates across providers**: one row per marketed flight, with every seller's price
- **Ranks by transparent value score**, returning the sub-scores and weights that produced it
- **Filters and sorts** on price, duration, departure, stops, airline, provider and benefits
- **Degrades honestly**: a failed provider becomes a visible status, never a failed search
- **Proves itself**: every price links to the page that quoted it, so it can be checked

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
| [`packages/providers`](./packages/providers/README.md) | 6 adapters + resilience primitives           | 79 tests |

Each package has its own README covering what it does and why it is built that way.

Dependencies point inward only:

```
apps/web ─┐
          ├─→ contracts
apps/api ─┼─→ core ──→ contracts
          └─→ providers ─→ core ─→ contracts
```

Nothing points back. `core` imports no framework, no HTTP client and no provider, which is
why its 79 tests run in ~30 ms with no mocks, and why the browser can run the same
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

**Every price shown is a price that seller's own website is showing, and every offer links
back to the page that quoted it.** Nothing is generated. A seller that cannot be sourced
truthfully is absent rather than filled in, because an invented number under a real
company's name is the error this product exists to catch, and a disclaimer does not fix it.

| Provider   | Integration                  | Source                     | Named in the brief? |
| ---------- | ---------------------------- | -------------------------- | ------------------- |
| Cleartrip  | Provider's own web search     | cleartrip.com              | Yes                 |
| EaseMyTrip | Provider's own web search     | flight.easemytrip.com      | No, added           |
| Ixigo      | Provider's own web search     | ixigo.com                  | No, added           |

These are client-rendered sites, so the adapter captures the structured JSON their own
front ends receive rather than scraping rendered markup: named fields, typed numbers, and
no selectors to break.

**MakeMyTrip and Goibibo are absent.** Both refuse automated clients at their CDN edge,
terminating the connection after the TLS handshake before serving a page. That was measured,
not assumed: the identical URL renders normally in an ordinary desktop Chrome on the same
machine, so it is automation detection rather than a network or geographic block. Getting
past it would mean forging a TLS fingerprint, which is not done here. EaseMyTrip and Ixigo
were integrated in their place so the comparison rests on real agency fares.

No airline's own API was integrated, because none of the Indian carriers publish one.

Provenance is structural, not documentary: every offer carries its `integrationType`, a
replayed recording is downgraded so it can never claim to be current, and replayed prices
are excluded from cheapest and best-value ranking.

**The claim is checkable, not just stated:**

```bash
pnpm verify:prices --route DEL-BOM --date 2026-08-27
```

opens each seller's page, reads the fares a human would see, and fails on any disagreement.
It reads the rendered page rather than the underlying JSON, so it checks the whole pipeline
against what the seller actually shows a customer instead of comparing the code to itself.

Full matrix and measurements: [`docs/INTEGRATIONS.md`](./docs/INTEGRATIONS.md).

---

## Testing

```bash
pnpm test
```

266 tests across the workspace, plus a Playwright smoke test in a real browser:

```bash
pnpm test        # 266 unit, component and integration tests
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

Both demo commands drive the running application, so `pnpm dev` has to be up first.

| Command           | Does                                                 |
| ----------------- | ---------------------------------------------------- |
| `pnpm demo`       | Re-record `docs/demo.gif` from the walkthrough       |
| `pnpm demo:video` | Same walkthrough to `recordings/`: video plus stills |

`demo:video` writes full-resolution video and the distinct frames as PNGs, for slides or a
screen-share. The output is gitignored, the GIF is the version-controlled asset.
