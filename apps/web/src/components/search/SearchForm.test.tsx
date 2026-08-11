import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SearchForm } from './SearchForm';

const AIRPORTS = [
  { code: 'DEL', city: 'Delhi', name: 'Indira Gandhi International' },
  { code: 'BOM', city: 'Mumbai', name: 'Chhatrapati Shivaji Maharaj International' },
  { code: 'BLR', city: 'Bengaluru', name: 'Kempegowda International' },
  { code: 'GAU', city: 'Guwahati', name: 'Lokpriya Gopinath Bordoloi International' },
];

// DEL flies to BOM and BLR. GAU is served as a destination from nowhere in this fixture.
const ROUTES = { DEL: ['BOM', 'BLR'], BOM: ['DEL'] };

function renderForm(onSearch = vi.fn()) {
  render(
    <SearchForm airports={AIRPORTS} routes={ROUTES} isSearching={false} onSearch={onSearch} />,
  );
  return { onSearch, user: userEvent.setup() };
}

async function pick(user: ReturnType<typeof userEvent.setup>, field: RegExp, option: RegExp) {
  await user.click(screen.getByRole('combobox', { name: field }));
  await user.click(await screen.findByRole('option', { name: option }));
}

describe('SearchForm', () => {
  it('keeps submit disabled until a route is chosen', async () => {
    const { user } = renderForm();

    expect(screen.getByRole('button', { name: /Search flights/ })).toBeDisabled();

    await pick(user, /^From/, /Delhi/);
    expect(screen.getByRole('button', { name: /Search flights/ })).toBeDisabled();

    await pick(user, /^To/, /Mumbai/);
    expect(screen.getByRole('button', { name: /Search flights/ })).toBeEnabled();
  });

  it('disables the destination picker before an origin is chosen', () => {
    renderForm();

    expect(screen.getByRole('combobox', { name: /^To/ })).toBeDisabled();
  });

  /**
   * Structural validation rather than a submit-time error: a user cannot build a route
   * with no flights, so there is nothing to reject afterwards.
   */
  it('marks destinations the origin cannot reach as unavailable', async () => {
    const { user } = renderForm();
    await pick(user, /^From/, /Delhi/);

    await user.click(screen.getByRole('combobox', { name: /^To/ }));

    // Reachable from DEL.
    expect(await screen.findByRole('option', { name: /Mumbai/ })).not.toHaveAttribute(
      'data-disabled',
      'true',
    );
    // Not reachable — shown, but explained rather than silently missing.
    const unreachable = screen.getByRole('option', { name: /Guwahati/ });
    expect(unreachable).toHaveAttribute('data-disabled', 'true');
    expect(unreachable).toHaveTextContent(/no route/i);
  });

  it('excludes the chosen origin from the destination list', async () => {
    const { user } = renderForm();
    await pick(user, /^From/, /Delhi/);

    await user.click(screen.getByRole('combobox', { name: /^To/ }));

    expect(screen.queryByRole('option', { name: /Delhi/ })).not.toBeInTheDocument();
  });

  /**
   * Changing origin can strand a destination that is no longer reachable. Clearing it is
   * better than leaving an invalid pair selected to fail later.
   */
  it('clears a destination the new origin cannot reach', async () => {
    const { user } = renderForm();
    await pick(user, /^From/, /Delhi/);
    await pick(user, /^To/, /Bengaluru/);

    expect(screen.getByRole('combobox', { name: /^To/ })).toHaveTextContent('BLR');

    // BOM only flies to DEL in this fixture, so BLR must be dropped.
    await pick(user, /^From/, /Mumbai/);

    expect(screen.getByRole('combobox', { name: /^To/ })).toHaveTextContent(/Select airport/);
    expect(screen.getByRole('button', { name: /Search flights/ })).toBeDisabled();
  });

  it('submits the route and date', async () => {
    const { user, onSearch } = renderForm();
    await pick(user, /^From/, /Delhi/);
    await pick(user, /^To/, /Mumbai/);

    await user.click(screen.getByRole('button', { name: /Search flights/ }));

    expect(onSearch).toHaveBeenCalledWith(
      expect.objectContaining({ origin: 'DEL', destination: 'BOM' }),
    );
  });

  /**
   * Regression for the defect where timeRange was collected and then ignored end to end.
   * The form's half of that contract is that it actually sends the window.
   */
  it('includes the preferred time window when one is chosen', async () => {
    const { user, onSearch } = renderForm();
    await pick(user, /^From/, /Delhi/);
    await pick(user, /^To/, /Mumbai/);

    await user.selectOptions(screen.getByLabelText(/Preferred time/), 'morning');
    await user.click(screen.getByRole('button', { name: /Search flights/ }));

    expect(onSearch).toHaveBeenCalledWith(
      expect.objectContaining({ timeRange: { from: '06:00', to: '12:00' } }),
    );
  });

  it('omits the time window when any time is acceptable', async () => {
    const { user, onSearch } = renderForm();
    await pick(user, /^From/, /Delhi/);
    await pick(user, /^To/, /Mumbai/);

    await user.click(screen.getByRole('button', { name: /Search flights/ }));

    expect(onSearch).toHaveBeenCalledWith(
      expect.not.objectContaining({ timeRange: expect.anything() }),
    );
  });

  it('finds an airport by city, code or name', async () => {
    const { user } = renderForm();
    await user.click(screen.getByRole('combobox', { name: /^From/ }));

    await user.type(screen.getByPlaceholderText(/Search city, airport or code/), 'kempe');

    expect(await screen.findByRole('option', { name: /Bengaluru/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Delhi/ })).not.toBeInTheDocument();
  });

  it('shows a searching state while a request is in flight', () => {
    render(
      <SearchForm airports={AIRPORTS} routes={ROUTES} isSearching onSearch={vi.fn()} />,
    );

    expect(screen.getByRole('button', { name: /Searching/ })).toBeDisabled();
  });
});
