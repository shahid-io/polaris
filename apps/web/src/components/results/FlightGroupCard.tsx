'use client';

import { useState } from 'react';
import { ChevronDownIcon, GiftIcon, LuggageIcon, PlaneIcon, RotateCcwIcon, TrendingDownIcon } from 'lucide-react';
import type { ComparisonGroup, NormalizedOffer } from '@polaris/contracts';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScoreBreakdown } from '@/components/results/ScoreBreakdown';
import { cn, dayOffset, formatDuration, formatLocalTime, formatRupees } from '@/lib/utils';

export interface FlightGroupCardProps {
  group: ComparisonGroup;
  /** Highlights the top-ranked result. */
  isTopResult?: boolean;
}

/**
 * One marketed flight, with every provider selling it.
 *
 * This is the component the whole product exists for. A naive implementation renders one
 * row per offer, so six providers selling the same flight produce six near-identical rows
 * and the user does the comparison themselves. Here the flight is the row and the sellers
 * sit inside it, which turns "scroll and compare" into "read one number".
 */
export function FlightGroupCard({ group, isTopResult = false }: FlightGroupCardProps) {
  const [showAllOffers, setShowAllOffers] = useState(false);

  const { itinerary, priceSpread, offers, providerCount } = group;
  const firstSegment = itinerary.segments[0]!;
  const lastSegment = itinerary.segments[itinerary.segments.length - 1]!;
  const arrivalDayOffset = dayOffset(firstSegment.departure.local, lastSegment.arrival.local);

  // One row per provider, cheapest first — the same basis the spread is measured on, so
  // the list and the headline figure cannot disagree.
  const cheapestPerProvider = bestOfferPerProvider(offers);
  const visibleOffers = showAllOffers ? cheapestPerProvider : cheapestPerProvider.slice(0, 3);
  const hasSavings = priceSpread.delta.amountMinor > 0;

  return (
    <article
      className={cn(
        'rounded-lg border bg-card transition-colors',
        isTopResult ? 'border-primary/40 ring-1 ring-primary/20' : 'border-border',
      )}
    >
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between">
        {/* ── Itinerary ─────────────────────────────────────────── */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold">
              {firstSegment.marketingCarrier} {firstSegment.flightNumber}
            </span>
            {itinerary.segments.length > 1 && (
              <span className="font-mono text-xs text-muted-foreground">
                +{itinerary.segments.length - 1} more
              </span>
            )}
            {isTopResult && <Badge variant="live">Best value</Badge>}
          </div>

          <div className="mt-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="tabular text-2xl font-semibold">
              {formatLocalTime(firstSegment.departure.local)}
            </span>
            <span className="text-muted-foreground" aria-hidden="true">
              →
            </span>
            <span className="tabular text-2xl font-semibold">
              {formatLocalTime(lastSegment.arrival.local)}
              {arrivalDayOffset > 0 && (
                <sup className="ml-0.5 text-xs font-medium text-warning">+{arrivalDayOffset}</sup>
              )}
            </span>
            <span className="text-sm text-muted-foreground">
              {itinerary.origin} → {itinerary.destination}
            </span>
          </div>

          <p className="mt-1.5 text-sm text-muted-foreground">
            {formatDuration(itinerary.totalDurationMinutes)}
            {' · '}
            {itinerary.stops === 0
              ? 'Non-stop'
              : `${itinerary.stops} stop${itinerary.stops > 1 ? 's' : ''} via ${viaAirports(group)}`}
          </p>
        </div>

        {/* ── Price ─────────────────────────────────────────────── */}
        <div className="shrink-0 text-left sm:text-right">
          <p className="tabular text-2xl font-semibold">
            {formatRupees(priceSpread.min.amountMinor)}
          </p>
          {hasSavings ? (
            <p className="tabular mt-0.5 flex items-center gap-1 text-xs text-success sm:justify-end">
              <TrendingDownIcon className="size-3" aria-hidden="true" />
              Save {formatRupees(priceSpread.delta.amountMinor)} vs{' '}
              {formatRupees(priceSpread.max.amountMinor)}
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-muted-foreground">Single seller</p>
          )}
          <div className="mt-2 sm:flex sm:justify-end">
            <ScoreBreakdown score={group.score} />
          </div>
        </div>
      </div>

      {/* ── Providers selling this flight ───────────────────────── */}
      <div className="border-t border-border px-4 py-3">
        <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {providerCount === 1
            ? 'Sold by 1 provider'
            : `Compare ${providerCount} providers · prices vary ${priceSpread.percentage}%`}
        </p>

        <ul className="flex flex-col gap-1">
          {visibleOffers.map((offer, index) => (
            <li key={offer.id} className="rounded-md px-2 py-1.5 even:bg-muted/40">
              <div className="flex items-center justify-between gap-3 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <PlaneIcon
                  className={cn('size-3.5 shrink-0', index === 0 ? 'text-success' : 'text-muted-foreground')}
                  aria-hidden="true"
                />
                <span className="truncate font-medium">{offer.providerDisplayName}</span>
                <Badge variant={offer.integrationType === 'representative' ? 'simulated' : 'live'}>
                  {offer.integrationType === 'representative' ? 'Representative' : 'Live'}
                </Badge>
                {offer.fareFamily && (
                  <span className="hidden text-xs text-muted-foreground sm:inline">
                    {offer.fareFamily}
                  </span>
                )}
              </span>

              <span className="flex shrink-0 items-center gap-2">
                {index === 0 && providerCount > 1 && (
                  <span className="text-[11px] font-medium text-success">Cheapest</span>
                )}
                <span className="tabular font-semibold">
                  {formatRupees(offer.price.total.amountMinor)}
                </span>
              </span>
              </div>

              <OfferPerks offer={offer} />
            </li>
          ))}
        </ul>

        {cheapestPerProvider.length > 3 && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-1 h-7 px-2 text-xs"
            onClick={() => setShowAllOffers((open) => !open)}
            aria-expanded={showAllOffers}
          >
            <ChevronDownIcon
              className={cn('transition-transform', showAllOffers && 'rotate-180')}
              aria-hidden="true"
            />
            {showAllOffers
              ? 'Show fewer'
              : `Show ${cheapestPerProvider.length - 3} more provider${cheapestPerProvider.length - 3 > 1 ? 's' : ''}`}
          </Button>
        )}
      </div>
    </article>
  );
}

