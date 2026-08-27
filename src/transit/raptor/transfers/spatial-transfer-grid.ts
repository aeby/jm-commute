import type { ActiveTransferStop } from './types';

const EARTH_RADIUS_METERS = 6_371_008.8;

interface ProjectedStop {
  readonly stop: ActiveTransferStop;
  readonly bucketX: number;
  readonly bucketY: number;
}

const degreesToRadians = (degrees: number): number =>
  (degrees * Math.PI) / 180;

const bucketKey = (x: number, y: number): string => `${x}:${y}`;

const requireCoordinates = (
  stop: ActiveTransferStop,
): stop is ActiveTransferStop & {
  readonly latitude: number;
  readonly longitude: number;
} =>
  Number.isFinite(stop.latitude) &&
  Number.isFinite(stop.longitude) &&
  (stop.latitude ?? 0) >= -90 &&
  (stop.latitude ?? 0) <= 90 &&
  (stop.longitude ?? 0) >= -180 &&
  (stop.longitude ?? 0) <= 180;

/**
 * Visits candidate pairs from the same or neighboring projected buckets.
 * The final Haversine radius check belongs to the caller.
 */
export const forEachSpatialTransferCandidate = (
  stops: readonly ActiveTransferStop[],
  maximumDistanceMeters: number,
  visit: (left: ActiveTransferStop, right: ActiveTransferStop) => void,
): number => {
  if (
    !Number.isFinite(maximumDistanceMeters) ||
    maximumDistanceMeters <= 0
  ) {
    throw new RangeError('maximumDistanceMeters must be greater than zero.');
  }

  const locatedStops = stops
    .filter(requireCoordinates)
    .toSorted((left, right) => left.stopIndex - right.stopIndex);
  if (locatedStops.length < 2) {
    return 0;
  }

  const meanLatitudeRadians = degreesToRadians(
    locatedStops.reduce((sum, stop) => sum + stop.latitude, 0) /
      locatedStops.length,
  );
  const referenceLongitudeScale = Math.cos(meanLatitudeRadians);
  const minimumLongitudeScale = locatedStops.reduce(
    (minimum, stop) =>
      Math.min(minimum, Math.abs(Math.cos(degreesToRadians(stop.latitude)))),
    1,
  );
  const maximumProjectionStretch =
    minimumLongitudeScale < Number.EPSILON
      ? Number.POSITIVE_INFINITY
      : Math.max(1, referenceLongitudeScale / minimumLongitudeScale);
  const bucketSizeMeters =
    maximumDistanceMeters * maximumProjectionStretch;
  const buckets = new Map<string, ProjectedStop[]>();
  const projectedStops: ProjectedStop[] = [];

  for (const stop of locatedStops) {
    const x =
      EARTH_RADIUS_METERS *
      degreesToRadians(stop.longitude) *
      referenceLongitudeScale;
    const y = EARTH_RADIUS_METERS * degreesToRadians(stop.latitude);
    const projectedStop = {
      stop,
      bucketX: Math.floor(x / bucketSizeMeters),
      bucketY: Math.floor(y / bucketSizeMeters),
    };
    projectedStops.push(projectedStop);
    const key = bucketKey(projectedStop.bucketX, projectedStop.bucketY);
    const bucket = buckets.get(key) ?? [];
    bucket.push(projectedStop);
    buckets.set(key, bucket);
  }

  let candidatePairCount = 0;
  for (const projectedStop of projectedStops) {
    for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
      for (let yOffset = -1; yOffset <= 1; yOffset += 1) {
        const candidates = buckets.get(
          bucketKey(
            projectedStop.bucketX + xOffset,
            projectedStop.bucketY + yOffset,
          ),
        );
        if (candidates === undefined) {
          continue;
        }
        for (const candidate of candidates) {
          if (candidate.stop.stopIndex <= projectedStop.stop.stopIndex) {
            continue;
          }
          visit(projectedStop.stop, candidate.stop);
          candidatePairCount += 1;
        }
      }
    }
  }
  return candidatePairCount;
};
