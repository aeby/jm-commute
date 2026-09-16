import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createWriteStream, type WriteStream } from 'node:fs';
import {
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { finished } from 'node:stream/promises';

import {
  parseGtfsTimeToSeconds,
  validateGtfsDate,
} from '../gtfs';
import { loadFixedDateGtfsFeed } from '../gtfs/load-fixed-date-feed';
import {
  processGtfsCsvRows,
  readCsvColumn,
  readNonemptyCsvId,
  type CsvColumnIndexes,
} from '../gtfs/read-csv-rows';
import { parseTransitStopsJson } from '../stops';
import { parseGtfsFrequencies } from './parse-gtfs-frequencies';
import { shouldRetainRoutingTrip } from './should-retain-routing-trip';
import type {
  FixedDayRoutingManifest,
  RoutingTrip,
} from './types';
import {
  validateRoutingStopTimes,
  type RoutingStopTimeInput,
} from './validate-routing-stop-times';

const MANIFEST_FILENAME = 'manifest.json';
const TRIPS_FILENAME = 'trips.ndjson';

export interface PrepareFixedDayRoutingDataOptions {
  readonly gtfsDirectory: string;
  readonly transitStopsPath: string;
  readonly outputDirectory: string;
  readonly serviceDate: string;
  readonly routingWindowStart: string;
  readonly routingWindowEnd: string;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readUtf8File(path: string, description: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read ${description} at "${path}": ${message}`, {
      cause: error,
    });
  }
}

function serviceDateToGtfsDate(serviceDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) {
    throw new RangeError(
      `Configured service date must use YYYY-MM-DD format: "${serviceDate}".`,
    );
  }

  const gtfsDate = serviceDate.replaceAll('-', '');
  validateGtfsDate(gtfsDate, 'Configured service date');
  return gtfsDate;
}

function writeStreamChunk(
  stream: WriteStream,
  chunk: string,
): void | Promise<void> {
  if (!stream.write(chunk, 'utf8')) {
    return once(stream, 'drain').then(() => undefined);
  }
}

async function closeWriteStream(stream: WriteStream): Promise<void> {
  stream.end();
  await finished(stream);
}

async function removeTemporaryFile(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (
      !isRecord(error) ||
      typeof error.code !== 'string' ||
      error.code !== 'ENOENT'
    ) {
      throw error;
    }
  }
}

export async function prepareFixedDayRoutingData(
  options: PrepareFixedDayRoutingDataOptions,
): Promise<FixedDayRoutingManifest> {
  const gtfsServiceDate = serviceDateToGtfsDate(options.serviceDate);
  const routingWindowStartSeconds = parseGtfsTimeToSeconds(
    options.routingWindowStart,
  );
  const routingWindowEndSeconds = parseGtfsTimeToSeconds(
    options.routingWindowEnd,
  );
  if (routingWindowStartSeconds >= routingWindowEndSeconds) {
    throw new RangeError(
      'Routing morning-window start must be earlier than its end.',
    );
  }
  const fixedDateFeed = await loadFixedDateGtfsFeed(
    options.gtfsDirectory,
    gtfsServiceDate,
  );
  const transitStopsJson = await readUtf8File(
    options.transitStopsPath,
    'processed transit-stop JSON',
  );
  const knownStopIds = new Set(
    parseTransitStopsJson(
      transitStopsJson,
      options.transitStopsPath,
    ).map(({ id }) => id),
  );
  const frequenciesCsv = await readUtf8File(
    join(options.gtfsDirectory, 'frequencies.txt'),
    'frequencies.txt',
  );
  const frequencyWindowsByTripId = parseGtfsFrequencies(
    frequenciesCsv,
    fixedDateFeed.allTripIds,
  );

  await mkdir(options.outputDirectory, { recursive: true });

  const nonce = `${process.pid}-${randomUUID()}`;
  const temporaryManifestPath = join(
    options.outputDirectory,
    `.manifest-${nonce}.tmp`,
  );
  const temporaryTripsPath = join(
    options.outputDirectory,
    `.trips-${nonce}.tmp`,
  );
  const manifestPath = join(options.outputDirectory, MANIFEST_FILENAME);
  const tripsPath = join(options.outputDirectory, TRIPS_FILENAME);
  const tripsStream = createWriteStream(temporaryTripsPath, {
    encoding: 'utf8',
    flags: 'wx',
  });
  const tripsHash = createHash('sha256');
  const completedActiveTripIds = new Set<string>();
  let currentTripId: string | undefined;
  let currentStopTimes: RoutingStopTimeInput[] = [];
  let currentTripHasBlankTime = false;
  let scheduledTripCount = 0;
  let frequencyTripCount = 0;
  let stopTimeCount = 0;
  let frequencyWindowCount = 0;
  let blankActiveTripTimeCount = 0;
  let streamClosed = false;

  const finalizeCurrentTrip = (): void | Promise<void> => {
    if (currentTripId === undefined) {
      return;
    }

    const activeTrip = fixedDateFeed.activeTrips.get(currentTripId);

    if (activeTrip === undefined) {
      return;
    }

    completedActiveTripIds.add(currentTripId);

    if (currentTripHasBlankTime) {
      return;
    }

    const stopTimes = validateRoutingStopTimes(
      currentTripId,
      currentStopTimes,
      knownStopIds,
    );
    const frequencyWindows =
      frequencyWindowsByTripId.get(currentTripId) ?? Object.freeze([]);

    if (
      !shouldRetainRoutingTrip(
        stopTimes,
        frequencyWindows,
        routingWindowStartSeconds,
      )
    ) {
      return;
    }

    const trip: RoutingTrip = {
      tripId: currentTripId,
      routeId: activeTrip.routeId,
      stopTimes,
      frequencyWindows,
    };

    const serializedTrip = `${JSON.stringify(trip)}\n`;
    tripsHash.update(serializedTrip, 'utf8');
    const writeResult = writeStreamChunk(tripsStream, serializedTrip);

    if (frequencyWindows.length > 0) {
      frequencyTripCount += 1;
      frequencyWindowCount += frequencyWindows.length;
    } else {
      scheduledTripCount += 1;
    }

    stopTimeCount += stopTimes.length;
    return writeResult;
  };
  const collectCurrentRow = (
    tripId: string,
    row: readonly string[],
    columns: CsvColumnIndexes,
  ): void => {
    if (!fixedDateFeed.activeTrips.has(tripId)) {
      return;
    }

    const arrivalTime = readCsvColumn(row, columns, 'arrival_time');
    const departureTime = readCsvColumn(row, columns, 'departure_time');

    if (arrivalTime.trim().length === 0) {
      blankActiveTripTimeCount += 1;
      currentTripHasBlankTime = true;
    }

    if (departureTime.trim().length === 0) {
      blankActiveTripTimeCount += 1;
      currentTripHasBlankTime = true;
    }

    currentStopTimes.push({
      stopId: readCsvColumn(row, columns, 'stop_id'),
      stopSequence: readCsvColumn(row, columns, 'stop_sequence'),
      arrivalTime,
      departureTime,
      pickupType: readCsvColumn(row, columns, 'pickup_type'),
      dropOffType: readCsvColumn(row, columns, 'drop_off_type'),
    });
  };
  const beginNewTrip = (
    tripId: string,
    row: readonly string[],
    columns: CsvColumnIndexes,
  ): void => {
    if (
      fixedDateFeed.activeTrips.has(tripId) &&
      completedActiveTripIds.has(tripId)
    ) {
      throw new Error(
        `stop_times.txt does not group rows for trip ${tripId} contiguously.`,
      );
    }

    currentTripId = tripId;
    currentStopTimes = [];
    currentTripHasBlankTime = false;
    collectCurrentRow(tripId, row, columns);
  };

  try {
    await processGtfsCsvRows(
      join(options.gtfsDirectory, 'stop_times.txt'),
      [
        'trip_id',
        'arrival_time',
        'departure_time',
        'stop_id',
        'stop_sequence',
        'pickup_type',
        'drop_off_type',
      ],
      (row, columns) => {
        const tripId = readNonemptyCsvId(row, columns, 'trip_id');

        if (!fixedDateFeed.allTripIds.has(tripId)) {
          throw new Error(
            `stop_times.txt references unknown trip_id "${tripId}".`,
          );
        }

        if (tripId === currentTripId) {
          collectCurrentRow(tripId, row, columns);
          return;
        }

        const finalization = finalizeCurrentTrip();

        if (finalization !== undefined) {
          return finalization.then(() => beginNewTrip(tripId, row, columns));
        }

        beginNewTrip(tripId, row, columns);
      },
    );

    const finalization = finalizeCurrentTrip();

    if (finalization !== undefined) {
      await finalization;
    }

    if (blankActiveTripTimeCount > 0) {
      throw new Error(
        `Active trips contain ${blankActiveTripTimeCount} blank arrival_time or departure_time field(s); interpolation is not implemented.`,
      );
    }

    if (completedActiveTripIds.size !== fixedDateFeed.activeTrips.size) {
      const missingTripId = [...fixedDateFeed.activeTrips.keys()].find(
        (tripId) => !completedActiveTripIds.has(tripId),
      );

      throw new Error(
        `Active trip "${missingTripId ?? 'unknown'}" has no stop_times.txt records.`,
      );
    }

    await closeWriteStream(tripsStream);
    streamClosed = true;
    const tripsSha256 = tripsHash.digest('hex');

    const tripCount = scheduledTripCount + frequencyTripCount;
    const manifest: FixedDayRoutingManifest = {
      ...(fixedDateFeed.feedInfo.version === undefined
        ? {}
        : { sourceFeedVersion: fixedDateFeed.feedInfo.version }),
      serviceDate: options.serviceDate,
      routingWindowStart: options.routingWindowStart,
      routingWindowEnd: options.routingWindowEnd,
      tripsSha256,
      tripCount,
      scheduledTripCount,
      frequencyTripCount,
      stopTimeCount,
      frequencyWindowCount,
    };

    await writeFile(
      temporaryManifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    );
    await rename(temporaryTripsPath, tripsPath);
    await rename(temporaryManifestPath, manifestPath);

    return manifest;
  } finally {
    if (!streamClosed) {
      tripsStream.destroy();
      await finished(tripsStream).catch(() => undefined);
    }

    await removeTemporaryFile(temporaryTripsPath);
    await removeTemporaryFile(temporaryManifestPath);
  }
}
