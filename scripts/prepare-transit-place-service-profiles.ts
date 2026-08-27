import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'csv-parse';

import { REFERENCE_TRANSIT_SCENARIO } from '../src/transit/reference-scenario';
import {
  isRailRouteType,
  parseGtfsTimeToSeconds,
  resolveActiveServiceIds,
  type TransitPlaceServiceProfileDataset,
} from '../src/transit/service-profiles';
import { validateGtfsDate } from '../src/transit/service-profiles/gtfs-date';
import { createTransitPlaceProfileAccumulator } from '../src/transit/service-profiles/transit-place-profile-accumulator';
import { validateFeedDateRange } from '../src/transit/service-profiles/validate-feed-date-range';
import type { TransitPlace } from '../src/transit/places';

const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const GTFS_DIRECTORY = join(PROJECT_ROOT, 'data', 'raw', 'gtfs');
const TRANSIT_PLACES_RELATIVE_PATH =
  'data/processed/transit-places.json';
const TRANSIT_PLACES_PATH = join(PROJECT_ROOT, TRANSIT_PLACES_RELATIVE_PATH);
const OUTPUT_RELATIVE_PATH =
  'data/processed/transit-place-service-profiles.json';
const OUTPUT_PATH = join(PROJECT_ROOT, OUTPUT_RELATIVE_PATH);
const SERVICE_DATE = REFERENCE_TRANSIT_SCENARIO.serviceDate.replaceAll(
  '-',
  '',
);

const CALENDAR_COLUMNS = [
  'service_id',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
  'start_date',
  'end_date',
] as const;

interface CalendarEntry {
  readonly serviceId: string;
  readonly monday: number;
  readonly tuesday: number;
  readonly wednesday: number;
  readonly thursday: number;
  readonly friday: number;
  readonly saturday: number;
  readonly sunday: number;
  readonly startDate: string;
  readonly endDate: string;
}

interface CalendarDateEntry {
  readonly serviceId: string;
  readonly date: string;
  readonly exceptionType: number;
}

interface FeedValidity {
  readonly startDate: string;
  readonly endDate: string;
}

interface ActiveTrip {
  readonly routeId: string;
  readonly isRail: boolean;
}

type CsvColumnIndexes = ReadonlyMap<string, number>;

function readColumn(
  row: readonly string[],
  columnIndexes: CsvColumnIndexes,
  column: string,
): string {
  const index = columnIndexes.get(column);

  if (index === undefined) {
    throw new Error(`Missing internal CSV column index for "${column}".`);
  }

  return row[index] ?? '';
}

function readNonemptyId(
  row: readonly string[],
  columnIndexes: CsvColumnIndexes,
  column: string,
): string {
  const value = readColumn(row, columnIndexes, column);

  if (value.trim().length === 0) {
    throw new Error(`Column "${column}" must contain a nonempty string ID.`);
  }

  return value;
}

function parseWeekdayFlag(value: string, column: string): number {
  if (value === '0') {
    return 0;
  }

  if (value === '1') {
    return 1;
  }

  throw new Error(`Column "${column}" must contain 0 or 1; received "${value}".`);
}

function parseExceptionType(value: string): number {
  if (value === '1') {
    return 1;
  }

  if (value === '2') {
    return 2;
  }

  throw new Error(
    `Column "exception_type" must contain 1 or 2; received "${value}".`,
  );
}

function parseRouteType(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(
      `Column "route_type" must contain a nonnegative integer; received "${value}".`,
    );
  }

  const routeType = Number(value);

  if (!Number.isSafeInteger(routeType)) {
    throw new Error(`Column "route_type" is too large: "${value}".`);
  }

  return routeType;
}

