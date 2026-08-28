import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  buildCarLocalityInputs,
  getMatrixTravelMinutes,
  loadCarTravelTimeMatrix,
  parseCarLocalityRoadAnchorsJson,
  validateCarLocalityRoadAnchorsAgainstInputs,
  type CarLocalityInput,
  type LoadedCarTravelTimeMatrix,
} from '@core/car/preprocessing';
import {
  calculateTravelTimeMatrixCellCount,
  parseCarTravelTimeMatrixManifestJson,
  UNREACHABLE_TRAVEL_MINUTES,
} from '@core/car/preprocessing/travel-time-matrix-format';
import {
  createLocalityId,
  LocalityResolver,
  type LocalityQuery,
} from '@core/localities';
import { parseLocalitiesCsv } from '../../src/localities/node';

const PROJECT_ROOT = resolve(import.meta.dirname, '..', '..');
const OUTPUT_DIRECTORY = resolve(
  PROJECT_ROOT,
  'data/processed/car/travel-time-matrix',
);
const MATRIX_PATH = resolve(OUTPUT_DIRECTORY, 'travel-times.bin');
const MANIFEST_PATH = resolve(OUTPUT_DIRECTORY, 'manifest.json');
const ANCHORS_PATH = resolve(
  PROJECT_ROOT,
  'data/processed/car/locality-road-anchors.json',
);
const LOCALITIES_PATH = resolve(
  PROJECT_ROOT,
  'data/raw/AMTOVZ_CSV_WGS84.csv',
);

const REFERENCE_ORIGINS: readonly LocalityQuery[] = [
  { postalCode: '8001', city: 'Zürich' },
  { postalCode: '3011', city: 'Bern' },
  { postalCode: '8750', city: 'Glarus' },
  { postalCode: '3920', city: 'Zermatt' },
];
const DIRECTIONAL_PAIRS: readonly (readonly [LocalityQuery, LocalityQuery])[] = [
  [
    { postalCode: '8001', city: 'Zürich' },
    { postalCode: '3011', city: 'Bern' },
  ],
  [
    { postalCode: '3011', city: 'Bern' },
    { postalCode: '8001', city: 'Zürich' },
  ],
  [
    { postalCode: '8750', city: 'Glarus' },
    { postalCode: '8001', city: 'Zürich' },
  ],
  [
    { postalCode: '8001', city: 'Zürich' },
    { postalCode: '8750', city: 'Glarus' },
  ],
  [
    { postalCode: '3920', city: 'Zermatt' },
    { postalCode: '3930', city: 'Visp' },
  ],
  [
    { postalCode: '3930', city: 'Visp' },
    { postalCode: '3920', city: 'Zermatt' },
  ],
];

interface MatrixDistribution {
  readonly reachableCells: number;
  readonly unreachableCells: number;
  readonly minimumNonSelf: number;
  readonly medianNonSelf: number;
  readonly p95NonSelf: number;
  readonly maximumNonSelf: number;
  readonly unreachableByOrigin: Uint32Array;
}

interface AsymmetryDistribution {
  readonly mutuallyReachablePairs: number;
  readonly equalPairs: number;
  readonly differentPairs: number;
  readonly oneWayReachablePairs: number;
  readonly bothUnreachablePairs: number;
  readonly medianDifference: number;
  readonly p95Difference: number;
  readonly maximumDifference: number;
}

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatPercentage(numerator: number, denominator: number): string {
  return `${((numerator / denominator) * 100).toFixed(6)}%`;
}

function localityLabel(input: CarLocalityInput): string {
  return `${input.postalCode} ${input.city}`;
}

function histogramNearestRank(
  histogram: Uint32Array,
  count: number,
  fraction: number,
): number {
  if (count === 0) {
    throw new Error('Cannot calculate a percentile from an empty histogram.');
  }
  const target = Math.max(Math.ceil(count * fraction), 1);
  let cumulative = 0;
  for (let value = 0; value < histogram.length; value += 1) {
    cumulative += histogram[value] as number;
    if (cumulative >= target) {
      return value;
    }
  }
  throw new Error('Histogram count does not match its declared population.');
}

