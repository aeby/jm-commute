import { createHash } from 'node:crypto';

import type { LocalityId } from '../../localities';
import type {
  CarLocalityInput,
  Coordinate,
  SnappedRoadPoint,
} from './types';

export interface CarLocalityRoadAnchor extends Coordinate {
  readonly localityId: LocalityId;

  /** Distance from the official locality coordinate to this routable point. */
  readonly snapDistanceMeters: number;
}

export interface CarLocalityRoadAnchorProgress {
  readonly completed: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly total: number;
}

export interface GenerateCarLocalityRoadAnchorsOptions {
  readonly concurrency?: number;
  readonly onProgress?: (progress: CarLocalityRoadAnchorProgress) => void;
}

export interface CarLocalityRoadAnchorFailure {
  readonly localityId: LocalityId;
  readonly message: string;
  readonly cause: unknown;
}

export interface SnapDistanceStatistics {
  readonly minimum: number;
  readonly median: number;
  readonly p90: number;
  readonly p95: number;
  readonly p99: number;
  readonly maximum: number;
}

export type FindNearestRoadPoint = (
  coordinate: Coordinate,
) => Promise<SnappedRoadPoint>;

interface LocalityFingerprintEntry extends Coordinate {
  readonly localityId: LocalityId;
}

function compareLocalityIds(
  left: { readonly localityId: LocalityId },
  right: { readonly localityId: LocalityId },
): number {
  return left.localityId < right.localityId
    ? -1
    : left.localityId > right.localityId
      ? 1
      : 0;
}

function assertInputCoordinate(
  input: CarLocalityInput,
  coordinateName: 'latitude' | 'longitude',
): void {
  const value = input[coordinateName];
  const minimum = coordinateName === 'latitude' ? -90 : -180;
  const maximum = coordinateName === 'latitude' ? 90 : 180;
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(
      `Car locality input "${input.localityId}" has an invalid ${coordinateName}.`,
    );
  }
}

function validateSnappedRoadPoint(
  value: unknown,
  localityId: LocalityId,
): Pick<SnappedRoadPoint, 'latitude' | 'longitude' | 'distanceMeters'> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(
      `Nearest-road result for "${localityId}" must be an object.`,
    );
  }
  const result = value as Readonly<Record<string, unknown>>;
  if (
    typeof result.latitude !== 'number' ||
    !Number.isFinite(result.latitude) ||
    result.latitude < -90 ||
    result.latitude > 90
  ) {
    throw new Error(
      `Nearest-road result for "${localityId}" has an invalid latitude.`,
    );
  }
  if (
    typeof result.longitude !== 'number' ||
    !Number.isFinite(result.longitude) ||
    result.longitude < -180 ||
    result.longitude > 180
  ) {
    throw new Error(
      `Nearest-road result for "${localityId}" has an invalid longitude.`,
    );
  }
  if (
    typeof result.distanceMeters !== 'number' ||
    !Number.isFinite(result.distanceMeters) ||
    result.distanceMeters < 0
  ) {
    throw new Error(
      `Nearest-road result for "${localityId}" has an invalid distance.`,
    );
  }
  return {
    latitude: result.latitude,
    longitude: result.longitude,
    distanceMeters: result.distanceMeters,
  };
}

function canonicalFingerprintEntries(
  inputs: readonly CarLocalityInput[],
): readonly LocalityFingerprintEntry[] {
  const entries = inputs
    .map((input): LocalityFingerprintEntry => {
      if (
        typeof input.localityId !== 'string' ||
        input.localityId.length === 0
      ) {
        throw new Error('Car locality input must have a nonempty locality ID.');
      }
      assertInputCoordinate(input, 'latitude');
      assertInputCoordinate(input, 'longitude');
      return {
        localityId: input.localityId,
        latitude: input.latitude,
        longitude: input.longitude,
      };
    })
    .toSorted(compareLocalityIds);

  for (let index = 1; index < entries.length; index += 1) {
    if (entries[index - 1]?.localityId === entries[index]?.localityId) {
      throw new Error(
        `Duplicate car locality input "${entries[index]?.localityId}".`,
      );
    }
  }
  return entries;
}

