import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';

import {
  buildCarLocalityInputs,
  createCarLocalityRoadAnchorsFile,
  generateCarLocalityRoadAnchors,
  OSRM_ALGORITHM,
  OSRM_PROFILE,
  OSRM_VERSION,
  OsrmClient,
  parseCarLocalityRoadAnchorsJson,
  serializeCarLocalityRoadAnchorsFile,
  summarizeSnapDistances,
  validateCarLocalityRoadAnchorsAgainstInputs,
  type CarLocalityRoadAnchor,
} from '@core/car/preprocessing';
import { parseLocalitiesCsv } from '@core/localities/node';
import { writeUtf8FileAtomically } from '../write-utf8-file-atomically';

const PROJECT_ROOT = resolve(import.meta.dirname, '..', '..');
const LOCALITIES_PATH = resolve(
  PROJECT_ROOT,
  'data/raw/AMTOVZ_CSV_WGS84.csv',
);
const SOURCE_PBF_PATH = resolve(
  PROJECT_ROOT,
  'data/raw/osm/switzerland-latest.osm.pbf',
);
const OSRM_DIRECTORY = resolve(PROJECT_ROOT, 'data/processed/car/osrm');
const OSRM_BASENAME = 'switzerland.osrm';
const OUTPUT_PATH = resolve(
  PROJECT_ROOT,
  'data/processed/car/locality-road-anchors.json',
);
const SNAP_CONCURRENCY = 16;
const PROGRESS_INTERVAL = 500;

interface FileFingerprint {
  readonly size: number;
  readonly sha256: string;
}

interface PreparedGraphSummary {
  readonly fileCount: number;
  readonly totalSize: number;
}

function formatBytes(bytes: number): string {
  return new Intl.NumberFormat('en-US').format(bytes);
}

function formatSeconds(milliseconds: number): string {
  return `${(milliseconds / 1_000).toFixed(3)} s`;
}

function formatMeters(meters: number): string {
  return `${meters.toFixed(1)} m`;
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

async function fingerprintNonemptyFile(
  path: string,
  description: string,
): Promise<FileFingerprint> {
  let fileStat;
  try {
    fileStat = await stat(path);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${description} is unavailable at ${path}: ${message}`, {
      cause: error,
    });
  }
  if (!fileStat.isFile() || fileStat.size === 0) {
    throw new Error(`${description} must be a nonempty regular file at ${path}.`);
  }
  return { size: fileStat.size, sha256: await sha256File(path) };
}

async function inspectPreparedGraph(): Promise<PreparedGraphSummary> {
  let entries;
  try {
    entries = await readdir(OSRM_DIRECTORY, { withFileTypes: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Prepared OSRM graph is unavailable at ${OSRM_DIRECTORY}: ${message}. Run npm run car:osrm:prepare first.`,
      { cause: error },
    );
  }

  const graphFiles = entries.filter(
    (entry) =>
      entry.isFile() &&
      (entry.name === OSRM_BASENAME ||
        entry.name.startsWith(`${OSRM_BASENAME}.`)),
  );
  const sizes = await Promise.all(
    graphFiles.map(async ({ name }) => ({
      name,
      size: (await stat(join(OSRM_DIRECTORY, name))).size,
    })),
  );
  const empty = sizes.filter(({ size }) => size === 0);
  if (empty.length > 0) {
    throw new Error(
      `Prepared OSRM graph contains empty file(s): ${empty.map(({ name }) => name).join(', ')}.`,
    );
  }
  for (const requiredName of [
    `${OSRM_BASENAME}.hsgr`,
    `${OSRM_BASENAME}.edges`,
    `${OSRM_BASENAME}.geometry`,
    `${OSRM_BASENAME}.properties`,
  ]) {
    if (!sizes.some(({ name }) => name === requiredName)) {
      throw new Error(
        `Prepared CH graph is missing ${requiredName}. Run npm run car:osrm:prepare first.`,
      );
    }
  }
  return {
    fileCount: sizes.length,
    totalSize: sizes.reduce((sum, { size }) => sum + size, 0),
  };
}

