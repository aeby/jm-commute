export type LocalityId = string;

export interface LocalityQuery {
  readonly postalCode: string;
  readonly city: string;
}

export interface Locality {
  readonly localityId: LocalityId;
  readonly postalCode: string;
  readonly city: string;
  readonly latitude: number;
  readonly longitude: number;
  /** Physical station selected for this snapshot; absent when none is active. */
  readonly publicTransportStationName?: string;
}

export interface ReachableLocality {
  readonly localityId: LocalityId;
  readonly travelMinutes: number;
}

const SWISS_POSTAL_CODE = /^[0-9]{4}$/u;
const COMBINING_MARKS = /\p{M}+/gu;
const REPEATED_WHITESPACE = /\s+/gu;

export function normalizeCityName(city: string): string {
  return city
    .trim()
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(REPEATED_WHITESPACE, ' ');
}

export function normalizePostalCode(postalCode: string): string | undefined {
  const normalized = postalCode.trim();
  return SWISS_POSTAL_CODE.test(normalized) ? normalized : undefined;
}

export function createLocalityId(
  postalCode: string,
  city: string,
): LocalityId {
  if (typeof postalCode !== 'string' || typeof city !== 'string') {
    throw new TypeError('Locality postal code and city must be strings.');
  }
  const normalizedPostalCode = normalizePostalCode(postalCode);
  if (normalizedPostalCode === undefined) {
    throw new Error('Locality postal code must contain exactly four digits.');
  }
  const normalizedCity = normalizeCityName(city);
  if (normalizedCity.length === 0) {
    throw new Error('Locality city must not be empty.');
  }
  return `${normalizedPostalCode}:${normalizedCity}`;
}

export function localityQueryKey(postalCode: string, city: string): string {
  return `${postalCode}\u0000${normalizeCityName(city)}`;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseLocality(value: unknown, index: number, source: string): Locality {
  if (!isRecord(value)) {
    throw new Error(`${source} locality ${index} must be an object.`);
  }
  const {
    localityId, postalCode, city, latitude, longitude,
    publicTransportStationName,
  } = value;
  if (
    typeof localityId !== 'string' ||
    localityId.length === 0 ||
    typeof postalCode !== 'string' ||
    normalizePostalCode(postalCode) === undefined ||
    typeof city !== 'string' ||
    normalizeCityName(city).length === 0 ||
    typeof latitude !== 'number' ||
    !Number.isFinite(latitude) ||
    typeof longitude !== 'number' ||
    !Number.isFinite(longitude)
  ) {
    throw new Error(`${source} locality ${index} has incompatible fields.`);
  }
  if (
    publicTransportStationName !== undefined &&
    (typeof publicTransportStationName !== 'string' ||
      publicTransportStationName.trim().length === 0)
  ) {
    throw new Error(`${source} locality ${index} has an invalid publicTransportStationName.`);
  }
  return Object.freeze({
    localityId, postalCode, city, latitude, longitude,
    ...(publicTransportStationName === undefined ? {} : { publicTransportStationName }),
  });
}

export function parseLocalitiesJson(
  json: string,
  source = 'localities JSON',
): readonly Locality[] {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    throw new Error(`Unable to parse ${source}.`, { cause: error });
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${source} must contain a nonempty locality array.`);
  }
  return Object.freeze(
    value.map((locality, index) => parseLocality(locality, index, source)),
  );
}
