import { relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { PROJECT_CONFIG } from '@core/config';
import { prepareData } from '@core/public_transport';

import {
  allRegularFilesExist,
  findMissingRegularFiles,
  runCliCommand,
  runCommandStep,
} from '../cli';
import {
  PREPARED_ROUTING_DIRECTORY,
  PREPARED_STOPS_PATH,
  PROJECT_ROOT,
  RAW_GTFS_DIRECTORY,
} from './paths';

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: { restart: { type: 'boolean', default: false } },
  allowPositionals: false,
  strict: true,
});
const preparedOutputs = [
  PREPARED_STOPS_PATH,
  resolve(PREPARED_ROUTING_DIRECTORY, 'manifest.json'),
  resolve(PREPARED_ROUTING_DIRECTORY, 'trips.ndjson'),
];
const rawInputPaths = [
  resolve(RAW_GTFS_DIRECTORY, 'stops.txt'),
  resolve(RAW_GTFS_DIRECTORY, 'feed_info.txt'),
  resolve(RAW_GTFS_DIRECTORY, 'calendar.txt'),
  resolve(RAW_GTFS_DIRECTORY, 'calendar_dates.txt'),
  resolve(RAW_GTFS_DIRECTORY, 'trips.txt'),
  resolve(RAW_GTFS_DIRECTORY, 'frequencies.txt'),
  resolve(RAW_GTFS_DIRECTORY, 'stop_times.txt'),
];

async function haveRawInputs(): Promise<boolean> {
  const missingPaths = await findMissingRegularFiles(rawInputPaths);
  if (missingPaths.length === 0) {
    return true;
  }

  console.error(
    'Error: Public-transport preparation needs raw GTFS data, but these files are missing or are not files:',
  );
  for (const path of missingPaths) {
    console.error(`  - ${relative(PROJECT_ROOT, path)}`);
  }
  console.error(
    'Hint: Restore the source files, then rerun "npm run public-transport:prepare".',
  );
  process.exitCode = 1;
  return false;
}

async function main(): Promise<void> {
  if (!values.restart && (await allRegularFilesExist(preparedOutputs))) {
    console.log('Prepared public-transport data already exists. Nothing to do.');
    console.log(
      'Run "npm run public-transport:prepare -- --restart" to rebuild it intentionally.',
    );
    return;
  }
  if (!(await haveRawInputs())) {
    return;
  }

  const { referenceScenario } = PROJECT_CONFIG.publicTransport;
  const result = await runCommandStep(
    'Prepare public-transport routing data',
    () =>
      prepareData({
        gtfsDirectory: RAW_GTFS_DIRECTORY,
        stopsPath: PREPARED_STOPS_PATH,
        routingDirectory: PREPARED_ROUTING_DIRECTORY,
        scenario: {
          serviceDate: referenceScenario.serviceDate,
          routingWindowStart: referenceScenario.morningWindow.start,
          routingWindowEnd: referenceScenario.morningWindow.end,
        },
      }),
  );

  console.log(`Prepared ${result.stopCount} stops.`);
  console.log(
    `Prepared ${result.routingManifest.tripCount} trips with ` +
      `${result.routingManifest.stopTimeCount} stop times for ` +
      `${result.routingManifest.serviceDate}.`,
  );
  console.log(`Stops: ${PREPARED_STOPS_PATH}`);
  console.log(`Routing data: ${PREPARED_ROUTING_DIRECTORY}`);
}

await runCliCommand(main, {
  fileErrorHint:
    'Correct the reported filesystem problem, then rerun "npm run public-transport:prepare".',
});
