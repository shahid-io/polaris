# @polaris/contracts

**The single source of truth for every shape that crosses a boundary in Polaris.**

Zod schemas describing search requests, flight offers, comparison groups, provider statuses
and API errors. Types are derived from the schemas with `z.infer`, so a type and its
validator cannot disagree — there is only one definition.

Consumed by `apps/api`, `apps/web`, `@polaris/core` and `@polaris/providers`. Depends on
nothing but Zod.

---

## Why this package exists

A request shape described twice — once as a validator, once as a type — will drift. The two
copies start identical, one gets a new field, and the mismatch surfaces as a runtime failure
in whichever layer was not updated.

Defining the schema once and deriving the type removes the possibility:

```ts
export const searchQuerySchema = z.object({/* … */});
export type SearchQuery = z.infer<typeof searchQuerySchema>;
```

This is also why the NestJS app deliberately does **not** use `class-validator` DTOs.
Decorated DTO classes would be a second description of the same contract, which is exactly
what this package exists to prevent.

---

## Usage

```ts
import { searchRequestSchema, type SearchResponse } from '@polaris/contracts';

// Server: validate at the edge, and get the parsed type for free.
const result = searchRequestSchema.safeParse(body);
if (!result.success) return badRequest(result.error.issues);

// Client: the same schema types the request it sends.
const response: SearchResponse = await post('/api/search', result.data);
```

---

## What's in here

| Module            | Describes                                                             |
| ----------------- | --------------------------------------------------------------------- |
| `common`          | IATA codes, ISO dates, money, scheduled times                         |
| `provider`        | Provider ids, integration types, per-provider call status             |
| `search-query`    | The search itself — route, date, time window, passengers, cabin       |
| `search-request`  | Request body: query plus optional filters and sort                    |
| `offer`           | Segments, itineraries, benefits, baggage, a normalised provider offer |
| `comparison`      | Comparison groups, price spreads, value scores                        |
| `search-response` | The response envelope, search metadata, API errors                    |

---

## Two modelling decisions worth knowing

### Money is integer minor units

```ts
{ amountMinor: 549_900, currency: 'INR' }   // ₹5,499.00
```

Prices are summed and compared constantly to produce cross-provider spreads. Floating point
would surface as off-by-one-paisa errors in a number the user reads. Comparing amounts in
different currencies throws rather than silently producing a meaningless figure.

### `ScheduledTime` carries three representations at once

```ts
{
  local:    '2026-08-20T00:45:00',   // wall clock at the airport
  utc:      '2026-08-19T19:15:00Z',  // note: the previous day
  timeZone: 'Asia/Kolkata',
}
```

This shape exists to prevent one specific bug. The canonical key that recognises the same
flight across providers includes the departure date, and that date **must** be local to the
origin. A 00:45 IST departure is 19:15 UTC the day before; providers differ in which they
report. Keying on UTC splits one flight into two groups whenever they disagree — silently,
and only on red-eyes, which is when nobody notices.

Carrying all three makes each consumer's choice explicit rather than accidental.

---

## Scripts

```bash
pnpm build       # compile to dist/
pnpm test        # schema validation and defaults
pnpm typecheck
```