/**
 * What a provider includes beyond the fare.
 *
 * The brief lists "benefits or offers" as a field every result must display, and asks
 * users to compare on them. Showing only price would leave a ₹5,499 fare with free
 * cancellation and 20 kg of baggage looking identical to a ₹5,499 fare with neither.
 *
 * Conditional benefits are marked rather than hidden. They are real, and a user holding
 * the right card should see them — but they are excluded from the value score, so the
 * marker explains why a visible saving did not move the ranking.
 */
function OfferPerks({ offer }: { offer: NormalizedOffer }) {
  const baggage = offer.baggage?.checkedKg;
  const hasAnything =
    offer.benefits.length > 0 || offer.refundable !== undefined || baggage !== undefined;

  if (!hasAnything) return null;

  return (
    <ul className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 pl-5.5 text-[11px] text-muted-foreground">
      {offer.refundable && (
        <li className="flex items-center gap-1 text-success">
          <RotateCcwIcon className="size-3" aria-hidden="true" />
          Refundable
        </li>
      )}
      {baggage !== undefined && (
        <li className="flex items-center gap-1">
          <LuggageIcon className="size-3" aria-hidden="true" />
          {baggage} kg checked
        </li>
      )}
      {offer.benefits.map((benefit) => (
        <li key={benefit.label} className="flex items-center gap-1">
          <GiftIcon className="size-3" aria-hidden="true" />
          {benefit.label}
          {benefit.conditional && (
            <span className="text-warning" title="Conditional — excluded from the value score">
              *
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Reduces offers to each provider's cheapest.
 *
 * A group can hold several fare families from one seller. Listing every one would show
 * "IndiGo" three times at different prices, which reads as a bug; the price spread is
 * measured on this same basis, so the list and the headline saving cannot disagree.
 *
 * @param offers - Every offer in the group, already sorted cheapest-first.
 * @returns One offer per provider, cheapest first.
 */
function bestOfferPerProvider(offers: readonly NormalizedOffer[]): NormalizedOffer[] {
  const seen = new Set<string>();

  return offers.filter((offer) => {
    if (seen.has(offer.providerId)) return false;
    seen.add(offer.providerId);
    return true;
  });
}

/**
 * Lists the connection airports.
 *
 * @param group - The comparison group.
 * @returns Comma-separated IATA codes of intermediate stops.
 */
function viaAirports(group: ComparisonGroup): string {
  return group.itinerary.segments
    .slice(0, -1)
    .map((segment) => segment.destination)
    .join(', ');
}
