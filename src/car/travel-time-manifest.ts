import {
  parseTravelTimeMatrixDescriptor,
  type TravelTimeMatrixDescriptor,
} from '../travel-time-matrix';

export interface CarRoadGraphProvenance {
  readonly sourcePbfSha256: string;
  readonly osrmVersion: string;
  readonly profile: 'car.lua';
  readonly algorithm: 'ch';
}

export interface CarTravelTimeManifest {
  readonly mode: 'CAR';
  readonly matrix: TravelTimeMatrixDescriptor;
  readonly source: {
    readonly sourceMatrixSha256: string;
    readonly anchorsSha256: string;
    readonly localityInputSha256: string;
    readonly roadGraph: CarRoadGraphProvenance;
  };
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const OSRM_VERSION_PATTERN = /^\d+\.\d+\.\d+$/u;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(source: string, path: string, detail: string): never {
  throw new Error(`Invalid car travel-time manifest in ${source} at ${path}: ${detail}.`);
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

function parseSha256(value: unknown, source: string, path: string): string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    return invalid(source, path, 'expected a lowercase SHA-256 digest');
  }
  return value;
}

export function parseCarRoadGraphProvenance(
  value: unknown,
  source = 'value',
  path = 'source.roadGraph',
): CarRoadGraphProvenance {
  if (!isRecord(value)) {
    return invalid(source, path, 'expected an object');
  }
  requireExactKeys(
    value,
    ['sourcePbfSha256', 'osrmVersion', 'profile', 'algorithm'],
    source,
    path,
  );
  const sourcePbfSha256 = parseSha256(
    value.sourcePbfSha256,
    source,
    `${path}.sourcePbfSha256`,
  );
  if (
    typeof value.osrmVersion !== 'string' ||
    !OSRM_VERSION_PATTERN.test(value.osrmVersion)
  ) {
    return invalid(
      source,
      `${path}.osrmVersion`,
      'expected a semantic version such as 26.8.0',
    );
  }
  if (value.profile !== 'car.lua') {
    return invalid(source, `${path}.profile`, 'expected "car.lua"');
  }
  if (value.algorithm !== 'ch') {
    return invalid(source, `${path}.algorithm`, 'expected "ch"');
  }
  return {
    sourcePbfSha256,
    osrmVersion: value.osrmVersion,
    profile: value.profile,
    algorithm: value.algorithm,
  };
}

export function parseCarTravelTimeManifest(
  value: unknown,
  source = 'value',
): CarTravelTimeManifest {
  if (!isRecord(value)) {
    return invalid(source, '$', 'expected an object');
  }
  requireExactKeys(value, ['mode', 'matrix', 'source'], source, '$');
  if (value.mode !== 'CAR') {
    return invalid(source, 'mode', 'expected "CAR"');
  }
  if (!isRecord(value.source)) {
    return invalid(source, 'source', 'expected an object');
  }
  requireExactKeys(
    value.source,
    [
      'sourceMatrixSha256',
      'anchorsSha256',
      'localityInputSha256',
      'roadGraph',
    ],
    source,
    'source',
  );

  return {
    mode: value.mode,
    matrix: parseTravelTimeMatrixDescriptor(
      value.matrix,
      `${source} matrix descriptor`,
    ),
    source: {
      sourceMatrixSha256: parseSha256(
        value.source.sourceMatrixSha256,
        source,
        'source.sourceMatrixSha256',
      ),
      anchorsSha256: parseSha256(
        value.source.anchorsSha256,
        source,
        'source.anchorsSha256',
      ),
      localityInputSha256: parseSha256(
        value.source.localityInputSha256,
        source,
        'source.localityInputSha256',
      ),
      roadGraph: parseCarRoadGraphProvenance(
        value.source.roadGraph,
        source,
      ),
    },
  };
}

export function parseCarTravelTimeManifestJson(
  json: string,
  source = 'car travel-time manifest JSON',
): CarTravelTimeManifest {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to parse ${source}: ${message}`, { cause: error });
  }
  return parseCarTravelTimeManifest(value, source);
}
