import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { buildNetwork } from '../../network';
import { loadPreparedData } from '../load-prepared-data';
import { prepareData } from '../prepare-data';
import type { PublicTransportScenario } from '../types';

const ROUTING_FIXTURES = fileURLToPath(
  new URL('../routing/__tests__/fixtures', import.meta.url),
);
const COPIED_GTFS_FILES = [
  'feed_info.txt',
  'calendar.txt',
  'calendar_dates.txt',
  'trips.txt',
  'routes.txt',
  'stop_times.txt',
  'frequencies.txt',
] as const;
const SCENARIO: PublicTransportScenario = {
  serviceDate: '2026-09-07',
  routingWindowStart: '07:00:00',
  routingWindowEnd: '09:00:00',
};
const temporaryRoots: string[] = [];

interface Workspace {
  readonly root: string;
  readonly gtfsDirectory: string;
  readonly stopsPath: string;
  readonly routingDirectory: string;
  readonly localitiesPath: string;
  readonly transfersPath: string;
}

function stopsCsv(): string {
  const rows = Array.from({ length: 16 }, (_, index) => {
    const number = index + 1;
    return [
      `stop-${number}`,
      `Stop ${number}`,
      (47 + number / 100).toFixed(2),
      (8 + number / 100).toFixed(2),
      '0',
      '',
    ].join(',');
  });

  return [
    'stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station',
    ...rows,
    '',
  ].join('\n');
}

async function createWorkspace(): Promise<Workspace> {
  const root = await mkdtemp(join(tmpdir(), 'jm-public-transport-prepare-'));
  const gtfsDirectory = join(root, 'gtfs');
  const preparedDirectory = join(root, 'prepared');
  const stopsPath = join(preparedDirectory, 'stops.json');
  const routingDirectory = join(preparedDirectory, 'routing');
  const localitiesPath = join(root, 'localities.csv');
  const transfersPath = join(gtfsDirectory, 'transfers.txt');

  temporaryRoots.push(root);
  await mkdir(gtfsDirectory, { recursive: true });
  await Promise.all(
    COPIED_GTFS_FILES.map((filename) =>
      copyFile(
        join(ROUTING_FIXTURES, filename),
        join(gtfsDirectory, filename),
      ),
    ),
  );
  await Promise.all([
    writeFile(join(gtfsDirectory, 'stops.txt'), stopsCsv(), 'utf8'),
    writeFile(
      transfersPath,
      'from_stop_id,to_stop_id,transfer_type,min_transfer_time\n' +
        'stop-1,stop-2,2,120\n',
      'utf8',
    ),
    writeFile(
      localitiesPath,
      'Ortschaftsname;PLZ4;E;N;Adressenanteil\n' +
        'Near;1000;8.017;47.017;100\n' +
        'Far;2000;8.16;47.16;100\n',
      'utf8',
    ),
  ]);

  return {
    root,
    gtfsDirectory,
    stopsPath,
    routingDirectory,
    localitiesPath,
    transfersPath,
  };
}

async function prepareWorkspace(workspace: Workspace) {
  return prepareData({
    gtfsDirectory: workspace.gtfsDirectory,
    stopsPath: workspace.stopsPath,
    routingDirectory: workspace.routingDirectory,
    scenario: SCENARIO,
  });
}

