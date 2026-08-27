import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { PROJECT_CONFIG } from '../../../config';
import { prepareFixedDayRoutingData } from '../prepare-fixed-day-routing-data';
import type {
  FixedDayRoutingManifest,
  RoutingTrip,
} from '../types';

const FIXTURE_DIRECTORY = fileURLToPath(new URL('fixtures', import.meta.url));
const GTFS_FILENAMES = [
  'feed_info.txt',
  'calendar.txt',
  'calendar_dates.txt',
  'routes.txt',
  'trips.txt',
  'stop_times.txt',
  'frequencies.txt',
] as const;
const temporaryRoots: string[] = [];

interface FixtureWorkspace {
  readonly root: string;
  readonly gtfsDirectory: string;
  readonly transitStopsPath: string;
  readonly outputDirectory: string;
}

async function createFixtureWorkspace(): Promise<FixtureWorkspace> {
  const root = await mkdtemp(join(tmpdir(), 'jm-commute-routing-'));
  const gtfsDirectory = join(root, 'gtfs');
  const transitStopsPath = join(root, 'transit-stops.json');
  const outputDirectory = join(root, 'output');

  temporaryRoots.push(root);
  await mkdir(gtfsDirectory, { recursive: true });
  await Promise.all(
    GTFS_FILENAMES.map((filename) =>
      copyFile(join(FIXTURE_DIRECTORY, filename), join(gtfsDirectory, filename)),
    ),
  );
  await copyFile(
    join(FIXTURE_DIRECTORY, 'transit-stops.json'),
    transitStopsPath,
  );

  return { root, gtfsDirectory, transitStopsPath, outputDirectory };
}

async function prepareFixture(workspace: FixtureWorkspace) {
  const { referenceScenario } = PROJECT_CONFIG.transit;

  return prepareFixedDayRoutingData({
    gtfsDirectory: workspace.gtfsDirectory,
    transitStopsPath: workspace.transitStopsPath,
    outputDirectory: workspace.outputDirectory,
    serviceDate: referenceScenario.serviceDate,
    routingWindowStart: referenceScenario.morningWindow.start,
    routingWindowEnd: referenceScenario.morningWindow.end,
  });
}

async function readOutput(workspace: FixtureWorkspace): Promise<{
  readonly manifestBytes: Buffer;
  readonly tripsBytes: Buffer;
  readonly manifest: FixedDayRoutingManifest;
  readonly trips: readonly RoutingTrip[];
}> {
  const manifestBytes = await readFile(
    join(workspace.outputDirectory, 'manifest.json'),
  );
  const tripsBytes = await readFile(
    join(workspace.outputDirectory, 'trips.ndjson'),
  );
  const manifest = JSON.parse(
    manifestBytes.toString('utf8'),
  ) as FixedDayRoutingManifest;
  const tripsText = tripsBytes.toString('utf8');
  const trips = tripsText
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line) as RoutingTrip);

  return { manifestBytes, tripsBytes, manifest, trips };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