function inspectMatrixDistribution(
  matrix: LoadedCarTravelTimeMatrix,
): MatrixDistribution {
  const histogram = new Uint32Array(UNREACHABLE_TRAVEL_MINUTES + 1);
  const unreachableByOrigin = new Uint32Array(matrix.localityCount);
  let reachableCells = 0;
  let unreachableCells = 0;
  let nonSelfReachableCells = 0;
  let minimumNonSelf = Number.POSITIVE_INFINITY;
  let maximumNonSelf = 0;

  for (let originIndex = 0; originIndex < matrix.localityCount; originIndex += 1) {
    const rowOffset = originIndex * matrix.localityCount;
    for (
      let destinationIndex = 0;
      destinationIndex < matrix.localityCount;
      destinationIndex += 1
    ) {
      const value = matrix.values[rowOffset + destinationIndex] as number;
      if (value === UNREACHABLE_TRAVEL_MINUTES) {
        unreachableCells += 1;
        unreachableByOrigin[originIndex] =
          (unreachableByOrigin[originIndex] as number) + 1;
        continue;
      }
      reachableCells += 1;
      if (originIndex !== destinationIndex) {
        nonSelfReachableCells += 1;
        histogram[value] = (histogram[value] as number) + 1;
        minimumNonSelf = Math.min(minimumNonSelf, value);
        maximumNonSelf = Math.max(maximumNonSelf, value);
      }
    }
  }

  if (nonSelfReachableCells === 0) {
    throw new Error('Matrix contains no reachable non-self cells.');
  }
  return {
    reachableCells,
    unreachableCells,
    minimumNonSelf,
    medianNonSelf: histogramNearestRank(
      histogram,
      nonSelfReachableCells,
      0.5,
    ),
    p95NonSelf: histogramNearestRank(
      histogram,
      nonSelfReachableCells,
      0.95,
    ),
    maximumNonSelf,
    unreachableByOrigin,
  };
}

function inspectAsymmetry(
  matrix: LoadedCarTravelTimeMatrix,
): AsymmetryDistribution {
  const differenceHistogram = new Uint32Array(
    UNREACHABLE_TRAVEL_MINUTES,
  );
  let mutuallyReachablePairs = 0;
  let equalPairs = 0;
  let differentPairs = 0;
  let oneWayReachablePairs = 0;
  let bothUnreachablePairs = 0;
  let maximumDifference = 0;

  for (let leftIndex = 0; leftIndex < matrix.localityCount; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < matrix.localityCount;
      rightIndex += 1
    ) {
      const leftToRight =
        matrix.values[leftIndex * matrix.localityCount + rightIndex] as number;
      const rightToLeft =
        matrix.values[rightIndex * matrix.localityCount + leftIndex] as number;
      const leftUnreachable = leftToRight === UNREACHABLE_TRAVEL_MINUTES;
      const rightUnreachable = rightToLeft === UNREACHABLE_TRAVEL_MINUTES;
      if (leftUnreachable && rightUnreachable) {
        bothUnreachablePairs += 1;
        continue;
      }
      if (leftUnreachable || rightUnreachable) {
        oneWayReachablePairs += 1;
        continue;
      }

      mutuallyReachablePairs += 1;
      const difference = Math.abs(leftToRight - rightToLeft);
      differenceHistogram[difference] =
        (differenceHistogram[difference] as number) + 1;
      maximumDifference = Math.max(maximumDifference, difference);
      if (difference === 0) {
        equalPairs += 1;
      } else {
        differentPairs += 1;
      }
    }
  }

  if (mutuallyReachablePairs === 0) {
    throw new Error('Matrix has no mutually reachable directional pairs.');
  }
  return {
    mutuallyReachablePairs,
    equalPairs,
    differentPairs,
    oneWayReachablePairs,
    bothUnreachablePairs,
    medianDifference: histogramNearestRank(
      differenceHistogram,
      mutuallyReachablePairs,
      0.5,
    ),
    p95Difference: histogramNearestRank(
      differenceHistogram,
      mutuallyReachablePairs,
      0.95,
    ),
    maximumDifference,
  };
}

