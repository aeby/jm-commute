import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { PROJECT_CONFIG } from '@core/config';
import { parseGtfsTimeToSeconds } from '@core/transit/gtfs';
import {
  loadFixedDateGtfsFeed,
  processGtfsCsvRows,
  readCsvColumn,
} from '@core/transit/gtfs/node';
import {
  parseTransitPlacesJson,
  type TransitPlace,
} from '@core/transit/places';
import {
  isRailRouteType,
  type TransitPlaceServiceProfileDataset,
} from '@core/transit/service-profiles';
import { createTransitPlaceProfileAccumulator } from '@core/transit/service-profiles/transit-place-profile-accumulator';

import { writeUtf8FileAtomically } from '../write-utf8-file-atomically';
import {
  RAW_GTFS_DIRECTORY,
  TRANSIT_PLACES_PATH,
  TRANSIT_PLACE_SERVICE_PROFILES_PATH,
} from './paths';

const TRANSIT_PLACES_RELATIVE_PATH =
  'data/processed/transit/places.json';
const OUTPUT_RELATIVE_PATH =
  'data/processed/transit/place-service-profiles.json';
const REFERENCE_SCENARIO = PROJECT_CONFIG.transit.referenceScenario;
const SERVICE_DATE = REFERENCE_SCENARIO.serviceDate.replaceAll('-', '');

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

  return parseTransitPlacesJson(json, TRANSIT_PLACES_RELATIVE_PATH);
}

async function main(): Promise<void> {
  const fixedDateFeed = await loadFixedDateGtfsFeed(
    RAW_GTFS_DIRECTORY,
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
    REFERENCE_SCENARIO.morningWindow.start,
  );
  const windowEndSeconds = parseGtfsTimeToSeconds(
    REFERENCE_SCENARIO.morningWindow.end,
  );
  const accumulator = createTransitPlaceProfileAccumulator(
    places,
    activeTrips,
    windowStartSeconds,
    windowEndSeconds,
  );
  let qualifyingDepartureCount = 0;

  const stopTimeRowCount = await processGtfsCsvRows(
    resolve(RAW_GTFS_DIRECTORY, 'stop_times.txt'),
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
    windowStart: REFERENCE_SCENARIO.morningWindow.start,
    windowEnd: REFERENCE_SCENARIO.morningWindow.end,
    profiles,
  };
  const placesWithMorningService = profiles.filter(
    ({ departureCount }) => departureCount > 0,
  ).length;
  const placesWithRailwayService = profiles.filter(
    ({ railDepartureCount }) => railDepartureCount > 0,
  ).length;

  await writeUtf8FileAtomically(
    TRANSIT_PLACE_SERVICE_PROFILES_PATH,
    `${JSON.stringify(dataset, null, 2)}\n`,
  );

  console.log(`Reference date: ${REFERENCE_SCENARIO.serviceDate}`);
  console.log(
    `Morning window: ${REFERENCE_SCENARIO.morningWindow.start}–${REFERENCE_SCENARIO.morningWindow.end}`,
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
