import type { LocalityId } from '@jm/commute';
import {
  createTravelTimeIndex,
  UNAVAILABLE_TRAVEL_TIME,
  type TravelTimeMatrixDescriptor,
} from '@commute-internal/travel-time-matrix';

export const TRANSIT_REACHABILITY_DIAGNOSTIC_THRESHOLDS = [
  30, 60, 90, 120, 180, 240,
] as const;

export type TransitReachabilityDiagnosticThreshold =
  (typeof TRANSIT_REACHABILITY_DIAGNOSTIC_THRESHOLDS)[number];

export interface TransitMatrixCellDistribution {
  readonly zeroMinutes: number;
  readonly minutes1To30: number;
  readonly minutes31To60: number;
  readonly minutes61To90: number;
  readonly minutes91To120: number;
  readonly minutes121To180: number;
  readonly minutes181To240: number;
  readonly unavailable: number;
}

export interface TransitOriginCountStatistics {
  readonly minimum: number;
  readonly median: number;
  readonly mean: number;
  readonly p95: number;
  readonly maximum: number;
}

export interface TransitReachabilityThresholdDiagnostics {
  readonly thresholdMinutes: TransitReachabilityDiagnosticThreshold;
  readonly countsByOrigin: Uint32Array;
  readonly statistics: TransitOriginCountStatistics;
}

export interface TransitMatrixDirectionalityDiagnostics {
  readonly unorderedPairCount: number;
  readonly equalDirections: number;
  readonly differentDirections: number;
  readonly reachableOneDirectionOnly: number;
  readonly unavailableBothDirections: number;
  /** Difference statistics among pairs reachable in both directions. */
  readonly mutuallyReachablePairCount: number;
  readonly medianAbsoluteDifferenceMinutes: number;
  readonly p95AbsoluteDifferenceMinutes: number;
  readonly maximumAbsoluteDifferenceMinutes: number;
}

export interface TransitOriginConnectivity {
  readonly localityId: LocalityId;
  readonly reachableWithin240Minutes: number;
}

export interface TransitTravelTimeMatrixDiagnostics {
  readonly localityCount: number;
  readonly totalCells: number;
  readonly cellDistribution: TransitMatrixCellDistribution;
  readonly reachabilityByThreshold: readonly TransitReachabilityThresholdDiagnostics[];
  readonly directionality: TransitMatrixDirectionalityDiagnostics;
  readonly leastConnectedOrigins: readonly TransitOriginConnectivity[];
  readonly mostConnectedOrigins: readonly TransitOriginConnectivity[];
  readonly selfOnlyOriginLocalityIds: readonly LocalityId[];
}

function nearestRank(
  histogram: Uint32Array,
  population: number,
  fraction: number,
): number {
  if (population <= 0) {
    throw new Error('Cannot calculate a percentile from an empty population.');
  }
  const target = Math.max(Math.ceil(population * fraction), 1);
  let cumulative = 0;
  for (let value = 0; value < histogram.length; value += 1) {
    cumulative += histogram[value] as number;
    if (cumulative >= target) {
      return value;
    }
  }
  throw new Error('Diagnostic histogram does not match its population.');
}

function summarizeOriginCounts(
  counts: Uint32Array,
): TransitOriginCountStatistics {
  const sorted = [...counts].toSorted((left, right) => left - right);
  if (sorted.length === 0) {
    throw new Error('Cannot summarize an empty origin-count population.');
  }
  const midpoint = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? ((sorted[midpoint - 1] as number) + (sorted[midpoint] as number)) / 2
      : (sorted[midpoint] as number);
  return {
    minimum: sorted[0] as number,
    median,
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    p95: sorted[Math.max(Math.ceil(sorted.length * 0.95) - 1, 0)] as number,
    maximum: sorted.at(-1) as number,
  };
}

