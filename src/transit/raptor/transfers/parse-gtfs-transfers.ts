import { parse as parseSync } from 'csv-parse/sync';

import type { CsvColumnIndexes } from '../../gtfs/read-csv-rows';
import { USE_QUERY_TRANSFER_TIME } from '../transfer-encoding';
import {
  type GtfsTransferType,
  type ParsedGtfsTransfer,
} from './types';

const REQUIRED_COLUMNS = [
  'from_stop_id',
  'to_stop_id',
  'transfer_type',
] as const;

const optionalValue = (
  row: readonly string[],
  columns: CsvColumnIndexes,
  column: string,
): string | undefined => {
  const index = columns.get(column);
  const value = index === undefined ? undefined : row[index];
  return value === undefined || value.trim().length === 0 ? undefined : value;
};

const requiredValue = (
  row: readonly string[],
  columns: CsvColumnIndexes,
  column: string,
): string => {
  const value = optionalValue(row, columns, column);
  if (value === undefined) {
    throw new Error(`Column "${column}" must not be empty.`);
  }
  return value;
};

const parseTransferType = (value: string): GtfsTransferType => {
  if (!/^[0-5]$/.test(value)) {
    throw new Error(
      `transfer_type must be an integer from 0 through 5; received "${value}".`,
    );
  }
  return Number(value) as GtfsTransferType;
};

const parseMinimumTransferTime = (
  value: string | undefined,
): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (!/^\d+$/.test(value)) {
    throw new Error(
      `min_transfer_time must be a nonnegative integer; received "${value}".`,
    );
  }
  const seconds = Number(value);
  if (
    !Number.isSafeInteger(seconds) ||
    seconds >= USE_QUERY_TRANSFER_TIME
  ) {
    throw new Error(`min_transfer_time exceeds the supported range: "${value}".`);
  }
  return seconds;
};

export const requireGtfsTransferCsvRow = (
  record: unknown,
): readonly string[] => {
  if (!Array.isArray(record)) {
    throw new Error('CSV parser returned a non-array transfer record.');
  }
  return record as string[];
};

export const createGtfsTransferColumnIndexes = (
  header: readonly string[],
): CsvColumnIndexes => {
  const missingColumns = REQUIRED_COLUMNS.filter(
    (column) => !header.includes(column),
  );
  if (missingColumns.length > 0) {
    throw new Error(
      `transfers.txt is missing required column(s): ${missingColumns.join(', ')}.`,
    );
  }
  return new Map(header.map((column, index) => [column, index]));
};

export const parseGtfsTransferRow = (
  row: readonly string[],
  columns: CsvColumnIndexes,
): ParsedGtfsTransfer => ({
  fromStopId: optionalValue(row, columns, 'from_stop_id'),
  toStopId: optionalValue(row, columns, 'to_stop_id'),
  fromRouteId: optionalValue(row, columns, 'from_route_id'),
  toRouteId: optionalValue(row, columns, 'to_route_id'),
  fromTripId: optionalValue(row, columns, 'from_trip_id'),
  toTripId: optionalValue(row, columns, 'to_trip_id'),
  transferType: parseTransferType(
    requiredValue(row, columns, 'transfer_type'),
  ),
  minimumTransferTimeSeconds: parseMinimumTransferTime(
    optionalValue(row, columns, 'min_transfer_time'),
  ),
  serviceId: optionalValue(row, columns, 'service_id'),
});

export const parseGtfsTransfersCsv = (
  csv: string,
): readonly ParsedGtfsTransfer[] => {
  let records: unknown;
  try {
    records = parseSync(csv, {
      bom: true,
      delimiter: ',',
      skip_empty_lines: true,
    });
  } catch (error) {
    throw new Error('Unable to parse transfers.txt.', { cause: error });
  }
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error('transfers.txt is empty.');
  }
  const header = requireGtfsTransferCsvRow(records[0]);
  const columns = createGtfsTransferColumnIndexes(header);
  return records.slice(1).map((record, index) => {
    try {
      return parseGtfsTransferRow(requireGtfsTransferCsvRow(record), columns);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Invalid transfers.txt row ${index + 2}: ${message}`,
        { cause: error },
      );
    }
  });
};
