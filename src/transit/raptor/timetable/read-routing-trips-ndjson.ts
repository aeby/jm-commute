import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

import type { RoutingTrip } from '../../routing-data';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseRoutingTripLine = (
  line: string,
  lineNumber: number,
): RoutingTrip => {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (error) {
    throw new Error(`Invalid JSON on routing-trip line ${lineNumber}`, {
      cause: error,
    });
  }

  if (!isRecord(value)) {
    throw new Error(`Routing-trip line ${lineNumber} must contain an object`);
  }
  if (typeof value.tripId !== 'string') {
    throw new Error(`Routing-trip line ${lineNumber} has no string tripId`);
  }
  if (typeof value.routeId !== 'string') {
    throw new Error(`Routing-trip line ${lineNumber} has no string routeId`);
  }
  if (typeof value.routeType !== 'number') {
    throw new Error(`Routing-trip line ${lineNumber} has no numeric routeType`);
  }
  if (!Array.isArray(value.stopTimes)) {
    throw new Error(`Routing-trip line ${lineNumber} has no stopTimes array`);
  }
  if (!Array.isArray(value.frequencyWindows)) {
    throw new Error(
      `Routing-trip line ${lineNumber} has no frequencyWindows array`,
    );
  }

  return value as unknown as RoutingTrip;
};

/** Reads the large fixed-day NDJSON file one JSON object at a time. */
export async function* readRoutingTripsNdjson(
  path: string,
): AsyncGenerator<RoutingTrip> {
  const input = createReadStream(path, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
  let lineNumber = 0;

  try {
    for await (const line of lines) {
      lineNumber += 1;
      if (line.length === 0) {
        throw new Error(`Routing-trip line ${lineNumber} is blank`);
      }
      yield parseRoutingTripLine(line, lineNumber);
    }
  } finally {
    lines.close();
    input.destroy();
  }
}
