import { searchQuerySchema, TIME_RANGE_PRESETS } from '@polaris/contracts';

/**
 * Phase 0 placeholder. The real search UI lands in Phase 3.
 *
 * It parses a query with the shared schema on purpose: this page failing to build is the
 * signal that the workspace wiring between @polaris/contracts and Next.js has broken.
 */
export default function HomePage() {
  const sample = searchQuerySchema.parse({
    origin: 'DEL',
    destination: 'BOM',
    departureDate: '2026-08-20',
    timeRange: TIME_RANGE_PRESETS.morning,
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-4xl font-semibold tracking-tight">Polaris</h1>
        <p className="mt-2 text-slate-600">Find your bearing on every fare.</p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <p className="text-sm font-medium text-slate-500">
          Scaffold check — parsed by <code>@polaris/contracts</code>
        </p>
        <pre className="mt-3 overflow-x-auto rounded bg-slate-900 p-4 text-xs text-slate-100">
          {JSON.stringify(sample, null, 2)}
        </pre>
      </div>

      <p className="text-sm text-slate-500">Phase 0 complete. Search UI arrives in Phase 3.</p>
    </main>
  );
}
