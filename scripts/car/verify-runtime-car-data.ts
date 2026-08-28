import { resolve } from 'node:path';

import { resolveCarRuntimeDataPaths } from '@core/car/node';

import {
  verifyRuntimeCarData,
  type RuntimeCarPointCheck,
  type RuntimeCarReachabilityCheck,
  type RuntimeCarReachabilityDiagnostic,
} from './runtime-car-data-verification';

const PROJECT_ROOT = resolve(import.meta.dirname, '..', '..');

const POINT_CHECKS = [
  {
    label: '8001 Zürich → 3011 Bern',
    fromLocalityId: '8001:zurich',
    toLocalityId: '3011:bern',
    expectedTravelMinutes: 93,
  },
  {
    label: '3011 Bern → 8001 Zürich',
    fromLocalityId: '3011:bern',
    toLocalityId: '8001:zurich',
    expectedTravelMinutes: 95,
  },
  {
    label: '8750 Glarus → 8001 Zürich',
    fromLocalityId: '8750:glarus',
    toLocalityId: '8001:zurich',
    expectedTravelMinutes: 58,
  },
  {
    label: '8001 Zürich → 8750 Glarus',
    fromLocalityId: '8001:zurich',
    toLocalityId: '8750:glarus',
    expectedTravelMinutes: 56,
  },
  {
    label: '3920 Zermatt → 3930 Visp',
    fromLocalityId: '3920:zermatt',
    toLocalityId: '3930:visp',
    expectedTravelMinutes: 43,
  },
  {
    label: '3930 Visp → 3920 Zermatt',
    fromLocalityId: '3930:visp',
    toLocalityId: '3920:zermatt',
    expectedTravelMinutes: 43,
  },
] as const satisfies readonly RuntimeCarPointCheck[];

const REACHABILITY_ORIGINS = [
  { label: '8001 Zürich', localityId: '8001:zurich' },
  { label: '3011 Bern', localityId: '3011:bern' },
  { label: '8750 Glarus', localityId: '8750:glarus' },
  { label: '3920 Zermatt', localityId: '3920:zermatt' },
] as const;
const REACHABILITY_LIMITS = [30, 60, 90, 120] as const;
const EXPECTED_REACHABILITY_COUNTS = {
  '8001:zurich': [271, 1_091, 1_770, 2_430],
  '3011:bern': [221, 983, 2_035, 2_781],
  '8750:glarus': [53, 332, 1_147, 1_768],
  '3920:zermatt': [5, 46, 194, 360],
} as const;
const REACHABILITY_CHECKS = REACHABILITY_ORIGINS.flatMap((origin) =>
  REACHABILITY_LIMITS.map(
    (maxTravelMinutes, limitIndex): RuntimeCarReachabilityCheck => ({
      label: `${origin.label}, ${maxTravelMinutes} min`,
      originLocalityId: origin.localityId,
      maxTravelMinutes,
      expectedReachableLocalityCount:
        EXPECTED_REACHABILITY_COUNTS[origin.localityId][limitIndex] as number,
    }),
  ),
);
const HIGH_HORIZON_DIAGNOSTICS = REACHABILITY_ORIGINS.flatMap((origin) =>
  ([180, 240] as const).map(
    (maxTravelMinutes): RuntimeCarReachabilityDiagnostic => ({
      label: `${origin.label}, ${maxTravelMinutes} min`,
      originLocalityId: origin.localityId,
      maxTravelMinutes,
    }),
  ),
);

async function main(): Promise<void> {
  const paths = resolveCarRuntimeDataPaths(PROJECT_ROOT);
  const verification = await verifyRuntimeCarData({
    ...paths,
    pointChecks: POINT_CHECKS,
    reachabilityChecks: REACHABILITY_CHECKS,
    diagnosticReachabilityQueries: HIGH_HORIZON_DIAGNOSTICS,
  });

  console.log('Runtime car data verified:');
  console.log(`  Manifest: ${verification.manifestPath}`);
  console.log(`  Matrix: ${verification.matrixPath}`);
  console.log('');
  console.log('Directional point checks:');
  for (const check of verification.pointChecks) {
    console.log(
      `  ${check.label}: ${check.travelMinutes === undefined ? 'unreachable' : `${check.travelMinutes} min`}`,
    );
  }
  console.log('');
  console.log('Reachable-locality checks (including the origin):');
  for (const check of verification.reachabilityChecks) {
    console.log(`  ${check.label}: ${check.reachableLocalityCount}`);
  }
  console.log('');
  console.log('Four-hour dataset diagnostics (not hardcoded baselines):');
  for (const diagnostic of verification.diagnosticReachabilityQueries) {
    console.log(`  ${diagnostic.label}: ${diagnostic.reachableLocalityCount}`);
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
