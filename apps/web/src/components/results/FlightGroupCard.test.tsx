import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { FlightGroupCard } from './FlightGroupCard';
import { buildBenefit, buildGroup, buildItinerary, istTime } from '@/test/builders';

describe('FlightGroupCard', () => {
  it('shows the flight identity and route', () => {
    render(<FlightGroupCard group={buildGroup()} />);

    expect(screen.getByText('6E 2134')).toBeInTheDocument();
    expect(screen.getByText('DEL → BOM')).toBeInTheDocument();
    expect(screen.getByText('06:15')).toBeInTheDocument();
  });

  /**
   * The product's central claim. A naive list renders one row per offer, so two providers
   * selling one flight produce two near-identical rows and the user does the comparing.
   * Here it must be a single card containing both sellers.
   */
  it('renders one card containing every provider, not one card per offer', () => {
    render(
      <FlightGroupCard
        group={buildGroup([
          { providerId: 'goibibo', displayName: 'Goibibo', priceInr: 4614 },
          { providerId: 'makemytrip', displayName: 'MakeMyTrip', priceInr: 4704 },
          { providerId: 'cleartrip', displayName: 'Cleartrip', priceInr: 4890 },
        ])}
      />,
    );

    expect(screen.getAllByRole('article')).toHaveLength(1);
    expect(screen.getByText('Goibibo')).toBeInTheDocument();
    expect(screen.getByText('MakeMyTrip')).toBeInTheDocument();
    expect(screen.getByText('Cleartrip')).toBeInTheDocument();
    expect(screen.getByText(/Compare 3 providers/)).toBeInTheDocument();
  });

  it('lists providers cheapest first and marks the cheapest', () => {
    render(
      <FlightGroupCard
        group={buildGroup([
          { providerId: 'makemytrip', displayName: 'MakeMyTrip', priceInr: 4704 },
          { providerId: 'goibibo', displayName: 'Goibibo', priceInr: 4614 },
        ])}
      />,
    );

    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]!).getByText('Goibibo')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('Cheapest')).toBeInTheDocument();
  });

  it('states the saving against the dearest provider', () => {
    render(
      <FlightGroupCard
        group={buildGroup([
          { providerId: 'goibibo', displayName: 'Goibibo', priceInr: 4614 },
          { providerId: 'makemytrip', displayName: 'MakeMyTrip', priceInr: 4704 },
        ])}
      />,
    );

    expect(screen.getByText(/Save ₹90/)).toBeInTheDocument();
  });

  it('says single seller rather than showing a zero saving', () => {
    render(
      <FlightGroupCard
        group={buildGroup([{ providerId: 'indigo', displayName: 'IndiGo', priceInr: 6074 }])}
      />,
    );

    expect(screen.getByText('Single seller')).toBeInTheDocument();
    expect(screen.queryByText(/Save ₹0/)).not.toBeInTheDocument();
  });

  /**
   * Data provenance must be visible where the price is, not only in the API response.
   * A user should never have to guess whether a fare is real.
   */
  it('badges each offer as live or representative', () => {
    render(
      <FlightGroupCard
        group={buildGroup([
          {
            providerId: 'indigo',
            displayName: 'IndiGo',
            priceInr: 4500,
            offer: { integrationType: 'live-api' },
          },
          { providerId: 'makemytrip', displayName: 'MakeMyTrip', priceInr: 4704 },
        ])}
      />,
    );

    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByText('Representative')).toBeInTheDocument();
  });

  it('shows benefits, baggage and refundability', () => {
    render(
      <FlightGroupCard
        group={buildGroup([
          {
            providerId: 'goibibo',
            displayName: 'Goibibo',
            priceInr: 4614,
            offer: {
              benefits: [buildBenefit({ label: '₹400 goCash' })],
              baggage: { cabinKg: 7, checkedKg: 15 },
              refundable: true,
            },
          },
        ])}
      />,
    );

    expect(screen.getByText('₹400 goCash')).toBeInTheDocument();
    expect(screen.getByText('15 kg checked')).toBeInTheDocument();
    expect(screen.getByText('Refundable')).toBeInTheDocument();
  });

  /**
   * Conditional benefits are shown because they are real, but marked because they are
   * excluded from the value score — so a visible saving that did not move the ranking
   * explains itself rather than looking like a scoring bug.
   */
  it('marks a card-conditional benefit', () => {
    render(
      <FlightGroupCard
        group={buildGroup([
          {
            providerId: 'makemytrip',
            displayName: 'MakeMyTrip',
            priceInr: 4704,
            offer: {
              benefits: [buildBenefit({ label: '₹750 off with HDFC cards', conditional: true })],
            },
          },
        ])}
      />,
    );

    expect(screen.getByText('₹750 off with HDFC cards')).toBeInTheDocument();
    expect(screen.getByTitle(/Conditional/)).toBeInTheDocument();
  });

  it('collapses providers beyond the first three behind a toggle', async () => {
    const user = userEvent.setup();
    render(
      <FlightGroupCard
        group={buildGroup([
          { providerId: 'goibibo', displayName: 'Goibibo', priceInr: 4600 },
          { providerId: 'makemytrip', displayName: 'MakeMyTrip', priceInr: 4700 },
          { providerId: 'cleartrip', displayName: 'Cleartrip', priceInr: 4800 },
          { providerId: 'indigo', displayName: 'IndiGo', priceInr: 4900 },
        ])}
      />,
    );

    expect(screen.queryByText('IndiGo')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Show 1 more provider/ }));

    expect(screen.getByText('IndiGo')).toBeInTheDocument();
  });

  /**
   * A 21:55 departure arriving 00:05 reads as landing before it left without this marker.
   */
  it('marks an arrival that falls on the next day', () => {
    const overnight = buildItinerary({
      segments: [
        {
          marketingCarrier: '6E',
          flightNumber: '944',
          origin: 'DEL',
          destination: 'BOM',
          departure: istTime('2026-08-20T21:55'),
          arrival: istTime('2026-08-21T00:05'),
          durationMinutes: 130,
        },
      ],
    });

    render(<FlightGroupCard group={buildGroup(undefined, { itinerary: overnight })} />);

    expect(screen.getByText('+1')).toBeInTheDocument();
  });

  it('describes a connection with its via airport', () => {
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

    render(<FlightGroupCard group={buildGroup(undefined, { itinerary: connecting })} />);

    expect(screen.getByText(/1 stop via AMD/)).toBeInTheDocument();
  });

  it('marks the top result only when told to', () => {
    const { rerender } = render(<FlightGroupCard group={buildGroup()} />);
    expect(screen.queryByText('Best value')).not.toBeInTheDocument();

    rerender(<FlightGroupCard group={buildGroup()} isTopResult />);
    expect(screen.getByText('Best value')).toBeInTheDocument();
  });
});

