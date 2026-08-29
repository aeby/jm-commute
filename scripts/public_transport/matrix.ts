import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { PROJECT_CONFIG } from '@core/config';
import {
  buildNetwork,
  calculateTravelTimes,
  loadPreparedData,
} from '@core/public_transport';

import {
  MATRIX_WORK_DIRECTORY,
  PREPARED_ROUTING_DIRECTORY,
  PREPARED_STOPS_PATH,
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
const config = PROJECT_CONFIG.publicTransport;
const scenario = {
  serviceDate: config.referenceScenario.serviceDate,
  routingWindowStart: config.referenceScenario.morningWindow.start,
  routingWindowEnd: config.referenceScenario.morningWindow.end,
};

console.log('Loading prepared public-transport data...');
const prepared = await loadPreparedData({
  gtfsDirectory: RAW_GTFS_DIRECTORY,
  stopsPath: PREPARED_STOPS_PATH,
  routingDirectory: PREPARED_ROUTING_DIRECTORY,
  localitiesPath: RAW_LOCALITIES_PATH,
  transfersPath: RAW_TRANSFERS_PATH,
  scenario,
  localitySelection: config.localityAccess,
});

console.log('Building the public-transport network...');
const { network, localities } = await buildNetwork({
  trips: prepared.trips,
  transferRules: prepared.transferRules,
  activeServiceIds: prepared.activeServiceIds,
  stops: prepared.stops,
  localities: prepared.localities,
  routingWindowStartSeconds: prepared.routingWindowStartSeconds,
  routingWindowEndSeconds: prepared.routingWindowEndSeconds,
});
const gtfsFeedVersion = prepared.manifest.sourceFeedVersion;
if (gtfsFeedVersion === undefined || gtfsFeedVersion.length === 0) {
  throw new Error('Prepared routing data has no GTFS feed version.');
}
console.log(
  `Calculating ${localities.entries.length} × ` +
    `${localities.entries.length} travel times...`,
);
let lastReportedOrigin = 0;
const result = await calculateTravelTimes({
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
  paths: {
    workDirectory: MATRIX_WORK_DIRECTORY,
    manifestPath: resolve(RUNTIME_DATA_DIRECTORY, 'manifest.json'),
    matrixPath: resolve(RUNTIME_DATA_DIRECTORY, 'travel-times.bin'),
  },
  onProgress: ({ completedOrigins, totalOrigins }) => {
    if (
      completedOrigins === totalOrigins ||
      completedOrigins - lastReportedOrigin >= 250
    ) {
      console.log(`Origins: ${completedOrigins} / ${totalOrigins}`);
      lastReportedOrigin = completedOrigins;
    }
  },
});

console.log(
  `Published ${result.matrixByteLength} matrix bytes after ` +
    `${result.validation.exactMatches} validation checks.`,
);
console.log(`Matrix SHA-256: ${result.matrixSha256}`);
