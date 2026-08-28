import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

import {
  encodeFloat32ArrayBase64,
  raptorTimetableTypedArrayBytes,
  serializeRaptorTimetable,
} from '@jm/commute-viewer/src/data/browser-timetable';
import {
  COMMUTE_VIEWER_DATA_GLOBAL_KEY,
  COMMUTE_VIEWER_DATA_SCHEMA_VERSION,
  type CommuteViewerData,
  type ViewerLocality,
  type ViewerLocalityRoutingEntry,
} from '@jm/commute-viewer/src/data/runtime-data';
import { createLocalityId } from '@core/localities';
import { parseLocalitiesCsv } from '@core/localities/node';
import {
  buildLocalityRoutingIndex,
  type LocalityRoutingIndex,
} from '@core/transit/locality-routing';
import { loadLocalityRoutingIndex } from '@core/transit/locality-routing/node';
import {
  DEFAULT_LOCALITIES_FILE_PATH,
  loadTransitCandidateInputs,
  readUtf8Input,
} from './transit-inspection-inputs';
import { loadRaptorInspectionTimetable } from './load-raptor-inspection-timetable';
import { writeUtf8FileAtomically } from './write-utf8-file-atomically';

const PROJECT_ROOT = resolve(import.meta.dirname, '..');
const LOCALITY_INDEX_PATH = resolve(
  PROJECT_ROOT,
  'data/processed/locality-routing-index.json',
);
const DEFAULT_OUTPUT_PATH = resolve(
  PROJECT_ROOT,
  'apps/commute-viewer/public/generated/commute-data.js',
);

export interface CommuteViewerDataBuildResult {
  readonly outputPath: string;
  readonly outputBytes: number;
  readonly sha256: string;
  readonly rawTimetableTypedArrayBytes: number;
  readonly stopCoordinateBytes: number;
  readonly localityCount: number;
  readonly activeStopCount: number;
  readonly missingCoordinateStopCount: number;
  readonly timetableBuildMilliseconds: number;
  readonly transferBuildMilliseconds: number;
  readonly serializationMilliseconds: number;
  readonly buildMilliseconds: number;
}

function javascriptSafeJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

export function assertLocalityRoutingIndexMatchesTimetable(
  persistedIndex: LocalityRoutingIndex,
  expectedIndex: LocalityRoutingIndex,
): void {
  if (persistedIndex.entries.length !== expectedIndex.entries.length) {
    throw new Error(
      'Generated locality routing index does not match the current timetable. Rebuild it.',
    );
  }

  for (
    let entryIndex = 0;
    entryIndex < expectedIndex.entries.length;
    entryIndex += 1
  ) {
    const persisted = persistedIndex.entries[entryIndex];
    const expected = expectedIndex.entries[entryIndex];
    if (
      persisted === undefined ||
      expected === undefined ||
      persisted.localityId !== expected.localityId ||
      persisted.selectionMode !== expected.selectionMode ||
      persisted.stopIndexes.length !== expected.stopIndexes.length ||
      persisted.stopIndexes.some(
        (stopIndex, stopIndexPosition) =>
          stopIndex !== expected.stopIndexes[stopIndexPosition],
      )
    ) {
      const localityId =
        expected?.localityId ?? persisted?.localityId ?? 'unknown';
      throw new Error(
        `Generated locality routing index for "${localityId}" does not match the current timetable's numeric stop ordering. Rebuild it.`,
      );
    }
  }
}

export function buildStopCoordinates(
  stopCount: number,
  stopIndexBySourceId: ReadonlyMap<string, number>,
  transitStops: readonly {
    readonly id: string;
    readonly longitude: number;
    readonly latitude: number;
  }[],
): {
  readonly coordinates: Float32Array;
  readonly missingCoordinateStopCount: number;
} {
  const coordinates = new Float32Array(stopCount * 2).fill(Number.NaN);
  const locatedStops = new Uint8Array(stopCount);

  for (const stop of transitStops) {
    const stopIndex = stopIndexBySourceId.get(stop.id);
    if (stopIndex === undefined) {
      continue;
    }
    if (stopIndex >= stopCount) {
      throw new Error(
        `Dense stop lookup maps "${stop.id}" outside the timetable.`,
      );
    }
    coordinates[stopIndex * 2] = stop.longitude;
    coordinates[stopIndex * 2 + 1] = stop.latitude;
    locatedStops[stopIndex] = 1;
  }

  let missingCoordinateStopCount = 0;
  for (const isLocated of locatedStops) {
    if (isLocated === 0) {
      missingCoordinateStopCount += 1;
    }
  }
  return { coordinates, missingCoordinateStopCount };
}