describe('expanding a flight', () => {
  it('hides the detail until the card is clicked', () => {
    render(<FlightGroupCard group={buildGroup()} />);

    expect(screen.queryByText(/All \d+ fares/)).not.toBeInTheDocument();
  });

  it('reveals the full journey and every fare on click', async () => {
    const user = userEvent.setup();
    render(
      <FlightGroupCard
        group={buildGroup([
          {
            providerId: 'goibibo',
            displayName: 'Goibibo',
            priceInr: 4614,
            offer: { fareFamily: 'SAVER' },
          },
          {
            providerId: 'goibibo',
            displayName: 'Goibibo',
            priceInr: 6400,
            offer: { fareFamily: 'FLEX' },
          },
        ])}
      />,
    );

    await user.click(screen.getByRole('button', { name: /show full journey and all fares/i }));

    // The card lists one row per provider; the detail lists every fare family.
    expect(screen.getByText(/All 2 fares/)).toBeInTheDocument();
    expect(screen.getByText('FLEX')).toBeInTheDocument();
    expect(screen.getByText(/Total/)).toBeInTheDocument();
  });

  it('collapses again on a second click', async () => {
    const user = userEvent.setup();
    render(<FlightGroupCard group={buildGroup()} />);

    const toggle = screen.getByRole('button', { name: /show full journey/i });
    await user.click(toggle);
    expect(screen.getByText(/All \d+ fares/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /hide full journey/i }));
    expect(screen.queryByText(/All \d+ fares/)).not.toBeInTheDocument();
  });

  /**
   * The split between flying and waiting is invisible in a single total duration — two
   * four-hour journeys are very different if one is a single flight and the other is
   * ninety minutes of flying either side of a wait.
   */
  it('shows layover time and flags a tight connection', async () => {
    const user = userEvent.setup();
    const tight = buildItinerary({
      segments: [
        {
          marketingCarrier: '6E',
          flightNumber: '6261',
          origin: 'DEL',
          destination: 'AMD',
          departure: istTime('2026-08-20T06:00'),
          arrival: istTime('2026-08-20T07:30'),
          durationMinutes: 90,
        },
        {
          marketingCarrier: '6E',
          flightNumber: '6285',
          origin: 'AMD',
          destination: 'BOM',
          departure: istTime('2026-08-20T08:15'),
          arrival: istTime('2026-08-20T09:15'),
          durationMinutes: 60,
        },
      ],
      totalDurationMinutes: 195,
    });

    render(<FlightGroupCard group={buildGroup(undefined, { itinerary: tight })} />);
    await user.click(screen.getByRole('button', { name: /show full journey/i }));

    expect(screen.getByText(/45m in AMD/)).toBeInTheDocument();
    expect(screen.getByText(/tight connection/)).toBeInTheDocument();
  });

  it('warns when a journey is split across two carriers', async () => {
    const user = userEvent.setup();
    const mixed = buildItinerary({
      segments: [
        {
          marketingCarrier: 'IX',
          flightNumber: '1592',
          origin: 'DEL',
          destination: 'AMD',
          departure: istTime('2026-08-20T06:00'),
          arrival: istTime('2026-08-20T07:30'),
          durationMinutes: 90,
        },
        {
          marketingCarrier: '6E',
          flightNumber: '6285',
          origin: 'AMD',
          destination: 'BOM',
          departure: istTime('2026-08-20T10:00'),
          arrival: istTime('2026-08-20T11:00'),
          durationMinutes: 60,
        },
      ],
      totalDurationMinutes: 300,
    });

    render(<FlightGroupCard group={buildGroup(undefined, { itinerary: mixed })} />);
    await user.click(screen.getByRole('button', { name: /show full journey/i }));

    expect(screen.getByText('IX + 6E')).toBeInTheDocument();
    expect(screen.getByText(/baggage may not transfer/)).toBeInTheDocument();
  });
});
