import { stat } from 'node:fs/promises';
import { PROJECT_CONFIG } from '@core/config';
import { prepareFixedDayRoutingData } from '@core/transit/routing-data/prepare-fixed-day-routing-data';

import {
  FIXED_DAY_ROUTING_DIRECTORY,
  RAW_GTFS_DIRECTORY,
  TRANSIT_STOPS_PATH,
} from './paths';

const OUTPUT_RELATIVE_DIRECTORY =
  'data/processed/transit/fixed-day-routing';

function formatBytes(bytes: number): string {
  return new Intl.NumberFormat('en-US').format(bytes);
}

async function main(): Promise<void> {
  const { referenceScenario } = PROJECT_CONFIG.transit;
  const result = await prepareFixedDayRoutingData({
    gtfsDirectory: RAW_GTFS_DIRECTORY,
    transitStopsPath: TRANSIT_STOPS_PATH,
    outputDirectory: FIXED_DAY_ROUTING_DIRECTORY,
    serviceDate: referenceScenario.serviceDate,
    routingWindowStart: referenceScenario.morningWindow.start,
    routingWindowEnd: referenceScenario.morningWindow.end,
  });
  const [manifestStats, tripsStats] = await Promise.all([
    stat(result.manifestPath),
    stat(result.tripsPath),
  ]);

  console.log(
    `Feed version: ${result.manifest.sourceFeedVersion ?? 'not supplied'}`,
  );
  console.log(`Service date: ${result.manifest.serviceDate}`);
  console.log(
    `Routing window: ${result.manifest.routingWindowStart}–${result.manifest.routingWindowEnd}`,
  );
  console.log('');
  console.log(`Active services: ${result.activeServiceCount}`);
  console.log(`Active trips: ${result.activeTripCount}`);
  console.log(
    `Retained scheduled trips: ${result.manifest.scheduledTripCount}`,
  );
  console.log(
    `Retained frequency templates: ${result.manifest.frequencyTripCount}`,
  );
  console.log(
    `Trips excluded before routing window: ${result.manifest.excludedBeforeRoutingWindowTripCount}`,
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
