import type { NormalizedOffer } from '@polaris/contracts';

import { cn, formatRupees } from '@/lib/utils';

/**
 * An offer's price, with the seller's own discounted figure alongside it when they differ.
 *
 * Polaris compares on the price anyone can obtain. Cleartrip attaches a coupon to most
 * fares and its own page leads with the discounted number, so quoting that would rank it
 * above sellers advertising nothing, on a price most users cannot actually get.
 *
 * Showing only the comparable price has the opposite failure: a reader following the
 * verification link finds a different number on the seller's page and concludes the
 * comparison is broken. It is the likeliest reason a correct row looks wrong.
 *
 * So both are shown. The comparable price is the prominent one because it is what the
 * ranking means; the seller's figure is named and attributed so there is no ambiguity
 * about which number will appear when the link is followed.
 */
export function OfferPrice({
  offer,
  className,
}: {
  offer: NormalizedOffer;
  className?: string;
}) {
  const discounted = offer.price.discountedTotal;

  return (
    <span className="flex flex-col items-end leading-tight">
      <span className={cn('tabular font-semibold', className)}>
        {formatRupees(offer.price.total.amountMinor)}
      </span>
      {discounted && (
        <span
          className="text-[11px] whitespace-nowrap text-muted-foreground"
          title={`${offer.providerDisplayName} shows this fare at ${formatRupees(discounted.amountMinor)} with its own coupon applied. Polaris compares on the undiscounted price, because a coupon needs a code not everyone can use.`}
        >
          {formatRupees(discounted.amountMinor)} with coupon
        </span>
      )}
    </span>
  );
}
