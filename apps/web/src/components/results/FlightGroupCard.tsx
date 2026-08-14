'use client';

import { useState } from 'react';
import {
  ChevronDownIcon,
  GiftIcon,
  LuggageIcon,
  PlaneIcon,
  RotateCcwIcon,
  TrendingDownIcon,
} from 'lucide-react';
import type { ComparisonGroup, NormalizedOffer } from '@polaris/contracts';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FlightDetail } from '@/components/results/FlightDetail';
import { ScoreBreakdown } from '@/components/results/ScoreBreakdown';
import { cn, dayOffset, formatDuration, formatLocalTime, formatRupees } from '@/lib/utils';
import { ProvenanceBadge } from '@/components/results/ProvenanceBadge';
import { VerifyLink } from '@/components/results/VerifyLink';

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
  const [isExpanded, setIsExpanded] = useState(false);

  const { itinerary, priceSpread, offers, providerCount } = group;
  const firstSegment = itinerary.segments[0]!;
  const lastSegment = itinerary.segments[itinerary.segments.length - 1]!;
  const arrivalDayOffset = dayOffset(firstSegment.departure.local, lastSegment.arrival.local);

  // One row per provider, cheapest first, the same basis the spread is measured on, so
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
      <button
        type="button"
        onClick={() => setIsExpanded((open) => !open)}
        aria-expanded={isExpanded}
        aria-label={`${firstSegment.marketingCarrier} ${firstSegment.flightNumber}, ${formatLocalTime(firstSegment.departure.local)}: ${isExpanded ? 'hide' : 'show'} full journey and all fares`}
        className="flex w-full flex-col gap-4 rounded-lg p-4 text-left transition-colors hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none sm:flex-row sm:items-start sm:justify-between"
      >
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
          <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground sm:justify-end">
            <ChevronDownIcon
              className={cn('size-3 transition-transform', isExpanded && 'rotate-180')}
              aria-hidden="true"
            />
            {isExpanded ? 'Hide details' : 'Journey & all fares'}
          </p>
        </div>
      </button>

      {/* Outside the toggle button: it opens its own popover, and nesting an interactive
          element inside a button is invalid and breaks keyboard behaviour. */}
      <div className="-mt-1 flex justify-end px-4 pb-2">
        <ScoreBreakdown score={group.score} />
      </div>

      {/* ── Providers selling this flight ─────────────────────────
          A single seller needs no comparison table, the price is already on the card
          above, so repeating it under a "sold by 1 provider" heading is pure noise. The
          seller's name and badge move up into a single quiet line instead. */}
      {providerCount === 1 ? (
        <div className="border-t border-border px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <PlaneIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="text-muted-foreground">Only on</span>
            <span className="font-medium">{offers[0]!.providerDisplayName}</span>
            <ProvenanceBadge integrationType={offers[0]!.integrationType} />
            <VerifyLink offer={offers[0]!} />
          </div>
          {/* Benefits still belong here, what disappears for a single seller is the
              comparison framing, not what the fare actually includes. */}
          <OfferPerks offer={offers[0]!} />
        </div>
      ) : (
        <div className="border-t border-border px-4 py-3">
          <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Compare {providerCount} providers · prices vary {priceSpread.percentage}%
          </p>

          <ul className="flex flex-col gap-1">
            {visibleOffers.map((offer, index) => (
              <li key={offer.id} className="rounded-md px-2 py-1.5 even:bg-muted/40">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <PlaneIcon
                      className={cn(
                        'size-3.5 shrink-0',
                        index === 0 ? 'text-success' : 'text-muted-foreground',
                      )}
                      aria-hidden="true"
                    />
                    <span className="truncate font-medium">{offer.providerDisplayName}</span>
                    <ProvenanceBadge integrationType={offer.integrationType} />
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
                {/* Every seller row carries its own proof: the price above is checkable
                    against the seller that quoted it, not against the group as a whole. */}
                <VerifyLink offer={offer} />
              </li>
            ))}
          </ul>

          {!isExpanded && cheapestPerProvider.length > 3 && (
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
      )}

      {isExpanded && <FlightDetail group={group} />}
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
 * the right card should see them, but they are excluded from the value score, so the
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
            <span className="text-warning" title="Conditional: excluded from the value score">
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
