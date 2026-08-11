import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import HomePage from './page';
import {
  buildGroup,
  buildItinerary,
  buildProviderStatus,
  buildSearchResponse,
  istTime,
} from '@/test/builders';

// The API client is mocked rather than the network: these tests are about what the page
// does with a response, and lib/fetch has its own tests for how a response is obtained.
vi.mock('@/lib/fetch', () => ({
  fetchAirports: vi.fn(),
  searchFlights: vi.fn(),
}));

const { fetchAirports, searchFlights } = await import('@/lib/fetch');

const AIRPORTS = {
  airports: [
    { code: 'DEL', city: 'Delhi', name: 'Indira Gandhi International' },
    { code: 'BOM', city: 'Mumbai', name: 'Chhatrapati Shivaji Maharaj International' },
    { code: 'BLR', city: 'Bengaluru', name: 'Kempegowda International' },
  ],
  routes: { DEL: ['BOM', 'BLR'] },
};

/** Drives the form the way a user would: pick origin, pick destination, submit. */
async function runSearch(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('combobox', { name: /^From/ }));
  await user.click(await screen.findByRole('option', { name: /Delhi/ }));

  await user.click(screen.getByRole('combobox', { name: /^To/ }));
  await user.click(await screen.findByRole('option', { name: /Mumbai/ }));

  await user.click(screen.getByRole('button', { name: /Search flights/ }));
}

beforeEach(() => {
  vi.mocked(fetchAirports).mockResolvedValue({ data: AIRPORTS });
});