function inspectDirectionality(
  matrixBytes: Uint8Array,
  localityCount: number,
): TransitMatrixDirectionalityDiagnostics {
  const differenceHistogram = new Uint32Array(241);
  let equalDirections = 0;
  let differentDirections = 0;
  let reachableOneDirectionOnly = 0;
  let unavailableBothDirections = 0;
  let mutuallyReachablePairCount = 0;
  let maximumAbsoluteDifferenceMinutes = 0;

  for (let leftIndex = 0; leftIndex < localityCount; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < localityCount;
      rightIndex += 1
    ) {
      const leftToRight =
        matrixBytes[leftIndex * localityCount + rightIndex] as number;
      const rightToLeft =
        matrixBytes[rightIndex * localityCount + leftIndex] as number;
      const leftUnavailable = leftToRight === UNAVAILABLE_TRAVEL_TIME;
      const rightUnavailable = rightToLeft === UNAVAILABLE_TRAVEL_TIME;
      if (leftUnavailable && rightUnavailable) {
        unavailableBothDirections += 1;
        continue;
      }
      if (leftUnavailable || rightUnavailable) {
        reachableOneDirectionOnly += 1;
        continue;
      }

      mutuallyReachablePairCount += 1;
      const difference = Math.abs(leftToRight - rightToLeft);
      differenceHistogram[difference] =
        (differenceHistogram[difference] as number) + 1;
      maximumAbsoluteDifferenceMinutes = Math.max(
        maximumAbsoluteDifferenceMinutes,
        difference,
      );
      if (difference === 0) {
        equalDirections += 1;
      } else {
        differentDirections += 1;
      }
    }
  }

  const unorderedPairCount = (localityCount * (localityCount - 1)) / 2;
  if (mutuallyReachablePairCount === 0) {
    return {
      unorderedPairCount,
      equalDirections,
      differentDirections,
      reachableOneDirectionOnly,
      unavailableBothDirections,
      mutuallyReachablePairCount,
      medianAbsoluteDifferenceMinutes: 0,
      p95AbsoluteDifferenceMinutes: 0,
      maximumAbsoluteDifferenceMinutes: 0,
    };
  }
  return {
    unorderedPairCount,
    equalDirections,
    differentDirections,
    reachableOneDirectionOnly,
    unavailableBothDirections,
    mutuallyReachablePairCount,
    medianAbsoluteDifferenceMinutes: nearestRank(
      differenceHistogram,
      mutuallyReachablePairCount,
      0.5,
    ),
    p95AbsoluteDifferenceMinutes: nearestRank(
      differenceHistogram,
      mutuallyReachablePairCount,
      0.95,
    ),
    maximumAbsoluteDifferenceMinutes,
  };
}

function compareLocalityIds(left: LocalityId, right: LocalityId): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareLeastConnected(
  left: TransitOriginConnectivity,
  right: TransitOriginConnectivity,
): number {
  return (
    left.reachableWithin240Minutes - right.reachableWithin240Minutes ||
    compareLocalityIds(left.localityId, right.localityId)
  );
}

function compareMostConnected(
  left: TransitOriginConnectivity,
  right: TransitOriginConnectivity,
): number {
  return (
    right.reachableWithin240Minutes - left.reachableWithin240Minutes ||
    compareLocalityIds(left.localityId, right.localityId)
  );
}

