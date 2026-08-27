import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PROJECT_CONFIG } from '../src/config';
import { prepareFixedDayRoutingData } from '../src/transit/routing-data/prepare-fixed-day-routing-data';

const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const GTFS_DIRECTORY = join(PROJECT_ROOT, 'data', 'raw', 'gtfs');
const TRANSIT_STOPS_PATH = join(
  PROJECT_ROOT,
  'data',
  'processed',
  'transit-stops.json',
);
const OUTPUT_DIRECTORY = join(
  PROJECT_ROOT,
  'data',
  'processed',
  'fixed-day-routing',
);
const OUTPUT_RELATIVE_DIRECTORY = 'data/processed/fixed-day-routing';

function formatBytes(bytes: number): string {
  return new Intl.NumberFormat('en-US').format(bytes);
}

async function main(): Promise<void> {
  const { referenceScenario } = PROJECT_CONFIG.transit;
  const result = await prepareFixedDayRoutingData({
    gtfsDirectory: GTFS_DIRECTORY,
    transitStopsPath: TRANSIT_STOPS_PATH,
    outputDirectory: OUTPUT_DIRECTORY,
    serviceDate: referenceScenario.serviceDate,
    departureTime: referenceScenario.departureTime,
  });
  const [manifestStats, tripsStats] = await Promise.all([
    stat(result.manifestPath),
    stat(result.tripsPath),
  ]);

  console.log(
    `Feed version: ${result.manifest.sourceFeedVersion ?? 'not supplied'}`,
  );
  console.log(`Service date: ${result.manifest.serviceDate}`);
  console.log(`Departure time: ${result.manifest.departureTime}`);
  console.log('');
  console.log(`Active services: ${result.activeServiceCount}`);
  console.log(`Active trips: ${result.activeTripCount}`);
  console.log(
    `Retained scheduled trips: ${result.manifest.scheduledTripCount}`,
  );
  console.log(
    `Retained frequency trips: ${result.manifest.frequencyTripCount}`,
  );
  console.log(
    `Trips excluded before departure: ${result.manifest.excludedBeforeDepartureTripCount}`,
  );
  console.log(`Retained stop-time records: ${result.manifest.stopTimeCount}`);
  console.log(`Frequency windows: ${result.manifest.frequencyWindowCount}`);
  console.log(
    `Blank active-trip times encountered: ${result.blankActiveTripTimeCount}`,
  );
  console.log(`Stop-time rows scanned: ${result.stopTimeRowsScanned}`);
  console.log('');
  console.log(`Manifest size: ${formatBytes(manifestStats.size)} bytes`);
  console.log(`Trips size: ${formatBytes(tripsStats.size)} bytes`);
  console.log(`Output: ${OUTPUT_RELATIVE_DIRECTORY}`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
