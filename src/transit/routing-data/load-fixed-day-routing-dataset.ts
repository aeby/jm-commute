import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { parseFixedDayRoutingManifestJson } from './parse-fixed-day-routing-manifest-json';
import { readRoutingTripsNdjson } from './read-routing-trips-ndjson';
import type { FixedDayRoutingManifest, RoutingTrip } from './types';

const MANIFEST_FILENAME = 'manifest.json';
const TRIPS_FILENAME = 'trips.ndjson';

export interface FixedDayRoutingDataset {
  readonly manifest: FixedDayRoutingManifest;
  /** Manifest counts are checked when this stream is consumed to completion. */
  readonly trips: AsyncIterable<RoutingTrip>;
}

const validateObservedCounts = (
  manifest: FixedDayRoutingManifest,
  observed: {
    readonly tripCount: number;
    readonly scheduledTripCount: number;
    readonly frequencyTripCount: number;
    readonly stopTimeCount: number;
    readonly frequencyWindowCount: number;
  },
  sourceDescription: string,
): void => {
  const checks: readonly [string, number, number][] = [
    ['tripCount', manifest.tripCount, observed.tripCount],
    [
      'scheduledTripCount',
      manifest.scheduledTripCount,
      observed.scheduledTripCount,
    ],
    [
      'frequencyTripCount',
      manifest.frequencyTripCount,
      observed.frequencyTripCount,
    ],
    ['stopTimeCount', manifest.stopTimeCount, observed.stopTimeCount],
    [
      'frequencyWindowCount',
      manifest.frequencyWindowCount,
      observed.frequencyWindowCount,
    ],
  ];

  for (const [field, expected, actual] of checks) {
    if (expected !== actual) {
      throw new Error(
        `${sourceDescription} ${field} is ${expected}, but the NDJSON stream contains ${actual}.`,
      );
    }
  }
};

async function* validateDatasetTrips(
  path: string,
  manifest: FixedDayRoutingManifest,
  sourceDescription: string,
): AsyncGenerator<RoutingTrip> {
  let tripCount = 0;
  let scheduledTripCount = 0;
  let frequencyTripCount = 0;
  let stopTimeCount = 0;
  let frequencyWindowCount = 0;
  const tripsHash = createHash('sha256');

  for await (const trip of readRoutingTripsNdjson(path)) {
    tripCount += 1;
    stopTimeCount += trip.stopTimes.length;
    frequencyWindowCount += trip.frequencyWindows.length;
    if (trip.frequencyWindows.length === 0) {
      scheduledTripCount += 1;
    } else {
      frequencyTripCount += 1;
    }
    tripsHash.update(`${JSON.stringify(trip)}\n`, 'utf8');
    yield trip;
  }

  const tripsSha256 = tripsHash.digest('hex');
  if (tripsSha256 !== manifest.tripsSha256) {
    throw new Error(
      `${sourceDescription} tripsSha256 is ${manifest.tripsSha256}, but the NDJSON stream is ${tripsSha256}.`,
    );
  }

  validateObservedCounts(
    manifest,
    {
      tripCount,
      scheduledTripCount,
      frequencyTripCount,
      stopTimeCount,
      frequencyWindowCount,
    },
    sourceDescription,
  );
}

export async function loadFixedDayRoutingDataset(
  directory: string,
): Promise<FixedDayRoutingDataset> {
  const manifestPath = join(directory, MANIFEST_FILENAME);
  const tripsPath = join(directory, TRIPS_FILENAME);
  let manifestJson: string;
  try {
    manifestJson = await readFile(manifestPath, 'utf8');
  } catch (error) {
    throw new Error(
      `Unable to read fixed-day routing manifest at "${manifestPath}".`,
      { cause: error },
    );
  }
  const manifest = parseFixedDayRoutingManifestJson(
    manifestJson,
    `fixed-day routing manifest "${manifestPath}"`,
  );

  return {
    manifest,
    trips: validateDatasetTrips(
      tripsPath,
      manifest,
      `fixed-day routing dataset "${directory}"`,
    ),
  };
}
