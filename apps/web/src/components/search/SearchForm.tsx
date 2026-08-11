'use client';

import { SearchIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { TIME_RANGE_PRESETS, type SearchQueryInput } from '@polaris/contracts';

import { AirportPicker } from '@/components/search/AirportPicker';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import type { AirportSummary } from '@/lib/fetch';

/** Preset labels for the departure-window control. */
const TIME_PRESETS = [
  { value: 'any', label: 'Any time' },
  { value: 'early_morning', label: 'Early morning · 00:00–06:00' },
  { value: 'morning', label: 'Morning · 06:00–12:00' },
  { value: 'afternoon', label: 'Afternoon · 12:00–18:00' },
  { value: 'evening', label: 'Evening · 18:00–24:00' },
] as const;

type TimePreset = (typeof TIME_PRESETS)[number]['value'];

export interface SearchFormProps {
  airports: readonly AirportSummary[];
  /** Destinations reachable from each origin, so the form cannot build a dead end. */
  routes: Record<string, string[]>;
  isSearching: boolean;
  onSearch: (query: SearchQueryInput) => void;
}

/**
 * The search form — the brief's four inputs: source, destination, date and time range.
 *
 * Validation is structural rather than a submit-time error message: the destination picker
 * only offers airports the origin actually reaches, and the submit button stays disabled
 * until the query is complete. A user cannot construct an invalid search, so there is
 * nothing to reject.
 */
export function SearchForm({ airports, routes, isSearching, onSearch }: SearchFormProps) {
  const [origin, setOrigin] = useState<string>();
  const [destination, setDestination] = useState<string>();
  const [departureDate, setDepartureDate] = useState(defaultDate);
  const [timePreset, setTimePreset] = useState<TimePreset>('any');

  const reachable = useMemo(
    () => (origin ? (routes[origin] ?? []) : undefined),
    [origin, routes],
  );

  const canSearch = Boolean(origin && destination && departureDate) && !isSearching;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!origin || !destination) return;

    onSearch({
      origin,
      destination,
      departureDate,
      ...(timePreset !== 'any' ? { timeRange: TIME_RANGE_PRESETS[timePreset] } : {}),
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-border bg-card p-4 shadow-sm sm:p-5"
      aria-label="Flight search"
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <AirportPicker
          label="From"
          value={origin}
          airports={airports}
          excludeCode={destination}
          onChange={(code) => {
            setOrigin(code);
            // Clear a destination the new origin cannot reach, rather than leaving an
            // invalid pair selected to fail on submit.
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

        <Field label="Departure date" htmlFor="departure-date">
          <Input
            id="departure-date"
            type="date"
            value={departureDate}
            min={today()}
            onChange={(event) => setDepartureDate(event.target.value)}
            required
          />
        </Field>

        <Field label="Preferred time" htmlFor="time-range">
          <Select
            id="time-range"
            value={timePreset}
            onChange={(event) => setTimePreset(event.target.value as TimePreset)}
          >
            {TIME_PRESETS.map((preset) => (
              <option key={preset.value} value={preset.value}>
                {preset.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="mt-4 flex items-center justify-between gap-4">
        <p className="text-xs text-muted-foreground">
          {origin && !destination ? 'Choose a destination this route serves.' : ''}
        </p>
        <Button type="submit" size="lg" disabled={!canSearch} className="min-w-40">
          <SearchIcon aria-hidden="true" />
          {isSearching ? 'Searching…' : 'Search flights'}
        </Button>
      </div>
    </form>
  );
}

/** @returns Today as `YYYY-MM-DD`, used as the earliest selectable date. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Default departure date.
 *
 * A fortnight out rather than today: same-day fares are unrepresentative, and a search
 * that returns almost nothing is a poor first impression of a comparison tool.
 */
function defaultDate(): string {
  const date = new Date();
  date.setDate(date.getDate() + 14);
  return date.toISOString().slice(0, 10);
}
