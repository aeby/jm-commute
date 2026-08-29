import type { LocalityId } from '@jm/commute';
import {
  verifyRuntimeTransitData,
  type RuntimeTransitPointCheck,
  type RuntimeTransitReachabilityCheck,
} from '@core/public_transport/matrix/runtime-data-verification';

import { RUNTIME_DATA_DIRECTORY } from './paths';

const pointChecks: readonly RuntimeTransitPointCheck[] = [
  ['8001:zurich', '3011:bern', 62],
  ['3011:bern', '8001:zurich', 62],
  ['8750:glarus', '8001:zurich', 63],
  ['8001:zurich', '8750:glarus', 62],
  ['3920:zermatt', '3930:visp', 70],
  ['3930:visp', '3920:zermatt', 66],
].map(([fromLocalityId, toLocalityId, expectedTravelMinutes]) => ({
  label: `${String(fromLocalityId)} → ${String(toLocalityId)}`,
  fromLocalityId: fromLocalityId as LocalityId,
  toLocalityId: toLocalityId as LocalityId,
  expectedTravelMinutes: expectedTravelMinutes as number,
}));

const referenceOrigins = [
  ['8001:zurich', [176, 768, 1_626, 2_236, 3_467, 4_002]],
  ['3011:bern', [128, 630, 1_386, 2_166, 3_315, 3_891]],
  ['8750:glarus', [36, 113, 344, 796, 2_167, 3_379]],
  ['3920:zermatt', [4, 9, 19, 65, 563, 2_148]],
] as const;
const reachabilityChecks = referenceOrigins.flatMap(
  ([originLocalityId, expectedCounts]) =>
    ([30, 60, 90, 120, 180, 240] as const).map(
      (maxTravelMinutes, thresholdIndex): RuntimeTransitReachabilityCheck => ({
        label: `${originLocalityId}, ${maxTravelMinutes} min`,
        originLocalityId,
        maxTravelMinutes,
        expectedReachableLocalityCount: expectedCounts[thresholdIndex] as number,
      }),
    ),
);

const result = await verifyRuntimeTransitData({
  runtimeDataDirectory: RUNTIME_DATA_DIRECTORY,
  pointChecks,
  reachabilityChecks,
});

console.log(
  `Verified ${result.pointResults.length} point values and ` +
    `${result.reachabilityResults.length} reachability counts in ` +
    `${result.runtimeDataDirectory}.`,
);
