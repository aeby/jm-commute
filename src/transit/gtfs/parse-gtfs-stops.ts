import { parse } from 'csv-parse/sync';

import type { TransitLocation, TransitLocationKind } from './types';

const ID_COLUMN = 'stop_id';
const NAME_COLUMN = 'stop_name';
const LATITUDE_COLUMN = 'stop_lat';
const LONGITUDE_COLUMN = 'stop_lon';
const LOCATION_TYPE_COLUMN = 'location_type';
const PARENT_STATION_COLUMN = 'parent_station';

const REQUIRED_COLUMNS = [
  ID_COLUMN,
  NAME_COLUMN,
  LATITUDE_COLUMN,
  LONGITUDE_COLUMN,
  LOCATION_TYPE_COLUMN,
  PARENT_STATION_COLUMN,
] as const;

interface ParsedLocation {
  readonly location: TransitLocation;
  readonly rowNumber: number;
}

function readRequiredField(
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
  locationId: string,
): number {
  const rawValue = readRequiredField(
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
      `GTFS stops CSV row ${rowNumber} (stop_id "${locationId}") has invalid "${columnName}" coordinate: "${rawValue}".`,
    );
  }

  return value;
}

function parseLocationKind(
  value: string,
  rowNumber: number,
): TransitLocationKind | undefined {
  switch (value) {
    case '':
    case '0':
      return 'STOP';
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

function compareById(left: TransitLocation, right: TransitLocation): number {
  if (left.id < right.id) {
    return -1;
  }

  if (left.id > right.id) {
    return 1;
  }

  return 0;
}

function validateParentRelationships(
  locationsById: ReadonlyMap<string, ParsedLocation>,
): void {
  for (const { location, rowNumber } of locationsById.values()) {
    if (location.kind === 'STATION') {
      if (location.parentId !== undefined) {
        throw new Error(
          `GTFS stops CSV row ${rowNumber}: station "${location.id}" must not have parent station "${location.parentId}".`,
        );
      }

      continue;
    }

    if (location.parentId === undefined) {
      continue;
    }

    const parent = locationsById.get(location.parentId);

    if (!parent) {
      throw new Error(
        `GTFS stops CSV row ${rowNumber}: stop "${location.id}" references missing parent station "${location.parentId}".`,
      );
    }

    if (parent.location.kind !== 'STATION') {
      throw new Error(
        `GTFS stops CSV row ${rowNumber}: stop "${location.id}" references "${location.parentId}", which is not a station.`,
      );
    }
  }
}

export function parseGtfsStops(csv: string): readonly TransitLocation[] {
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
  const nameIndex = headers.indexOf(NAME_COLUMN);
  const latitudeIndex = headers.indexOf(LATITUDE_COLUMN);
  const longitudeIndex = headers.indexOf(LONGITUDE_COLUMN);
  const locationTypeIndex = headers.indexOf(LOCATION_TYPE_COLUMN);
  const parentStationIndex = headers.indexOf(PARENT_STATION_COLUMN);
  const locationsById = new Map<string, ParsedLocation>();

  records.slice(1).forEach((row, index) => {
    const rowNumber = index + 2;
    const locationType = row[locationTypeIndex]?.trim() ?? '';
    const kind = parseLocationKind(locationType, rowNumber);

    if (kind === undefined) {
      return;
    }

    const id = readRequiredField(row, idIndex, ID_COLUMN, rowNumber);
    const previousLocation = locationsById.get(id);

    if (previousLocation) {
      throw new Error(
        `GTFS stops CSV row ${rowNumber} has duplicate stop_id "${id}"; first seen at row ${previousLocation.rowNumber}.`,
      );
    }

    const name = readRequiredField(row, nameIndex, NAME_COLUMN, rowNumber);
    const parentId = row[parentStationIndex]?.trim() || undefined;
    const location: TransitLocation = {
      id,
      name,
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
      ...(parentId === undefined ? {} : { parentId }),
    };

    locationsById.set(id, { location, rowNumber });
  });

  validateParentRelationships(locationsById);

  return Array.from(
    locationsById.values(),
    ({ location }) => location,
  ).sort(compareById);
}
