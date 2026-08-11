import { Controller, Get } from '@nestjs/common';
import { AIRPORTS, destinationsFrom, servedRoutes } from '@polaris/providers';

/** An airport as the search UI needs it. */
export interface AirportSummary {
  code: string;
  city: string;
  name: string;
}

/** Airports plus the adjacency the destination picker needs. */
export interface AirportsResponse {
  airports: AirportSummary[];
  /** Destinations reachable from each origin, keyed by origin code. */
  routes: Record<string, string[]>;
}

@Controller('api/airports')
export class AirportsController {
  /**
   * Lists served airports and which destinations each origin reaches.
   *
   * Served from the API rather than duplicated in the frontend so the picker cannot drift
   * out of sync with the timetable, an airport offered in the UI but absent from the
   * schedule would give the user a search that silently returns nothing.
   *
   * The adjacency map lets the destination picker show only routes that have flights,
   * which is the difference between a form that guides and one that lets you construct a
   * dead end.
   *
   * @returns Airports and origin-to-destination adjacency.
   */
  @Get()
  list(): AirportsResponse {
    const routes: Record<string, string[]> = {};

    for (const { origin } of servedRoutes()) {
      routes[origin] ??= destinationsFrom(origin);
    }

    return {
      airports: AIRPORTS.map(({ code, city, name }) => ({ code, city, name })),
      routes,
    };
  }
}
