import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadFixedDayRoutingDataset } from '../load-fixed-day-routing-dataset';
import { readRoutingTripsNdjson } from '../read-routing-trips-ndjson';
import type { FixedDayRoutingManifest, RoutingTrip } from '../types';

const temporaryDirectories: string[] = [];

const routingTrip = (tripId: string): RoutingTrip => ({
  tripId,
  routeId: 'route',
  routeType: 700,
  stopTimes: [
    {
      stopId: 'a',
      stopSequence: 1,
      arrivalTimeSeconds: 28_800,
      departureTimeSeconds: 28_800,
      pickupType: 0,
      dropOffType: 0,
    },
    {
      stopId: 'b',
      stopSequence: 2,
      arrivalTimeSeconds: 29_400,
      departureTimeSeconds: 29_400,
      pickupType: 0,
      dropOffType: 0,
    },
  ],
  frequencyWindows: [],
});

const manifest = (
  trips: readonly RoutingTrip[],
): FixedDayRoutingManifest => ({
  schemaVersion: 1,
  sourceFeedVersion: 'test-feed',
  serviceDate: '2026-09-07',
  routingWindowStart: '07:00:00',
  routingWindowEnd: '09:00:00',
  tripsSha256: createHash('sha256')
    .update(
      trips.map((trip) => `${JSON.stringify(trip)}\n`).join(''),
    )
    .digest('hex'),
  tripCount: trips.length,
  scheduledTripCount: trips.length,
  frequencyTripCount: 0,
  stopTimeCount: trips.length * 2,
  frequencyWindowCount: 0,
  excludedBeforeRoutingWindowTripCount: 0,
});

const createDataset = async (
  trips: readonly RoutingTrip[],
  manifestOverride: FixedDayRoutingManifest = manifest(trips),
): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'jm-commute-routing-'));
  temporaryDirectories.push(directory);
  await Promise.all([
    writeFile(
      join(directory, 'manifest.json'),
      `${JSON.stringify(manifestOverride, null, 2)}\n`,
      'utf8',
    ),
    writeFile(
      join(directory, 'trips.ndjson'),
      `${trips.map((trip) => JSON.stringify(trip)).join('\n')}\n`,
      'utf8',
    ),
  ]);
  return directory;
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('loadFixedDayRoutingDataset', () => {
  it('streams validated trips and verifies all manifest counts', async () => {
    const expected = [routingTrip('a'), routingTrip('b')];
    const dataset = await loadFixedDayRoutingDataset(
      await createDataset(expected),
    );
    const actual: RoutingTrip[] = [];
    for await (const trip of dataset.trips) {
      actual.push(trip);
    }

    expect(dataset.manifest).toEqual(manifest(expected));
    expect(actual).toEqual(expected);
  });

  it('rejects a manifest that disagrees with the completed stream', async () => {
    const directory = await createDataset(
      [routingTrip('a')],
      { ...manifest([routingTrip('a')]), stopTimeCount: 3 },
    );
    const dataset = await loadFixedDayRoutingDataset(directory);

    await expect(async () => {
      for await (const trip of dataset.trips) {
        void trip;
      }
    }).rejects.toThrow(/stopTimeCount.*3.*2/i);
  });

  it('uses the manifest hash as the final dataset consistency marker', async () => {
    const trip = routingTrip('a');
    const directory = await createDataset([trip], {
      ...manifest([trip]),
      tripsSha256: '0'.repeat(64),
    });
    const dataset = await loadFixedDayRoutingDataset(directory);

    await expect(async () => {
      for await (const value of dataset.trips) {
        void value;
      }
    }).rejects.toThrow(/tripsSha256/i);
  });
});

describe('readRoutingTripsNdjson', () => {
  it('reports malformed JSON and normalized rows with their line number', async () => {
    const directory = await createDataset([routingTrip('a')]);
    const path = join(directory, 'trips.ndjson');
    await writeFile(path, `${JSON.stringify(routingTrip('a'))}\nnot-json\n`);

    await expect(async () => {
      for await (const trip of readRoutingTripsNdjson(path)) {
        void trip;
      }
    }).rejects.toThrow(/line 2/i);
  });

  it('rejects duplicate trip IDs and invalid nested stop times', async () => {
    const directory = await createDataset([routingTrip('a')]);
    const path = join(directory, 'trips.ndjson');
    const duplicate = routingTrip('duplicate');
    await writeFile(
      path,
      `${JSON.stringify(duplicate)}\n${JSON.stringify(duplicate)}\n`,
    );
    await expect(async () => {
      for await (const trip of readRoutingTripsNdjson(path)) {
        void trip;
      }
    }).rejects.toThrow(/duplicate routing trip ID/i);

    await writeFile(
      path,
      `${JSON.stringify({ ...routingTrip('bad'), stopTimes: [] })}\n`,
    );
    await expect(async () => {
      for await (const trip of readRoutingTripsNdjson(path)) {
        void trip;
      }
    }).rejects.toThrow(/at least two/i);
  });
});
