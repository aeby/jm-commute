import {
  COMMUTE_MATRIX_MAX_TRAVEL_MINUTES,
  TRAVEL_TIME_MATRIX_BYTES_PER_CELL,
} from '../../travel-time-matrix';

export const TRANSIT_TRAVEL_TIME_MATRIX_CHECKPOINT_SCHEMA_VERSION = 1;

export interface TransitTravelTimeMatrixResumeIdentity {
  readonly localityCount: number;
  readonly maxTravelMinutes: 240;
  readonly valueEncoding: 'UINT8';
  readonly routingDataFingerprint: string;
  readonly timetableFingerprint: string;
  readonly localityRoutingIndexSha256: string;
  readonly queryPolicySha256: string;
}

export interface TransitTravelTimeMatrixCheckpoint
  extends TransitTravelTimeMatrixResumeIdentity {
  readonly schemaVersion: 1;
  readonly nextOriginIndex: number;
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(source: string, path: string, detail: string): never {
  throw new Error(
    `Invalid transit travel-time matrix checkpoint in ${source} at ${path}: ${detail}.`,
  );
}

function requireExactKeys(
  value: Readonly<Record<string, unknown>>,
  expectedKeys: readonly string[],
  source: string,
): void {
  const actualKeys = Object.keys(value);
  const actual = new Set(actualKeys);
  const expected = new Set(expectedKeys);
  const missing = expectedKeys.filter((key) => !actual.has(key));
  if (missing.length > 0) {
    invalid(source, '$', `missing field(s) ${missing.join(', ')}`);
  }
  const unexpected = actualKeys.filter((key) => !expected.has(key));
  if (unexpected.length > 0) {
    invalid(source, '$', `unexpected field(s) ${unexpected.join(', ')}`);
  }
}

function parseSha256(value: unknown, source: string, path: string): string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    return invalid(source, path, 'expected a lowercase SHA-256 digest');
  }
  return value;
}

function parsePositiveSafeInteger(
  value: unknown,
  source: string,
  path: string,
): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    return invalid(source, path, 'expected a positive safe integer');
  }
  return value as number;
}

export function parseTransitTravelTimeMatrixCheckpoint(
  value: unknown,
  source = 'value',
): TransitTravelTimeMatrixCheckpoint {
  if (!isRecord(value)) {
    return invalid(source, '$', 'expected an object');
  }
  requireExactKeys(
    value,
    [
      'schemaVersion',
      'localityCount',
      'maxTravelMinutes',
      'valueEncoding',
      'routingDataFingerprint',
      'timetableFingerprint',
      'localityRoutingIndexSha256',
      'queryPolicySha256',
      'nextOriginIndex',
    ],
    source,
  );
  if (
    value.schemaVersion !==
    TRANSIT_TRAVEL_TIME_MATRIX_CHECKPOINT_SCHEMA_VERSION
  ) {
    return invalid(source, 'schemaVersion', 'expected 1');
  }
  const localityCount = parsePositiveSafeInteger(
    value.localityCount,
    source,
    'localityCount',
  );
  if (value.maxTravelMinutes !== COMMUTE_MATRIX_MAX_TRAVEL_MINUTES) {
    return invalid(
      source,
      'maxTravelMinutes',
      `expected ${COMMUTE_MATRIX_MAX_TRAVEL_MINUTES}`,
    );
  }
  if (value.valueEncoding !== 'UINT8') {
    return invalid(source, 'valueEncoding', 'expected "UINT8"');
  }
  if (
    !Number.isSafeInteger(value.nextOriginIndex) ||
    (value.nextOriginIndex as number) < 0 ||
    (value.nextOriginIndex as number) > localityCount
  ) {
    return invalid(
      source,
      'nextOriginIndex',
      `expected an integer from 0 to ${localityCount}`,
    );
  }

  return Object.freeze({
    schemaVersion: TRANSIT_TRAVEL_TIME_MATRIX_CHECKPOINT_SCHEMA_VERSION,
    localityCount,
    maxTravelMinutes: COMMUTE_MATRIX_MAX_TRAVEL_MINUTES,
    valueEncoding: value.valueEncoding,
    routingDataFingerprint: parseSha256(
      value.routingDataFingerprint,
      source,
      'routingDataFingerprint',
    ),
    timetableFingerprint: parseSha256(
      value.timetableFingerprint,
      source,
      'timetableFingerprint',
    ),
    localityRoutingIndexSha256: parseSha256(
      value.localityRoutingIndexSha256,
      source,
      'localityRoutingIndexSha256',
    ),
    queryPolicySha256: parseSha256(
      value.queryPolicySha256,
      source,
      'queryPolicySha256',
    ),
    nextOriginIndex: value.nextOriginIndex as number,
  });
}

