'use client';

import { CheckIcon, ChevronsUpDownIcon, PlaneIcon } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { AirportSummary } from '@/lib/fetch';

export interface AirportPickerProps {
  label: string;
  value?: string;
  airports: readonly AirportSummary[];
  /**
   * Restricts selectable airports to these codes.
   *
   * Used for the destination picker, so a user can only choose somewhere the timetable
   * actually flies. Codes outside the list are shown greyed rather than hidden — a
   * destination vanishing from the list as you change origin is disorienting, whereas a
   * disabled row explains itself.
   */
  selectableCodes?: readonly string[];
  /** Excluded entirely — used so origin cannot equal destination. */
  excludeCode?: string;
  disabled?: boolean;
  onChange: (code: string) => void;
}

/**
 * Searchable airport combobox.
 *
 * Filters on city, airport name and IATA code together, because people reach for whichever
 * they know — "Bombay" and "BOM" and "Chhatrapati" should all find the same airport.
 */
export function AirportPicker({
  label,
  value,
  airports,
  selectableCodes,
  excludeCode,
  disabled = false,
  onChange,
}: AirportPickerProps) {
  const [open, setOpen] = useState(false);

  const selected = airports.find((airport) => airport.code === value);

  const options = useMemo(
    () =>
      airports
        .filter((airport) => airport.code !== excludeCode)
        .map((airport) => ({
          ...airport,
          // No restriction means everything is selectable — the origin picker's case.
          isSelectable: !selectableCodes || selectableCodes.includes(airport.code),
        }))
        // Selectable first, so the useful options are not buried under greyed rows.
        .sort((a, b) => Number(b.isSelectable) - Number(a.isSelectable)),
    [airports, excludeCode, selectableCodes],
  );

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </span>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label={`${label}: ${selected ? `${selected.city} (${selected.code})` : 'not selected'}`}
            disabled={disabled}
            className="h-auto w-full justify-between px-3 py-2.5 font-normal"
          >
            {selected ? (
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="font-mono text-base font-semibold">{selected.code}</span>
                <span className="truncate text-sm text-muted-foreground">{selected.city}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">Select airport</span>
            )}
            <ChevronsUpDownIcon className="ml-2 shrink-0 opacity-50" aria-hidden="true" />
          </Button>
        </PopoverTrigger>

        <PopoverContent className="w-(--radix-popover-trigger-width) min-w-72">
          <Command
            // Search city, name and code together — people reach for whichever they know.
            filter={(itemValue, search) =>
              itemValue.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
            }
          >
            <CommandInput placeholder="Search city, airport or code…" />
            <CommandList>
              <CommandEmpty>No matching airport.</CommandEmpty>
              <CommandGroup>
                {options.map((airport) => (
                  <CommandItem
                    key={airport.code}
                    value={`${airport.code} ${airport.city} ${airport.name}`}
                    disabled={!airport.isSelectable}
                    onSelect={() => {
                      onChange(airport.code);
                      setOpen(false);
                    }}
                    className={cn(!airport.isSelectable && 'opacity-40')}
                  >
                    <PlaneIcon className="shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="font-mono text-sm font-semibold">{airport.code}</span>
                    <span className="min-w-0 flex-1 truncate">
                      {airport.city}
                      <span className="ml-1.5 text-xs text-muted-foreground">{airport.name}</span>
                    </span>
                    {airport.code === value && (
                      <CheckIcon className="shrink-0" aria-hidden="true" />
                    )}
                    {!airport.isSelectable && (
                      <span className="shrink-0 text-[10px] text-muted-foreground uppercase">
                        no route
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
