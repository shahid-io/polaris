import { Controller, Get } from '@nestjs/common';
import { AIRPORTS } from '@polaris/providers';

/** An airport as the search UI needs it. */
export interface AirportSummary {
  code: string;
  city: string;
  name: string;
}

/** Airports the search form offers. */
export interface AirportsResponse {
  airports: AirportSummary[];
  /**
   * Destinations reachable from each origin, keyed by origin code.
   *
   * Now always empty, and kept so the response shape does not break clients that read it.
   * See {@link AirportsController.list} for why there is nothing to put in it.
   */
  routes: Record<string, string[]>;
}

@Controller('api/airports')
export class AirportsController {
  /**
   * Lists the airports the search form offers.
   *
   * This used to also return an origin-to-destination adjacency map, built from the
   * generated timetable, so the picker could grey out routes that "had no flights". That
   * map described which routes the *simulation* covered, and it is gone along with it.
   *
   * Every provider now reads a real seller's own search, and those sellers fly whatever
   * they fly. Publishing an adjacency list would mean asserting which routes exist, which
   * is not something this application knows: it would have to be maintained by hand, and
   * the first time it drifted it would hide a route that genuinely has flights. An empty
   * result for an unserved route is a truthful answer and costs one search to discover.
   *
   * @returns Airports, and an empty adjacency map retained for response compatibility.
   */
  @Get()
  list(): AirportsResponse {
    return {
      airports: AIRPORTS.map(({ code, city, name }) => ({ code, city, name })),
      routes: {},
    };
  }
}