/**
 * Hashes compact JSON objects containing exactly localityId, latitude, and
 * longitude in lexical locality-ID order. No timestamp or display metadata is
 * included.
 */
export function createLocalityInputFingerprint(
  inputs: readonly CarLocalityInput[],
): string {
  const canonicalJson = JSON.stringify(canonicalFingerprintEntries(inputs));
  return createHash('sha256').update(canonicalJson).digest('hex');
}

export class CarLocalityRoadAnchorGenerationError extends Error {
  readonly failures: readonly CarLocalityRoadAnchorFailure[];

  constructor(
    failures: readonly CarLocalityRoadAnchorFailure[],
    localityCount: number,
  ) {
    const details = failures
      .map(({ localityId, message }) => `${localityId}: ${message}`)
      .join('\n');
    super(
      `Unable to snap ${failures.length} of ${localityCount} car localities:\n${details}`,
    );
    this.name = 'CarLocalityRoadAnchorGenerationError';
    this.failures = failures;
  }
}

export async function generateCarLocalityRoadAnchors(
  inputs: readonly CarLocalityInput[],
  findNearestRoadPoint: FindNearestRoadPoint,
  options: GenerateCarLocalityRoadAnchorsOptions = {},
): Promise<readonly CarLocalityRoadAnchor[]> {
  const orderedInputs = canonicalFingerprintEntries(inputs);
  if (orderedInputs.length === 0) {
    throw new Error('At least one car locality input is required.');
  }

  const concurrency = options.concurrency ?? 16;
  if (!Number.isSafeInteger(concurrency) || concurrency <= 0) {
    throw new Error('Anchor generation concurrency must be a positive integer.');
  }

  const anchors: CarLocalityRoadAnchor[] = [];
  const failures: Array<CarLocalityRoadAnchorFailure | undefined> = [];
  let progressError: unknown;
  let nextIndex = 0;
  let completed = 0;
  let succeeded = 0;

  async function worker(): Promise<void> {
    while (nextIndex < orderedInputs.length) {
      const index = nextIndex;
      nextIndex += 1;
      const input = orderedInputs[index] as LocalityFingerprintEntry;

      try {
        const snapped = validateSnappedRoadPoint(
          await findNearestRoadPoint({
            latitude: input.latitude,
            longitude: input.longitude,
          }),
          input.localityId,
        );
        anchors[index] = {
          localityId: input.localityId,
          latitude: snapped.latitude,
          longitude: snapped.longitude,
          snapDistanceMeters: snapped.distanceMeters,
        };
        succeeded += 1;
      } catch (error) {
        failures[index] = {
          localityId: input.localityId,
          message: error instanceof Error ? error.message : String(error),
          cause: error,
        };
      } finally {
        completed += 1;
        try {
          options.onProgress?.({
            completed,
            succeeded,
            failed: completed - succeeded,
            total: orderedInputs.length,
          });
        } catch (error) {
          progressError ??= error;
        }
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, orderedInputs.length) },
      async () => worker(),
    ),
  );

  const failed = failures.filter(
    (failure): failure is CarLocalityRoadAnchorFailure =>
      failure !== undefined,
  );
  if (failed.length > 0) {
    throw new CarLocalityRoadAnchorGenerationError(
      failed,
      orderedInputs.length,
    );
  }
  if (progressError !== undefined) {
    throw progressError;
  }
  return anchors;
}

function nearestRank(
  sortedValues: readonly number[],
  fraction: number,
): number {
  const index = Math.max(Math.ceil(sortedValues.length * fraction) - 1, 0);
  return sortedValues[index] as number;
}

export function summarizeSnapDistances(
  anchors: readonly CarLocalityRoadAnchor[],
): SnapDistanceStatistics {
  if (anchors.length === 0) {
    throw new Error('At least one car locality road anchor is required.');
  }
  const distances = anchors
    .map(({ snapDistanceMeters }) => snapDistanceMeters)
    .toSorted((left, right) => left - right);
  return {
    minimum: distances[0] as number,
    median: nearestRank(distances, 0.5),
    p90: nearestRank(distances, 0.9),
    p95: nearestRank(distances, 0.95),
    p99: nearestRank(distances, 0.99),
    maximum: distances.at(-1) as number,
  };
}