function printSnapSummary(anchors: readonly CarLocalityRoadAnchor[]): void {
  const statistics = summarizeSnapDistances(anchors);
  console.log('Snap-distance summary:');
  console.log(`  minimum: ${formatMeters(statistics.minimum)}`);
  console.log(`  median: ${formatMeters(statistics.median)}`);
  console.log(`  p90: ${formatMeters(statistics.p90)}`);
  console.log(`  p95: ${formatMeters(statistics.p95)}`);
  console.log(`  p99: ${formatMeters(statistics.p99)}`);
  console.log(`  maximum: ${formatMeters(statistics.maximum)}`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'osrm-base-url': { type: 'string' },
    },
    allowPositionals: false,
  });
  const startedAt = performance.now();

  const sourcePbf = await fingerprintNonemptyFile(
    SOURCE_PBF_PATH,
    'Swiss OSM source PBF',
  );
  const graph = await inspectPreparedGraph();
  const localities = parseLocalitiesCsv(await readFile(LOCALITIES_PATH, 'utf8'));
  const localityInputs = buildCarLocalityInputs(localities);
  if (localityInputs.length === 0) {
    throw new Error('The official locality dataset produced no car inputs.');
  }

  console.log(`Official locality count: ${localityInputs.length}`);
  console.log(`Source PBF size: ${formatBytes(sourcePbf.size)} bytes`);
  console.log(`Source PBF SHA-256: ${sourcePbf.sha256}`);
  console.log(
    `Prepared CH graph: ${graph.fileCount} files, ${formatBytes(graph.totalSize)} bytes`,
  );
  console.log(
    `Expected graph provenance: OSRM ${OSRM_VERSION}, ${OSRM_PROFILE}, ${OSRM_ALGORITHM.toUpperCase()}`,
  );

  const client = new OsrmClient({ baseUrl: values['osrm-base-url'] });
  const healthCoordinate = localityInputs[0];
  try {
    await client.findNearestRoadPoint(healthCoordinate);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Local OSRM health check failed for ${healthCoordinate.localityId}: ${message}. Start osrm-routed on 127.0.0.1:5000 (or pass --osrm-base-url).`,
      { cause: error },
    );
  }
  console.log(`OSRM nearest-road health check: OK (${healthCoordinate.localityId})`);
  console.log(
    'Graph identity note: OSRM HTTP proves service health, but does not expose the mounted graph\'s PBF hash, profile, algorithm, or version.',
  );
  console.log(`Snapping with bounded concurrency ${SNAP_CONCURRENCY}...`);

  const snappingStartedAt = performance.now();
  const anchors = await generateCarLocalityRoadAnchors(
    localityInputs,
    (coordinate) => client.findNearestRoadPoint(coordinate),
    {
      concurrency: SNAP_CONCURRENCY,
      onProgress: ({ completed, total }) => {
        if (completed % PROGRESS_INTERVAL === 0 || completed === total) {
          console.log(`Snapped ${completed} / ${total}`);
        }
      },
    },
  );
  const snappingMilliseconds = performance.now() - snappingStartedAt;
  const sourcePbfAfterSnapping = await fingerprintNonemptyFile(
    SOURCE_PBF_PATH,
    'Swiss OSM source PBF integrity recheck',
  );
  if (
    sourcePbfAfterSnapping.size !== sourcePbf.size ||
    sourcePbfAfterSnapping.sha256 !== sourcePbf.sha256
  ) {
    throw new Error(
      'Swiss OSM source PBF changed while locality anchors were being generated.',
    );
  }

  const output = createCarLocalityRoadAnchorsFile({
    localityInputs,
    anchors,
    roadGraph: {
      sourcePbfSha256: sourcePbf.sha256,
      osrmVersion: OSRM_VERSION,
      profile: OSRM_PROFILE,
      algorithm: OSRM_ALGORITHM,
    },
  });
  const serialized = serializeCarLocalityRoadAnchorsFile(output);
  await writeUtf8FileAtomically(OUTPUT_PATH, serialized);

  const readBack = await readFile(OUTPUT_PATH, 'utf8');
  const parsedReadBack = parseCarLocalityRoadAnchorsJson(
    readBack,
    OUTPUT_PATH,
  );
  validateCarLocalityRoadAnchorsAgainstInputs(parsedReadBack, localityInputs);
  if (readBack !== serialized) {
    throw new Error('Atomic anchor output readback differs from generated bytes.');
  }
  const outputSha256 = createHash('sha256').update(readBack).digest('hex');

  console.log('');
  console.log(`Generated anchors: ${parsedReadBack.localityCount}`);
  console.log(
    `Locality-input SHA-256: ${parsedReadBack.localityInputSha256}`,
  );
  console.log(`Snapping time: ${formatSeconds(snappingMilliseconds)}`);
  console.log(
    `Generation time: ${formatSeconds(performance.now() - startedAt)}`,
  );
  console.log(`Output: ${OUTPUT_PATH}`);
  console.log(
    `Output size: ${formatBytes(Buffer.byteLength(readBack, 'utf8'))} bytes`,
  );
  console.log(`Output SHA-256: ${outputSha256}`);
  console.log(`Source PBF integrity recheck: unchanged (${sourcePbf.sha256})`);
  printSnapSummary(parsedReadBack.anchors);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
