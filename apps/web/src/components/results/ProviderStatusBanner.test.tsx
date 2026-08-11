import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ProviderStatusBanner } from './ProviderStatusBanner';
import { buildProviderStatus, buildSearchResponse } from '@/test/builders';

const metaFor = (statuses: ReturnType<typeof buildProviderStatus>[]) =>
  buildSearchResponse({ providerStatuses: statuses }).meta;

describe('ProviderStatusBanner', () => {
  it('reports quietly when every provider responded', () => {
    const statuses = [
      buildProviderStatus({ providerId: 'makemytrip', displayName: 'MakeMyTrip' }),
      buildProviderStatus({ providerId: 'goibibo', displayName: 'Goibibo' }),
    ];

    render(<ProviderStatusBanner statuses={statuses} meta={metaFor(statuses)} />);

    expect(screen.getByText(/All 2 providers responded/)).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  /**
   * The requirement this component exists for. Silently returning a shorter list is the
   * failure mode: a user comparing prices must know the cheapest seller may not have been
   * asked at all.
   */
  it('names the failed provider and why when results are partial', () => {
    const statuses = [
      buildProviderStatus({ providerId: 'makemytrip', displayName: 'MakeMyTrip' }),
      buildProviderStatus({
        providerId: 'cleartrip',
        displayName: 'Cleartrip',
        status: 'timeout',
        offerCount: 0,
        message: 'Did not respond within 6000ms',
      }),
    ];

    render(<ProviderStatusBanner statuses={statuses} meta={metaFor(statuses)} />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/Showing results from 1 of 2 providers/)).toBeInTheDocument();
    expect(screen.getByText(/Cleartrip/)).toBeInTheDocument();
    expect(screen.getByText(/Timed out/)).toBeInTheDocument();
    expect(screen.getByText(/Did not respond within 6000ms/)).toBeInTheDocument();
  });

  it('warns that a cheaper fare may exist when a provider is missing', () => {
    const statuses = [
      buildProviderStatus({ status: 'error', message: 'upstream 503', offerCount: 0 }),
    ];

    render(<ProviderStatusBanner statuses={statuses} meta={metaFor(statuses)} />);

    expect(screen.getByText(/a cheaper fare may exist/i)).toBeInTheDocument();
  });

  it('treats an empty provider result as success, not failure', () => {
    // "No flights on this route" is a valid answer; it must not raise the warning banner.
    const statuses = [buildProviderStatus({ status: 'empty', offerCount: 0 })];

    render(<ProviderStatusBanner statuses={statuses} meta={metaFor(statuses)} />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('explains a provider skipped for missing credentials', () => {
    const statuses = [
      buildProviderStatus({ providerId: 'duffel', displayName: 'Duffel', status: 'skipped', offerCount: 0 }),
    ];

    render(<ProviderStatusBanner statuses={statuses} meta={metaFor(statuses)} />);

    expect(screen.getByText(/Not configured/)).toBeInTheDocument();
  });
});
