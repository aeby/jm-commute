import { relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';

import { PROJECT_CONFIG } from '@core/config';
import {
  buildNetwork,
  calculateTravelTimes,
  loadPreparedData,
  OsrmClient,
} from '@core/road';

import {
  decideResumableBuildPreflight,
  findMissingRegularFiles,
  formatElapsed,
  inspectRegularFileSet,
  runCliCommand,
  runCommandStep,
} from '../cli';
import {
  MATRIX_WORK_DIRECTORY,
  PREPARED_NETWORK_DIRECTORY,
  PROJECT_ROOT,
  RAW_LOCALITIES_PATH,
  RAW_OSM_PBF_PATH,
  RUNTIME_DATA_DIRECTORY,
} from './paths';

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    restart: { type: 'boolean', default: false },
    'osrm-base-url': { type: 'string' },
  },
  allowPositionals: false,
  strict: true,
});
const config = PROJECT_CONFIG.road;
const matrixPaths = {
  workDirectory: MATRIX_WORK_DIRECTORY,
  manifestPath: resolve(RUNTIME_DATA_DIRECTORY, 'manifest.json'),
  matrixPath: resolve(RUNTIME_DATA_DIRECTORY, 'travel-times.bin'),
};
const workPaths = [
  resolve(MATRIX_WORK_DIRECTORY, 'checkpoint.json'),
  resolve(MATRIX_WORK_DIRECTORY, 'travel-times.bin.partial'),
];
const publishedPaths = [matrixPaths.manifestPath, matrixPaths.matrixPath];
const preparedPaths = [
  resolve(PREPARED_NETWORK_DIRECTORY, 'manifest.json'),
  ...['hsgr', 'edges', 'geometry', 'properties'].map((suffix) =>
    resolve(
      PREPARED_NETWORK_DIRECTORY,
      `${config.osrm.datasetBasename}.${suffix}`,
    ),
  ),
];
const matrixCommand = 'npm run road:matrix';
const restartCommand = `${matrixCommand} -- --restart`;
const prepareCommand = 'npm run road:prepare';

async function requireFiles(
  paths: readonly string[],
  message: string,
  hint: string,
): Promise<boolean> {
  const missing = await findMissingRegularFiles(paths);
  if (missing.length === 0) {
    return true;
  }
  console.error(`Error: ${message}`);
  for (const path of missing) {
    console.error(`  - ${relative(PROJECT_ROOT, path)}`);
  }
  console.error(`Hint: ${hint}`);
  process.exitCode = 1;
  return false;
}

async function canBuildMatrix(): Promise<boolean> {
  if (values.restart) {
    return true;
  }
  const [work, publication] = await Promise.all([
    inspectRegularFileSet(workPaths),
    inspectRegularFileSet(publishedPaths),
  ]);
  const decision = decideResumableBuildPreflight({
    restart: false,
    work,
    publication,
  });
  if (decision === 'resume') {
    console.log('Found a partial road matrix; resuming it.');
    return true;
  }
  if (decision === 'skip') {
    console.log('The road travel-time matrix already exists. Nothing to do.');
    console.log(`Run "${restartCommand}" to rebuild it intentionally.`);
    return false;
  }
  if (decision === 'incomplete-work') {
    console.error('Error: The road matrix resume files are incomplete.');
    console.error(`Hint: Run "${restartCommand}" to start over.`);
    process.exitCode = 1;
    return false;
  }
  if (decision === 'incomplete-publication') {
    console.error('Error: The published road matrix files are incomplete.');
    console.error(`Hint: Run "${restartCommand}" to rebuild them.`);
    process.exitCode = 1;
    return false;
  }
  return true;
}

async function main(): Promise<void> {
  if (!(await canBuildMatrix())) {
    return;
  }
  if (
    !(await requireFiles(
      preparedPaths,
      'The road matrix needs prepared network data:',
      `Run "${prepareCommand}" first.`,
    )) ||
    !(await requireFiles(
      [RAW_OSM_PBF_PATH, RAW_LOCALITIES_PATH],
      'The road matrix needs its canonical source inputs:',
      'Restore the source files before building the matrix.',
    ))
  ) {
    return;
  }

  const prepared = await runCommandStep('Load prepared road data', () =>
    loadPreparedData({
      osmPbfPath: RAW_OSM_PBF_PATH,
      localitiesPath: RAW_LOCALITIES_PATH,
      networkDirectory: PREPARED_NETWORK_DIRECTORY,
      osrm: config.osrm,
    }),
  );
  const router = new OsrmClient({
    baseUrl: values['osrm-base-url'] ?? config.osrm.baseUrl,
    requestTimeoutMilliseconds: config.osrm.requestTimeoutMilliseconds,
  });
  await runCommandStep('Check the OSRM routing service', () =>
    router.findNearestRoadPoint(prepared.localities[0]!),
  );
  const networkStartedAt = performance.now();
  let lastReportedAnchor = 0;
  const network = await runCommandStep('Build the locality road network', () =>
    buildNetwork({
      preparedData: prepared,
      router,
      concurrency: config.network.snapConcurrency,
      onProgress: ({ completedLocalities, totalLocalities }) => {
        if (
          completedLocalities === totalLocalities ||
          completedLocalities - lastReportedAnchor >= 500
        ) {
          console.log(
            `[progress] Locality anchors: ${completedLocalities} / ${totalLocalities} ` +
              `(${formatElapsed(performance.now() - networkStartedAt)} elapsed)`,
          );
          lastReportedAnchor = completedLocalities;
        }
      },
    }),
  );

  const matrixStartedAt = performance.now();
  let lastReportedOrigin = 0;
  const result = await runCommandStep(
    `Calculate ${network.localities.length} × ${network.localities.length} travel times`,
    () =>
      calculateTravelTimes({
        network,
        config: config.matrix,
        paths: matrixPaths,
        restart: values.restart,
        onProgress: ({ completedOrigins, totalOrigins }) => {
          if (
            completedOrigins === totalOrigins ||
            completedOrigins - lastReportedOrigin >= 250
          ) {
            console.log(
              `[progress] Matrix origins: ${completedOrigins} / ${totalOrigins} ` +
                `(${formatElapsed(performance.now() - matrixStartedAt)} elapsed)`,
            );
            lastReportedOrigin = completedOrigins;
          }
        },
      }),
  );
  console.log(
    `Published ${result.matrixByteLength} matrix bytes after ` +
      `${result.validation.exactMatches} validation checks.`,
  );
  console.log(`Matrix fingerprint: ${result.fingerprint}`);
}

await runCliCommand(main, {
  fileErrorHint:
    `Correct the reported filesystem problem, then rerun "${matrixCommand}". ` +
    `Use "${prepareCommand}" to recreate the road network or ` +
    `"${restartCommand}" to replace incomplete matrix state.`,
});
