import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PROJECT_CONFIG } from '../src/config';
import { loadFixedDateGtfsFeed } from '../src/transit/gtfs/load-fixed-date-feed';
import {
  processGtfsCsvRows,
  readCsvColumn,
} from '../src/transit/gtfs/read-csv-rows';
import type { TransitPlace } from '../src/transit/places';
import {
  isRailRouteType,
  parseGtfsTimeToSeconds,
  type TransitPlaceServiceProfileDataset,
} from '../src/transit/service-profiles';
import { createTransitPlaceProfileAccumulator } from '../src/transit/service-profiles/transit-place-profile-accumulator';

const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const GTFS_DIRECTORY = join(PROJECT_ROOT, 'data', 'raw', 'gtfs');
const TRANSIT_PLACES_RELATIVE_PATH =
  'data/processed/transit-places.json';
const TRANSIT_PLACES_PATH = join(PROJECT_ROOT, TRANSIT_PLACES_RELATIVE_PATH);
const OUTPUT_RELATIVE_PATH =
  'data/processed/transit-place-service-profiles.json';
const OUTPUT_PATH = join(PROJECT_ROOT, OUTPUT_RELATIVE_PATH);
const REFERENCE_SCENARIO = PROJECT_CONFIG.transit.referenceScenario;
const SERVICE_DATE = REFERENCE_SCENARIO.serviceDate.replaceAll('-', '');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidPlace(index: number, message: string): never {
  throw new Error(
    `Invalid transit place at index ${index} in ${TRANSIT_PLACES_RELATIVE_PATH}: ${message}.`,
  );
}

function parseTransitPlacesJson(json: string): readonly TransitPlace[] {
  let value: unknown;

  try {
    value = JSON.parse(json);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Unable to parse ${TRANSIT_PLACES_RELATIVE_PATH} as JSON: ${message}`,
      { cause: error },
    );
  }

  if (!Array.isArray(value)) {
    throw new Error(
      `${TRANSIT_PLACES_RELATIVE_PATH} must contain a JSON array.`,
    );
  }

  return value.map((entry, index): TransitPlace => {
    if (!isRecord(entry)) {
      return invalidPlace(index, 'expected an object');
    }

    const { id, name, latitude, longitude, stopIds } = entry;

    if (typeof id !== 'string' || id.trim().length === 0) {
      return invalidPlace(index, '"id" must be a nonempty string');
    }

    if (typeof name !== 'string' || name.trim().length === 0) {
      return invalidPlace(index, '"name" must be a nonempty string');
    }

    if (typeof latitude !== 'number' || !Number.isFinite(latitude)) {
      return invalidPlace(index, '"latitude" must be a finite number');
    }

    if (typeof longitude !== 'number' || !Number.isFinite(longitude)) {
      return invalidPlace(index, '"longitude" must be a finite number');
    }

    if (
      !Array.isArray(stopIds) ||
      !stopIds.every((stopId) => typeof stopId === 'string')
    ) {
      return invalidPlace(index, '"stopIds" must be an array of strings');
    }

    return { id, name, latitude, longitude, stopIds };
  });
}

async function loadTransitPlaces(): Promise<readonly TransitPlace[]> {
  let json: string;

  try {
    json = await readFile(TRANSIT_PLACES_PATH, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Unable to read ${TRANSIT_PLACES_RELATIVE_PATH}: ${message}`,
      { cause: error },
    );
  }

  return parseTransitPlacesJson(json);
}

async function main(): Promise<void> {
  const fixedDateFeed = await loadFixedDateGtfsFeed(
    GTFS_DIRECTORY,
    SERVICE_DATE,
  );
  const activeTrips = new Map(
    [...fixedDateFeed.activeTrips].map(
      ([tripId, { routeId, routeType }]) => [
        tripId,
        { routeId, isRail: isRailRouteType(routeType) },
      ],
    ),
  );
  const places = await loadTransitPlaces();
  const windowStartSeconds = parseGtfsTimeToSeconds(
    REFERENCE_SCENARIO.serviceProfileWindow.start,
  );
  const windowEndSeconds = parseGtfsTimeToSeconds(
    REFERENCE_SCENARIO.serviceProfileWindow.end,
  );
  const accumulator = createTransitPlaceProfileAccumulator(
    places,
    activeTrips,
    windowStartSeconds,
    windowEndSeconds,
  );
  let qualifyingDepartureCount = 0;

  const stopTimeRowCount = await processGtfsCsvRows(
    join(GTFS_DIRECTORY, 'stop_times.txt'),
    ['trip_id', 'departure_time', 'stop_id', 'pickup_type'],
    (row, columns) => {
      if (
        accumulator.addStopTime({
          tripId: readCsvColumn(row, columns, 'trip_id'),
          departureTime: readCsvColumn(row, columns, 'departure_time'),
          stopId: readCsvColumn(row, columns, 'stop_id'),
          pickupType: readCsvColumn(row, columns, 'pickup_type'),
        })
      ) {
        qualifyingDepartureCount += 1;
      }
    },
  );

  const profiles = accumulator.buildProfiles();
  const dataset: TransitPlaceServiceProfileDataset = {
    serviceDate: REFERENCE_SCENARIO.serviceDate,
    departureTime: REFERENCE_SCENARIO.departureTime,
    windowStart: REFERENCE_SCENARIO.serviceProfileWindow.start,
    windowEnd: REFERENCE_SCENARIO.serviceProfileWindow.end,
    profiles,
  };
  const placesWithMorningService = profiles.filter(
    ({ departureCount }) => departureCount > 0,
  ).length;
  const placesWithRailwayService = profiles.filter(
    ({ railDepartureCount }) => railDepartureCount > 0,
  ).length;

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(dataset, null, 2)}\n`, 'utf8');

  console.log(`Reference date: ${REFERENCE_SCENARIO.serviceDate}`);
  console.log(`Departure time: ${REFERENCE_SCENARIO.departureTime}`);
  console.log(
    `Hub window: ${REFERENCE_SCENARIO.serviceProfileWindow.start}–${REFERENCE_SCENARIO.serviceProfileWindow.end}`,
  );
  console.log('');
  console.log(`Active services: ${fixedDateFeed.activeServiceIds.size}`);
  console.log(`Active trips: ${fixedDateFeed.activeTrips.size}`);
  console.log(`Stop-time rows scanned: ${stopTimeRowCount}`);
  console.log(`Qualifying departures: ${qualifyingDepartureCount}`);
  console.log(`Places with morning service: ${placesWithMorningService}`);
  console.log(`Places with railway service: ${placesWithRailwayService}`);
  console.log(`Total transit places: ${profiles.length}`);
  console.log('');
  console.log(`Output: ${OUTPUT_RELATIVE_PATH}`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
