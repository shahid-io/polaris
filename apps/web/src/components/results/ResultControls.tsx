'use client';

import type { SortKey } from '@polaris/contracts';

import { Select } from '@/components/ui/field';
import { formatRupees } from '@/lib/utils';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'value', label: 'Best value' },
  { value: 'price', label: 'Cheapest first' },
  { value: 'duration', label: 'Shortest first' },
  { value: 'departure', label: 'Earliest departure' },
  { value: 'arrival', label: 'Earliest arrival' },
];

/** Filter state held by the results view. */
export interface FilterState {
  nonStopOnly: boolean;
  /** Keep only flights where at least one seller offers a refundable fare. */
  refundableOnly: boolean;
  airlines: string[];
  providers: string[];
  maxPriceMinor?: number;
}

export interface ResultControlsProps {
  sort: SortKey;
  filters: FilterState;
  /** Options present in the unfiltered result, so nothing offered returns zero. */
  available: {
    airlines: string[];
    providers: { id: string; label: string }[];
    minPriceMinor: number;
    maxPriceMinor: number;
    hasConnections: boolean;
    hasRefundable: boolean;
  };
  onSortChange: (sort: SortKey) => void;
  onFiltersChange: (filters: FilterState) => void;
}

/**
 * Sorting and filtering controls.
 *
 * Options are built from what the current result actually contains rather than a fixed
 * list, so a user is never offered an airline or provider that would return nothing.
 * Filtering runs client-side against the already-fetched result — instant, and it does not
 * spend another provider fan-out or a SerpApi credit per checkbox.
 */
export function ResultControls({
  sort,
  filters,
  available,
  onSortChange,
  onFiltersChange,
}: ResultControlsProps) {
  function toggle(list: string[], value: string): string[] {
    return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
  }

  const activeCount =
    (filters.nonStopOnly ? 1 : 0) +
    (filters.refundableOnly ? 1 : 0) +
    filters.airlines.length +
    filters.providers.length +
    (filters.maxPriceMinor !== undefined ? 1 : 0);

  return (
    <aside className="flex flex-col gap-5 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="sort"
          className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
        >
          Sort by
        </label>
        <Select id="sort" value={sort} onChange={(event) => onSortChange(event.target.value as SortKey)}>
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Filters
          </span>
          {activeCount > 0 && (
            <button
              type="button"
              onClick={() =>
                // Every filter counted by activeCount must be reset here, or "Clear 2"
                // leaves one of them silently applied.
                onFiltersChange({
                  nonStopOnly: false,
                  refundableOnly: false,
                  airlines: [],
                  providers: [],
                  maxPriceMinor: undefined,
                })
              }
              className="text-xs text-primary hover:underline"
            >
              Clear {activeCount}
            </button>
          )}
        </div>

        {available.hasConnections && (
          <Checkbox
            label="Non-stop only"
            checked={filters.nonStopOnly}
            onChange={(checked) => onFiltersChange({ ...filters, nonStopOnly: checked })}
          />
        )}

        {available.hasRefundable && (
          <Checkbox
            label="Refundable fares"
            checked={filters.refundableOnly}
            onChange={(checked) => onFiltersChange({ ...filters, refundableOnly: checked })}
          />
        )}

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-xs text-muted-foreground">Airline</legend>
          {available.airlines.map((airline) => (
            <Checkbox
              key={airline}
              label={airline}
              mono
              checked={filters.airlines.includes(airline)}
              onChange={() => onFiltersChange({ ...filters, airlines: toggle(filters.airlines, airline) })}
            />
          ))}
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-xs text-muted-foreground">Provider</legend>
          {available.providers.map((provider) => (
            <Checkbox
              key={provider.id}
              label={provider.label}
              checked={filters.providers.includes(provider.id)}
              onChange={() =>
                onFiltersChange({ ...filters, providers: toggle(filters.providers, provider.id) })
              }
            />
          ))}
        </fieldset>

        {available.maxPriceMinor > available.minPriceMinor && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="max-price" className="text-xs text-muted-foreground">
              Max price{' '}
              <span className="tabular font-medium text-foreground">
                {formatRupees(filters.maxPriceMinor ?? available.maxPriceMinor)}
              </span>
            </label>
            <input
              id="max-price"
              type="range"
              min={available.minPriceMinor}
              max={available.maxPriceMinor}
              step={10_000}
              value={filters.maxPriceMinor ?? available.maxPriceMinor}
              onChange={(event) =>
                onFiltersChange({ ...filters, maxPriceMinor: Number(event.target.value) })
              }
              className="accent-primary"
            />
          </div>
        )}
      </div>
    </aside>
  );
}

/** Checkbox row, styled consistently across every filter group. */
function Checkbox({
  label,
  checked,
  mono = false,
  onChange,
}: {
  label: string;
  checked: boolean;
  mono?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 accent-primary"
      />
      <span className={mono ? 'font-mono' : undefined}>{label}</span>
    </label>
  );
}

export { SORT_OPTIONS };
