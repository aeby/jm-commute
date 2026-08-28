import {
  getCarTravelMinutes,
  getReachableLocalitiesByCar,
} from '@jm/commute';
import {
  loadCarTravelTimeIndex,
  type LoadTravelTimeIndexOptions,
} from '@commute-internal/internal/load-travel-time-data';
import type { LocalityId } from '@jm/commute';

export interface RuntimeCarPointCheck {
  readonly label: string;
  readonly fromLocalityId: LocalityId;
  readonly toLocalityId: LocalityId;
  readonly expectedTravelMinutes: number | undefined;
}

export interface RuntimeCarReachabilityCheck {
  readonly label: string;
  readonly originLocalityId: LocalityId;
  readonly maxTravelMinutes: number;
  readonly expectedReachableLocalityCount: number;
}

export interface RuntimeCarPointCheckResult extends RuntimeCarPointCheck {
  readonly travelMinutes: number | undefined;
}

export interface RuntimeCarReachabilityCheckResult
  extends RuntimeCarReachabilityCheck {
  readonly reachableLocalityCount: number;
}

export interface VerifyRuntimeCarDataOptions
  extends LoadTravelTimeIndexOptions {
  readonly pointChecks: readonly RuntimeCarPointCheck[];
  readonly reachabilityChecks: readonly RuntimeCarReachabilityCheck[];
}

export interface RuntimeCarDataVerification {
  readonly runtimeDataDirectory: string;
  readonly pointChecks: readonly RuntimeCarPointCheckResult[];
  readonly reachabilityChecks: readonly RuntimeCarReachabilityCheckResult[];
}

function formatTravelMinutes(value: number | undefined): string {
  return value === undefined ? 'unreachable' : `${value} min`;
}

function requireChecks(
  checks: readonly unknown[],
  description: string,
): void {
  if (!Array.isArray(checks) || checks.length === 0) {
    throw new Error(`Runtime car verification requires at least one ${description}.`);
  }
}

/**
 * Authenticates and queries only the supplied runtime artifacts. This module
 * deliberately has no dependency on preprocessing inputs or output paths.
 */
export async function verifyRuntimeCarData(
  options: VerifyRuntimeCarDataOptions,
): Promise<RuntimeCarDataVerification> {
  requireChecks(options.pointChecks, 'point check');
  requireChecks(options.reachabilityChecks, 'reachability check');

  const index = await loadCarTravelTimeIndex(options);
  const pointChecks = options.pointChecks.map((check) => ({
    ...check,
    travelMinutes: getCarTravelMinutes(
      index,
      check.fromLocalityId,
      check.toLocalityId,
    ),
  }));
  const reachabilityChecks = options.reachabilityChecks.map((check) => ({
    ...check,
    reachableLocalityCount: getReachableLocalitiesByCar(
      index,
      check.originLocalityId,
      check.maxTravelMinutes,
    ).length,
  }));
  const mismatches = [
    ...pointChecks.flatMap((check) =>
      check.travelMinutes === check.expectedTravelMinutes
        ? []
        : [
            `${check.label}: expected ${formatTravelMinutes(check.expectedTravelMinutes)}, received ${formatTravelMinutes(check.travelMinutes)}`,
          ],
    ),
    ...reachabilityChecks.flatMap((check) =>
      check.reachableLocalityCount === check.expectedReachableLocalityCount
        ? []
        : [
            `${check.label}: expected ${check.expectedReachableLocalityCount} reachable localities, received ${check.reachableLocalityCount}`,
          ],
    ),
  ];
  if (mismatches.length > 0) {
    throw new Error(
      `Runtime car data verification found ${mismatches.length} mismatch(es):\n${mismatches.join('\n')}`,
    );
  }

  return {
    runtimeDataDirectory: options.runtimeDataDirectory,
    pointChecks,
    reachabilityChecks,
  };
}
