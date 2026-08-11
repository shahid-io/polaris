# How AI was used

The brief invites AI use and asks the candidate to describe it. This is an honest account,
including the places where the AI was wrong and how that was caught.

**AI was used extensively** — for research, implementation, test authoring and
documentation. Architectural decisions were directed and reviewed rather than accepted, and
the reasoning behind every decision recorded in [`ARCHITECTURE.md`](./ARCHITECTURE.md) is
reasoning I can defend.

---

## Where it was genuinely valuable

### 1. Research — and one finding that changed the whole plan

The obvious first move for real flight data is **Amadeus Self-Service**: free tier, real
fares, well documented. It is what almost any prior knowledge points to.

Verifying rather than assuming turned up that **Amadeus Self-Service was decommissioned on
17 July 2026** — three weeks before this build started. Registrations paused, portal shut for
existing users.

This is the single most useful thing AI did on this project, and it is worth being precise
about why: the model's _training knowledge_ said Amadeus was the answer. A live search said
otherwise. Had the plan been written from memory, the whole integration layer would have been
built against a dead dependency and the problem discovered mid-implementation, with days
already spent.

The same check was applied to every other integration option — Duffel's test mode turns out
to be synthetic, Travelpayouts is affiliate-model — which produced the matrix in
[`INTEGRATIONS.md`](./INTEGRATIONS.md) rather than a guess.

### 2. Verifying claims instead of accepting them

The same discipline caught several things that would otherwise have been wrong:

- **"MongoDB with Drizzle, TypeORM or Sequelize."** Checking the packages showed Drizzle and
  Sequelize are SQL-only and cannot target MongoDB at all. TypeORM can, but MongoDB is its
  least-maintained driver. That reframed the decision and led to Mongoose with
  `@nestjs/mongoose`.
- **Dependency versions.** An audit against what is actually published found Vitest, Next,
  Tailwind and Zod all majors behind. Upgrading Next and Tailwind _before_ the UI existed
  cost fifteen minutes; after Phase 3 it would have meant a rewrite.
- **TypeScript 7.** Latest is not automatically correct. TS 7 is the native Go port; NestJS 11
  officially supports 5.x and `emitDecoratorMetadata` is the surface most likely to break, so
  the project deliberately stays on 5.9.

### 3. Test authoring

AI is good at enumerating cases a person skims past — empty inputs, boundary values, an
inverted time range, a provider throwing a non-`Error` value. Several tests are named after
the wrong answer they prevent rather than the function they cover, which is a habit worth
keeping.

### 4. Volume

Roughly 5,000 lines of implementation, tests and documentation in a few days. The
representative flight timetable, the JSDoc, and these documents would each have consumed
hours to write by hand.

---

## Where it was wrong, and how that was caught

This section matters more than the one above.

### A concurrency bug in the timeout primitive

The first `withTimeout` awaited the operation directly while aborting its signal. That works
only if the operation _honours_ the signal. An adapter that ignored it — a third-party client
that does not accept one, or simply a mistake — would never settle, and the timeout meant to
contain one slow provider would hang the entire search instead.

Writing a test with an operation that deliberately ignores its signal made this immediate: the
suite hung, then failed. The fix passes the signal in _and_ races a rejecting deadline, so the
signal stops the work and the race bounds the wait.

**The lesson:** the code looked correct and read correctly. Only an adversarial test found it.

### Floating-point drift in score weights

Weight normalisation divided weights that already summed to 1, turning `0.45` into
`0.45000000000000007`. Since the applied weights are echoed to the client so the UI can
explain a ranking, the response no longer matched what the caller passed in. Caught by an
equality assertion, not by review.

### A silent process

The API was created with `bufferLogs: true` but `flushLogs()` was never called, so it ran
completely silently for several phases — including startup errors. This actively obstructed
diagnosis when the MongoDB path was being tested, and it was only noticed because a log file
that should have had content was empty.

### Tests that asserted nothing

Three provider tests guarded their assertions behind `if (flight)`, so they passed silently
whenever inventory coverage happened to exclude that flight. A test that can quietly no-op is
worse than no test — it reports safety it does not provide. Found on review of the AI's own
output and rewritten to assert unconditionally.

### A misdiagnosis

At one point the API was reported as having crashed when MongoDB was unavailable. It had not —
a stale process was holding the port and the test harness misread the empty response.
The conclusion was wrong and had to be retracted. **AI output stated confidently is still
worth checking.**

### A reversed recommendation

`nestjs-zod` was recommended, then rejected on inspection: `createZodDto` expects a
`ZodObject`, and several schemas end in `.refine(...)`, producing a wrapped effect type the
library does not accept. A twenty-line pipe replaced it.

---

## What I own

Every decision in [`ARCHITECTURE.md`](./ARCHITECTURE.md) is one I can explain and defend:
why the canonical key uses origin-local dates, why price spread is measured per provider
rather than per offer, why scoring runs before filtering, why failure is normalised at the
provider boundary rather than at the fan-out, why money is integer minor units, and why
analytics stores no IP address.

The most useful working pattern was not "generate code" but **"make the reasoning explicit,
then check it"** — which is why the comments in this codebase explain _why_ a line exists
rather than restating what it does, and why several tests are named after the bug they
prevent. Those comments are the audit trail. If a decision could not be justified in writing,
it was reconsidered.
