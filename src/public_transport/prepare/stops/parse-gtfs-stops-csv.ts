import { parse } from 'csv-parse/sync';

import type { TransitStop, TransitStopKind } from './types';

const ID_COLUMN = 'stop_id';
const LATITUDE_COLUMN = 'stop_lat';
const LONGITUDE_COLUMN = 'stop_lon';
const LOCATION_TYPE_COLUMN = 'location_type';
const PARENT_STATION_COLUMN = 'parent_station';

const REQUIRED_COLUMNS = [
  ID_COLUMN,
  LATITUDE_COLUMN,
  LONGITUDE_COLUMN,
  LOCATION_TYPE_COLUMN,
  PARENT_STATION_COLUMN,
] as const;

interface ParsedStop {
  readonly stop: TransitStop;
  readonly rowNumber: number;
}

function readRequiredIdentifier(
  row: readonly string[],
  columnIndex: number,
  columnName: string,
  rowNumber: number,
): string {
  const value = row[columnIndex];

  if (value === undefined || value.trim().length === 0) {
    throw new Error(
      `GTFS stops CSV row ${rowNumber} is missing required field "${columnName}".`,
    );
  }

  return value;
}

function readRequiredText(
  row: readonly string[],
  columnIndex: number,
  columnName: string,
  rowNumber: number,
): string {
  const value = row[columnIndex]?.trim();

  if (!value) {
    throw new Error(
      `GTFS stops CSV row ${rowNumber} is missing required field "${columnName}".`,
    );
  }

  return value;
}

function parseCoordinate(
  row: readonly string[],
  columnIndex: number,
  columnName: typeof LATITUDE_COLUMN | typeof LONGITUDE_COLUMN,
  rowNumber: number,
  stopId: string,
): number {
  const rawValue = readRequiredText(
    row,
    columnIndex,
    columnName,
    rowNumber,
  );
  const value = Number(rawValue);
  const isLatitude = columnName === LATITUDE_COLUMN;
  const minimum = isLatitude ? -90 : -180;
  const maximum = isLatitude ? 90 : 180;

  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(
      `GTFS stops CSV row ${rowNumber} (stop_id "${stopId}") has invalid "${columnName}" coordinate: "${rawValue}".`,
    );
  }

  return value;
}

function parseStopKind(
  value: string,
  rowNumber: number,
): TransitStopKind | undefined {
  switch (value) {
    case '':
    case '0':
      return 'STOP_OR_PLATFORM';
    case '1':
      return 'STATION';
    case '2':
    case '3':
    case '4':
      return undefined;
    default:
      throw new Error(
        `GTFS stops CSV row ${rowNumber} has unknown "${LOCATION_TYPE_COLUMN}" value: "${value}".`,
      );
  }
}

function compareById(left: TransitStop, right: TransitStop): number {
  if (left.id < right.id) {
    return -1;
  }

  if (left.id > right.id) {
    return 1;
  }

  return 0;
}

function validateParentRelationships(
  stopsById: ReadonlyMap<string, ParsedStop>,
): void {
  for (const { stop, rowNumber } of stopsById.values()) {
    if (stop.kind === 'STATION') {
      if (stop.parentStationId !== undefined) {
        throw new Error(
          `GTFS stops CSV row ${rowNumber}: station "${stop.id}" must not have parent station "${stop.parentStationId}".`,
        );
      }

      continue;
    }

    if (stop.parentStationId === undefined) {
      continue;
    }

    const parent = stopsById.get(stop.parentStationId);

    if (!parent) {
      throw new Error(
        `GTFS stops CSV row ${rowNumber}: stop "${stop.id}" references missing parent station "${stop.parentStationId}".`,
      );
    }

    if (parent.stop.kind !== 'STATION') {
      throw new Error(
        `GTFS stops CSV row ${rowNumber}: stop "${stop.id}" references "${stop.parentStationId}", which is not a station.`,
      );
    }
  }
}

export function parseGtfsStopsCsv(csv: string): readonly TransitStop[] {
  let records: string[][];

  try {
    records = parse(csv, {
      bom: true,
      delimiter: ',',
      skip_empty_lines: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to parse GTFS stops CSV: ${message}`, {
      cause: error,
    });
  }

  const headers = records[0];

  if (!headers) {
    throw new Error('GTFS stops CSV is missing a header row.');
  }

  const missingColumns = REQUIRED_COLUMNS.filter(
    (column) => !headers.includes(column),
  );

  if (missingColumns.length > 0) {
    throw new Error(
      `GTFS stops CSV is missing required column(s): ${missingColumns.join(', ')}.`,
    );
  }

  const idIndex = headers.indexOf(ID_COLUMN);
  const latitudeIndex = headers.indexOf(LATITUDE_COLUMN);
  const longitudeIndex = headers.indexOf(LONGITUDE_COLUMN);
  const locationTypeIndex = headers.indexOf(LOCATION_TYPE_COLUMN);
  const parentStationIndex = headers.indexOf(PARENT_STATION_COLUMN);
  const stopsById = new Map<string, ParsedStop>();

  records.slice(1).forEach((row, index) => {
    const rowNumber = index + 2;
    const locationType = row[locationTypeIndex]?.trim() ?? '';
    const kind = parseStopKind(locationType, rowNumber);

    if (kind === undefined) {
      return;
    }

    const id = readRequiredIdentifier(row, idIndex, ID_COLUMN, rowNumber);
    const previousStop = stopsById.get(id);

    if (previousStop) {
      throw new Error(
        `GTFS stops CSV row ${rowNumber} has duplicate stop_id "${id}"; first seen at row ${previousStop.rowNumber}.`,
      );
    }

    const rawParentStationId = row[parentStationIndex] ?? '';
    const parentStationId =
      rawParentStationId.trim().length === 0 ? undefined : rawParentStationId;
    const stop: TransitStop = {
      id,
      latitude: parseCoordinate(
        row,
        latitudeIndex,
        LATITUDE_COLUMN,
        rowNumber,
        id,
      ),
      longitude: parseCoordinate(
        row,
        longitudeIndex,
        LONGITUDE_COLUMN,
        rowNumber,
        id,
      ),
      kind,
      ...(parentStationId === undefined ? {} : { parentStationId }),
    };

    stopsById.set(id, { stop, rowNumber });
  });

  validateParentRelationships(stopsById);

  return Array.from(stopsById.values(), ({ stop }) => stop).toSorted(
    compareById,
  );
}