export function parseTransitTravelTimeMatrixCheckpointJson(
  json: string,
  source = 'transit travel-time matrix checkpoint JSON',
): TransitTravelTimeMatrixCheckpoint {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to parse ${source}: ${message}`, { cause: error });
  }
  return parseTransitTravelTimeMatrixCheckpoint(value, source);
}

export function createTransitTravelTimeMatrixCheckpoint(
  identity: TransitTravelTimeMatrixResumeIdentity,
  nextOriginIndex: number,
): TransitTravelTimeMatrixCheckpoint {
  return parseTransitTravelTimeMatrixCheckpoint(
    {
      schemaVersion: TRANSIT_TRAVEL_TIME_MATRIX_CHECKPOINT_SCHEMA_VERSION,
      ...identity,
      nextOriginIndex,
    },
    'generated transit travel-time matrix checkpoint',
  );
}

export function serializeTransitTravelTimeMatrixCheckpoint(
  checkpoint: TransitTravelTimeMatrixCheckpoint,
): string {
  const validated = parseTransitTravelTimeMatrixCheckpoint(
    checkpoint,
    'transit travel-time matrix checkpoint serialization input',
  );
  return `${JSON.stringify(validated, null, 2)}\n`;
}

export function expectedTransitPartialMatrixByteLength(
  localityCount: number,
  nextOriginIndex: number,
): number {
  if (!Number.isSafeInteger(localityCount) || localityCount <= 0) {
    throw new Error(
      'Transit resume locality count must be a positive safe integer.',
    );
  }
  if (
    !Number.isSafeInteger(nextOriginIndex) ||
    nextOriginIndex < 0 ||
    nextOriginIndex > localityCount
  ) {
    throw new Error(
      `Transit resume next origin index must be an integer from 0 to ${localityCount}.`,
    );
  }
  const byteLength =
    nextOriginIndex * localityCount * TRAVEL_TIME_MATRIX_BYTES_PER_CELL;
  if (!Number.isSafeInteger(byteLength)) {
    throw new Error('Transit partial matrix byte length exceeds safe integers.');
  }
  return byteLength;
}

export function validateTransitTravelTimeMatrixResume(
  checkpoint: TransitTravelTimeMatrixCheckpoint,
  expectedIdentity: TransitTravelTimeMatrixResumeIdentity,
  partialFileByteLength: number,
): void {
  const validated = parseTransitTravelTimeMatrixCheckpoint(
    checkpoint,
    'transit resume checkpoint',
  );
  for (const key of [
    'localityCount',
    'maxTravelMinutes',
    'valueEncoding',
    'routingDataFingerprint',
    'timetableFingerprint',
    'localityRoutingIndexSha256',
    'queryPolicySha256',
  ] as const) {
    if (validated[key] !== expectedIdentity[key]) {
      throw new Error(
        `Transit travel-time matrix checkpoint ${key} ${JSON.stringify(validated[key])} does not match current generation ${JSON.stringify(expectedIdentity[key])}. Use --restart to intentionally start over.`,
      );
    }
  }
  if (!Number.isSafeInteger(partialFileByteLength) || partialFileByteLength < 0) {
    throw new Error(
      'Transit partial matrix file length must be a nonnegative integer.',
    );
  }
  const expectedLength = expectedTransitPartialMatrixByteLength(
    validated.localityCount,
    validated.nextOriginIndex,
  );
  if (partialFileByteLength !== expectedLength) {
    throw new Error(
      `Transit partial matrix has ${partialFileByteLength} bytes; checkpoint progress requires exactly ${expectedLength}. Use --restart to intentionally start over.`,
    );
  }
}
