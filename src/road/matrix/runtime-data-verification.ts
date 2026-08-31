import type { LocalityId } from '@jm/commute';
import {
  getCarTravelMinutes,
  getReachableLocalitiesByCar,
} from '@jm/commute';
import {
  loadCarTravelTimeIndex,
  type LoadTravelTimeIndexOptions,
} from '@commute-internal/internal/load-travel-time-data';

export interface RuntimeRoadPointCheck {
  readonly label: string;
  readonly fromLocalityId: LocalityId;
  readonly toLocalityId: LocalityId;
  readonly expectedTravelMinutes: number | undefined;
}

export interface RuntimeRoadReachabilityCheck {
  readonly label: string;
  readonly originLocalityId: LocalityId;
  readonly maxTravelMinutes: number;
  readonly expectedReachableLocalityCount: number;
}

export interface VerifyRuntimeRoadDataOptions extends LoadTravelTimeIndexOptions {
  readonly pointChecks: readonly RuntimeRoadPointCheck[];
  readonly reachabilityChecks: readonly RuntimeRoadReachabilityCheck[];
}

export async function verifyRuntimeRoadData(
  options: VerifyRuntimeRoadDataOptions,
): Promise<{ readonly pointCount: number; readonly reachabilityCount: number }> {
  if (options.pointChecks.length === 0 || options.reachabilityChecks.length === 0) {
    throw new Error('Runtime road verification requires point and reachability checks.');
  }
  const index = await loadCarTravelTimeIndex(options);
  const mismatches: string[] = [];
  for (const check of options.pointChecks) {
    const actual = getCarTravelMinutes(
      index,
      check.fromLocalityId,
      check.toLocalityId,
    );
    if (actual !== check.expectedTravelMinutes) {
      mismatches.push(
        `${check.label}: expected ${check.expectedTravelMinutes ?? 'unavailable'}, received ${actual ?? 'unavailable'}`,
      );
    }
  }
  for (const check of options.reachabilityChecks) {
    const actual = getReachableLocalitiesByCar(
      index,
      check.originLocalityId,
      check.maxTravelMinutes,
    ).length;
    if (actual !== check.expectedReachableLocalityCount) {
      mismatches.push(
        `${check.label}: expected ${check.expectedReachableLocalityCount}, received ${actual}`,
      );
    }
  }
  if (mismatches.length > 0) {
    throw new Error(
      `Runtime road data verification found ${mismatches.length} mismatch(es):\n${mismatches.join('\n')}`,
    );
  }
  return {
    pointCount: options.pointChecks.length,
    reachabilityCount: options.reachabilityChecks.length,
  };
}
