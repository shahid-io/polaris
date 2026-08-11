'use client';

import {
  ArmchairIcon,
  ClockIcon,
  GiftIcon,
  LuggageIcon,
  PlaneIcon,
  RotateCcwIcon,
} from 'lucide-react';
import type { ComparisonGroup, NormalizedOffer } from '@polaris/contracts';
import { carriersOn, flyingMinutes, layoversFor, waitingMinutes } from '@polaris/core';

import { Badge } from '@/components/ui/badge';
import { cn, dayOffset, formatDuration, formatLocalTime, formatRupees } from '@/lib/utils';

/**
 * Everything about one flight that does not fit on its card.
 *
 * Expands in place rather than opening a page. The product's whole claim is comparison
 * without losing context, and navigating away from the list to inspect one flight
 * discards the neighbouring prices that were the reason for looking. Expanding also avoids
 * a detail route's real problem: it would arrive with no data, and refetching could return
 * different prices from the ones just clicked.
 */
export function FlightDetail({ group }: { group: ComparisonGroup }) {
  const { itinerary } = group;
  const layovers = layoversFor(itinerary);
  const carriers = carriersOn(itinerary);
  const waiting = waitingMinutes(itinerary);

  return (
    <div className="border-t border-border bg-muted/30 px-4 py-4">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* ── Journey ───────────────────────────────────────────── */}
        <section>
          <h4 className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Journey
          </h4>

          <ol className="flex flex-col">
            {itinerary.segments.map((segment, index) => {
              const layover = layovers[index];
              const arrivalOffset = dayOffset(segment.departure.local, segment.arrival.local);

              return (
                <li key={`${segment.marketingCarrier}${segment.flightNumber}`}>
                  <div className="flex gap-3">
                    <div className="flex flex-col items-center pt-1.5">
                      <span className="size-2 rounded-full bg-primary" aria-hidden="true" />
                      <span className="my-1 w-px flex-1 bg-border" aria-hidden="true" />
                      <span
                        className="size-2 rounded-full border border-primary"
                        aria-hidden="true"
                      />
                    </div>

                    <div className="flex-1 pb-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="tabular font-semibold">
                          {formatLocalTime(segment.departure.local)}
                        </span>
                        <span className="font-mono text-sm">{segment.origin}</span>
                        <span className="text-xs text-muted-foreground">
                          {segment.marketingCarrier} {segment.flightNumber}
                          {segment.aircraft ? ` · ${segment.aircraft}` : ''}
                        </span>
                      </div>

                      <p className="my-1.5 text-xs text-muted-foreground">
                        {formatDuration(segment.durationMinutes)} in the air
                      </p>

                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="tabular font-semibold">
                          {formatLocalTime(segment.arrival.local)}
                          {arrivalOffset > 0 && (
                            <sup className="ml-0.5 text-[10px] text-warning">+{arrivalOffset}</sup>
                          )}
                        </span>
                        <span className="font-mono text-sm">{segment.destination}</span>
                      </div>
                    </div>
                  </div>

                  {layover && (
                    <div
                      className={cn(
                        'my-2 ml-6 flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs',
                        layover.isTight
                          ? 'border-warning/40 bg-warning/10 text-warning'
                          : 'border-border text-muted-foreground',
                      )}
                    >
                      <ClockIcon className="size-3.5 shrink-0" aria-hidden="true" />
                      <span>
                        {formatDuration(layover.minutes)} in {layover.airport}
                        {layover.isTight && ': tight connection'}
                        {layover.isLong && ': long wait'}
                      </span>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>

          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-border pt-3 text-xs sm:grid-cols-3">
            <Stat label="Total" value={formatDuration(itinerary.totalDurationMinutes)} />
            <Stat label="Flying" value={formatDuration(flyingMinutes(itinerary))} />
            {waiting > 0 && <Stat label="Connecting" value={formatDuration(waiting)} />}
            <Stat
              label="Stops"
              value={itinerary.stops === 0 ? 'Non-stop' : String(itinerary.stops)}
            />
            <Stat label="Airline" value={carriers.join(' + ')} />
            {carriers.length > 1 && (
              <Stat label="Note" value="Two carriers, baggage may not transfer" />
            )}
          </dl>
        </section>

        {/* ── Every fare, not just the cheapest per provider ────── */}
        <section>
          <h4 className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            All {group.offers.length} fares from {group.providerCount}{' '}
            {group.providerCount === 1 ? 'provider' : 'providers'}
          </h4>

          <ul className="flex flex-col gap-2">
            {group.offers.map((offer) => (
              <FareRow
                key={offer.id}
                offer={offer}
                isCheapest={offer.id === group.cheapestOfferId}
              />
            ))}
          </ul>

          <p className="mt-3 text-xs text-muted-foreground">
            The card shows each provider&apos;s cheapest fare. This lists every fare family they
            sell, which is why a provider can appear more than once here.
          </p>
        </section>
      </div>
    </div>
  );
}

/** A labelled figure in the journey summary. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

/** One purchasable fare, with everything it includes. */
function FareRow({ offer, isCheapest }: { offer: NormalizedOffer; isCheapest: boolean }) {
  return (
    <li
      className={cn(
        'rounded-md border px-3 py-2',
        isCheapest ? 'border-success/40 bg-success/5' : 'border-border bg-card',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-1.5">
          <PlaneIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="text-sm font-medium">{offer.providerDisplayName}</span>
          {offer.fareFamily && (
            <span className="font-mono text-[11px] text-muted-foreground">{offer.fareFamily}</span>
          )}
          <Badge variant={offer.integrationType === 'representative' ? 'simulated' : 'live'}>
            {offer.integrationType === 'representative' ? 'Representative' : 'Live'}
          </Badge>
        </span>

        <span className="flex items-center gap-2">
          {isCheapest && <span className="text-[11px] font-medium text-success">Cheapest</span>}
          <span className="tabular text-sm font-semibold">
            {formatRupees(offer.price.total.amountMinor)}
          </span>
        </span>
      </div>

      <ul className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {offer.refundable !== undefined && (
          <li className={cn('flex items-center gap-1', offer.refundable && 'text-success')}>
            <RotateCcwIcon className="size-3" aria-hidden="true" />
            {offer.refundable ? 'Refundable' : 'Non-refundable'}
          </li>
        )}
        {offer.baggage?.cabinKg !== undefined && (
          <li className="flex items-center gap-1">
            <LuggageIcon className="size-3" aria-hidden="true" />
            {offer.baggage.cabinKg} kg cabin
          </li>
        )}
        {offer.baggage?.checkedKg !== undefined && (
          <li className="flex items-center gap-1">
            <LuggageIcon className="size-3" aria-hidden="true" />
            {offer.baggage.checkedKg} kg checked
          </li>
        )}
        {offer.seatsAvailable !== undefined && offer.seatsAvailable <= 5 && (
          <li className="flex items-center gap-1 text-warning">
            <ArmchairIcon className="size-3" aria-hidden="true" />
            {offer.seatsAvailable} seats left
          </li>
        )}
        {offer.benefits.map((benefit) => (
          <li key={benefit.label} className="flex items-center gap-1">
            <GiftIcon className="size-3" aria-hidden="true" />
            {benefit.label}
            {benefit.conditional && (
              <span className="text-warning" title="Conditional: excluded from the value score">
                *
              </span>
            )}
          </li>
        ))}
      </ul>
    </li>
  );
}
