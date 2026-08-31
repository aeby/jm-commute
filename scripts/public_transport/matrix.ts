import { relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';

import { PROJECT_CONFIG } from '@core/config';
import {
  buildNetwork,
  calculateTravelTimes,
  loadPreparedData,
} from '@core/public_transport';

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
  PREPARED_ROUTING_DIRECTORY,
  PREPARED_STOPS_PATH,
  PROJECT_ROOT,
  RAW_GTFS_DIRECTORY,
  RAW_LOCALITIES_PATH,
  RAW_TRANSFERS_PATH,
  RUNTIME_DATA_DIRECTORY,
} from './paths';

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: { restart: { type: 'boolean', default: false } },
  allowPositionals: false,
  strict: true,
});
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
const matrixCommand = 'npm run public-transport:matrix';
const restartCommand = `${matrixCommand} -- --restart`;
const prepareCommand = 'npm run public-transport:prepare';
const preparedInputPaths = [
  PREPARED_STOPS_PATH,
  resolve(PREPARED_ROUTING_DIRECTORY, 'manifest.json'),
  resolve(PREPARED_ROUTING_DIRECTORY, 'trips.ndjson'),
];
const rawInputPaths = [
  RAW_LOCALITIES_PATH,
  resolve(RAW_GTFS_DIRECTORY, 'feed_info.txt'),
  resolve(RAW_GTFS_DIRECTORY, 'calendar.txt'),
  resolve(RAW_GTFS_DIRECTORY, 'calendar_dates.txt'),
  RAW_TRANSFERS_PATH,
];

async function haveRequiredFiles(
  paths: readonly string[],
  message: string,
  hint: string,
): Promise<boolean> {
  const missingPaths = await findMissingRegularFiles(paths);
  if (missingPaths.length === 0) {
    return true;
  }

  console.error(`Error: ${message}`);
  for (const path of missingPaths) {
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

  const [workState, publishedState] = await Promise.all([
    inspectRegularFileSet(workPaths),
    inspectRegularFileSet(publishedPaths),
  ]);
  const decision = decideResumableBuildPreflight({
    restart: false,
    work: workState,
    publication: publishedState,
  });
  if (decision === 'incomplete-work') {
    console.error(
      'Error: The public-transport matrix resume files are incomplete, so the build cannot safely continue.',
    );
    console.error(
      `Hint: Run "${restartCommand}" to start over intentionally.`,
    );
    process.exitCode = 1;
    return false;
  }
  if (decision === 'resume') {
    console.log('Found a partial public-transport matrix; resuming it.');
    return true;
  }
  if (decision === 'incomplete-publication') {
    console.error(
      'Error: The published public-transport matrix files are incomplete, so the output cannot be reused.',
    );
    console.error(
      `Hint: Run "${restartCommand}" to rebuild them intentionally.`,
    );
    process.exitCode = 1;
    return false;
  }
  if (decision === 'skip') {
    console.log(
      'The public-transport travel-time matrix already exists. Nothing to do.',
    );
    console.log(`Run "${restartCommand}" to rebuild it intentionally.`);
    return false;
  }
  return true;
}

async function main(): Promise<void> {
  if (!(await canBuildMatrix())) {
    return;
  }
  if (
    !(await haveRequiredFiles(
      preparedInputPaths,
      'The public-transport matrix needs prepared data, but these files are missing or are not files:',
      `Run "${prepareCommand}" first, then rerun "${matrixCommand}".`,
    ))
  ) {
    return;
  }
  if (
    !(await haveRequiredFiles(
      rawInputPaths,
      'The public-transport matrix needs raw source data, but these files are missing or are not files:',
      `Restore the source files, then rerun "${matrixCommand}". If the GTFS feed changed, run "${prepareCommand} -- --restart" first.`,
    ))
  ) {
    return;
  }

  const config = PROJECT_CONFIG.publicTransport;
  const scenario = {
    serviceDate: config.referenceScenario.serviceDate,
    routingWindowStart: config.referenceScenario.morningWindow.start,
    routingWindowEnd: config.referenceScenario.morningWindow.end,
  };

  const prepared = await runCommandStep(
    'Load prepared public-transport data',
    () =>
      loadPreparedData({
        gtfsDirectory: RAW_GTFS_DIRECTORY,
        stopsPath: PREPARED_STOPS_PATH,
        routingDirectory: PREPARED_ROUTING_DIRECTORY,
        localitiesPath: RAW_LOCALITIES_PATH,
        transfersPath: RAW_TRANSFERS_PATH,
        scenario,
        localitySelection: config.localityAccess,
      }),
  );

  const { network, localities } = await runCommandStep(
    'Build public-transport network',
    () =>
      buildNetwork({
        trips: prepared.trips,
        transferRules: prepared.transferRules,
        activeServiceIds: prepared.activeServiceIds,
        stops: prepared.stops,
        localities: prepared.localities,
        routingWindowStartSeconds: prepared.routingWindowStartSeconds,
        routingWindowEndSeconds: prepared.routingWindowEndSeconds,
      }),
  );
  const gtfsFeedVersion = prepared.manifest.sourceFeedVersion;
  if (gtfsFeedVersion === undefined || gtfsFeedVersion.length === 0) {
    throw new Error('Prepared routing data has no GTFS feed version.');
  }
  const matrixStartedAt = performance.now();
  let lastReportedOrigin = 0;
  const result = await runCommandStep(
    `Calculate ${localities.entries.length} × ${localities.entries.length} travel times`,
    () =>
      calculateTravelTimes({
        network,
        localityRoutingIndex: localities,
        provenance: {
          serviceDate: scenario.serviceDate,
          morningWindow: config.referenceScenario.morningWindow,
          gtfsFeedVersion,
          routingDataFingerprint: prepared.manifest.tripsSha256,
          maxTransfers: config.routing.maxTransfers,
          minTransferTimeSeconds: config.routing.minTransferTimeSeconds,
        },
        restart: values.restart,
        paths: matrixPaths,
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
    `Use "${prepareCommand}" to recreate prepared inputs or "${restartCommand}" ` +
    'to replace incomplete matrix state.',
});
