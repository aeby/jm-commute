import type { FixedDayRoutingManifest } from './types';

const COUNT_FIELDS = [
  'tripCount',
  'scheduledTripCount',
  'frequencyTripCount',
  'stopTimeCount',
  'frequencyWindowCount',
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function parseFixedDayRoutingManifestJson(
  json: string,
  sourceDescription: string,
): FixedDayRoutingManifest {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Unable to parse ${sourceDescription} as JSON: ${message}`,
      { cause: error },
    );
  }

  if (!isRecord(value)) {
    throw new Error(`${sourceDescription} must be an object.`);
  }

  const {
    sourceFeedVersion,
    serviceDate,
    routingWindowStart,
    routingWindowEnd,
    tripsSha256,
  } = value;
  if (
    sourceFeedVersion !== undefined &&
    (typeof sourceFeedVersion !== 'string' ||
      sourceFeedVersion.trim().length === 0)
  ) {
    throw new Error(
      `${sourceDescription} sourceFeedVersion must be a nonempty string when present.`,
    );
  }
  if (typeof serviceDate !== 'string' || serviceDate.trim().length === 0) {
    throw new Error(`${sourceDescription} serviceDate must be a nonempty string.`);
  }
  if (
    typeof routingWindowStart !== 'string' ||
    routingWindowStart.trim().length === 0
  ) {
    throw new Error(
      `${sourceDescription} routingWindowStart must be a nonempty string.`,
    );
  }
  if (
    typeof routingWindowEnd !== 'string' ||
    routingWindowEnd.trim().length === 0
  ) {
    throw new Error(
      `${sourceDescription} routingWindowEnd must be a nonempty string.`,
    );
  }
  if (typeof tripsSha256 !== 'string' || !/^[\da-f]{64}$/.test(tripsSha256)) {
    throw new Error(
      `${sourceDescription} tripsSha256 must be a lowercase SHA-256 digest.`,
    );
  }

  for (const field of COUNT_FIELDS) {
    const count = value[field];
    if (!Number.isSafeInteger(count) || (count as number) < 0) {
      throw new Error(
        `${sourceDescription} ${field} must be a nonnegative integer.`,
      );
    }
  }

  const tripCount = value.tripCount as number;
  const scheduledTripCount = value.scheduledTripCount as number;
  const frequencyTripCount = value.frequencyTripCount as number;
  if (tripCount !== scheduledTripCount + frequencyTripCount) {
    throw new Error(
      `${sourceDescription} tripCount must equal scheduledTripCount plus frequencyTripCount.`,
    );
  }

  return {
    ...(sourceFeedVersion === undefined ? {} : { sourceFeedVersion }),
    serviceDate,
    routingWindowStart,
    routingWindowEnd,
    tripsSha256,
    tripCount,
    scheduledTripCount,
    frequencyTripCount,
    stopTimeCount: value.stopTimeCount as number,
    frequencyWindowCount: value.frequencyWindowCount as number,
  };
}

export interface FixedDayRoutingScenarioMetadata {
  readonly serviceDate: string;
  readonly routingWindowStart: string;
  readonly routingWindowEnd: string;
}

export function validateFixedDayRoutingManifestScenario(
  manifest: FixedDayRoutingManifest,
  expected: FixedDayRoutingScenarioMetadata,
): void {
  if (manifest.serviceDate !== expected.serviceDate) {
    throw new Error(
      `Routing manifest service date ${manifest.serviceDate} does not match ${expected.serviceDate}.`,
    );
  }
  if (
    manifest.routingWindowStart !== expected.routingWindowStart ||
    manifest.routingWindowEnd !== expected.routingWindowEnd
  ) {
    throw new Error(
      `Routing manifest window ${manifest.routingWindowStart}–${manifest.routingWindowEnd} does not match ${expected.routingWindowStart}–${expected.routingWindowEnd}.`,
    );
  }
}
