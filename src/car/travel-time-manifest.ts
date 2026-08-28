import {
  parseTravelTimeMatrixDescriptor,
  type TravelTimeMatrixDescriptor,
} from '../travel-time-matrix';
import {
  parseCarRoadGraphMetadata,
  type CarRoadGraphMetadata,
} from './road-graph-metadata';

export interface CarTravelTimeManifest {
  readonly mode: 'CAR';
  readonly matrix: TravelTimeMatrixDescriptor;
  readonly source: {
    readonly sourceMatrixSha256: string;
    readonly anchorsSha256: string;
    readonly localityInputSha256: string;
    readonly roadGraph: CarRoadGraphMetadata;
  };
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

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
      roadGraph: parseCarRoadGraphMetadata(
        value.source.roadGraph,
        'source.roadGraph',
        (path, detail) => invalid(source, path, detail),
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
