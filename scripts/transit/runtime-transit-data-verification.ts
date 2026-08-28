import {
  getReachableLocalitiesByTransit,
  getTransitTravelMinutes,
} from '@jm/commute';
import {
  loadTransitTravelTimeIndex,
  type LoadTravelTimeIndexOptions,
} from '@commute-internal/internal/load-travel-time-data';
import type { LocalityId } from '@jm/commute';

export interface RuntimeTransitPointCheck {
  readonly label: string;
  readonly fromLocalityId: LocalityId;
  readonly toLocalityId: LocalityId;
  readonly expectedTravelMinutes: number | undefined;
}

export interface RuntimeTransitReachabilityCheck {
  readonly label: string;
  readonly originLocalityId: LocalityId;
  readonly maxTravelMinutes: number;
  readonly expectedReachableLocalityCount: number;
}

export interface RuntimeTransitPointResult
  extends Omit<RuntimeTransitPointCheck, 'expectedTravelMinutes'> {
  readonly travelMinutes: number | undefined;
}

export interface RuntimeTransitReachabilityResult
  extends Omit<
    RuntimeTransitReachabilityCheck,
    'expectedReachableLocalityCount'
  > {
  readonly reachableLocalityCount: number;
}

export interface VerifyRuntimeTransitDataOptions
  extends LoadTravelTimeIndexOptions {
  readonly pointChecks: readonly RuntimeTransitPointCheck[];
  readonly reachabilityChecks: readonly RuntimeTransitReachabilityCheck[];
}

export interface RuntimeTransitDataVerification {
  readonly runtimeDataDirectory: string;
  readonly pointResults: readonly RuntimeTransitPointResult[];
  readonly reachabilityResults: readonly RuntimeTransitReachabilityResult[];
}

function formatTravelMinutes(value: number | undefined): string {
  return value === undefined ? 'unavailable' : `${value} min`;
}

function requireChecks(checks: readonly unknown[], description: string): void {
  if (checks.length === 0) {
    throw new Error(
      `Runtime transit verification requires at least one ${description}.`,
    );
  }
}

/**
 * Authenticates and queries only the supplied runtime files through the public
 * transit matrix façade. It intentionally imports no preprocessing modules.
 */
export async function verifyRuntimeTransitData(
  options: VerifyRuntimeTransitDataOptions,
): Promise<RuntimeTransitDataVerification> {
  requireChecks(options.pointChecks, 'point check');
  requireChecks(options.reachabilityChecks, 'reachability check');

  const index = await loadTransitTravelTimeIndex(options);
  const pointResults = options.pointChecks.map((query) => ({
    label: query.label,
    fromLocalityId: query.fromLocalityId,
    toLocalityId: query.toLocalityId,
    travelMinutes: getTransitTravelMinutes(
      index,
      query.fromLocalityId,
      query.toLocalityId,
    ),
  }));
  const reachabilityResults = options.reachabilityChecks.map((query) => ({
    label: query.label,
    originLocalityId: query.originLocalityId,
    maxTravelMinutes: query.maxTravelMinutes,
    reachableLocalityCount: getReachableLocalitiesByTransit(
      index,
      query.originLocalityId,
      query.maxTravelMinutes,
    ).length,
  }));

  const mismatches = [
    ...options.pointChecks.flatMap((check, resultIndex) => {
      const actual = pointResults[resultIndex]?.travelMinutes;
      return actual === check.expectedTravelMinutes
        ? []
        : [
            `${check.label}: expected ` +
              `${formatTravelMinutes(check.expectedTravelMinutes)}, received ` +
              formatTravelMinutes(actual),
          ];
    }),
    ...options.reachabilityChecks.flatMap((check, resultIndex) => {
      const actual =
        reachabilityResults[resultIndex]?.reachableLocalityCount;
      return actual === check.expectedReachableLocalityCount
        ? []
        : [
            `${check.label}: expected ` +
              `${check.expectedReachableLocalityCount} reachable localities, ` +
              `received ${actual ?? 'missing'}`,
          ];
    }),
  ];
  if (mismatches.length > 0) {
    throw new Error(
      `Runtime transit data verification found ${mismatches.length} ` +
        `mismatch(es):\n${mismatches.join('\n')}`,
    );
  }

  return {
    runtimeDataDirectory: options.runtimeDataDirectory,
    pointResults,
    reachabilityResults,
  };
}
