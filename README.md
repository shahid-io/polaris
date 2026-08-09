# Polaris

**Find your bearing on every fare.**

A flight comparison prototype that searches multiple providers, aggregates their offers, and —
critically — recognises when several providers are selling *the same physical flight*, so you
compare one flight's price across providers rather than scrolling a list of near-duplicates.

Built for the North Star Identity Full Stack Developer assessment.

> **Status: Phase 0 (scaffold) complete.** Search functionality lands in Phases 1–3.
> See [`PLAN.md`](./PLAN.md) for the full build plan.

---

## Quickstart

```bash
# Requires Node 20+ and pnpm
npm i -g pnpm

pnpm install
cp .env.example .env        # optional: add SERPAPI_KEY for live data
pnpm build
pnpm dev                    # api :4000 · web :3000
```

Verify the API:

```bash
curl http://localhost:4000/api/health
```

The app runs without any API keys — providers without credentials report a `skipped` status
and the search continues with the rest. This is the same partial-results path used when a
provider fails in production.

---

## Layout

```
apps/
  api/          NestJS — provider fan-out, aggregation, comparison
  web/          Next.js — search, results, comparison UI
packages/
  contracts/    Zod schemas — single source of truth shared across the service boundary
  core/         normalize · canonical key · group · score · filter · sort  (pure, no I/O)
  providers/    provider adapters + resilient HTTP client
fixtures/       recorded provider responses — deterministic tests, offline demos
docs/           architecture, integrations, limitations, AI usage
```

### Why this shape

**`packages/core` is pure and framework-free.** Every rule worth testing — deduplication,
value scoring, grouping — is a function of its inputs with no I/O, so it's tested without
mocks or a running Nest context. NestJS wraps this logic; it never leaks into it.

**`packages/contracts` is Zod-first.** Schemas are defined once and types derived with
`z.infer`, so a contract cannot drift from its validator. This is why the API deliberately
does *not* use class-validator DTOs — duplicating these as decorated classes would reintroduce
exactly the drift the package exists to prevent.

**Providers are adapters behind one interface.** Each implements the same contract while using
a different integration mechanism — live API, sandbox API, representative data. Adding a
provider touches one array.

---

## Assumptions

- **Indian domestic routes, priced in INR**, consistent with the five providers in the brief.
- **One-way search.** The brief specifies a single travel date; the contract extends to
  round-trip without a breaking change.
- Money is stored as integer minor units (paise) — float arithmetic would surface as
  off-by-one-paisa errors in cross-provider price spreads.

## Provider integration

Three of the five named providers have no obtainable API for a prototype, and the one obvious
free source of real flight data was decommissioned weeks before this build started. The full
matrix — what is live, what is representative, and why — is documented in
[`docs/INTEGRATIONS.md`](./docs/INTEGRATIONS.md) *(written in Phase 4)*.

Data provenance is not buried in documentation: every offer carries its `integrationType`, and
simulated data is badged as such in the UI.

## Scripts

| Command | Does |
|---|---|
| `pnpm dev` | Run api and web together |
| `pnpm build` | Build all packages and apps |
| `pnpm test` | Run all tests |
| `pnpm typecheck` | Type-check everything |
| `pnpm format` | Format with Prettier |