function loadOptions(workspace: Workspace) {
  return {
    gtfsDirectory: workspace.gtfsDirectory,
    stopsPath: workspace.stopsPath,
    routingDirectory: workspace.routingDirectory,
    localitiesPath: workspace.localitiesPath,
    transfersPath: workspace.transfersPath,
    scenario: SCENARIO,
  } as const;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

describe('prepareData', () => {
  it('normalizes stops and prepares the fixed-day routing dataset', async () => {
    const workspace = await createWorkspace();
    const result = await prepareWorkspace(workspace);

    expect(result).toMatchObject({
      stopCount: 16,
      routingManifest: {
        sourceFeedVersion: 'fixture-20260826',
        serviceDate: SCENARIO.serviceDate,
        routingWindowStart: SCENARIO.routingWindowStart,
        routingWindowEnd: SCENARIO.routingWindowEnd,
        tripCount: 6,
      },
    });
    expect(JSON.parse(await readFile(workspace.stopsPath, 'utf8'))).toHaveLength(
      16,
    );
  });
});

describe('loadPreparedData', () => {
  it('validates and assembles the complete network-build input', async () => {
    const workspace = await createWorkspace();
    await prepareWorkspace(workspace);

    const prepared = await loadPreparedData(loadOptions(workspace));
    const trips = [];
    for await (const trip of prepared.trips) {
      trips.push(trip);
    }
    const transferRules = [];
    for await (const rule of prepared.transferRules) {
      transferRules.push(rule);
    }

    expect(prepared.stops).toHaveLength(16);
    expect(prepared.localities).toEqual([
      {
        localityId: '1000:near',
        postalCode: '1000',
        city: 'Near',
        longitude: 8.017,
        latitude: 47.017,
      },
      {
        localityId: '2000:far',
        postalCode: '2000',
        city: 'Far',
        longitude: 8.16,
        latitude: 47.16,
      },
    ]);
    expect(prepared.activeServiceIds).toEqual(new Set(['service-active']));
    expect(prepared.routingWindowStartSeconds).toBe(7 * 60 * 60);
    expect(prepared.routingWindowEndSeconds).toBe(9 * 60 * 60);
    expect(trips).toHaveLength(6);
    expect(transferRules).toEqual([
      {
        fromStopId: 'stop-1',
        toStopId: 'stop-2',
        fromRouteId: undefined,
        toRouteId: undefined,
        fromTripId: undefined,
        toTripId: undefined,
        transferType: 2,
        minimumTransferTimeSeconds: 120,
        serviceId: undefined,
      },
    ]);
  });

  it('rejects a prepared scenario that differs from the requested scenario', async () => {
    const workspace = await createWorkspace();
    await prepareWorkspace(workspace);

    await expect(
      loadPreparedData({
        ...loadOptions(workspace),
        scenario: { ...SCENARIO, routingWindowStart: '06:00:00' },
      }),
    ).rejects.toThrow(/manifest window.*does not match/i);
  });

  it('feeds the network stage and skips a nearer place without boardable service', async () => {
    const workspace = await createWorkspace();
    await prepareWorkspace(workspace);
    const prepared = await loadPreparedData(loadOptions(workspace));

    const { network, localities } = await buildNetwork({
      trips: prepared.trips,
      transferRules: prepared.transferRules,
      activeServiceIds: prepared.activeServiceIds,
      railByRouteId: prepared.railByRouteId,
      stops: prepared.stops,
      localities: prepared.localities,
      localitySelection: { preferredRadiusMeters: 500, railDepartureBoostPercent: 25 },
      routingWindowStartSeconds: prepared.routingWindowStartSeconds,
      routingWindowEndSeconds: prepared.routingWindowEndSeconds,
    });

    expect(network.sourceStopIds).toHaveLength(12);
    expect(network.patterns).toHaveLength(6);
    expect(network.routingWindowStartSeconds).toBe(7 * 60 * 60);
    expect(network.routingWindowEndSeconds).toBe(9 * 60 * 60);
    const stop2Index = network.sourceStopIds.indexOf('stop-2');
    const stop3Index = network.sourceStopIds.indexOf('stop-3');
    expect(stop2Index).toBeGreaterThanOrEqual(0);
    expect(stop3Index).toBeGreaterThanOrEqual(0);
    expect(network.transfersByStop[0]).toEqual(
      Uint32Array.of(stop2Index, 120),
    );
    expect(localities.entries).toEqual([
      { localityId: '1000:near', stationName: 'Stop 3', stopIndexes: Uint32Array.of(stop3Index) },
      { localityId: '2000:far', stationName: 'Stop 13', stopIndexes: Uint32Array.of(network.sourceStopIds.indexOf('stop-13')) },
    ]);
  });

  it('rejects prepared routing from a different raw feed version', async () => {
    const workspace = await createWorkspace();
    await prepareWorkspace(workspace);
    const feedInfoPath = join(workspace.gtfsDirectory, 'feed_info.txt');
    const feedInfo = await readFile(feedInfoPath, 'utf8');
    await writeFile(
      feedInfoPath,
      feedInfo.replace('fixture-20260826', 'fixture-changed'),
      'utf8',
    );

    await expect(loadPreparedData(loadOptions(workspace))).rejects.toThrow(
      /raw gtfs feed version.*does not match prepared routing feed version/i,
    );
  });
});
