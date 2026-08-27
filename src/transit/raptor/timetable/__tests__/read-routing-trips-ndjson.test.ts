import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { RoutingTrip } from '../../../routing-data';
import { readRoutingTripsNdjson } from '../read-routing-trips-ndjson';

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

const createFile = async (contents: string): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'jm-commute-raptor-'));
  temporaryDirectories.push(directory);
  const path = join(directory, 'trips.ndjson');
  await writeFile(path, contents, 'utf8');
  return path;
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('readRoutingTripsNdjson', () => {
  it('exposes line-delimited input as an AsyncIterable of trips', async () => {
    const expected = [routingTrip('a'), routingTrip('b')];
    const path = await createFile(
      `${expected.map((trip) => JSON.stringify(trip)).join('\n')}\n`,
    );
    const actual: RoutingTrip[] = [];

    for await (const trip of readRoutingTripsNdjson(path)) {
      actual.push(trip);
    }

    expect(actual).toEqual(expected);
  });

  it('fails with a useful line number for malformed input', async () => {
    const path = await createFile(
      `${JSON.stringify(routingTrip('a'))}\nnot-json\n`,
    );

    await expect(async () => {
      for await (const trip of readRoutingTripsNdjson(path)) {
        // Consume the stream.
        void trip;
      }
    }).rejects.toThrow(/line 2/i);
  });
});
