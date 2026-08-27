import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

import { PROJECT_CONFIG } from '../src/config';
import {
  createLocalityId,
  parseLocalitiesCsv,
} from '../src/localities';
import { loadLocalityRoutingIndex } from '../src/localities/routing/node';
import { createTransitPlaceCandidateSelector } from '../src/transit/candidates';
import {
  serializeValidationTimetable,
  validationTimetableTypedArrayBytes,
  type SwissCommuteValidationData,
  type ValidationHubCandidate,
} from '../src/validation-ui/validation-data';
import {
  DEFAULT_LOCALITIES_FILE_PATH,
  loadTransitCandidateInputs,
  readUtf8Input,
} from './transit-inspection-inputs';
import { loadRaptorInspectionTimetable } from './load-raptor-inspection-timetable';
import { writeUtf8FileAtomically } from './write-utf8-file-atomically';

const PROJECT_ROOT = resolve(import.meta.dirname, '..');
const MANIFEST_PATH = resolve(
  PROJECT_ROOT,
  'data/processed/fixed-day-routing/manifest.json',
);
const LOCALITY_INDEX_PATH = resolve(
  PROJECT_ROOT,
  'data/processed/locality-routing-index.json',
);
const DEFAULT_OUTPUT_PATH = resolve(
  PROJECT_ROOT,
  'dist-validation/validation-data.js',
);

interface RoutingManifestMetadata {
  readonly sourceFeedVersion: string;
  readonly serviceDate: string;
  readonly routingWindowStart: string;
  readonly routingWindowEnd: string;
}

export interface ValidationDataBuildResult {
  readonly outputPath: string;
  readonly outputBytes: number;
  readonly sha256: string;
  readonly rawTimetableTypedArrayBytes: number;
  readonly localityCount: number;
  readonly hubCandidateCount: number;
  readonly buildMilliseconds: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

async function loadManifestMetadata(): Promise<RoutingManifestMetadata> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read routing manifest at "${MANIFEST_PATH}".`, {
      cause: error,
    });
  }
  if (!isRecord(value)) {
    throw new Error('Routing manifest must contain a JSON object.');
  }
  const {
    sourceFeedVersion,
    serviceDate,
    routingWindowStart,
    routingWindowEnd,
  } = value;
  if (
    typeof sourceFeedVersion !== 'string' ||
    sourceFeedVersion.length === 0 ||
    typeof serviceDate !== 'string' ||
    typeof routingWindowStart !== 'string' ||
    typeof routingWindowEnd !== 'string'
  ) {
    throw new Error(
      'Routing manifest must contain feed version, service date, and routing window.',
    );
  }
  const scenario = PROJECT_CONFIG.transit.referenceScenario;
  if (
    serviceDate !== scenario.serviceDate ||
    routingWindowStart !== scenario.morningWindow.start ||
    routingWindowEnd !== scenario.morningWindow.end
  ) {
    throw new Error(
      'Routing manifest metadata does not match PROJECT_CONFIG.',
    );
  }
  return {
    sourceFeedVersion,
    serviceDate,
    routingWindowStart,
    routingWindowEnd,
  };
}

function javascriptSafeJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

export async function buildValidationData(
  outputPath = DEFAULT_OUTPUT_PATH,
): Promise<ValidationDataBuildResult> {
  const buildStart = performance.now();
  const [
    localitiesCsv,
    candidateInputs,
    localityIndex,
    manifest,
    loadedTimetable,
  ] = await Promise.all([
    readUtf8Input(DEFAULT_LOCALITIES_FILE_PATH, 'locality CSV'),
    loadTransitCandidateInputs(),
    loadLocalityRoutingIndex(LOCALITY_INDEX_PATH),
    loadManifestMetadata(),
    loadRaptorInspectionTimetable(),
  ]);
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

  const selectCandidates = createTransitPlaceCandidateSelector(
    candidateInputs.places,
    candidateInputs.profileDataset,
  );
  const hubCandidatesByLocality: Record<
    string,
    readonly ValidationHubCandidate[]
  > = Object.create(null) as Record<
    string,
    readonly ValidationHubCandidate[]
  >;
  let hubCandidateCount = 0;

  for (const entry of localityIndex.entries) {
    const locality = localityById.get(entry.localityId);
    if (locality === undefined) {
      throw new Error(
        `Locality routing entry "${entry.localityId}" is absent from the locality CSV.`,
      );
    }
    if (
      [...entry.stopIndexes].some(
        (stopIndex) =>
          stopIndex >= loadedTimetable.timetable.sourceStopIds.length,
      )
    ) {
      throw new Error(
        `Locality routing entry "${entry.localityId}" is incompatible with the timetable.`,
      );
    }

    const selection = selectCandidates(locality);
    if (selection.mode !== entry.selectionMode) {
      throw new Error(
        `Candidate-selection mode mismatch for locality "${entry.localityId}".`,
      );
    }
    const candidates = selection.candidates.map(
      ({ place, profile, distanceMeters }): ValidationHubCandidate => ({
        placeId: place.id,
        name: place.name,
        distanceMeters,
        routeCount: profile.routeCount,
        departureCount: profile.departureCount,
        railRouteCount: profile.railRouteCount,
        railDepartureCount: profile.railDepartureCount,
      }),
    );
    hubCandidateCount += candidates.length;
    hubCandidatesByLocality[entry.localityId] = candidates;
  }

  const rawTimetableTypedArrayBytes = validationTimetableTypedArrayBytes(
    loadedTimetable.timetable,
  );
  const dataset: SwissCommuteValidationData = {
    schemaVersion: 1,
    feedVersion: manifest.sourceFeedVersion,
    serviceDate: manifest.serviceDate,
    routingWindowStart: manifest.routingWindowStart,
    routingWindowEnd: manifest.routingWindowEnd,
    localities: localityIndex.entries.map(
      ({ localityId, postalCode, city }) => ({
        localityId,
        postalCode,
        city,
      }),
    ),
    localityRoutingEntries: localityIndex.entries.map(
      ({ localityId, selectionMode, stopIndexes }) => ({
        localityId,
        selectionMode,
        stopIndexes: [...stopIndexes],
      }),
    ),
    hubCandidatesByLocality,
    timetable: serializeValidationTimetable(loadedTimetable.timetable),
  };
  const output = `window.__SWISS_COMMUTE_VALIDATION_DATA__=${javascriptSafeJson(dataset)};\n`;
  await writeUtf8FileAtomically(outputPath, output);
  const buildMilliseconds = performance.now() - buildStart;

  return {
    outputPath,
    outputBytes: Buffer.byteLength(output),
    sha256: createHash('sha256').update(output).digest('hex'),
    rawTimetableTypedArrayBytes,
    localityCount: dataset.localities.length,
    hubCandidateCount,
    buildMilliseconds,
  };
}

function formatBytes(value: number): string {
  return `${new Intl.NumberFormat('en-US').format(value)} bytes (${(value / 1024 / 1024).toFixed(2)} MiB)`;
}

async function runDirectly(): Promise<void> {
  const result = await buildValidationData();
  console.log(`Localities: ${result.localityCount}`);
  console.log(`Hub candidates: ${result.hubCandidateCount}`);
  console.log(
    `Raw timetable typed-array bytes: ${formatBytes(result.rawTimetableTypedArrayBytes)}`,
  );
  console.log(`Generated data size: ${formatBytes(result.outputBytes)}`);
  console.log(`SHA-256: ${result.sha256}`);
  console.log(`Build time: ${(result.buildMilliseconds / 1000).toFixed(3)} s`);
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
