import { relative, resolve } from 'node:path';

import type { LocalityId } from '@jm/commute';
import {
  verifyRuntimeTransitData,
  type RuntimeTransitPointCheck,
  type RuntimeTransitReachabilityCheck,
} from '@core/public_transport/matrix/runtime-data-verification';

import {
  findMissingRegularFiles,
  inspectRegularFileSet,
  runCliCommand,
  runCommandStep,
} from '../cli';
import { PROJECT_ROOT, RUNTIME_DATA_DIRECTORY } from './paths';

const matrixCommand = 'npm run public-transport:matrix';
const verifyCommand = 'npm run public-transport:verify';

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
const runtimePaths = [
  resolve(RUNTIME_DATA_DIRECTORY, 'manifest.json'),
  resolve(RUNTIME_DATA_DIRECTORY, 'travel-times.bin'),
];

async function haveRuntimeData(): Promise<boolean> {
  const state = await inspectRegularFileSet(runtimePaths);
  if (state === 'complete') {
    return true;
  }

  const missingPaths = await findMissingRegularFiles(runtimePaths);
  console.error(
    'Error: Published public-transport data is missing or incomplete:',
  );
  for (const path of missingPaths) {
    console.error(`  - ${relative(PROJECT_ROOT, path)}`);
  }
  console.error(
    state === 'absent'
      ? `Hint: Run "${matrixCommand}" first, then rerun "${verifyCommand}".`
      : `Hint: Run "${matrixCommand} -- --restart" to rebuild the complete published pair, then rerun "${verifyCommand}".`,
  );
  process.exitCode = 1;
  return false;
}

async function main(): Promise<void> {
  if (!(await haveRuntimeData())) {
    return;
  }

  const result = await runCommandStep(
    'Verify published public-transport data',
    () =>
      verifyRuntimeTransitData({
        runtimeDataDirectory: RUNTIME_DATA_DIRECTORY,
        pointChecks,
        reachabilityChecks,
      }),
  );

  console.log(
    `Verified ${result.pointResults.length} point values and ` +
      `${result.reachabilityResults.length} reachability counts in ` +
      `${result.runtimeDataDirectory}.`,
  );
}

await runCliCommand(main, {
  fileErrorHint:
    `Correct the reported filesystem problem, then rerun "${verifyCommand}". ` +
    `Use "${matrixCommand} -- --restart" if the published pair must be rebuilt.`,
});
