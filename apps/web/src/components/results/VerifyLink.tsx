import type { NormalizedOffer } from '@polaris/contracts';

import { formatLocalTime, formatRupees } from '@/lib/utils';

/**
 * Opens the provider's own page so a reader can check the price against its source.
 *
 * This is the product's central claim made checkable. Every other honesty mechanism here,
 * the provenance field, the badge, the recording rules, asks the reader to trust that the
 * pipeline reported faithfully. This one does not: it hands them the seller's own page and
 * invites them to disagree.
 *
 * ### Why it carries the values to match
 * None of the three agencies supports linking to a single itinerary. Their result cards are
 * script-driven with no per-flight URL, and only Ixigo honours an airline filter in the
 * query string. So the link lands on the provider's results for the exact route, date,
 * passenger count and cabin that produced this offer, which is a list.
 *
 * Sending someone to a list without saying what to look for makes verification a chore and
 * quietly invites them not to bother. Naming the flight, the departure time and the price
 * turns it into a scan: find this row, read that number, confirm they match.
 */
export function VerifyLink({ offer }: { offer: NormalizedOffer }) {
  if (!offer.deepLink) return null;

  const segment = offer.itinerary.segments[0]!;
  const flight = `${segment.marketingCarrier}-${segment.flightNumber}`;
  const departure = formatLocalTime(segment.departure.local);
  const price = formatRupees(offer.price.total.amountMinor);

  return (
    <a
      href={offer.deepLink}
      // A new tab, because the point is to compare the two side by side rather than lose
      // the results to a navigation. noopener/noreferrer because the destination is a third
      // party: without them it gets a handle on this window via `window.opener`.
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      title={`Opens ${offer.providerDisplayName} in a new tab. Look for ${flight} departing ${departure} at ${price}.`}
    >
      {`Check on ${offer.providerDisplayName}`}
      <span aria-hidden="true">&#8599;</span>
      {/* The values to match, announced to assistive tech but not repeated visually: the
          row already shows all three, so reading them twice would be noise. */}
      <span className="sr-only">
        {`, opens in a new tab. Look for flight ${flight} departing ${departure} priced ${price}.`}
      </span>
    </a>
  );
}