async function main(): Promise<void> {
  const [matrixBytes, manifestJson, anchorsBytes, localitiesCsv] =
    await Promise.all([
      readFile(MATRIX_PATH),
      readFile(MANIFEST_PATH, 'utf8'),
      readFile(ANCHORS_PATH),
      readFile(LOCALITIES_PATH, 'utf8'),
    ]);
  const anchorsSha256 = sha256(anchorsBytes);
  const anchorsFile = parseCarLocalityRoadAnchorsJson(
    anchorsBytes.toString('utf8'),
    ANCHORS_PATH,
  );
  const localities = parseLocalitiesCsv(localitiesCsv);
  const localityInputs = buildCarLocalityInputs(localities);
  validateCarLocalityRoadAnchorsAgainstInputs(anchorsFile, localityInputs);
  const manifest = parseCarTravelTimeMatrixManifestJson(
    manifestJson,
    MANIFEST_PATH,
  );
  const matrix = loadCarTravelTimeMatrix(manifest, matrixBytes, {
    anchorsFile,
    anchorsSha256,
  });
  const expectedCellCount = calculateTravelTimeMatrixCellCount(
    matrix.localityCount,
  );
  const distribution = inspectMatrixDistribution(matrix);
  const asymmetry = inspectAsymmetry(matrix);
  const inputsById = new Map(
    localityInputs.map((input) => [input.localityId, input]),
  );

  console.log(`Locality count: ${formatInteger(matrix.localityCount)}`);
  console.log(`Cell count: ${formatInteger(expectedCellCount)}`);
  console.log(`Binary size: ${formatInteger(matrixBytes.byteLength)} bytes`);
  console.log(`Binary SHA-256: ${manifest.matrixSha256}`);
  console.log(`Manifest size: ${formatInteger(Buffer.byteLength(manifestJson))} bytes`);
  console.log(`Manifest SHA-256: ${sha256(manifestJson)}`);
  console.log(`Anchor SHA-256: ${anchorsSha256}`);
  console.log('');
  console.log('Connectivity:');
  console.log(`  Reachable cells: ${formatInteger(distribution.reachableCells)}`);
  console.log(`  Unreachable cells: ${formatInteger(distribution.unreachableCells)}`);
  console.log(
    `  Unreachable percentage: ${formatPercentage(distribution.unreachableCells, expectedCellCount)}`,
  );
  console.log('');
  console.log('Exact reachable non-self duration distribution:');
  console.log(`  Minimum: ${distribution.minimumNonSelf} min`);
  console.log(`  Median: ${distribution.medianNonSelf} min`);
  console.log(`  p95: ${distribution.p95NonSelf} min`);
  console.log(`  Maximum: ${distribution.maximumNonSelf} min`);

  console.log('');
  console.log('Reference reachability counts (including the zero-minute origin):');
  const resolver = new LocalityResolver(localities);
  for (const query of REFERENCE_ORIGINS) {
    const locality = resolver.resolve(query);
    if (locality === undefined) {
      throw new Error(
        `Unable to resolve reference locality ${query.postalCode} ${query.city}.`,
      );
    }
    const localityId = createLocalityId(locality.postalCode, locality.city);
    const originIndex = matrix.localityIds.indexOf(localityId);
    if (originIndex < 0) {
      throw new Error(`Matrix does not contain reference locality ${localityId}.`);
    }
    const rowOffset = originIndex * matrix.localityCount;
    const counts = [30, 60, 90, 120].map((maximumMinutes) => ({
      maximumMinutes,
      count: matrix.values.subarray(
        rowOffset,
        rowOffset + matrix.localityCount,
      ).reduce(
        (total, value) =>
          total +
          (value !== UNREACHABLE_TRAVEL_MINUTES && value <= maximumMinutes
            ? 1
            : 0),
        0,
      ),
    }));
    console.log(
      `  ${localityId} (${locality.postalCode} ${locality.city}): ${counts.map(({ maximumMinutes, count }) => `${maximumMinutes}m=${formatInteger(count)}`).join(', ')}`,
    );
  }

  console.log('');
  console.log('Directional sanity checks:');
  for (const [fromQuery, toQuery] of DIRECTIONAL_PAIRS) {
    const from = resolver.resolve(fromQuery);
    const to = resolver.resolve(toQuery);
    if (from === undefined || to === undefined) {
      throw new Error(
        `Unable to resolve directional pair ${fromQuery.postalCode} ${fromQuery.city} → ${toQuery.postalCode} ${toQuery.city}.`,
      );
    }
    const fromId = createLocalityId(from.postalCode, from.city);
    const toId = createLocalityId(to.postalCode, to.city);
    const travelMinutes = getMatrixTravelMinutes(matrix, fromId, toId);
    console.log(
      `  ${from.postalCode} ${from.city} → ${to.postalCode} ${to.city}: ${travelMinutes === undefined ? 'unreachable' : `${travelMinutes} min`}`,
    );
  }

  console.log('');
  console.log('Directional asymmetry (all unordered non-self pairs):');
  console.log(
    `  Mutually reachable: ${formatInteger(asymmetry.mutuallyReachablePairs)}`,
  );
  console.log(`  Equal durations: ${formatInteger(asymmetry.equalPairs)}`);
  console.log(`  Different durations: ${formatInteger(asymmetry.differentPairs)}`);
  console.log(
    `  Reachable in one direction only: ${formatInteger(asymmetry.oneWayReachablePairs)}`,
  );
  console.log(
    `  Unreachable both ways: ${formatInteger(asymmetry.bothUnreachablePairs)}`,
  );
  console.log(
    `  Absolute difference median/p95/max: ${asymmetry.medianDifference}/${asymmetry.p95Difference}/${asymmetry.maximumDifference} min`,
  );

  const worstOrigins = Array.from(
    distribution.unreachableByOrigin,
    (unreachableCount, index) => ({ index, unreachableCount }),
  )
    .toSorted((left, right) => {
      const countDifference = right.unreachableCount - left.unreachableCount;
      if (countDifference !== 0) {
        return countDifference;
      }
      const leftId = matrix.localityIds[left.index] as string;
      const rightId = matrix.localityIds[right.index] as string;
      return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
    })
    .slice(0, 10);
  console.log('');
  console.log('Origins with the most unreachable destinations:');
  if (distribution.unreachableCells === 0) {
    console.log('  None; every origin reaches every destination.');
  } else {
    for (const { index, unreachableCount } of worstOrigins) {
      const localityId = matrix.localityIds[index] as string;
      const input = inputsById.get(localityId);
      console.log(
        `  ${localityId}${input === undefined ? '' : ` (${localityLabel(input)})`}: ${formatInteger(unreachableCount)} (${formatPercentage(unreachableCount, matrix.localityCount)})`,
      );
    }
  }
  const almostDisconnected = Array.from(
    distribution.unreachableByOrigin,
    (unreachableCount, index) => ({ index, unreachableCount }),
  ).filter(
    ({ unreachableCount }) =>
      unreachableCount >= Math.ceil(matrix.localityCount * 0.9),
  );
  console.log(
    `Rows at least 90% unreachable: ${formatInteger(almostDisconnected.length)}`,
  );
  for (const { index, unreachableCount } of almostDisconnected) {
    console.log(
      `  ${matrix.localityIds[index]}: ${formatInteger(unreachableCount)} / ${formatInteger(matrix.localityCount)}`,
    );
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
