import { relative, resolve } from 'node:path';

import type { LocalityId } from '@jm/commute';
import {
  verifyRuntimeRoadData,
  type RuntimeRoadPointCheck,
  type RuntimeRoadReachabilityCheck,
} from '@core/road/matrix/runtime-data-verification';

import {
  findMissingRegularFiles,
  inspectRegularFileSet,
  runCliCommand,
  runCommandStep,
} from '../cli';
import { PROJECT_ROOT, RUNTIME_DATA_DIRECTORY } from './paths';

const pointChecks: readonly RuntimeRoadPointCheck[] = [
  ['8001:zurich', '3011:bern', 93],
  ['3011:bern', '8001:zurich', 95],
  ['8750:glarus', '8001:zurich', 58],
  ['8001:zurich', '8750:glarus', 56],
  ['3920:zermatt', '3930:visp', 43],
  ['3930:visp', '3920:zermatt', 43],
].map(([fromLocalityId, toLocalityId, expectedTravelMinutes]) => ({
  label: `${String(fromLocalityId)} → ${String(toLocalityId)}`,
  fromLocalityId: fromLocalityId as LocalityId,
  toLocalityId: toLocalityId as LocalityId,
  expectedTravelMinutes: expectedTravelMinutes as number,
}));
const referenceOrigins = [
  ['8001:zurich', [271, 1_091, 1_770, 2_430]],
  ['3011:bern', [221, 983, 2_035, 2_781]],
  ['8750:glarus', [53, 332, 1_147, 1_768]],
  ['3920:zermatt', [5, 46, 194, 360]],
] as const;
const reachabilityChecks = referenceOrigins.flatMap(
  ([originLocalityId, expectedCounts]) =>
    ([30, 60, 90, 120] as const).map(
      (maxTravelMinutes, index): RuntimeRoadReachabilityCheck => ({
        label: `${originLocalityId}, ${maxTravelMinutes} min`,
        originLocalityId,
        maxTravelMinutes,
        expectedReachableLocalityCount: expectedCounts[index] as number,
      }),
    ),
);
const runtimePaths = [
  resolve(RUNTIME_DATA_DIRECTORY, 'manifest.json'),
  resolve(RUNTIME_DATA_DIRECTORY, 'travel-times.bin'),
];
const matrixCommand = 'npm run road:matrix';
const verifyCommand = 'npm run road:verify';

async function main(): Promise<void> {
  const state = await inspectRegularFileSet(runtimePaths);
  if (state !== 'complete') {
    console.error('Error: Published road data is missing or incomplete:');
    for (const path of await findMissingRegularFiles(runtimePaths)) {
      console.error(`  - ${relative(PROJECT_ROOT, path)}`);
    }
    console.error(
      `Hint: Run "${matrixCommand}${state === 'incomplete' ? ' -- --restart' : ''}" first.`,
    );
    process.exitCode = 1;
    return;
  }
  const result = await runCommandStep('Verify published road data', () =>
    verifyRuntimeRoadData({
      runtimeDataDirectory: RUNTIME_DATA_DIRECTORY,
      pointChecks,
      reachabilityChecks,
    }),
  );
  console.log(
    `Verified ${result.pointCount} point values and ` +
      `${result.reachabilityCount} reachability counts.`,
  );
}

await runCliCommand(main, {
  fileErrorHint:
    `Correct the filesystem problem, then rerun "${verifyCommand}".`,
});
