'use client';

import { useMemo, useState } from 'react';
import { AirportPicker } from '@/components/search/AirportPicker';
import { useAirports } from '@/hooks/useAirports';

/**
 * Phase 3 in progress — the airport picker, wired to the live airports endpoint.
 * The full search form, results and comparison view follow.
 */
export default function HomePage() {
  const { airports, routes, isLoading, error } = useAirports();
  const [origin, setOrigin] = useState<string>();
  const [destination, setDestination] = useState<string>();

  const reachable = useMemo(
    () => (origin ? (routes[origin] ?? []) : undefined),
    [origin, routes],
  );

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-8 px-6 py-16">
      <div>
        <h1 className="text-4xl font-semibold tracking-tight">Polaris</h1>
        <p className="mt-2 text-muted-foreground">Find your bearing on every fare.</p>
      </div>

      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm">
          {error}
        </p>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">Loading airports…</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <AirportPicker
            label="From"
            value={origin}
            airports={airports}
            excludeCode={destination}
            onChange={(code) => {
              setOrigin(code);
              // Clear a destination the new origin cannot reach, rather than leaving an
              // invalid pair selected and failing on submit.
              if (destination && !(routes[code] ?? []).includes(destination)) {
                setDestination(undefined);
              }
            }}
          />
          <AirportPicker
            label="To"
            value={destination}
            airports={airports}
            selectableCodes={reachable}
            excludeCode={origin}
            disabled={!origin}
            onChange={setDestination}
          />
        </div>
      )}

      <p className="text-sm text-muted-foreground">
        {airports.length} airports · {Object.values(routes).flat().length} routes
      </p>
    </main>
  );
}
