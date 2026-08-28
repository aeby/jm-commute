import {
  parseTravelTimeMatrixDescriptor,
  type TravelTimeMatrixDescriptor,
} from '../travel-time-matrix/index.js';

export interface TransitRoutingPolicyProvenance {
  readonly maxTransfers: number;
  readonly minTransferTimeSeconds: number;
  readonly virtualTransfersEnabled: boolean;
}

export interface TransitTravelTimeSource {
  readonly serviceDate: string;
  readonly morningWindow: {
    readonly start: string;
    readonly end: string;
  };
  readonly gtfsFeedVersion: string;
  readonly routingDataFingerprint: string;
  readonly timetableFingerprint: string;
  readonly localityRoutingIndexSha256: string;
  readonly routingPolicy: TransitRoutingPolicyProvenance;
}

export interface TransitTravelTimeManifest {
  readonly mode: 'TRANSIT';
  readonly matrix: TravelTimeMatrixDescriptor;
  readonly source: TransitTravelTimeSource;
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const SERVICE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const CLOCK_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/u;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(source: string, path: string, detail: string): never {
  throw new Error(
    `Invalid transit travel-time manifest in ${source} at ${path}: ${detail}.`,
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

function parseSha256(value: unknown, source: string, path: string): string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    return invalid(source, path, 'expected a lowercase SHA-256 digest');
  }
  return value;
}

function parseNonnegativeSafeInteger(
  value: unknown,
  source: string,
  path: string,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    return invalid(source, path, 'expected a nonnegative safe integer');
  }
  return value as number;
}

function clockTimeSeconds(value: string): number {
  const [hours, minutes, seconds] = value.split(':').map(Number);
  return (
    (hours as number) * 3_600 +
    (minutes as number) * 60 +
    (seconds as number)
  );
}

function parseMorningWindow(
  value: unknown,
  source: string,
): TransitTravelTimeManifest['source']['morningWindow'] {
  if (!isRecord(value)) {
    return invalid(source, 'source.morningWindow', 'expected an object');
  }
  requireExactKeys(value, ['start', 'end'], source, 'source.morningWindow');
  const { start, end } = value;
  if (typeof start !== 'string' || !CLOCK_TIME_PATTERN.test(start)) {
    return invalid(
      source,
      'source.morningWindow.start',
      'expected HH:MM:SS within a civil day',
    );
  }
  if (typeof end !== 'string' || !CLOCK_TIME_PATTERN.test(end)) {
    return invalid(
      source,
      'source.morningWindow.end',
      'expected HH:MM:SS within a civil day',
    );
  }
  if (clockTimeSeconds(end) <= clockTimeSeconds(start)) {
    return invalid(
      source,
      'source.morningWindow',
      'end must be later than start',
    );
  }
  return { start, end };
}

function parseRoutingPolicy(
  value: unknown,
  source: string,
): TransitRoutingPolicyProvenance {
  if (!isRecord(value)) {
    return invalid(source, 'source.routingPolicy', 'expected an object');
  }
  requireExactKeys(
    value,
    [
      'maxTransfers',
      'minTransferTimeSeconds',
      'virtualTransfersEnabled',
    ],
    source,
    'source.routingPolicy',
  );
  if (
    value.virtualTransfersEnabled !== true &&
    value.virtualTransfersEnabled !== false
  ) {
    return invalid(
      source,
      'source.routingPolicy.virtualTransfersEnabled',
      'expected a boolean',
    );
  }
  return {
    maxTransfers: parseNonnegativeSafeInteger(
      value.maxTransfers,
      source,
      'source.routingPolicy.maxTransfers',
    ),
    minTransferTimeSeconds: parseNonnegativeSafeInteger(
      value.minTransferTimeSeconds,
      source,
      'source.routingPolicy.minTransferTimeSeconds',
    ),
    virtualTransfersEnabled: value.virtualTransfersEnabled,
  };
}

function parseServiceDate(value: unknown, source: string): string {
  if (typeof value !== 'string' || !SERVICE_DATE_PATTERN.test(value)) {
    return invalid(source, 'source.serviceDate', 'expected YYYY-MM-DD');
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (
    Number.isNaN(date.valueOf()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    return invalid(
      source,
      'source.serviceDate',
      'expected a real calendar date',
    );
  }
  return value;
}

export function parseTransitTravelTimeManifest(
  value: unknown,
  source = 'value',
): TransitTravelTimeManifest {
  if (!isRecord(value)) {
    return invalid(source, '$', 'expected an object');
  }
  requireExactKeys(value, ['mode', 'matrix', 'source'], source, '$');
  if (value.mode !== 'TRANSIT') {
    return invalid(source, 'mode', 'expected "TRANSIT"');
  }
  if (!isRecord(value.source)) {
    return invalid(source, 'source', 'expected an object');
  }
  requireExactKeys(
    value.source,
    [
      'serviceDate',
      'morningWindow',
      'gtfsFeedVersion',
      'routingDataFingerprint',
      'timetableFingerprint',
      'localityRoutingIndexSha256',
      'routingPolicy',
    ],
    source,
    'source',
  );
  if (
    typeof value.source.gtfsFeedVersion !== 'string' ||
    value.source.gtfsFeedVersion.length === 0 ||
    value.source.gtfsFeedVersion.trim() !== value.source.gtfsFeedVersion
  ) {
    return invalid(
      source,
      'source.gtfsFeedVersion',
      'expected a nonempty canonical string',
    );
  }

  return {
    mode: value.mode,
    matrix: parseTravelTimeMatrixDescriptor(
      value.matrix,
      `${source} matrix descriptor`,
    ),
    source: {
      serviceDate: parseServiceDate(value.source.serviceDate, source),
      morningWindow: parseMorningWindow(value.source.morningWindow, source),
      gtfsFeedVersion: value.source.gtfsFeedVersion,
      routingDataFingerprint: parseSha256(
        value.source.routingDataFingerprint,
        source,
        'source.routingDataFingerprint',
      ),
      timetableFingerprint: parseSha256(
        value.source.timetableFingerprint,
        source,
        'source.timetableFingerprint',
      ),
      localityRoutingIndexSha256: parseSha256(
        value.source.localityRoutingIndexSha256,
        source,
        'source.localityRoutingIndexSha256',
      ),
      routingPolicy: parseRoutingPolicy(value.source.routingPolicy, source),
    },
  };
}

export function parseTransitTravelTimeManifestJson(
  json: string,
  source = 'transit travel-time manifest JSON',
): TransitTravelTimeManifest {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to parse ${source}: ${message}`, { cause: error });
  }
  return parseTransitTravelTimeManifest(value, source);
}
