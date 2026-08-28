import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import { PROJECT_CONFIG } from '@core/config';
import { parseLocalitiesCsv } from '@core/localities/node';
import { buildLocalityRoutingIndex } from '@core/transit/locality-routing';
import { buildRaptorTimetable } from '@core/transit/raptor/timetable/build-raptor-timetable';
import { buildSourceStopIndex } from '@core/transit/raptor/timetable/dense-stop-ids';
import { validateFixedDayRoutingManifestScenario } from '@core/transit/routing-data';
import { loadFixedDayRoutingDataset } from '@core/transit/routing-data/node';
import {
  DEFAULT_LOCALITIES_FILE_PATH,
  loadTransitCandidateInputs,
  readUtf8Input,
} from './transit-inspection-inputs';
import { writeUtf8FileAtomically } from './write-utf8-file-atomically';

const PROJECT_ROOT = resolve(import.meta.dirname, '..');
const ROUTING_DATA_DIRECTORY = resolve(
  PROJECT_ROOT,
  'data/processed/fixed-day-routing',
);
const OUTPUT_RELATIVE_PATH = 'data/processed/locality-routing-index.json';
const OUTPUT_PATH = resolve(PROJECT_ROOT, OUTPUT_RELATIVE_PATH);

const formatInteger = (value: number): string =>
  new Intl.NumberFormat('en-US').format(value);

function median(sortedValues: readonly number[]): number {
  if (sortedValues.length === 0) {
    return 0;
  }
  const middle = Math.floor(sortedValues.length / 2);
  return sortedValues.length % 2 === 1
    ? (sortedValues[middle] ?? 0)
    : ((sortedValues[middle - 1] ?? 0) + (sortedValues[middle] ?? 0)) / 2;
}

async function main(): Promise<void> {
  const [localitiesCsv, candidateInputs] = await Promise.all([
    readUtf8Input(DEFAULT_LOCALITIES_FILE_PATH, 'locality CSV'),
    loadTransitCandidateInputs(),
  ]);
  const localities = parseLocalitiesCsv(localitiesCsv);

  const timetableStart = performance.now();
  const routingDataset = await loadFixedDayRoutingDataset(
    ROUTING_DATA_DIRECTORY,
  );
  const scenario = PROJECT_CONFIG.transit.referenceScenario;
  validateFixedDayRoutingManifestScenario(routingDataset.manifest, {
    serviceDate: scenario.serviceDate,
    routingWindowStart: scenario.morningWindow.start,
    routingWindowEnd: scenario.morningWindow.end,
  });
  const timetable = await buildRaptorTimetable(routingDataset.trips);
  const timetableMilliseconds = performance.now() - timetableStart;
  const denseStopLookup = buildSourceStopIndex(timetable.sourceStopIds);

  const indexStart = performance.now();
  const index = buildLocalityRoutingIndex(
    localities,
    candidateInputs.places,
    candidateInputs.profileDataset,
    denseStopLookup,
  );
  const indexMilliseconds = performance.now() - indexStart;
  const dataset = {
    schemaVersion: 1 as const,
    entries: index.entries.map((entry) => ({
      localityId: entry.localityId,
      postalCode: entry.postalCode,
      city: entry.city,
      selectionMode: entry.selectionMode,
      stopIndexes: [...entry.stopIndexes],
    })),
  };
  const output = `${JSON.stringify(dataset, null, 2)}\n`;
  const sha256 = createHash('sha256').update(output).digest('hex');
  await writeUtf8FileAtomically(OUTPUT_PATH, output);

  const stopCounts = index.entries
    .map(({ stopIndexes }) => stopIndexes.length)
    .toSorted((left, right) => left - right);
  const withinRadiusCount = index.entries.filter(
    ({ selectionMode }) => selectionMode === 'WITHIN_ACCESS_RADIUS',
  ).length;
  const activeStopLocalityCount = stopCounts.filter((count) => count > 0).length;
  const associationCount = stopCounts.reduce(
    (total, count) => total + count,
    0,
  );

  console.log(`Total unique localities: ${formatInteger(index.entries.length)}`);
  console.log(`Within-radius localities: ${formatInteger(withinRadiusCount)}`);
  console.log(
    `Fallback localities: ${formatInteger(index.entries.length - withinRadiusCount)}`,
  );
  console.log(
    `Localities with active routing stops: ${formatInteger(activeStopLocalityCount)}`,
  );
  console.log(
    `Localities with zero active routing stops: ${formatInteger(index.entries.length - activeStopLocalityCount)}`,
  );
  console.log('');
  console.log(`Minimum stop count: ${formatInteger(stopCounts[0] ?? 0)}`);
  console.log(`Median stop count: ${median(stopCounts)}`);
  console.log(
    `Maximum stop count: ${formatInteger(stopCounts.at(-1) ?? 0)}`,
  );
  console.log(
    `Total locality→stop associations: ${formatInteger(associationCount)}`,
  );
  console.log('');
  console.log(
    `Timetable construction time: ${(timetableMilliseconds / 1000).toFixed(3)} s`,
  );
  console.log(
    `Locality-index construction time: ${(indexMilliseconds / 1000).toFixed(3)} s`,
  );
  console.log(`Output: ${OUTPUT_RELATIVE_PATH}`);
  console.log(`SHA-256: ${sha256}`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
