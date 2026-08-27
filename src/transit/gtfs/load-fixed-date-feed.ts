import { join } from 'node:path';

import { resolveActiveServiceIds } from '../service-profiles';
import { validateGtfsDate } from '../service-profiles/gtfs-date';
import { validateFeedDateRange } from '../service-profiles/validate-feed-date-range';
import {
  processGtfsCsvRows,
  readCsvColumn,
  readNonemptyCsvId,
  readOptionalCsvColumn,
} from './read-csv-rows';

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

export interface FixedDateFeedInfo {
  readonly startDate: string;
  readonly endDate: string;
  readonly version?: string;
}

export interface ActiveGtfsTrip {
  readonly routeId: string;
  readonly routeType: number;
}

export interface FixedDateGtfsFeed {
  readonly feedInfo: FixedDateFeedInfo;
  readonly activeServiceIds: ReadonlySet<string>;
  readonly routeTypeByRouteId: ReadonlyMap<string, number>;
  readonly allTripIds: ReadonlySet<string>;
  readonly activeTrips: ReadonlyMap<string, ActiveGtfsTrip>;
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

async function loadFeedInfo(
  gtfsDirectory: string,
  serviceDate: string,
): Promise<FixedDateFeedInfo> {
  const entries: FixedDateFeedInfo[] = [];

  await processGtfsCsvRows(
    join(gtfsDirectory, 'feed_info.txt'),
    ['feed_start_date', 'feed_end_date'],
    (row, columns) => {
      const version = readOptionalCsvColumn(row, columns, 'feed_version');

      entries.push({
        startDate: readCsvColumn(row, columns, 'feed_start_date'),
        endDate: readCsvColumn(row, columns, 'feed_end_date'),
        ...(version === undefined || version.trim().length === 0
          ? {}
          : { version }),
      });
    },
  );

  if (entries.length !== 1) {
    throw new Error(
      `feed_info.txt must contain exactly one data row; found ${entries.length}.`,
    );
  }

  const feedInfo = entries[0];

  if (feedInfo === undefined) {
    throw new Error('feed_info.txt is missing its data row.');
  }

  validateFeedDateRange(feedInfo.startDate, feedInfo.endDate, serviceDate);
  return feedInfo;
}

function createFeedDateIndexes(
  feedInfo: FixedDateFeedInfo,
): ReadonlyMap<string, number> {
  const year = Number(feedInfo.startDate.slice(0, 4));
  const month = Number(feedInfo.startDate.slice(4, 6));
  const day = Number(feedInfo.startDate.slice(6, 8));
  const currentDate = new Date(Date.UTC(year, month - 1, day));
  const dateIndexes = new Map<string, number>();

  while (true) {
    const date = [
      currentDate.getUTCFullYear().toString().padStart(4, '0'),
      (currentDate.getUTCMonth() + 1).toString().padStart(2, '0'),
      currentDate.getUTCDate().toString().padStart(2, '0'),
    ].join('');

    if (date > feedInfo.endDate) {
      break;
    }

    dateIndexes.set(date, dateIndexes.size);
    currentDate.setUTCDate(currentDate.getUTCDate() + 1);
  }

  return dateIndexes;
}

async function loadActiveServiceIds(
  gtfsDirectory: string,
  feedInfo: FixedDateFeedInfo,
  serviceDate: string,
): Promise<ReadonlySet<string>> {
  const calendarEntries: CalendarEntry[] = [];

  await processGtfsCsvRows(
    join(gtfsDirectory, 'calendar.txt'),
    CALENDAR_COLUMNS,
    (row, columns) => {
      calendarEntries.push({
        serviceId: readNonemptyCsvId(row, columns, 'service_id'),
        monday: parseWeekdayFlag(
          readCsvColumn(row, columns, 'monday'),
          'monday',
        ),
        tuesday: parseWeekdayFlag(
          readCsvColumn(row, columns, 'tuesday'),
          'tuesday',
        ),
        wednesday: parseWeekdayFlag(
          readCsvColumn(row, columns, 'wednesday'),
          'wednesday',
        ),
        thursday: parseWeekdayFlag(
          readCsvColumn(row, columns, 'thursday'),
          'thursday',
        ),
        friday: parseWeekdayFlag(
          readCsvColumn(row, columns, 'friday'),
          'friday',
        ),
        saturday: parseWeekdayFlag(
          readCsvColumn(row, columns, 'saturday'),
          'saturday',
        ),
        sunday: parseWeekdayFlag(
          readCsvColumn(row, columns, 'sunday'),
          'sunday',
        ),
        startDate: readCsvColumn(row, columns, 'start_date'),
        endDate: readCsvColumn(row, columns, 'end_date'),
      });
    },
  );

  const calendarDateEntries: CalendarDateEntry[] = [];
  const feedDateIndexes = createFeedDateIndexes(feedInfo);
  const exceptionDateByteCount = Math.ceil(feedDateIndexes.size / 8);
  const exceptionDatesByServiceId = new Map<string, Uint8Array>();

  await processGtfsCsvRows(
    join(gtfsDirectory, 'calendar_dates.txt'),
    ['service_id', 'date', 'exception_type'],
    (row, columns) => {
      const serviceId = readNonemptyCsvId(row, columns, 'service_id');
      const date = readCsvColumn(row, columns, 'date');
      const exceptionType = parseExceptionType(
        readCsvColumn(row, columns, 'exception_type'),
      );

      validateGtfsDate(date, 'calendar_dates.txt date');

      const dateIndex = feedDateIndexes.get(date);

      if (dateIndex === undefined) {
        throw new RangeError(
          `calendar_dates.txt date ${date} is outside the GTFS feed validity range ${feedInfo.startDate}–${feedInfo.endDate}.`,
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

      if (date === serviceDate) {
        calendarDateEntries.push({ serviceId, date, exceptionType });
      }
    },
  );

  return resolveActiveServiceIds(
    calendarEntries,
    calendarDateEntries,
    serviceDate,
  );
}

async function loadRouteTypes(
  gtfsDirectory: string,
): Promise<ReadonlyMap<string, number>> {
  const routeTypeByRouteId = new Map<string, number>();

  await processGtfsCsvRows(
    join(gtfsDirectory, 'routes.txt'),
    ['route_id', 'route_type'],
    (row, columns) => {
      const routeId = readNonemptyCsvId(row, columns, 'route_id');

      if (routeTypeByRouteId.has(routeId)) {
        throw new Error(`Duplicate route_id "${routeId}".`);
      }

      routeTypeByRouteId.set(
        routeId,
        parseRouteType(readCsvColumn(row, columns, 'route_type')),
      );
    },
  );

  return routeTypeByRouteId;
}

async function loadTrips(
  gtfsDirectory: string,
  activeServiceIds: ReadonlySet<string>,
  routeTypeByRouteId: ReadonlyMap<string, number>,
): Promise<{
  readonly allTripIds: ReadonlySet<string>;
  readonly activeTrips: ReadonlyMap<string, ActiveGtfsTrip>;
}> {
  const allTripIds = new Set<string>();
  const activeTrips = new Map<string, ActiveGtfsTrip>();

  await processGtfsCsvRows(
    join(gtfsDirectory, 'trips.txt'),
    ['trip_id', 'route_id', 'service_id'],
    (row, columns) => {
      const tripId = readNonemptyCsvId(row, columns, 'trip_id');
      const routeId = readNonemptyCsvId(row, columns, 'route_id');
      const serviceId = readNonemptyCsvId(row, columns, 'service_id');

      if (allTripIds.has(tripId)) {
        throw new Error(`Duplicate trip_id "${tripId}".`);
      }

      allTripIds.add(tripId);

      if (!activeServiceIds.has(serviceId)) {
        return;
      }

      const routeType = routeTypeByRouteId.get(routeId);

      if (routeType === undefined) {
        throw new Error(
          `Active trip "${tripId}" references unknown route_id "${routeId}".`,
        );
      }

      activeTrips.set(tripId, { routeId, routeType });
    },
  );

  return { allTripIds, activeTrips };
}

export async function loadFixedDateGtfsFeed(
  gtfsDirectory: string,
  serviceDate: string,
): Promise<FixedDateGtfsFeed> {
  validateGtfsDate(serviceDate, 'Configured service date');

  const feedInfo = await loadFeedInfo(gtfsDirectory, serviceDate);
  const activeServiceIds = await loadActiveServiceIds(
    gtfsDirectory,
    feedInfo,
    serviceDate,
  );
  const routeTypeByRouteId = await loadRouteTypes(gtfsDirectory);
  const { allTripIds, activeTrips } = await loadTrips(
    gtfsDirectory,
    activeServiceIds,
    routeTypeByRouteId,
  );

  return {
    feedInfo,
    activeServiceIds,
    routeTypeByRouteId,
    allTripIds,
    activeTrips,
  };
}
