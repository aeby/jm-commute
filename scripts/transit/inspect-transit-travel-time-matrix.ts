import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  createTransitTravelTimeIndex,
  getTransitTravelMinutes,
} from '@jm/commute';
import { parseLocalityRoutingIndexJson } from '@core/transit/locality-routing/parse-locality-routing-index';
import {
  getTransitOriginReachabilityCountAtIndex,
  inspectTransitTravelTimeMatrix,
  TRANSIT_REACHABILITY_DIAGNOSTIC_THRESHOLDS,
  type TransitMatrixCellDistribution,
  type TransitOriginConnectivity,
} from '@core/transit/preprocessing';

import { authenticateTransitMatrixData } from './transit-matrix-artifacts';
import {
  LOCALITY_ROUTING_INDEX_PATH,
  TRANSIT_RUNTIME_DIRECTORY,
} from './paths';

const MANIFEST_PATH = resolve(TRANSIT_RUNTIME_DIRECTORY, 'manifest.json');
const MATRIX_PATH = resolve(TRANSIT_RUNTIME_DIRECTORY, 'travel-times.bin');

const REFERENCE_ORIGINS = [
  ['8001:zurich', '8001 Zürich'],
  ['3011:bern', '3011 Bern'],
  ['8750:glarus', '8750 Glarus'],
  ['3920:zermatt', '3920 Zermatt'],
] as const;

const DIRECTIONAL_PAIRS = [
  ['3011:bern', '8001:zurich'],
  ['8001:zurich', '3011:bern'],
  ['8750:glarus', '8001:zurich'],
  ['8001:zurich', '8750:glarus'],
  ['3920:zermatt', '3930:visp'],
  ['3930:visp', '3920:zermatt'],
] as const;

const CELL_BUCKETS: readonly [keyof TransitMatrixCellDistribution, string][] = [
  ['zeroMinutes', '0 minutes'],
  ['minutes1To30', '1–30 minutes'],
  ['minutes31To60', '31–60 minutes'],
  ['minutes61To90', '61–90 minutes'],
  ['minutes91To120', '91–120 minutes'],
  ['minutes121To180', '121–180 minutes'],
  ['minutes181To240', '181–240 minutes'],
  ['unavailable', '255 unavailable'],
];

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatDecimal(value: number): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercentage(count: number, total: number): string {
  return `${((count / total) * 100).toFixed(6)}%`;
}

function formatBytes(byteLength: number): string {
  return `${formatInteger(byteLength)} bytes (${(byteLength / (1024 * 1024)).toFixed(2)} MiB)`;
}

async function readRequiredFile(path: string, description: string): Promise<Buffer> {
  try {
    return await readFile(path);
  } catch (error) {
    throw new Error(`Unable to read ${description} at "${path}".`, {
      cause: error,
    });
  }
}

function assertLocalityRoutingProvenance(
  localityRoutingBytes: Uint8Array,
  expectedSha256: string,
): void {
  const actualSha256 = sha256(localityRoutingBytes);
  if (actualSha256 !== expectedSha256) {
    throw new Error(
      `Locality-routing index SHA-256 is ${actualSha256}; transit manifest expects ${expectedSha256}.`,
    );
  }
}

