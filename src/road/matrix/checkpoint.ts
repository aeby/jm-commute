import {
  MATRIX_BYTES_PER_CELL,
  MAX_TRAVEL_MINUTES,
} from '@commute-internal/matrix';

export const ROAD_MATRIX_CHECKPOINT_SCHEMA_VERSION = 1;

export interface RoadMatrixResumeIdentity {
  readonly localityCount: number;
  readonly blockSize: number;
  readonly maxTravelMinutes: 240;
  readonly valueEncoding: 'UINT8';
  readonly anchorsSha256: string;
}

export interface RoadMatrixCheckpoint extends RoadMatrixResumeIdentity {
  readonly schemaVersion: 1;
  readonly nextOriginIndex: number;
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

function invalid(source: string, path: string, detail: string): never {
  throw new Error(
    `Invalid road travel-time matrix checkpoint in ${source} at ${path}: ${detail}.`,
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseRoadMatrixCheckpoint(
  value: unknown,
  source = 'value',
): RoadMatrixCheckpoint {
  if (!isRecord(value)) {
    return invalid(source, '$', 'expected an object');
  }
  const expectedKeys = [
    'schemaVersion',
    'localityCount',
    'blockSize',
    'maxTravelMinutes',
    'valueEncoding',
    'anchorsSha256',
    'nextOriginIndex',
  ];
  const actualKeys = Object.keys(value);
  const missing = expectedKeys.filter((key) => !(key in value));
  const unexpected = actualKeys.filter((key) => !expectedKeys.includes(key));
  if (missing.length > 0 || unexpected.length > 0) {
    return invalid(
      source,
      '$',
      `fields differ (missing: ${missing.join(', ') || 'none'}; unexpected: ${unexpected.join(', ') || 'none'})`,
    );
  }
  if (value.schemaVersion !== ROAD_MATRIX_CHECKPOINT_SCHEMA_VERSION) {
    return invalid(source, 'schemaVersion', 'expected 1');
  }
  if (
    !Number.isSafeInteger(value.localityCount) ||
    (value.localityCount as number) <= 0
  ) {
    return invalid(source, 'localityCount', 'expected a positive integer');
  }
  const localityCount = value.localityCount as number;
  if (
    !Number.isSafeInteger(value.blockSize) ||
    (value.blockSize as number) <= 0 ||
    (value.blockSize as number) > localityCount
  ) {
    return invalid(source, 'blockSize', 'expected a valid positive block size');
  }
  const blockSize = value.blockSize as number;
  if (value.maxTravelMinutes !== MAX_TRAVEL_MINUTES) {
    return invalid(source, 'maxTravelMinutes', 'expected 240');
  }
  if (value.valueEncoding !== 'UINT8') {
    return invalid(source, 'valueEncoding', 'expected "UINT8"');
  }
  if (
    typeof value.anchorsSha256 !== 'string' ||
    !SHA256_PATTERN.test(value.anchorsSha256)
  ) {
    return invalid(source, 'anchorsSha256', 'expected a SHA-256 digest');
  }
  if (
    !Number.isSafeInteger(value.nextOriginIndex) ||
    (value.nextOriginIndex as number) < 0 ||
    (value.nextOriginIndex as number) > localityCount
  ) {
    return invalid(source, 'nextOriginIndex', 'expected a valid row index');
  }
  const nextOriginIndex = value.nextOriginIndex as number;
  if (nextOriginIndex !== localityCount && nextOriginIndex % blockSize !== 0) {
    return invalid(
      source,
      'nextOriginIndex',
      'expected a completed block boundary',
    );
  }
  return Object.freeze({
    schemaVersion: ROAD_MATRIX_CHECKPOINT_SCHEMA_VERSION,
    localityCount,
    blockSize,
    maxTravelMinutes: MAX_TRAVEL_MINUTES,
    valueEncoding: value.valueEncoding,
    anchorsSha256: value.anchorsSha256,
    nextOriginIndex,
  });
}

export function parseRoadMatrixCheckpointJson(
  json: string,
  source = 'road matrix checkpoint JSON',
): RoadMatrixCheckpoint {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    throw new Error(`Unable to parse ${source}.`, { cause: error });
  }
  return parseRoadMatrixCheckpoint(value, source);
}

export function createRoadMatrixCheckpoint(
  identity: RoadMatrixResumeIdentity,
  nextOriginIndex: number,
): RoadMatrixCheckpoint {
  return parseRoadMatrixCheckpoint(
    {
      schemaVersion: ROAD_MATRIX_CHECKPOINT_SCHEMA_VERSION,
      ...identity,
      nextOriginIndex,
    },
    'generated road matrix checkpoint',
  );
}

export function serializeRoadMatrixCheckpoint(
  checkpoint: RoadMatrixCheckpoint,
): string {
  return `${JSON.stringify(parseRoadMatrixCheckpoint(checkpoint), null, 2)}\n`;
}

export function expectedRoadPartialMatrixByteLength(
  localityCount: number,
  nextOriginIndex: number,
): number {
  if (!Number.isSafeInteger(localityCount) || localityCount <= 0) {
    throw new RangeError('Road matrix locality count must be positive.');
  }
  if (
    !Number.isSafeInteger(nextOriginIndex) ||
    nextOriginIndex < 0 ||
    nextOriginIndex > localityCount
  ) {
    throw new RangeError('Road matrix next origin index is invalid.');
  }
  const byteLength =
    localityCount * nextOriginIndex * MATRIX_BYTES_PER_CELL;
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
    throw new Error('Road partial-matrix byte length is invalid.');
  }
  return byteLength;
}

export function validateRoadMatrixResume(
  checkpoint: RoadMatrixCheckpoint,
  identity: RoadMatrixResumeIdentity,
  partialByteLength: number,
): void {
  const validated = parseRoadMatrixCheckpoint(checkpoint, 'resume checkpoint');
  for (const key of [
    'localityCount',
    'blockSize',
    'maxTravelMinutes',
    'valueEncoding',
    'anchorsSha256',
  ] as const) {
    if (validated[key] !== identity[key]) {
      throw new Error(
        `Road matrix checkpoint ${key} does not match the current network. Use --restart to start over.`,
      );
    }
  }
  const expectedByteLength = expectedRoadPartialMatrixByteLength(
    validated.localityCount,
    validated.nextOriginIndex,
  );
  if (partialByteLength !== expectedByteLength) {
    throw new Error(
      `Road partial matrix has ${partialByteLength} bytes; expected ${expectedByteLength}. Use --restart to start over.`,
    );
  }
}
