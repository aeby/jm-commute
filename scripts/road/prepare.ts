import { relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { PROJECT_CONFIG } from '@core/config';
import { prepareData } from '@core/road';

import {
  allRegularFilesExist,
  findMissingRegularFiles,
  runCliCommand,
  runCommandStep,
} from '../cli';
import {
  PREPARED_NETWORK_DIRECTORY,
  PROJECT_ROOT,
  RAW_OSM_PBF_PATH,
} from './paths';

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: { restart: { type: 'boolean', default: false } },
  allowPositionals: false,
  strict: true,
});
const config = PROJECT_CONFIG.road.osrm;
const preparedOutputs = [
  resolve(PREPARED_NETWORK_DIRECTORY, 'manifest.json'),
  ...['hsgr', 'edges', 'geometry', 'properties'].map((suffix) =>
    resolve(
      PREPARED_NETWORK_DIRECTORY,
      `${config.datasetBasename}.${suffix}`,
    ),
  ),
];
const prepareCommand = 'npm run road:prepare';

async function main(): Promise<void> {
  if (!values.restart && (await allRegularFilesExist(preparedOutputs))) {
    console.log('Prepared road data already exists. Nothing to do.');
    console.log(
      `Run "${prepareCommand} -- --restart" to rebuild it intentionally.`,
    );
    return;
  }
  const missingInputs = await findMissingRegularFiles([RAW_OSM_PBF_PATH]);
  if (missingInputs.length > 0) {
    console.error('Error: Road preparation needs the OpenStreetMap PBF:');
    for (const path of missingInputs) {
      console.error(`  - ${relative(PROJECT_ROOT, path)}`);
    }
    process.exitCode = 1;
    return;
  }

  const result = await runCommandStep('Prepare the OSRM road network', () =>
    prepareData({
      osmPbfPath: RAW_OSM_PBF_PATH,
      outputDirectory: PREPARED_NETWORK_DIRECTORY,
      osrm: config,
    }),
  );
  console.log(
    `Prepared ${result.fileCount} network files (${result.totalByteLength} bytes).`,
  );
  console.log(`Source PBF SHA-256: ${result.manifest.roadGraph.sourcePbfSha256}`);
  console.log(`Network: ${PREPARED_NETWORK_DIRECTORY}`);
}

await runCliCommand(main, {
  fileErrorHint:
    `Correct the reported filesystem problem, then rerun "${prepareCommand}".`,
});