/** Performs deterministic full-matrix diagnostics without any routing engine. */
export function inspectTransitTravelTimeMatrix(
  descriptor: TravelTimeMatrixDescriptor,
  bytes: ArrayBuffer | Uint8Array,
): TransitTravelTimeMatrixDiagnostics {
  // Reuse the canonical constructor for descriptor, value, size, and diagonal
  // validation. It keeps all matrix-format invariants in one implementation.
  createTravelTimeIndex(descriptor, bytes);
  const matrixBytes =
    bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const localityCount = descriptor.localityCount;
  const countsByThreshold = TRANSIT_REACHABILITY_DIAGNOSTIC_THRESHOLDS.map(
    () => new Uint32Array(localityCount),
  );
  const cellDistribution: {
    zeroMinutes: number;
    minutes1To30: number;
    minutes31To60: number;
    minutes61To90: number;
    minutes91To120: number;
    minutes121To180: number;
    minutes181To240: number;
    unavailable: number;
  } = {
    zeroMinutes: 0,
    minutes1To30: 0,
    minutes31To60: 0,
    minutes61To90: 0,
    minutes91To120: 0,
    minutes121To180: 0,
    minutes181To240: 0,
    unavailable: 0,
  };

  for (let originIndex = 0; originIndex < localityCount; originIndex += 1) {
    const rowOffset = originIndex * localityCount;
    for (
      let destinationIndex = 0;
      destinationIndex < localityCount;
      destinationIndex += 1
    ) {
      const value = matrixBytes[rowOffset + destinationIndex] as number;
      if (value === UNAVAILABLE_TRAVEL_TIME) {
        cellDistribution.unavailable += 1;
        continue;
      }
      if (value === 0) {
        cellDistribution.zeroMinutes += 1;
      } else if (value <= 30) {
        cellDistribution.minutes1To30 += 1;
      } else if (value <= 60) {
        cellDistribution.minutes31To60 += 1;
      } else if (value <= 90) {
        cellDistribution.minutes61To90 += 1;
      } else if (value <= 120) {
        cellDistribution.minutes91To120 += 1;
      } else if (value <= 180) {
        cellDistribution.minutes121To180 += 1;
      } else {
        cellDistribution.minutes181To240 += 1;
      }

      for (
        let thresholdIndex = 0;
        thresholdIndex < TRANSIT_REACHABILITY_DIAGNOSTIC_THRESHOLDS.length;
        thresholdIndex += 1
      ) {
        if (
          value <=
          (TRANSIT_REACHABILITY_DIAGNOSTIC_THRESHOLDS[
            thresholdIndex
          ] as number)
        ) {
          const counts = countsByThreshold[thresholdIndex] as Uint32Array;
          counts[originIndex] = (counts[originIndex] as number) + 1;
        }
      }
    }
  }

  const reachabilityByThreshold =
    TRANSIT_REACHABILITY_DIAGNOSTIC_THRESHOLDS.map(
      (thresholdMinutes, thresholdIndex) => {
        const countsByOrigin = countsByThreshold[
          thresholdIndex
        ] as Uint32Array;
        return {
          thresholdMinutes,
          countsByOrigin,
          statistics: summarizeOriginCounts(countsByOrigin),
        };
      },
    );
  const countsAt240 = countsByThreshold.at(-1) as Uint32Array;
  const originConnectivity = descriptor.localityIds.map(
    (localityId, originIndex): TransitOriginConnectivity => ({
      localityId,
      reachableWithin240Minutes: countsAt240[originIndex] as number,
    }),
  );

  return {
    localityCount,
    totalCells: matrixBytes.byteLength,
    cellDistribution,
    reachabilityByThreshold,
    directionality: inspectDirectionality(matrixBytes, localityCount),
    leastConnectedOrigins: originConnectivity
      .toSorted(compareLeastConnected)
      .slice(0, 10),
    mostConnectedOrigins: originConnectivity
      .toSorted(compareMostConnected)
      .slice(0, 10),
    selfOnlyOriginLocalityIds: originConnectivity
      .filter(({ reachableWithin240Minutes }) => reachableWithin240Minutes === 1)
      .map(({ localityId }) => localityId),
  };
}

export function getTransitOriginReachabilityCountAtIndex(
  diagnostics: TransitTravelTimeMatrixDiagnostics,
  originIndex: number,
  thresholdMinutes: TransitReachabilityDiagnosticThreshold,
): number {
  if (
    !Number.isSafeInteger(originIndex) ||
    originIndex < 0 ||
    originIndex >= diagnostics.localityCount
  ) {
    throw new RangeError(
      `Transit diagnostic origin index must be from 0 to ${diagnostics.localityCount - 1}.`,
    );
  }
  const threshold = diagnostics.reachabilityByThreshold.find(
    (candidate) => candidate.thresholdMinutes === thresholdMinutes,
  );
  if (threshold === undefined) {
    throw new Error(`Unsupported diagnostic threshold ${thresholdMinutes}.`);
  }
  return threshold.countsByOrigin[originIndex] as number;
}