describe('the search page', () => {
  it('invites a search before one has been run', async () => {
    render(<HomePage />);

    expect(await screen.findByText(/Search to compare fares/)).toBeInTheDocument();
  });

  it('renders grouped results after a search', async () => {
    const user = userEvent.setup();
    vi.mocked(searchFlights).mockResolvedValue({ data: buildSearchResponse() });
    render(<HomePage />);

    await runSearch(user);

    expect(await screen.findByRole('article')).toBeInTheDocument();
    expect(screen.getByText('6E 2134')).toBeInTheDocument();
    // Header states the reduction: N offers from M providers → K flights.
    expect(screen.getByText('offers from')).toBeInTheDocument();
    expect(screen.getByText('flights')).toBeInTheDocument();
  });

  it('sends the chosen route to the API', async () => {
    const user = userEvent.setup();
    vi.mocked(searchFlights).mockResolvedValue({ data: buildSearchResponse() });
    render(<HomePage />);

    await runSearch(user);

    await waitFor(() =>
      expect(searchFlights).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({ origin: 'DEL', destination: 'BOM' }),
        }),
        expect.anything(),
      ),
    );
  });

  it('narrows the list when a filter is applied', async () => {
    const user = userEvent.setup();
    const connecting = buildItinerary({
      segments: [
        {
          marketingCarrier: '6E',
          flightNumber: '6261',
          origin: 'DEL',
          destination: 'AMD',
          departure: istTime('2026-08-20T00:15'),
          arrival: istTime('2026-08-20T01:45'),
          durationMinutes: 90,
        },
        {
          marketingCarrier: '6E',
          flightNumber: '6285',
          origin: 'AMD',
          destination: 'BOM',
          departure: istTime('2026-08-20T04:30'),
          arrival: istTime('2026-08-20T05:30'),
          durationMinutes: 60,
        },
      ],
    });

    vi.mocked(searchFlights).mockResolvedValue({
      data: buildSearchResponse({
        groups: [
          buildGroup(),
          buildGroup(undefined, { itinerary: connecting, canonicalKey: 'connecting' }),
        ],
      }),
    });
    render(<HomePage />);
    await runSearch(user);

    expect(await screen.findAllByRole('article')).toHaveLength(2);

    await user.click(screen.getByRole('checkbox', { name: /Non-stop only/ }));

    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByText(/1 after filters/)).toBeInTheDocument();
  });

  /**
   * Regression. Clear reset every filter it counted except the price ceiling, so
   * "Clear 2" left the price filter silently applied and the list still narrowed.
   */
  it('clears every filter, including the price ceiling', async () => {
    const user = userEvent.setup();
    vi.mocked(searchFlights).mockResolvedValue({
      data: buildSearchResponse({
        groups: [
          buildGroup([{ providerId: 'goibibo', displayName: 'Goibibo', priceInr: 3000 }], {
            canonicalKey: 'cheap',
          }),
          buildGroup([{ providerId: 'makemytrip', displayName: 'MakeMyTrip', priceInr: 9000 }], {
            canonicalKey: 'dear',
          }),
        ],
      }),
    });
    render(<HomePage />);
    await runSearch(user);

    expect(await screen.findAllByRole('article')).toHaveLength(2);

    const priceSlider = screen.getByLabelText(/Max price/);
    fireEvent.change(priceSlider, { target: { value: '400000' } });
    expect(screen.getAllByRole('article')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: /Clear/ }));

    expect(screen.getAllByRole('article')).toHaveLength(2);
  });

  it('reorders when the sort changes', async () => {
    const user = userEvent.setup();
    const cheapLowScore = buildGroup(
      [{ providerId: 'goibibo', displayName: 'Goibibo', priceInr: 3000 }],
      {
        canonicalKey: 'cheap',
        itinerary: buildItinerary({
          segments: [
            {
              marketingCarrier: 'IX',
              flightNumber: '1592',
              origin: 'DEL',
              destination: 'BOM',
              departure: istTime('2026-08-20T07:40'),
              arrival: istTime('2026-08-20T09:45'),
              durationMinutes: 125,
            },
          ],
        }),
        score: {
          total: 0.2,
          breakdown: { price: 1, duration: 0, stops: 1, benefits: 0 },
          weights: { price: 0.45, duration: 0.25, stops: 0.2, benefits: 0.1 },
        },
      },
    );
    const dearHighScore = buildGroup([
      { providerId: 'makemytrip', displayName: 'MakeMyTrip', priceInr: 9000 },
    ]);

    vi.mocked(searchFlights).mockResolvedValue({
      data: buildSearchResponse({ groups: [cheapLowScore, dearHighScore] }),
    });
    render(<HomePage />);
    await runSearch(user);

    // Default is best value, so the higher-scoring (dearer) flight leads.
    let cards = await screen.findAllByRole('article');
    expect(within(cards[0]!).getByText('6E 2134')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/Sort by/), 'price');

    cards = screen.getAllByRole('article');
    expect(within(cards[0]!).getByText('IX 1592')).toBeInTheDocument();
  });

  it('shows the partial-results banner when a provider fails', async () => {
    const user = userEvent.setup();
    vi.mocked(searchFlights).mockResolvedValue({
      data: buildSearchResponse({
        providerStatuses: [
          buildProviderStatus({ providerId: 'makemytrip', displayName: 'MakeMyTrip' }),
          buildProviderStatus({
            providerId: 'cleartrip',
            displayName: 'Cleartrip',
            status: 'timeout',
            offerCount: 0,
            message: 'Did not respond within 6000ms',
          }),
        ],
      }),
    });
    render(<HomePage />);

    await runSearch(user);

    expect(await screen.findByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/Showing results from 1 of 2 providers/)).toBeInTheDocument();
    // Results from the providers that did answer are still shown.
    expect(screen.getByRole('article')).toBeInTheDocument();
  });

  it('shows an empty state when no flights are found', async () => {
    const user = userEvent.setup();
    vi.mocked(searchFlights).mockResolvedValue({
      data: buildSearchResponse({ groups: [] }),
    });
    render(<HomePage />);

    await runSearch(user);

    expect(await screen.findByText('No flights found')).toBeInTheDocument();
  });

  it('surfaces an API failure without blanking the page', async () => {
    const user = userEvent.setup();
    vi.mocked(searchFlights).mockResolvedValue({
      error: { code: 'UPSTREAM_FAILURE', message: 'Could not reach the Polaris API.' },
    });
    render(<HomePage />);

    await runSearch(user);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Could not reach the Polaris API/);
  });

  it('reports when the airport list cannot be loaded', async () => {
    vi.mocked(fetchAirports).mockResolvedValue({
      error: { code: 'UPSTREAM_FAILURE', message: 'Could not load airports' },
    });
    render(<HomePage />);

    expect(await screen.findByText(/Could not load airports/)).toBeInTheDocument();
  });
});
