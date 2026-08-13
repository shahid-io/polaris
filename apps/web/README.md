# @polaris/web

**Next.js interface for searching and comparing fares.**

Renders one row per marketed flight with every seller's price inside it, rather than one row
per offer. Runs on `:3000` and talks to [`@polaris/api`](../api/README.md) on `:4000`.

---

## Layout

```
src/
  app/            App Router: page, error boundaries, 404, loading
  components/
    ui/           primitives (kebab-case, shadcn convention)
    search/       search form and airport picker (PascalCase)
    results/      cards, filters, provider status
  hooks/          useAirports, useFlightSearch
  lib/            utils.ts (formatters) · fetch.ts (typed API client)
  test/           setup and builders
e2e/              Playwright smoke test
```

There is deliberately no `src/schemas/`, `src/actions/` or `src/models/`. Those belong to the
Next-as-backend pattern; Polaris has a separate NestJS service, so schemas live in
`@polaris/contracts` and are shared by both sides, one definition, no drift.

---

## Conventions

- `"use client"` on any client component; `@/` alias throughout, no relative climbing
- `cn()` = `twMerge(clsx(…))` on every `className` surface, so a caller's class genuinely
  overrides the component default rather than both landing in the list
- `cva` with `VariantProps` for variants; Radix `Slot` for `asChild`
- Named function declarations, not arrow consts
- `export type XProps = React.ComponentProps<typeof X>` rather than a hand-written interface
- Semantic Tailwind tokens (`bg-primary`, `text-muted-foreground`), never raw palette values
- Components never call `fetch`; `lib/fetch.ts` normalises every outcome to one shape

---

## Where the work happens

### `FlightGroupCard`

The component the product exists for. A naive results list renders one row per offer, so six
providers selling one flight produce six near-identical rows and the user does the comparing
themselves. Here the flight is the row and the sellers sit inside it.

Offers are reduced to each provider's cheapest, so one seller never appears three times at
three fare prices, the same basis the price spread is measured on, so the list and the
headline saving cannot disagree.

### `ProviderStatusBanner`

Makes the resilience work visible. Handling a failed provider silently is not enough: a user
comparing prices needs to know the cheapest seller may simply not have been asked, so the
banner names what failed, why, and says a cheaper fare may exist.

### `ScoreBreakdown`

Answers _"who decided these weights?"_ before it is asked, every sub-score, its weight, and
the fact that scores are relative to the **full** result set rather than the filtered view,
so filtering never changes a flight's score.

### Filtering and sorting run client-side

Against the already-fetched result, using `filterGroups` and `sortGroups` from
`@polaris/core`, the same functions the API runs. Reimplementing them here would give the
UI and the API two definitions of "cheapest first" that agree today and drift the first time
either gains a tie-breaker.

Client-side because it is instant, and because it spends neither a provider fan-out nor a
metered SerpApi credit per checkbox.

---

## A formatter worth knowing about

`formatLocalTime` slices the string rather than constructing a `Date`. The value is
offset-less wall-clock time at the departure airport; parsing it would reinterpret it in the
**viewer's** timezone, so someone in London would see every Indian departure shifted by five
and a half hours. This is the browser-side twin of the canonical-key timezone rule in
`@polaris/core`.

---

## Testing

```bash
pnpm test        # 52 component and integration tests (jsdom)
pnpm test:e2e    # Playwright smoke test, needs both servers running
```

The component suite covers behaviour. The single Playwright test answers what jsdom
structurally cannot: does this render and work in a real browser? Hydration mismatches, a
stylesheet that never loads and client-only crashes all pass a jsdom test and break in front
of a user, so it asserts zero console errors.

Radix and cmdk need `ResizeObserver`, `matchMedia`, `scrollIntoView` and pointer capture,
none of which jsdom implements. They are stubbed once in `src/test/setup.ts` so a missing
environment feature cannot masquerade as a component bug.

---

## Regenerating the demo GIF

```bash
pnpm dev      # both servers must be running, the capture drives the real app
pnpm demo     # from the repo root
```

Playwright walks the flow and screenshots each state, `sharp` decodes the frames and
`gifenc` writes `docs/demo.gif`. No ffmpeg: needing a system install to rebuild a README
asset would mean it could not be regenerated on a machine that lacks one.

---

## Configuration

| Variable                   | Default                 |
| -------------------------- | ----------------------- |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:4000` |

---

## Scripts

```bash
pnpm dev         # next dev --turbopack
pnpm build
pnpm start
pnpm typecheck
```
