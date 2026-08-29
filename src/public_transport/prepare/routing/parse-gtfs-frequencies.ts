import { parse } from 'csv-parse/sync';

import {
  readCsvColumn,
  readNonemptyCsvId,
  type CsvColumnIndexes,
} from '../gtfs/read-csv-rows';
import { parseGtfsTimeToSeconds } from '../gtfs';
import type { RoutingFrequencyWindow } from './types';

const REQUIRED_COLUMNS = [
  'trip_id',
  'start_time',
  'end_time',
  'headway_secs',
  'exact_times',
] as const;

function validateExactTimes(value: string, tripId: string): void {
  if (value === '' || value === '0') {
    return;
  }

  if (value === '1') {
    return;
  }

  throw new Error(
    `Frequency trip "${tripId}" has invalid exact_times "${value}"; expected an empty value, 0, or 1.`,
  );
}

function parseHeadwaySeconds(value: string, tripId: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(
      `Frequency trip "${tripId}" headway_secs must be a positive integer; received "${value}".`,
    );
  }

  const headwaySeconds = Number(value);

  if (!Number.isSafeInteger(headwaySeconds) || headwaySeconds <= 0) {
    throw new Error(
      `Frequency trip "${tripId}" headway_secs must be a positive integer; received "${value}".`,
    );
  }

  return headwaySeconds;
}

function parseRecords(csv: string): readonly string[][] {
  let records: unknown;

  try {
    records = parse(csv, {
      bom: true,
      delimiter: ',',
      skip_empty_lines: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to parse frequencies.txt: ${message}`, {
      cause: error,
    });
  }

  if (!Array.isArray(records)) {
    throw new Error('Unable to parse frequencies.txt into CSV records.');
  }

  return records as string[][];
}

function compareFrequencyWindows(
  left: RoutingFrequencyWindow,
  right: RoutingFrequencyWindow,
): number {
  return (
    left.startTimeSeconds - right.startTimeSeconds ||
    left.endTimeSeconds - right.endTimeSeconds ||
    left.headwaySeconds - right.headwaySeconds
  );
}

function parseFrequencyRow(
  row: readonly string[],
  columnIndexes: CsvColumnIndexes,
  knownTripIds: ReadonlySet<string>,
): {
  readonly tripId: string;
  readonly window: RoutingFrequencyWindow;
} {
  const tripId = readNonemptyCsvId(row, columnIndexes, 'trip_id');

  if (!knownTripIds.has(tripId)) {
    throw new Error(
      `frequencies.txt references unknown trip_id "${tripId}".`,
    );
  }

  const startTimeSeconds = parseGtfsTimeToSeconds(
    readCsvColumn(row, columnIndexes, 'start_time'),
  );
  const endTimeSeconds = parseGtfsTimeToSeconds(
    readCsvColumn(row, columnIndexes, 'end_time'),
  );

  if (startTimeSeconds >= endTimeSeconds) {
    throw new RangeError(
      `Frequency trip "${tripId}" must have start_time before end_time.`,
    );
  }

  validateExactTimes(
    readCsvColumn(row, columnIndexes, 'exact_times'),
    tripId,
  );

  return {
    tripId,
    window: Object.freeze({
      startTimeSeconds,
      endTimeSeconds,
      headwaySeconds: parseHeadwaySeconds(
        readCsvColumn(row, columnIndexes, 'headway_secs'),
        tripId,
      ),
    }),
  };
}

export function parseGtfsFrequencies(
  csv: string,
  knownTripIds: ReadonlySet<string>,
): ReadonlyMap<string, readonly RoutingFrequencyWindow[]> {
  const records = parseRecords(csv);
  const header = records[0];

  if (header === undefined) {
    throw new Error('frequencies.txt is empty.');
  }

  const missingColumns = REQUIRED_COLUMNS.filter(
    (column) => !header.includes(column),
  );

  if (missingColumns.length > 0) {
    throw new Error(
      `frequencies.txt is missing required column(s): ${missingColumns.join(', ')}.`,
    );
  }

  const columnIndexes: CsvColumnIndexes = new Map(
    header.map((column, index) => [column, index]),
  );
  const mutableWindowsByTripId = new Map<
    string,
    RoutingFrequencyWindow[]
  >();

  records.slice(1).forEach((row, index) => {
    const rowNumber = index + 2;
    let parsedRow: ReturnType<typeof parseFrequencyRow>;

    try {
      parsedRow = parseFrequencyRow(row, columnIndexes, knownTripIds);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid frequencies.txt row ${rowNumber}: ${message}`, {
        cause: error,
      });
    }

    const existingWindows = mutableWindowsByTripId.get(parsedRow.tripId);

    if (existingWindows === undefined) {
      mutableWindowsByTripId.set(parsedRow.tripId, [parsedRow.window]);
    } else {
      existingWindows.push(parsedRow.window);
    }
  });

  const windowsByTripId = new Map<
    string,
    readonly RoutingFrequencyWindow[]
  >();

  for (const [tripId, mutableWindows] of mutableWindowsByTripId) {
    const windows = mutableWindows.toSorted(compareFrequencyWindows);

    for (let index = 1; index < windows.length; index += 1) {
      const previous = windows[index - 1];
      const current = windows[index];

      if (
        previous !== undefined &&
        current !== undefined &&
        previous.endTimeSeconds > current.startTimeSeconds
      ) {
        throw new Error(
          `Frequency windows overlap for trip_id "${tripId}".`,
        );
      }
    }

    windowsByTripId.set(tripId, Object.freeze(windows));
  }

  return windowsByTripId;
}
