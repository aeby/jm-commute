import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  buildCarLocalityInputs,
  parseCarLocalityRoadAnchorsJson,
  summarizeSnapDistances,
  validateCarLocalityRoadAnchorsAgainstInputs,
  type CarLocalityInput,
  type CarLocalityRoadAnchor,
  type Coordinate,
} from '@core/car/preprocessing';
import { createLocalityId, LocalityResolver } from '@jm/commute';
import { parseLocalitiesCsv } from '@core/localities/node';

const PROJECT_ROOT = resolve(import.meta.dirname, '..', '..');
const LOCALITIES_PATH = resolve(
  PROJECT_ROOT,
  'data/raw/AMTOVZ_CSV_WGS84.csv',
);
const ANCHORS_PATH = resolve(
  PROJECT_ROOT,
  'data/processed/car/locality-road-anchors.json',
);

const REFERENCE_LOCALITIES = [
  { postalCode: '8001', city: 'Zürich' },
  { postalCode: '3011', city: 'Bern' },
  { postalCode: '8750', city: 'Glarus' },
  { postalCode: '3920', city: 'Zermatt' },
] as const;

function formatBytes(bytes: number): string {
  return new Intl.NumberFormat('en-US').format(bytes);
}

function formatCoordinate(coordinate: Coordinate): string {
  return `${coordinate.latitude.toFixed(6)}, ${coordinate.longitude.toFixed(6)}`;
}

function formatMeters(meters: number): string {
  return `${meters.toFixed(1)} m`;
}

function label(input: CarLocalityInput): string {
  return `${input.postalCode} ${input.city}`;
}

function printAnchor(
  anchor: CarLocalityRoadAnchor,
  input: CarLocalityInput,
): void {
  console.log(`${anchor.localityId} — ${label(input)}`);
  console.log(`  official: ${formatCoordinate(input)}`);
  console.log(`  anchor:   ${formatCoordinate(anchor)}`);
  console.log(`  snap:     ${formatMeters(anchor.snapDistanceMeters)}`);
}

function inputForAnchor(
  anchor: CarLocalityRoadAnchor,
  inputsById: ReadonlyMap<string, CarLocalityInput>,
): CarLocalityInput {
  const input = inputsById.get(anchor.localityId);
  if (input === undefined) {
    throw new Error(`Anchor ${anchor.localityId} has no current locality input.`);
  }
  return input;
}

async function main(): Promise<void> {
  const [anchorsJson, localitiesCsv] = await Promise.all([
    readFile(ANCHORS_PATH, 'utf8'),
    readFile(LOCALITIES_PATH, 'utf8'),
  ]);
  const file = parseCarLocalityRoadAnchorsJson(anchorsJson, ANCHORS_PATH);
  const localities = parseLocalitiesCsv(localitiesCsv);
  const localityInputs = buildCarLocalityInputs(localities);
  validateCarLocalityRoadAnchorsAgainstInputs(file, localityInputs);

  const inputsById = new Map(
    localityInputs.map((input) => [input.localityId, input]),
  );
  const anchorsById = new Map(
    file.anchors.map((anchor) => [anchor.localityId, anchor]),
  );
  const outputSha256 = createHash('sha256')
    .update(anchorsJson)
    .digest('hex');
  const statistics = summarizeSnapDistances(file.anchors);

  console.log(`Anchor file: ${ANCHORS_PATH}`);
  console.log(`Anchor file size: ${formatBytes(Buffer.byteLength(anchorsJson))} bytes`);
  console.log(`Anchor file SHA-256: ${outputSha256}`);
  console.log(`Anchor count: ${file.localityCount}`);
  console.log(`Locality-input SHA-256: ${file.localityInputSha256}`);
  console.log(
    `Road graph: source PBF ${file.roadGraph.sourcePbfSha256}, OSRM ${file.roadGraph.osrmVersion}, ${file.roadGraph.profile}, ${file.roadGraph.algorithm.toUpperCase()}`,
  );
  console.log('');
  console.log('Snap-distance distribution:');
  console.log(`  minimum: ${formatMeters(statistics.minimum)}`);
  console.log(`  median: ${formatMeters(statistics.median)}`);
  console.log(`  p90: ${formatMeters(statistics.p90)}`);
  console.log(`  p95: ${formatMeters(statistics.p95)}`);
  console.log(`  p99: ${formatMeters(statistics.p99)}`);
  console.log(`  maximum: ${formatMeters(statistics.maximum)}`);
  for (const threshold of [250, 500, 1_000, 2_000]) {
    const count = file.anchors.filter(
      ({ snapDistanceMeters }) => snapDistanceMeters >= threshold,
    ).length;
    console.log(`  >= ${formatMeters(threshold)}: ${count}`);
  }

  const worst = file.anchors
    .toSorted((left, right) => {
      const distanceDifference =
        right.snapDistanceMeters - left.snapDistanceMeters;
      if (distanceDifference !== 0) {
        return distanceDifference;
      }
      return left.localityId < right.localityId
        ? -1
        : left.localityId > right.localityId
          ? 1
          : 0;
    })
    .slice(0, 10);
  console.log('');
  console.log('Ten worst snaps:');
  for (const anchor of worst) {
    printAnchor(anchor, inputForAnchor(anchor, inputsById));
  }

  const resolver = new LocalityResolver(localities);
  console.log('');
  console.log('Reference locality anchors:');
  for (const query of REFERENCE_LOCALITIES) {
    const locality = resolver.resolve(query);
    if (locality === undefined) {
      throw new Error(
        `Unable to resolve reference locality ${query.postalCode} ${query.city}.`,
      );
    }
    const localityId = createLocalityId(locality.postalCode, locality.city);
    const anchor = anchorsById.get(localityId);
    const input = inputsById.get(localityId);
    if (anchor === undefined || input === undefined) {
      throw new Error(`Reference locality ${localityId} has no road anchor.`);
    }
    printAnchor(anchor, input);
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
