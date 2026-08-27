import { parse } from 'csv-parse/sync';

import { normalizeCityName } from './normalize-city-name';
import { normalizeSwissPostalCode } from './postal-code';
import type { Locality } from './types';

const CITY_COLUMN = 'Ortschaftsname';
const POSTAL_CODE_COLUMN = 'PLZ4';
const LONGITUDE_COLUMN = 'E';
const LATITUDE_COLUMN = 'N';
const ADDRESS_SHARE_COLUMN = 'Adressenanteil';

const REQUIRED_COLUMNS = [
  CITY_COLUMN,
  POSTAL_CODE_COLUMN,
  LONGITUDE_COLUMN,
  LATITUDE_COLUMN,
] as const;

interface Candidate {
  readonly locality: Locality;
  readonly addressShare: number | undefined;
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
      `Localities CSV row ${rowNumber} is missing required field "${columnName}".`,
    );
  }

  return value;
}

function parseCoordinate(
  row: readonly string[],
  columnIndex: number,
  columnName: string,
  coordinateName: 'latitude' | 'longitude',
  rowNumber: number,
): number {
  const rawValue = readRequiredField(
    row,
    columnIndex,
    columnName,
    rowNumber,
  );
  const value = Number(rawValue);
  const minimum = coordinateName === 'latitude' ? -90 : -180;
  const maximum = coordinateName === 'latitude' ? 90 : 180;

  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(
      `Localities CSV row ${rowNumber} has malformed WGS84 ${coordinateName} in "${columnName}": "${rawValue}".`,
    );
  }

  return value;
}

function parseAddressShare(value: string | undefined): number | undefined {
  const normalizedValue = value?.trim().replace(/%$/, '').trim();

  if (!normalizedValue) {
    return undefined;
  }

  const addressShare = Number(normalizedValue);
  return Number.isFinite(addressShare) ? addressShare : undefined;
}

function shouldReplaceCandidate(
  currentAddressShare: number | undefined,
  nextAddressShare: number | undefined,
): boolean {
  if (nextAddressShare === undefined) {
    return false;
  }

  return (
    currentAddressShare === undefined || nextAddressShare > currentAddressShare
  );
}

export function parseLocalitiesCsv(csv: string): readonly Locality[] {
  let records: string[][];

  try {
    records = parse(csv, {
      bom: true,
      delimiter: ';',
      skip_empty_lines: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to parse localities CSV: ${message}`, { cause: error });
  }

  const headers = records[0];

  if (!headers) {
    throw new Error('Localities CSV is missing a header row.');
  }

  const missingColumns = REQUIRED_COLUMNS.filter(
    (column) => !headers.includes(column),
  );

  if (missingColumns.length > 0) {
    throw new Error(
      `Localities CSV is missing required column(s): ${missingColumns.join(', ')}.`,
    );
  }

  const cityIndex = headers.indexOf(CITY_COLUMN);
  const postalCodeIndex = headers.indexOf(POSTAL_CODE_COLUMN);
  const longitudeIndex = headers.indexOf(LONGITUDE_COLUMN);
  const latitudeIndex = headers.indexOf(LATITUDE_COLUMN);
  const addressShareIndex = headers.indexOf(ADDRESS_SHARE_COLUMN);
  const candidatesByKey = new Map<string, Candidate>();

  records.slice(1).forEach((row, index) => {
    const rowNumber = index + 2;
    const city = readRequiredField(row, cityIndex, CITY_COLUMN, rowNumber);
    const postalCode = readRequiredField(
      row,
      postalCodeIndex,
      POSTAL_CODE_COLUMN,
      rowNumber,
    );

    if (normalizeSwissPostalCode(postalCode) === undefined) {
      throw new Error(
        `Localities CSV row ${rowNumber} has malformed postal code in "${POSTAL_CODE_COLUMN}": "${postalCode}". Expected exactly four digits.`,
      );
    }

    const locality: Locality = {
      postalCode,
      city,
      latitude: parseCoordinate(
        row,
        latitudeIndex,
        LATITUDE_COLUMN,
        'latitude',
        rowNumber,
      ),
      longitude: parseCoordinate(
        row,
        longitudeIndex,
        LONGITUDE_COLUMN,
        'longitude',
        rowNumber,
      ),
    };
    const addressShare =
      addressShareIndex === -1
        ? undefined
        : parseAddressShare(row[addressShareIndex]);
    const key = `${postalCode}\u0000${normalizeCityName(city)}`;
    const currentCandidate = candidatesByKey.get(key);

    if (
      !currentCandidate ||
      shouldReplaceCandidate(currentCandidate.addressShare, addressShare)
    ) {
      candidatesByKey.set(key, { locality, addressShare });
    }
  });

  return Array.from(
    candidatesByKey.values(),
    (candidate) => candidate.locality,
  );
}
