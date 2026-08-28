import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

import { parseRoutingTrip } from './parse-routing-trip';
import type { RoutingTrip } from './types';

/** Reads a large prepared NDJSON file one validated object at a time. */
export async function* readRoutingTripsNdjson(
  path: string,
): AsyncGenerator<RoutingTrip> {
  const input = createReadStream(path, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
  const tripIds = new Set<string>();
  let lineNumber = 0;

  try {
    for await (const line of lines) {
      lineNumber += 1;
      if (line.length === 0) {
        throw new Error(`Routing-trip line ${lineNumber} in "${path}" is blank.`);
      }

      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch (error) {
        throw new Error(
          `Invalid JSON on routing-trip line ${lineNumber} in "${path}".`,
          { cause: error },
        );
      }
      const trip = parseRoutingTrip(value, `line ${lineNumber} of "${path}"`);
      if (tripIds.has(trip.tripId)) {
        throw new Error(
          `Duplicate routing trip ID "${trip.tripId}" on line ${lineNumber} of "${path}".`,
        );
      }
      tripIds.add(trip.tripId);
      yield trip;
    }
  } finally {
    lines.close();
    input.destroy();
  }
}
