import { randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  prepareFixedDayRoutingData,
} from './routing/prepare-fixed-day-routing-data';
import type { FixedDayRoutingManifest } from './routing/types';
import { parseGtfsStopsCsv } from './stops';
import type { PublicTransportScenario } from './types';

export interface PrepareDataOptions {
  readonly gtfsDirectory: string;
  readonly stopsPath: string;
  readonly routingDirectory: string;
  readonly scenario: PublicTransportScenario;
}

export interface PrepareDataResult {
  readonly stopCount: number;
  readonly routingManifest: FixedDayRoutingManifest;
}

async function writeUtf8Atomically(
  path: string,
  contents: string,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;

  try {
    await writeFile(temporaryPath, contents, 'utf8');
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

/** Normalizes the raw GTFS inputs needed by the network build. */
export async function prepareData(
  options: PrepareDataOptions,
): Promise<PrepareDataResult> {
  const stopsCsv = await readFile(
    join(options.gtfsDirectory, 'stops.txt'),
    'utf8',
  );
  const stops = parseGtfsStopsCsv(stopsCsv);
  await writeUtf8Atomically(
    options.stopsPath,
    `${JSON.stringify(stops, null, 2)}\n`,
  );

  const routingManifest = await prepareFixedDayRoutingData({
    gtfsDirectory: options.gtfsDirectory,
    transitStopsPath: options.stopsPath,
    outputDirectory: options.routingDirectory,
    serviceDate: options.scenario.serviceDate,
    routingWindowStart: options.scenario.routingWindowStart,
    routingWindowEnd: options.scenario.routingWindowEnd,
  });

  return {
    stopCount: stops.length,
    routingManifest,
  };
}