export async function buildCommuteViewerData(
  outputPath = DEFAULT_OUTPUT_PATH,
): Promise<CommuteViewerDataBuildResult> {
  const buildStart = performance.now();
  const [
    localitiesCsv,
    candidateInputs,
    localityIndex,
    loadedTimetable,
  ] = await Promise.all([
    readUtf8Input(DEFAULT_LOCALITIES_FILE_PATH, 'locality CSV'),
    loadTransitCandidateInputs(),
    loadLocalityRoutingIndex(LOCALITY_INDEX_PATH),
    loadRaptorInspectionTimetable(),
  ]);
  const { manifest, timetable, stopIndexBySourceId, transitStops } =
    loadedTimetable;
  if (manifest.sourceFeedVersion === undefined) {
    throw new Error(
      'The commute viewer requires sourceFeedVersion in the routing manifest.',
    );
  }

  const localities = parseLocalitiesCsv(localitiesCsv);
  const localityById = new Map(
    localities.map((locality) => [
      createLocalityId(locality.postalCode, locality.city),
      locality,
    ]),
  );
  if (localityById.size !== localityIndex.entries.length) {
    throw new Error(
      'Locality CSV and generated locality routing index have different locality counts.',
    );
  }

  const expectedLocalityIndex = buildLocalityRoutingIndex(
    localities,
    candidateInputs.places,
    candidateInputs.profileDataset,
    stopIndexBySourceId,
  );
  assertLocalityRoutingIndexMatchesTimetable(
    localityIndex,
    expectedLocalityIndex,
  );

  const viewerLocalities: ViewerLocality[] = [];
  const localityRoutingEntries: ViewerLocalityRoutingEntry[] = [];
  for (const entry of localityIndex.entries) {
    const locality = localityById.get(entry.localityId);
    if (locality === undefined) {
      throw new Error(
        `Locality routing entry "${entry.localityId}" is absent from the locality CSV.`,
      );
    }
    for (const stopIndex of entry.stopIndexes) {
      if (stopIndex >= timetable.sourceStopIds.length) {
        throw new Error(
          `Locality routing entry "${entry.localityId}" is incompatible with the timetable.`,
        );
      }
    }
    viewerLocalities.push({
      localityId: entry.localityId,
      postalCode: entry.postalCode,
      city: entry.city,
      longitude: locality.longitude,
      latitude: locality.latitude,
    });
    localityRoutingEntries.push({
      localityId: entry.localityId,
      selectionMode: entry.selectionMode,
      stopIndexes: [...entry.stopIndexes],
    });
  }

  const { coordinates, missingCoordinateStopCount } = buildStopCoordinates(
    timetable.sourceStopIds.length,
    stopIndexBySourceId,
    transitStops,
  );
  const serializationStart = performance.now();
  const dataset = {
    schemaVersion: COMMUTE_VIEWER_DATA_SCHEMA_VERSION,
    feedVersion: manifest.sourceFeedVersion,
    serviceDate: manifest.serviceDate,
    routingWindowStart: manifest.routingWindowStart,
    routingWindowEnd: manifest.routingWindowEnd,
    localities: viewerLocalities,
    localityRoutingEntries,
    timetable: serializeRaptorTimetable(timetable),
    stopCoordinatesBase64: encodeFloat32ArrayBase64(coordinates),
  } satisfies CommuteViewerData;
  const output = `window.${COMMUTE_VIEWER_DATA_GLOBAL_KEY}=${javascriptSafeJson(dataset)};\n`;
  const serializationMilliseconds = performance.now() - serializationStart;
  await writeUtf8FileAtomically(outputPath, output);
  const buildMilliseconds = performance.now() - buildStart;

  return {
    outputPath,
    outputBytes: Buffer.byteLength(output),
    sha256: createHash('sha256').update(output).digest('hex'),
    rawTimetableTypedArrayBytes: raptorTimetableTypedArrayBytes(timetable),
    stopCoordinateBytes: coordinates.byteLength,
    localityCount: viewerLocalities.length,
    activeStopCount: timetable.sourceStopIds.length,
    missingCoordinateStopCount,
    timetableBuildMilliseconds: loadedTimetable.timetableBuildMilliseconds,
    transferBuildMilliseconds: loadedTimetable.transferBuildMilliseconds,
    serializationMilliseconds,
    buildMilliseconds,
  };
}

function formatBytes(value: number): string {
  return `${new Intl.NumberFormat('en-US').format(value)} bytes (${(value / 1024 / 1024).toFixed(2)} MiB)`;
}

async function runDirectly(): Promise<void> {
  const result = await buildCommuteViewerData();
  console.log(`Localities: ${result.localityCount}`);
  console.log(`Active RAPTOR stops: ${result.activeStopCount}`);
  console.log(
    `Stops missing coordinates: ${result.missingCoordinateStopCount}`,
  );
  console.log(
    `Raw timetable typed-array size: ${formatBytes(result.rawTimetableTypedArrayBytes)}`,
  );
  console.log(
    `Raw stop-coordinate size: ${formatBytes(result.stopCoordinateBytes)}`,
  );
  console.log(`Generated data size: ${formatBytes(result.outputBytes)}`);
  console.log(`SHA-256: ${result.sha256}`);
  console.log(
    `Timetable build: ${(result.timetableBuildMilliseconds / 1000).toFixed(3)} s`,
  );
  console.log(
    `Transfer build: ${(result.transferBuildMilliseconds / 1000).toFixed(3)} s`,
  );
  console.log(
    `Serialization: ${(result.serializationMilliseconds / 1000).toFixed(3)} s`,
  );
  console.log(`Total build: ${(result.buildMilliseconds / 1000).toFixed(3)} s`);
  console.log(`Output: ${result.outputPath}`);
}

const directEntryPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : undefined;
if (directEntryPath === import.meta.url) {
  try {
    await runDirectly();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
