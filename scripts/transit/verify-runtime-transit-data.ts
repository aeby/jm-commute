import { resolve } from 'node:path';

import {
  verifyRuntimeTransitData,
  type RuntimeTransitPointCheck,
  type RuntimeTransitReachabilityCheck,
} from './runtime-transit-data-verification';

const PROJECT_ROOT = resolve(import.meta.dirname, '..', '..');

const POINT_CHECKS = ([
  ['8001 Zürich', '8001:zurich', '3011 Bern', '3011:bern', 62],
  ['3011 Bern', '3011:bern', '8001 Zürich', '8001:zurich', 62],
  ['8750 Glarus', '8750:glarus', '8001 Zürich', '8001:zurich', 63],
  ['8001 Zürich', '8001:zurich', '8750 Glarus', '8750:glarus', 62],
  ['3920 Zermatt', '3920:zermatt', '3930 Visp', '3930:visp', 70],
  ['3930 Visp', '3930:visp', '3920 Zermatt', '3920:zermatt', 66],
] as const).map(
  ([
    fromLabel,
    fromLocalityId,
    toLabel,
    toLocalityId,
    expectedTravelMinutes,
  ]): RuntimeTransitPointCheck => ({
    label: `${fromLabel} → ${toLabel}`,
    fromLocalityId,
    toLocalityId,
    expectedTravelMinutes,
  }),
);

const REFERENCE_ORIGINS = [
  ['8001 Zürich', '8001:zurich', [176, 768, 1_626, 2_236, 3_467, 4_002]],
  ['3011 Bern', '3011:bern', [128, 630, 1_386, 2_166, 3_315, 3_891]],
  ['8750 Glarus', '8750:glarus', [36, 113, 344, 796, 2_167, 3_379]],
  ['3920 Zermatt', '3920:zermatt', [4, 9, 19, 65, 563, 2_148]],
] as const;
const REACHABILITY_CHECKS = REFERENCE_ORIGINS.flatMap(
  ([label, originLocalityId, expectedCounts]) =>
    ([30, 60, 90, 120, 180, 240] as const).map(
      (maxTravelMinutes, thresholdIndex): RuntimeTransitReachabilityCheck => ({
        label: `${label}, ${maxTravelMinutes} min`,
        originLocalityId,
        maxTravelMinutes,
        expectedReachableLocalityCount: expectedCounts[thresholdIndex] as number,
      }),
    ),
);

async function main(): Promise<void> {
  const runtimeDataDirectory = resolve(PROJECT_ROOT, 'data/runtime/transit');
  const verification = await verifyRuntimeTransitData({
    runtimeDataDirectory,
    pointChecks: POINT_CHECKS,
    reachabilityChecks: REACHABILITY_CHECKS,
  });

  console.log('Runtime-only transit data authenticated and queried:');
  console.log(`  Directory: ${verification.runtimeDataDirectory}`);
  console.log('');
  console.log('Directional point diagnostics:');
  for (const result of verification.pointResults) {
    console.log(
      `  ${result.label}: ` +
        `${result.travelMinutes === undefined ? 'unavailable' : `${result.travelMinutes} min`}`,
    );
  }
  console.log('');
  console.log('Reachable-locality diagnostics (including origin):');
  for (const result of verification.reachabilityResults) {
    console.log(`  ${result.label}: ${result.reachableLocalityCount}`);
  }
  console.log('');
  console.log('All frozen runtime-only transit reference values matched.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