async function main(): Promise<void> {
  const [manifestBytes, matrixBytes, localityRoutingBytes] = await Promise.all([
    readRequiredFile(MANIFEST_PATH, 'runtime transit matrix manifest'),
    readRequiredFile(MATRIX_PATH, 'runtime transit matrix binary'),
    readRequiredFile(LOCALITY_ROUTING_INDEX_PATH, 'locality-routing index'),
  ]);
  const authenticated = authenticateTransitMatrixData(
    manifestBytes,
    matrixBytes,
    'processed transit travel-time matrix',
  );
  assertLocalityRoutingProvenance(
    localityRoutingBytes,
    authenticated.manifest.source.localityRoutingIndexSha256,
  );
  const localityRoutingIndex = parseLocalityRoutingIndexJson(
    localityRoutingBytes.toString('utf8'),
  );
  const localityIds = authenticated.manifest.matrix.localityIds;
  if (localityRoutingIndex.entries.length !== localityIds.length) {
    throw new Error(
      `Locality-routing index has ${localityRoutingIndex.entries.length} entries; matrix has ${localityIds.length}.`,
    );
  }
  for (let index = 0; index < localityIds.length; index += 1) {
    const routingId = localityRoutingIndex.entries[index]?.localityId;
    if (routingId !== localityIds[index]) {
      throw new Error(
        `Locality-routing ordering differs from the matrix at index ${index}: ${JSON.stringify(routingId)} versus ${JSON.stringify(localityIds[index])}.`,
      );
    }
  }

  const labelsById = new Map(
    localityRoutingIndex.entries.map((entry) => [
      entry.localityId,
      `${entry.postalCode} ${entry.city}`,
    ]),
  );
  const localityIndexById = new Map(
    localityIds.map((localityId, index) => [localityId, index]),
  );
  const diagnostics = inspectTransitTravelTimeMatrix(
    authenticated.manifest.matrix,
    matrixBytes,
  );
  const runtimeIndex = createTransitTravelTimeIndex(
    authenticated.manifest,
    matrixBytes,
  );

  console.log('Authenticated runtime transit matrix:');
  console.log(`  Localities: ${formatInteger(diagnostics.localityCount)}`);
  console.log(`  Cells: ${formatInteger(diagnostics.totalCells)}`);
  console.log(`  Matrix: ${formatBytes(authenticated.matrixByteLength)}`);
  console.log(`  Matrix SHA-256: ${authenticated.matrixSha256}`);
  console.log(`  Manifest: ${formatBytes(authenticated.manifestByteLength)}`);
  console.log(`  Manifest SHA-256: ${authenticated.manifestSha256}`);
  console.log(`  Service date: ${authenticated.manifest.source.serviceDate}`);
  console.log(
    `  Morning departures: ${authenticated.manifest.source.morningWindow.start}–${authenticated.manifest.source.morningWindow.end}`,
  );
  console.log(
    `  Locality-routing SHA-256: ${authenticated.manifest.source.localityRoutingIndexSha256}`,
  );

  console.log('\nComplete cell distribution:');
  for (const [key, label] of CELL_BUCKETS) {
    const count = diagnostics.cellDistribution[key];
    console.log(
      `  ${label}: ${formatInteger(count)} (${formatPercentage(count, diagnostics.totalCells)})`,
    );
  }

  console.log('\nNational reachable-locality counts by origin (including self):');
  for (const threshold of diagnostics.reachabilityByThreshold) {
    const { statistics } = threshold;
    console.log(
      `  ${threshold.thresholdMinutes} min: min ${formatInteger(statistics.minimum)}, ` +
        `median ${formatDecimal(statistics.median)}, mean ${formatDecimal(statistics.mean)}, ` +
        `p95 ${formatInteger(statistics.p95)}, max ${formatInteger(statistics.maximum)}`,
    );
  }

  console.log('\nReference origins (including self):');
  for (const [localityId, label] of REFERENCE_ORIGINS) {
    const originIndex = localityIndexById.get(localityId);
    if (originIndex === undefined) {
      throw new Error(`Transit matrix does not contain ${localityId}.`);
    }
    const counts = TRANSIT_REACHABILITY_DIAGNOSTIC_THRESHOLDS.map(
      (threshold) =>
        `${threshold}: ${formatInteger(getTransitOriginReachabilityCountAtIndex(diagnostics, originIndex, threshold))}`,
    );
    console.log(`  ${label}: ${counts.join(', ')}`);
  }

  console.log('\nDirectional reference pairs:');
  for (const [fromLocalityId, toLocalityId] of DIRECTIONAL_PAIRS) {
    const minutes = getTransitTravelMinutes(
      runtimeIndex,
      fromLocalityId,
      toLocalityId,
    );
    console.log(
      `  ${labelsById.get(fromLocalityId) ?? fromLocalityId} → ` +
        `${labelsById.get(toLocalityId) ?? toLocalityId}: ` +
        `${minutes === undefined ? 'unavailable' : `${minutes} min`}`,
    );
  }

  const directionality = diagnostics.directionality;
  console.log('\nFull directionality (unordered non-self pairs):');
  console.log(`  Pairs: ${formatInteger(directionality.unorderedPairCount)}`);
  console.log(
    `  Equal A→B/B→A: ${formatInteger(directionality.equalDirections)}`,
  );
  console.log(
    `  Different A→B/B→A: ${formatInteger(directionality.differentDirections)}`,
  );
  console.log(
    `  Reachable one direction only: ${formatInteger(directionality.reachableOneDirectionOnly)}`,
  );
  console.log(
    `  Unavailable both directions: ${formatInteger(directionality.unavailableBothDirections)}`,
  );
  console.log(
    `  Mutually reachable: ${formatInteger(directionality.mutuallyReachablePairCount)}`,
  );
  console.log(
    `  Absolute difference among mutually reachable pairs: median ${directionality.medianAbsoluteDifferenceMinutes} min, ` +
      `p95 ${directionality.p95AbsoluteDifferenceMinutes} min, max ${directionality.maximumAbsoluteDifferenceMinutes} min`,
  );

  const printConnectivity = (
    heading: string,
    origins: readonly TransitOriginConnectivity[],
  ): void => {
    console.log(`\n${heading}:`);
    origins.forEach((origin, index) => {
      console.log(
        `  ${index + 1}. ${labelsById.get(origin.localityId) ?? origin.localityId} ` +
          `(${origin.localityId}): ${formatInteger(origin.reachableWithin240Minutes)}`,
      );
    });
  };
  printConnectivity(
    '10 origins with fewest destinations reachable within 240 minutes',
    diagnostics.leastConnectedOrigins,
  );
  printConnectivity(
    '10 origins with most destinations reachable within 240 minutes',
    diagnostics.mostConnectedOrigins,
  );

  const noTransitOriginLocalityIds = localityRoutingIndex.entries
    .filter(({ stopIndexes }) => stopIndexes.length === 0)
    .map(({ localityId }) => localityId);
  console.log(
    `\nOrigins with no configured transit routing stops: ${formatInteger(noTransitOriginLocalityIds.length)}`,
  );
  for (const localityId of noTransitOriginLocalityIds) {
    console.log(
      `  ${labelsById.get(localityId) ?? localityId} (${localityId})`,
    );
  }

  console.log(
    `\nSelf-only matrix rows: ${formatInteger(diagnostics.selfOnlyOriginLocalityIds.length)}`,
  );
  for (const localityId of diagnostics.selfOnlyOriginLocalityIds) {
    console.log(
      `  ${labelsById.get(localityId) ?? localityId} (${localityId})`,
    );
  }
}

await main();