describe('prepareFixedDayRoutingData', () => {
  it('writes the configured fixed-day subset as deterministic NDJSON', async () => {
    const workspace = await createFixtureWorkspace();
    const result = await prepareFixture(workspace);
    const { manifest, trips, tripsBytes } = await readOutput(workspace);
    const tripIds = trips.map(({ tripId }) => tripId);

    expect(result.activeServiceCount).toBe(1);
    expect(result.activeTripCount).toBe(7);
    expect(result.blankActiveTripTimeCount).toBe(0);
    expect(manifest).toEqual({
      schemaVersion: 1,
      sourceFeedVersion: 'fixture-20260826',
      serviceDate: PROJECT_CONFIG.transit.referenceScenario.serviceDate,
      routingWindowStart:
        PROJECT_CONFIG.transit.referenceScenario.morningWindow.start,
      routingWindowEnd:
        PROJECT_CONFIG.transit.referenceScenario.morningWindow.end,
      tripCount: 6,
      scheduledTripCount: 5,
      frequencyTripCount: 1,
      stopTimeCount: 12,
      frequencyWindowCount: 1,
      excludedBeforeRoutingWindowTripCount: 1,
    });
    expect(tripIds).toEqual([
      'scheduled-exact',
      'before-later',
      'before-only',
      'frequency-special',
      'after-24',
      'tram-after',
    ]);
    expect(tripIds).not.toContain('inactive-trip');
    expect(tripsBytes.toString('utf8')).toMatch(/\n$/);
    expect(tripsBytes.toString('utf8')).not.toContain('\n\n');
  });

  it('preserves complete sequences, conditional pickups, route types, and frequency templates', async () => {
    const workspace = await createFixtureWorkspace();

    await prepareFixture(workspace);

    const { trips } = await readOutput(workspace);
    const scheduledExact = trips.find(
      ({ tripId }) => tripId === 'scheduled-exact',
    );
    const beforeLater = trips.find(({ tripId }) => tripId === 'before-later');
    const frequencySpecial = trips.find(
      ({ tripId }) => tripId === 'frequency-special',
    );
    const after24 = trips.find(({ tripId }) => tripId === 'after-24');
    const tramAfter = trips.find(({ tripId }) => tripId === 'tram-after');

    expect(scheduledExact?.routeType).toBe(700);
    expect(scheduledExact?.stopTimes).toHaveLength(2);
    expect(scheduledExact?.stopTimes[1]).toMatchObject({
      departureTimeSeconds: 28_800,
      pickupType: 2,
      dropOffType: 3,
    });
    expect(beforeLater?.routeType).toBe(102);
    expect(beforeLater?.stopTimes[0]?.departureTimeSeconds).toBe(28_200);
    expect(beforeLater?.stopTimes[1]).toMatchObject({
      pickupType: 3,
      dropOffType: 2,
    });
    expect(frequencySpecial?.routeType).toBe(1300);
    expect(frequencySpecial?.frequencyWindows).toEqual([
      {
        startTimeSeconds: 27_000,
        endTimeSeconds: 34_200,
        headwaySeconds: 600,
        exactTimes: 1,
      },
    ]);
    expect(after24?.stopTimes[1]?.departureTimeSeconds).toBe(90_210);
    expect(tramAfter?.routeType).toBe(0);
  });

  it('writes one valid object per line with stable property ordering and matching counts', async () => {
    const workspace = await createFixtureWorkspace();

    await prepareFixture(workspace);

    const { manifest, trips, tripsBytes } = await readOutput(workspace);
    const lines = tripsBytes.toString('utf8').trimEnd().split('\n');

    expect(lines).toHaveLength(manifest.tripCount);
    expect(lines[0]).toMatch(
      /^\{"tripId":.+,"routeId":.+,"routeType":.+,"stopTimes":.+,"frequencyWindows":.+}$/,
    );
    expect(lines[0]).toContain(
      '"stopId":"stop-1","stopSequence":1,"arrivalTimeSeconds":',
    );
    expect(manifest.stopTimeCount).toBe(
      trips.reduce((count, trip) => count + trip.stopTimes.length, 0),
    );
    expect(manifest.frequencyWindowCount).toBe(
      trips.reduce((count, trip) => count + trip.frequencyWindows.length, 0),
    );
  });

  it('produces byte-identical output on repeated preparation', async () => {
    const workspace = await createFixtureWorkspace();

    await prepareFixture(workspace);
    const first = await readOutput(workspace);
    await prepareFixture(workspace);
    const second = await readOutput(workspace);

    expect(second.manifestBytes).toEqual(first.manifestBytes);
    expect(second.tripsBytes).toEqual(first.tripsBytes);
  });

  it('cleans temporary files after successful preparation', async () => {
    const workspace = await createFixtureWorkspace();

    await prepareFixture(workspace);

    expect((await readdir(workspace.outputDirectory)).toSorted()).toEqual([
      'manifest.json',
      'trips.ndjson',
    ]);
  });

  it('does not replace valid output when later processing fails', async () => {
    const workspace = await createFixtureWorkspace();

    await prepareFixture(workspace);
    const previous = await readOutput(workspace);
    const stopTimesPath = join(workspace.gtfsDirectory, 'stop_times.txt');
    const stopTimes = await readFile(stopTimesPath, 'utf8');

    await writeFile(
      stopTimesPath,
      stopTimes.replace(
        'scheduled-exact,07:55:00,07:55:00',
        'scheduled-exact,,07:55:00',
      ),
      'utf8',
    );

    await expect(prepareFixture(workspace)).rejects.toThrow(
      /1 blank arrival_time or departure_time field/i,
    );

    const current = await readOutput(workspace);

    expect(current.manifestBytes).toEqual(previous.manifestBytes);
    expect(current.tripsBytes).toEqual(previous.tripsBytes);
    expect((await readdir(workspace.outputDirectory)).toSorted()).toEqual([
      'manifest.json',
      'trips.ndjson',
    ]);
  });

  it('rejects an active trip referencing an unknown route', async () => {
    const workspace = await createFixtureWorkspace();
    const tripsPath = join(workspace.gtfsDirectory, 'trips.txt');
    const trips = await readFile(tripsPath, 'utf8');

    await writeFile(
      tripsPath,
      trips.replace(
        'route-bus,service-active,scheduled-exact',
        'unknown-route,service-active,scheduled-exact',
      ),
      'utf8',
    );

    await expect(prepareFixture(workspace)).rejects.toThrow(
      /unknown route_id.*unknown-route/i,
    );
  });

  it('rejects active trip rows that are not grouped contiguously', async () => {
    const workspace = await createFixtureWorkspace();
    const stopTimesPath = join(workspace.gtfsDirectory, 'stop_times.txt');
    const stopTimes = await readFile(stopTimesPath, 'utf8');

    await writeFile(
      stopTimesPath,
      `${stopTimes}scheduled-exact,10:00:00,10:00:00,stop-1,3,0,0\n`,
      'utf8',
    );

    await expect(prepareFixture(workspace)).rejects.toThrow(
      /does not group rows.*scheduled-exact.*contiguously/i,
    );
  });
});
