import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VerifyLink } from './VerifyLink';
import { buildOffer } from '@/test/builders';

describe('VerifyLink', () => {
  /**
   * This link is the product's central claim made checkable: every other honesty mechanism
   * asks the reader to trust that the pipeline reported faithfully, and this one hands them
   * the seller's own page and invites them to disagree. It going missing is not a cosmetic
   * regression.
   */
  it('links to the page that quoted the price', () => {
    render(
      <VerifyLink
        offer={buildOffer({
          providerDisplayName: 'Cleartrip',
          deepLink: 'https://www.cleartrip.com/flights/results?from=DEL&to=BOM',
        })}
      />,
    );

    const link = screen.getByRole('link', { name: /Check on Cleartrip/ });
    expect(link).toHaveAttribute('href', 'https://www.cleartrip.com/flights/results?from=DEL&to=BOM');
  });

  /**
   * A new tab so the two can be compared side by side, and noopener/noreferrer because the
   * destination is a third party: without them it gets a handle on this window.
   */
  it('opens in a new tab without handing the opener over', () => {
    render(<VerifyLink offer={buildOffer({ deepLink: 'https://www.ixigo.com/x' })} />);

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.getAttribute('rel')).toContain('noreferrer');
  });

  /** The link lands on a list, so it has to say what to look for or it is a hunt. */
  it('names the flight, time and price to match', () => {
    render(
      <VerifyLink
        offer={buildOffer({
          deepLink: 'https://www.cleartrip.com/x',
          price: { total: { amountMinor: 594_200, currency: 'INR' } },
        })}
      />,
    );

    expect(screen.getByRole('link').getAttribute('title')).toMatch(/6E-2134.*₹5,942/);
  });

  /**
   * These results pages print the undiscounted fare in their price column and show any
   * coupon as a separate line beneath it, so the total is the number to send the reader
   * looking for. Confirmed by reading the rendered pages in `pnpm verify:prices`.
   */
  it('names the undiscounted total even when a coupon applies', () => {
    render(
      <VerifyLink
        offer={buildOffer({
          deepLink: 'https://www.cleartrip.com/x',
          price: {
            total: { amountMinor: 594_200, currency: 'INR' },
            discountedTotal: { amountMinor: 550_500, currency: 'INR' },
          },
        })}
      />,
    );

    expect(screen.getByRole('link').getAttribute('title')).toContain('₹5,942');
    expect(screen.getByRole('link').getAttribute('title')).not.toContain('₹5,505');
  });

  it('renders nothing when an offer has no link to prove it', () => {
    const { container } = render(<VerifyLink offer={buildOffer({ deepLink: undefined })} />);

    expect(container).toBeEmptyDOMElement();
  });
});
