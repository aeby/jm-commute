import {
  calculateTravelTimeMatrixByteLength,
  requireExactCarDataKeys,
  TRAVEL_TIME_MATRIX_BYTES_PER_CELL,
} from './travel-time-matrix-format';

export const CAR_TRAVEL_TIME_MATRIX_CHECKPOINT_SCHEMA_VERSION = 1;

export interface CarTravelTimeMatrixCheckpoint {
  readonly schemaVersion: 1;
  readonly anchorsSha256: string;
  readonly localityCount: number;
  readonly blockSize: number;
  readonly valueEncoding: 'UINT16_LE';
  readonly nextSourceIndex: number;
}

export interface CarTravelTimeMatrixResumeIdentity {
  readonly anchorsSha256: string;
  readonly localityCount: number;
  readonly blockSize: number;
  readonly valueEncoding: 'UINT16_LE';
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(source: string, path: string, detail: string): never {
  throw new Error(
    `Invalid car travel-time matrix checkpoint in ${source} at ${path}: ${detail}.`,
  );
}

function positiveInteger(
  value: unknown,
  source: string,
  path: string,
): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    return invalid(source, path, 'expected a positive safe integer');
  }
  return value as number;
}

function sha256(value: unknown, source: string, path: string): string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    return invalid(source, path, 'expected a lowercase SHA-256 digest');
  }
  return value;
}

export function parseCarTravelTimeMatrixCheckpoint(
  value: unknown,
  source = 'value',
): CarTravelTimeMatrixCheckpoint {
  if (!isRecord(value)) {
    return invalid(source, '$', 'expected an object');
  }
  requireExactCarDataKeys(
    value,
    [
      'schemaVersion',
      'anchorsSha256',
      'localityCount',
      'blockSize',
      'valueEncoding',
      'nextSourceIndex',
    ],
    (detail) => invalid(source, '$', detail),
  );
  if (
    value.schemaVersion !== CAR_TRAVEL_TIME_MATRIX_CHECKPOINT_SCHEMA_VERSION
  ) {
    return invalid(source, 'schemaVersion', 'expected 1');
  }
  const localityCount = positiveInteger(
    value.localityCount,
    source,
    'localityCount',
  );
  const blockSize = positiveInteger(value.blockSize, source, 'blockSize');
  if (blockSize > localityCount) {
    return invalid(
      source,
      'blockSize',
      'cannot exceed the locality count',
    );
  }
  if (value.valueEncoding !== 'UINT16_LE') {
    return invalid(source, 'valueEncoding', 'expected "UINT16_LE"');
  }
  if (
    !Number.isSafeInteger(value.nextSourceIndex) ||
    (value.nextSourceIndex as number) < 0 ||
    (value.nextSourceIndex as number) > localityCount
  ) {
    return invalid(
      source,
      'nextSourceIndex',
      `expected an integer from 0 to ${localityCount}`,
    );
  }
  const nextSourceIndex = value.nextSourceIndex as number;
  if (nextSourceIndex !== localityCount && nextSourceIndex % blockSize !== 0) {
    return invalid(
      source,
      'nextSourceIndex',
      `expected a completed block boundary divisible by ${blockSize}, or ${localityCount}`,
    );
  }
  calculateTravelTimeMatrixByteLength(localityCount);
  return {
    schemaVersion: CAR_TRAVEL_TIME_MATRIX_CHECKPOINT_SCHEMA_VERSION,
    anchorsSha256: sha256(
      value.anchorsSha256,
      source,
      'anchorsSha256',
    ),
    localityCount,
    blockSize,
    valueEncoding: value.valueEncoding,
    nextSourceIndex,
  };
}

export function parseCarTravelTimeMatrixCheckpointJson(
  json: string,
  source = 'car travel-time matrix checkpoint JSON',
): CarTravelTimeMatrixCheckpoint {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to parse ${source}: ${message}`, { cause: error });
  }
  return parseCarTravelTimeMatrixCheckpoint(value, source);
}

export function createCarTravelTimeMatrixCheckpoint(
  identity: CarTravelTimeMatrixResumeIdentity,
  nextSourceIndex: number,
): CarTravelTimeMatrixCheckpoint {
  return parseCarTravelTimeMatrixCheckpoint(
    {
      schemaVersion: CAR_TRAVEL_TIME_MATRIX_CHECKPOINT_SCHEMA_VERSION,
      ...identity,
      nextSourceIndex,
    },
    'generated car travel-time matrix checkpoint',
  );
}

export function serializeCarTravelTimeMatrixCheckpoint(
  checkpoint: CarTravelTimeMatrixCheckpoint,
): string {
  const validated = parseCarTravelTimeMatrixCheckpoint(
    checkpoint,
    'car travel-time matrix checkpoint serialization input',
  );
  return `${JSON.stringify(validated, null, 2)}\n`;
}

export function expectedPartialMatrixByteLength(
  localityCount: number,
  nextSourceIndex: number,
): number {
  if (!Number.isSafeInteger(localityCount) || localityCount <= 0) {
    throw new Error('Resume locality count must be a positive safe integer.');
  }
  if (
    !Number.isSafeInteger(nextSourceIndex) ||
    nextSourceIndex < 0 ||
    nextSourceIndex > localityCount
  ) {
    throw new Error(
      `Resume next source index must be an integer from 0 to ${localityCount}.`,
    );
  }
  const byteLength =
    nextSourceIndex * localityCount * TRAVEL_TIME_MATRIX_BYTES_PER_CELL;
  if (!Number.isSafeInteger(byteLength)) {
    throw new Error('Partial matrix byte length exceeds safe integers.');
  }
  return byteLength;
}

export function validateCarTravelTimeMatrixResume(
  checkpoint: CarTravelTimeMatrixCheckpoint,
  expectedIdentity: CarTravelTimeMatrixResumeIdentity,
  partialFileByteLength: number,
): void {
  const validated = parseCarTravelTimeMatrixCheckpoint(
    checkpoint,
    'resume checkpoint',
  );
  for (const key of [
    'anchorsSha256',
    'localityCount',
    'blockSize',
    'valueEncoding',
  ] as const) {
    if (validated[key] !== expectedIdentity[key]) {
      throw new Error(
        `Travel-time matrix checkpoint ${key} ${JSON.stringify(validated[key])} does not match current generation ${JSON.stringify(expectedIdentity[key])}. Use --restart to intentionally start over.`,
      );
    }
  }
  if (!Number.isSafeInteger(partialFileByteLength) || partialFileByteLength < 0) {
    throw new Error('Partial matrix file length must be a nonnegative integer.');
  }
  const expectedLength = expectedPartialMatrixByteLength(
    validated.localityCount,
    validated.nextSourceIndex,
  );
  if (partialFileByteLength !== expectedLength) {
    throw new Error(
      `Partial matrix has ${partialFileByteLength} bytes; checkpoint progress requires exactly ${expectedLength}. Use --restart to intentionally start over.`,
    );
  }
}
