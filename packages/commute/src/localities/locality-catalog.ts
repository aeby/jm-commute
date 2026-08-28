import { LocalityResolver } from './locality-resolver.js';
import { createLocalityId } from './locality-id.js';
import { normalizeCityName } from './normalize-city-name.js';
import { normalizeSwissPostalCode } from './postal-code.js';
import type { Locality, LocalityId, LocalityQuery } from './types.js';

export const LOCALITY_CATALOG_SCHEMA_VERSION = 1;

export interface LocalityCatalogFile {
  readonly schemaVersion: 1;
  readonly localityCount: number;
  readonly orderedLocalitySha256: string;
  readonly localities: readonly Locality[];
}

const localityCatalogBrand: unique symbol = Symbol('LocalityCatalog');

/** Opaque, immutable lookup over the canonical ordered locality catalog. */
export interface LocalityCatalog {
  readonly [localityCatalogBrand]: true;

  all(): readonly Locality[];

  get(localityId: LocalityId): Locality | undefined;

  resolve(query: LocalityQuery): Locality | undefined;
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(source: string, path: string, detail: string): never {
  throw new Error(
    `Invalid locality catalog in ${source} at ${path}: ${detail}.`,
  );
}

function requireExactKeys(
  value: Readonly<Record<string, unknown>>,
  expectedKeys: readonly string[],
  source: string,
  path: string,
): void {
  const expected = new Set(expectedKeys);
  const actualKeys = Object.keys(value);
  const actual = new Set(actualKeys);
  const missing = expectedKeys.filter((key) => !actual.has(key));
  if (missing.length > 0) {
    invalid(source, path, `missing field(s) ${missing.join(', ')}`);
  }
  const unexpected = actualKeys.filter((key) => !expected.has(key));
  if (unexpected.length > 0) {
    invalid(source, path, `unexpected field(s) ${unexpected.join(', ')}`);
  }
}

function parseCoordinate(
  value: unknown,
  minimum: number,
  maximum: number,
  source: string,
  path: string,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    return invalid(
      source,
      path,
      `expected a finite number between ${minimum} and ${maximum}`,
    );
  }
  return value;
}

function parseLocality(
  value: unknown,
  index: number,
  source: string,
): Locality {
  const path = `localities[${index}]`;
  if (!isRecord(value)) {
    return invalid(source, path, 'expected an object');
  }
  requireExactKeys(
    value,
    ['localityId', 'postalCode', 'city', 'latitude', 'longitude'],
    source,
    path,
  );
  if (
    typeof value.localityId !== 'string' ||
    value.localityId.length === 0 ||
    value.localityId.trim() !== value.localityId
  ) {
    return invalid(
      source,
      `${path}.localityId`,
      'expected a nonempty canonical locality ID',
    );
  }
  if (
    typeof value.postalCode !== 'string' ||
    normalizeSwissPostalCode(value.postalCode) !== value.postalCode
  ) {
    return invalid(
      source,
      `${path}.postalCode`,
      'expected exactly four digits',
    );
  }
  if (
    typeof value.city !== 'string' ||
    value.city.length === 0 ||
    value.city.trim() !== value.city ||
    normalizeCityName(value.city).length === 0
  ) {
    return invalid(
      source,
      `${path}.city`,
      'expected a nonempty trimmed city name',
    );
  }
  const canonicalLocalityId = createLocalityId(value.postalCode, value.city);
  if (value.localityId !== canonicalLocalityId) {
    return invalid(
      source,
      `${path}.localityId`,
      `expected canonical ID "${canonicalLocalityId}" for postal code and city`,
    );
  }
  return Object.freeze({
    localityId: value.localityId,
    postalCode: value.postalCode,
    city: value.city,
    latitude: parseCoordinate(
      value.latitude,
      -90,
      90,
      source,
      `${path}.latitude`,
    ),
    longitude: parseCoordinate(
      value.longitude,
      -180,
      180,
      source,
      `${path}.longitude`,
    ),
  });
}

function resolverKey(locality: Locality): string {
  return `${locality.postalCode}\u0000${normalizeCityName(locality.city)}`;
}

/** The canonical digest preimage: UTF-8 JSON of the ordered locality IDs. */
export function serializeOrderedLocalityIds(
  localities: readonly Pick<Locality, 'localityId'>[],
): string {
  return JSON.stringify(localities.map(({ localityId }) => localityId));
}

export function parseLocalityCatalogFile(
  value: unknown,
  source = 'value',
): LocalityCatalogFile {
  if (!isRecord(value)) {
    return invalid(source, '$', 'expected an object');
  }
  requireExactKeys(
    value,
    [
      'schemaVersion',
      'localityCount',
      'orderedLocalitySha256',
      'localities',
    ],
    source,
    '$',
  );
  if (value.schemaVersion !== LOCALITY_CATALOG_SCHEMA_VERSION) {
    return invalid(source, 'schemaVersion', 'expected 1');
  }
  if (
    !Number.isSafeInteger(value.localityCount) ||
    (value.localityCount as number) <= 0
  ) {
    return invalid(
      source,
      'localityCount',
      'expected a positive safe integer',
    );
  }
  if (
    typeof value.orderedLocalitySha256 !== 'string' ||
    !SHA256_PATTERN.test(value.orderedLocalitySha256)
  ) {
    return invalid(
      source,
      'orderedLocalitySha256',
      'expected a lowercase SHA-256 digest',
    );
  }
  if (!Array.isArray(value.localities)) {
    return invalid(source, 'localities', 'expected an array');
  }
  const localityCount = value.localityCount as number;
  if (value.localities.length !== localityCount) {
    return invalid(
      source,
      'localities',
      `has ${value.localities.length} entries; expected ${localityCount}`,
    );
  }

  const localities = value.localities.map((locality, index) =>
    parseLocality(locality, index, source),
  );
  const seenLocalityIds = new Set<LocalityId>();
  const seenResolverKeys = new Set<string>();
  for (let index = 0; index < localities.length; index += 1) {
    const locality = localities[index] as Locality;
    if (seenLocalityIds.has(locality.localityId)) {
      return invalid(
        source,
        `localities[${index}].localityId`,
        `duplicate locality ID "${locality.localityId}"`,
      );
    }
    seenLocalityIds.add(locality.localityId);
    const key = resolverKey(locality);
    if (seenResolverKeys.has(key)) {
      return invalid(
        source,
        `localities[${index}]`,
        'duplicate normalized postal-code/city resolver key',
      );
    }
    seenResolverKeys.add(key);
  }

  return Object.freeze({
    schemaVersion: LOCALITY_CATALOG_SCHEMA_VERSION,
    localityCount,
    orderedLocalitySha256: value.orderedLocalitySha256,
    localities: Object.freeze(localities),
  });
}

export function parseLocalityCatalogFileJson(
  json: string,
  source = 'locality catalog JSON',
): LocalityCatalogFile {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to parse ${source}: ${message}`, { cause: error });
  }
  return parseLocalityCatalogFile(value, source);
}

export function createLocalityCatalog(file: unknown): LocalityCatalog {
  const parsed = parseLocalityCatalogFile(file, 'locality catalog');
  const localities = parsed.localities;
  const localitiesById = new Map(
    localities.map((locality) => [locality.localityId, locality]),
  );
  const resolver = new LocalityResolver(localities);

  return Object.freeze({
    [localityCatalogBrand]: true as const,
    all: () => localities,
    get: (localityId: LocalityId) => localitiesById.get(localityId),
    resolve: (query: LocalityQuery) => resolver.resolve(query),
  });
}
