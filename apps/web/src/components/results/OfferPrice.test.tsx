import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OfferPrice } from './OfferPrice';
import { buildOffer } from '@/test/builders';

describe('OfferPrice', () => {
  /**
   * The reason this component exists. Cleartrip attaches a coupon to most fares and leads
   * with the discounted figure on its own page, so a reader following the verification
   * link sees a different number from the one Polaris ranked on. Showing only one of them
   * makes a correct row look wrong.
   */
  it('shows the seller’s discounted figure beside the comparable price', () => {
    render(
      <OfferPrice
        offer={buildOffer({
          providerDisplayName: 'Cleartrip',
          price: {
            total: { amountMinor: 594_200, currency: 'INR' },
            discountedTotal: { amountMinor: 550_500, currency: 'INR' },
          },
        })}
      />,
    );

    expect(screen.getByText('₹5,942')).toBeInTheDocument();
    expect(screen.getByText(/₹5,505 with coupon/)).toBeInTheDocument();
  });

  it('shows one price when the seller has no coupon', () => {
    render(
      <OfferPrice
        offer={buildOffer({ price: { total: { amountMinor: 594_200, currency: 'INR' } } })}
      />,
    );

    expect(screen.getByText('₹5,942')).toBeInTheDocument();
    expect(screen.queryByText(/with coupon/)).not.toBeInTheDocument();
  });
});