async function processCsvRows(
  path: string,
  requiredColumns: readonly string[],
  processRow: (
    row: readonly string[],
    columnIndexes: CsvColumnIndexes,
    rowNumber: number,
  ) => void,
): Promise<number> {
  const input = createReadStream(path);
  const parser = parse({
    bom: true,
    delimiter: ',',
    skip_empty_lines: true,
  });
  let currentRowNumber = 0;
  let dataRowCount = 0;
  let columnIndexes: CsvColumnIndexes | undefined;

  input.once('error', (error) => parser.destroy(error));
  input.pipe(parser);

  try {
    for await (const record of parser) {
      currentRowNumber += 1;

      if (!Array.isArray(record)) {
        throw new Error('CSV parser returned a non-array record.');
      }

      const row = record as string[];

      if (currentRowNumber === 1) {
        const missingColumns = requiredColumns.filter(
          (column) => !row.includes(column),
        );

        if (missingColumns.length > 0) {
          throw new Error(
            `Missing required column(s): ${missingColumns.join(', ')}.`,
          );
        }

        columnIndexes = new Map(
          requiredColumns.map((column) => [column, row.indexOf(column)]),
        );
        continue;
      }

      if (columnIndexes === undefined) {
        throw new Error('CSV file is missing a header row.');
      }

      processRow(row, columnIndexes, currentRowNumber);
      dataRowCount += 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const relativePath = relative(PROJECT_ROOT, path);
    const rowDescription =
      currentRowNumber === 0 ? '' : ` at row ${currentRowNumber}`;

    throw new Error(
      `Unable to process ${relativePath}${rowDescription}: ${message}`,
      { cause: error },
    );
  } finally {
    input.destroy();
    parser.destroy();
  }

  if (currentRowNumber === 0) {
    throw new Error(`${relative(PROJECT_ROOT, path)} is empty.`);
  }

  return dataRowCount;
}

async function readFeedValidity(): Promise<FeedValidity> {
  const entries: Array<{ startDate: string; endDate: string }> = [];

  await processCsvRows(
    join(GTFS_DIRECTORY, 'feed_info.txt'),
    ['feed_start_date', 'feed_end_date'],
    (row, columns) => {
      entries.push({
        startDate: readColumn(row, columns, 'feed_start_date'),
        endDate: readColumn(row, columns, 'feed_end_date'),
      });
    },
  );

  if (entries.length !== 1) {
    throw new Error(
      `feed_info.txt must contain exactly one data row; found ${entries.length}.`,
    );
  }

  const entry = entries[0];

  if (entry === undefined) {
    throw new Error('feed_info.txt is missing its data row.');
  }

  validateFeedDateRange(entry.startDate, entry.endDate, SERVICE_DATE);
  return entry;
}

function createFeedDateIndexes(
  feedValidity: FeedValidity,
): ReadonlyMap<string, number> {
  const year = Number(feedValidity.startDate.slice(0, 4));
  const month = Number(feedValidity.startDate.slice(4, 6));
  const day = Number(feedValidity.startDate.slice(6, 8));
  const currentDate = new Date(Date.UTC(year, month - 1, day));
  const dateIndexes = new Map<string, number>();

  while (true) {
    const date = [
      currentDate.getUTCFullYear().toString().padStart(4, '0'),
      (currentDate.getUTCMonth() + 1).toString().padStart(2, '0'),
      currentDate.getUTCDate().toString().padStart(2, '0'),
    ].join('');

    if (date > feedValidity.endDate) {
      break;
    }

    dateIndexes.set(date, dateIndexes.size);
    currentDate.setUTCDate(currentDate.getUTCDate() + 1);
  }

  return dateIndexes;
}

async function loadActiveServiceIds(
  feedValidity: FeedValidity,
): Promise<ReadonlySet<string>> {
  const calendarEntries: CalendarEntry[] = [];

  await processCsvRows(
    join(GTFS_DIRECTORY, 'calendar.txt'),
    CALENDAR_COLUMNS,
    (row, columns) => {
      calendarEntries.push({
        serviceId: readNonemptyId(row, columns, 'service_id'),
        monday: parseWeekdayFlag(
          readColumn(row, columns, 'monday'),
          'monday',
        ),
        tuesday: parseWeekdayFlag(
          readColumn(row, columns, 'tuesday'),
          'tuesday',
        ),
        wednesday: parseWeekdayFlag(
          readColumn(row, columns, 'wednesday'),
          'wednesday',
        ),
        thursday: parseWeekdayFlag(
          readColumn(row, columns, 'thursday'),
          'thursday',
        ),
        friday: parseWeekdayFlag(
          readColumn(row, columns, 'friday'),
          'friday',
        ),
        saturday: parseWeekdayFlag(
          readColumn(row, columns, 'saturday'),
          'saturday',
        ),
        sunday: parseWeekdayFlag(
          readColumn(row, columns, 'sunday'),
          'sunday',
        ),
        startDate: readColumn(row, columns, 'start_date'),
        endDate: readColumn(row, columns, 'end_date'),
      });
    },
  );

  const calendarDateEntries: CalendarDateEntry[] = [];
  const feedDateIndexes = createFeedDateIndexes(feedValidity);
  const exceptionDateByteCount = Math.ceil(feedDateIndexes.size / 8);
  const exceptionDatesByServiceId = new Map<string, Uint8Array>();

  await processCsvRows(
    join(GTFS_DIRECTORY, 'calendar_dates.txt'),
    ['service_id', 'date', 'exception_type'],
    (row, columns) => {
      const serviceId = readNonemptyId(row, columns, 'service_id');
      const date = readColumn(row, columns, 'date');
      const exceptionType = parseExceptionType(
        readColumn(row, columns, 'exception_type'),
      );

      validateGtfsDate(date, 'calendar_dates.txt date');

      const dateIndex = feedDateIndexes.get(date);

      if (dateIndex === undefined) {
        throw new RangeError(
          `calendar_dates.txt date ${date} is outside the GTFS feed validity range ${feedValidity.startDate}–${feedValidity.endDate}.`,
        );
      }

      let exceptionDates = exceptionDatesByServiceId.get(serviceId);

      if (exceptionDates === undefined) {
        exceptionDates = new Uint8Array(exceptionDateByteCount);
        exceptionDatesByServiceId.set(serviceId, exceptionDates);
      }

      const byteIndex = Math.floor(dateIndex / 8);
      const bitMask = 1 << (dateIndex % 8);
      const currentByte = exceptionDates[byteIndex] ?? 0;

      if ((currentByte & bitMask) !== 0) {
        throw new Error(
          `Duplicate calendar_dates.txt exception for service_id "${serviceId}" on ${date}.`,
        );
      }

      exceptionDates[byteIndex] = currentByte | bitMask;

      if (date === SERVICE_DATE) {
        calendarDateEntries.push({ serviceId, date, exceptionType });
      }
    },
  );

  return resolveActiveServiceIds(
    calendarEntries,
    calendarDateEntries,
    SERVICE_DATE,
  );
}

async function loadRoutes(): Promise<ReadonlyMap<string, boolean>> {
  const isRailByRouteId = new Map<string, boolean>();

  await processCsvRows(
    join(GTFS_DIRECTORY, 'routes.txt'),
    ['route_id', 'route_type'],
    (row, columns) => {
      const routeId = readNonemptyId(row, columns, 'route_id');

      if (isRailByRouteId.has(routeId)) {
        throw new Error(`Duplicate route_id "${routeId}".`);
      }

      const routeType = parseRouteType(
        readColumn(row, columns, 'route_type'),
      );
      isRailByRouteId.set(routeId, isRailRouteType(routeType));
    },
  );

  return isRailByRouteId;
}

async function loadActiveTrips(
  activeServiceIds: ReadonlySet<string>,
  isRailByRouteId: ReadonlyMap<string, boolean>,
): Promise<ReadonlyMap<string, ActiveTrip>> {
  const activeTrips = new Map<string, ActiveTrip>();
  const seenTripIds = new Set<string>();

  await processCsvRows(
    join(GTFS_DIRECTORY, 'trips.txt'),
    ['trip_id', 'route_id', 'service_id'],
    (row, columns) => {
      const tripId = readNonemptyId(row, columns, 'trip_id');
      const routeId = readNonemptyId(row, columns, 'route_id');
      const serviceId = readNonemptyId(row, columns, 'service_id');

      if (seenTripIds.has(tripId)) {
        throw new Error(`Duplicate trip_id "${tripId}".`);
      }

      seenTripIds.add(tripId);

      if (!activeServiceIds.has(serviceId)) {
        return;
      }

      const isRail = isRailByRouteId.get(routeId);

      if (isRail === undefined) {
        throw new Error(
          `Active trip "${tripId}" references unknown route_id "${routeId}".`,
        );
      }

      activeTrips.set(tripId, { routeId, isRail });
    },
  );

  return activeTrips;
}

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
  const feedValidity = await readFeedValidity();

  const activeServiceIds = await loadActiveServiceIds(feedValidity);
  const isRailByRouteId = await loadRoutes();
  const activeTrips = await loadActiveTrips(
    activeServiceIds,
    isRailByRouteId,
  );
  const places = await loadTransitPlaces();
  const windowStartSeconds = parseGtfsTimeToSeconds(
    REFERENCE_TRANSIT_SCENARIO.hubWindowStart,
  );
  const windowEndSeconds = parseGtfsTimeToSeconds(
    REFERENCE_TRANSIT_SCENARIO.hubWindowEnd,
  );
  const accumulator = createTransitPlaceProfileAccumulator(
    places,
    activeTrips,
    windowStartSeconds,
    windowEndSeconds,
  );
  let qualifyingDepartureCount = 0;

  const stopTimeRowCount = await processCsvRows(
    join(GTFS_DIRECTORY, 'stop_times.txt'),
    ['trip_id', 'departure_time', 'stop_id', 'pickup_type'],
    (row, columns) => {
      if (
        accumulator.addStopTime({
          tripId: readColumn(row, columns, 'trip_id'),
          departureTime: readColumn(row, columns, 'departure_time'),
          stopId: readColumn(row, columns, 'stop_id'),
          pickupType: readColumn(row, columns, 'pickup_type'),
        })
      ) {
        qualifyingDepartureCount += 1;
      }
    },
  );

  const profiles = accumulator.buildProfiles();
  const dataset: TransitPlaceServiceProfileDataset = {
    serviceDate: REFERENCE_TRANSIT_SCENARIO.serviceDate,
    departureTime: REFERENCE_TRANSIT_SCENARIO.departureTime,
    windowStart: REFERENCE_TRANSIT_SCENARIO.hubWindowStart,
    windowEnd: REFERENCE_TRANSIT_SCENARIO.hubWindowEnd,
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

  console.log(`Reference date: ${REFERENCE_TRANSIT_SCENARIO.serviceDate}`);
  console.log(`Departure time: ${REFERENCE_TRANSIT_SCENARIO.departureTime}`);
  console.log(
    `Hub window: ${REFERENCE_TRANSIT_SCENARIO.hubWindowStart}–${REFERENCE_TRANSIT_SCENARIO.hubWindowEnd}`,
  );
  console.log('');
  console.log(`Active services: ${activeServiceIds.size}`);
  console.log(`Active trips: ${activeTrips.size}`);
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
