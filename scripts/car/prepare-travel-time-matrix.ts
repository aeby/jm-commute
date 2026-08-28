import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';
import {
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
} from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';

import {
  buildCarLocalityInputs,
  createCarTravelTimeMatrixCheckpoint,
  createCarTravelTimeMatrixManifest,
  createCarTravelTimeRowSlab,
  durationSecondsToTravelMinutes,
  encodeTravelMinutesLittleEndian,
  finalizeCarTravelTimeRowSlab,
  loadCarTravelTimeMatrix,
  OSRM_ALGORITHM,
  OSRM_PROFILE,
  OSRM_VERSION,
  OsrmClient,
  OsrmHttpError,
  OsrmTransportError,
  parseCarLocalityRoadAnchorsJson,
  parseCarTravelTimeMatrixCheckpointJson,
  serializeCarTravelTimeMatrixCheckpoint,
  serializeCarTravelTimeMatrixManifest,
  validateCarLocalityRoadAnchorsAgainstInputs,
  validateCarTravelTimeMatrixResume,
  writeCarDurationBlockToRowSlab,
  type CarLocalityRoadAnchor,
  type CarLocalityRoadAnchorsFile,
  type CarRouteEstimate,
  type CarTravelTimeMatrixCheckpoint,
  type CarTravelTimeMatrixResumeIdentity,
  type LoadedCarTravelTimeMatrix,
} from '@core/car/preprocessing';
import {
  calculateTravelTimeMatrixByteLength,
  calculateTravelTimeMatrixCellCount,
  getTravelTimeMatrixCellIndex,
  parseCarTravelTimeMatrixManifestJson,
  TRAVEL_TIME_MATRIX_BYTES_PER_CELL,
  UNREACHABLE_TRAVEL_MINUTES,
} from '@core/car/preprocessing/travel-time-matrix-format';
import { parseLocalitiesCsv } from '@core/localities/node';
import { writeUtf8FileAtomically } from '../write-utf8-file-atomically';

const PROJECT_ROOT = resolve(import.meta.dirname, '..', '..');
const ANCHORS_PATH = resolve(
  PROJECT_ROOT,
  'data/processed/car/locality-road-anchors.json',
);
const LOCALITIES_PATH = resolve(
  PROJECT_ROOT,
  'data/raw/AMTOVZ_CSV_WGS84.csv',
);
const OSRM_HIERARCHY_PATH = resolve(
  PROJECT_ROOT,
  'data/processed/car/osrm/switzerland.osrm.hsgr',
);
const OUTPUT_DIRECTORY = resolve(
  PROJECT_ROOT,
  'data/processed/car/travel-time-matrix',
);
const PARTIAL_MATRIX_PATH = resolve(
  OUTPUT_DIRECTORY,
  'travel-times.bin.partial',
);
const CHECKPOINT_PATH = resolve(OUTPUT_DIRECTORY, 'checkpoint.json');
const MATRIX_PATH = resolve(OUTPUT_DIRECTORY, 'travel-times.bin');
const MANIFEST_PATH = resolve(OUTPUT_DIRECTORY, 'manifest.json');
const STAGED_MANIFEST_PATH = resolve(
  OUTPUT_DIRECTORY,
  'manifest.json.partial',
);

const BLOCK_SIZE = 50;
const TABLE_CONCURRENCY = 4;
const MAX_TABLE_ATTEMPTS = 3;
const ROUTE_VALIDATION_SAMPLE_SIZE = 100;
const RETRY_DELAYS_MILLISECONDS = [100, 250] as const;

interface RequestStatistics {
  totalAttempts: number;
  successfulRequests: number;
  retriedAttempts: number;
}

interface RouteValidationStatistics {
  readonly sampleSize: number;
  readonly exactMatches: number;
  readonly noRouteMatches: number;
  readonly mismatches: number;
  readonly retriedAttempts: number;
}

interface PairIndexes {
  readonly originIndex: number;
  readonly destinationIndex: number;
}

function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds)) {
    return 'unknown';
  }
  const rounded = Math.max(Math.round(seconds), 0);
  const hours = Math.floor(rounded / 3_600);
  const minutes = Math.floor((rounded % 3_600) / 60);
  const remainingSeconds = rounded % 60;
  return [
    ...(hours === 0 ? [] : [`${hours}h`]),
    ...(hours === 0 && minutes === 0 ? [] : [`${minutes}m`]),
    `${remainingSeconds}s`,
  ].join(' ');
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, milliseconds);
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

async function regularFileSize(path: string): Promise<number | undefined> {
  let fileStat: Stats;
  try {
    fileStat = await stat(path);
  } catch (error) {
    if (isMissingFileError(error)) {
      return undefined;
    }
    throw error;
  }
  if (!fileStat.isFile()) {
    throw new Error(`Expected a regular file at ${path}.`);
  }
  return fileStat.size;
}

async function removeIfPresent(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }
}

function isTransientOsrmError(error: unknown): boolean {
  return (
    error instanceof OsrmTransportError ||
    (error instanceof OsrmHttpError &&
      (error.status === 408 ||
        error.status === 429 ||
        (error.status >= 500 && error.status <= 599)))
  );
}

async function requestTableWithRetry(
  client: OsrmClient,
  sources: readonly CarLocalityRoadAnchor[],
  destinations: readonly CarLocalityRoadAnchor[],
  sourceStartIndex: number,
  destinationStartIndex: number,
  statistics: RequestStatistics,
) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_TABLE_ATTEMPTS; attempt += 1) {
    statistics.totalAttempts += 1;
    try {
      const table = await client.getCarDurationTable(sources, destinations);
      statistics.successfulRequests += 1;
      return table;
    } catch (error) {
      lastError = error;
      if (!isTransientOsrmError(error) || attempt === MAX_TABLE_ATTEMPTS) {
        break;
      }
      statistics.retriedAttempts += 1;
      await sleep(RETRY_DELAYS_MILLISECONDS[attempt - 1] as number);
    }
  }
  throw new Error(
    `OSRM Table block sources ${sourceStartIndex}–${sourceStartIndex + sources.length - 1}, destinations ${destinationStartIndex}–${destinationStartIndex + destinations.length - 1} failed: ${errorMessage(lastError)}`,
    { cause: lastError },
  );
}

async function requestRouteWithRetry(
  client: OsrmClient,
  from: CarLocalityRoadAnchor,
  to: CarLocalityRoadAnchor,
  onRetry: () => void,
): Promise<CarRouteEstimate | undefined> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_TABLE_ATTEMPTS; attempt += 1) {
    try {
      return await client.estimateCarRoute(from, to);
    } catch (error) {
      lastError = error;
      if (!isTransientOsrmError(error) || attempt === MAX_TABLE_ATTEMPTS) {
        break;
      }
      onRetry();
      await sleep(RETRY_DELAYS_MILLISECONDS[attempt - 1] as number);
    }
  }
  throw new Error(
    `OSRM Route validation request failed after ${MAX_TABLE_ATTEMPTS} attempts: ${errorMessage(lastError)}`,
    { cause: lastError },
  );
}

async function runBoundedTasks(
  itemCount: number,
  concurrency: number,
  task: (itemIndex: number) => Promise<void>,
): Promise<void> {
  let nextItemIndex = 0;
  let firstError: unknown;

  async function worker(): Promise<void> {
    while (firstError === undefined && nextItemIndex < itemCount) {
      const itemIndex = nextItemIndex;
      nextItemIndex += 1;
      try {
        await task(itemIndex);
      } catch (error) {
        firstError ??= error;
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, itemCount) },
      async () => worker(),
    ),
  );
  if (firstError !== undefined) {
    throw firstError;
  }
}

async function appendCompletedSlab(
  bytes: Uint8Array,
  expectedOffset: number,
): Promise<void> {
  const handle = await open(PARTIAL_MATRIX_PATH, 'r+');
  try {
    let written = 0;
    while (written < bytes.byteLength) {
      const result = await handle.write(
        bytes,
        written,
        bytes.byteLength - written,
        expectedOffset + written,
      );
      if (result.bytesWritten === 0) {
        throw new Error('Writing the completed matrix row slab made no progress.');
      }
      written += result.bytesWritten;
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
  const actualLength = await regularFileSize(PARTIAL_MATRIX_PATH);
  const expectedLength = expectedOffset + bytes.byteLength;
  if (actualLength !== expectedLength) {
    throw new Error(
      `Partial matrix has ${actualLength ?? 'no'} bytes after slab write; expected ${expectedLength}.`,
    );
  }
}

function createResumeIdentity(
  anchorsSha256: string,
  localityCount: number,
): CarTravelTimeMatrixResumeIdentity {
  return {
    anchorsSha256,
    localityCount,
    blockSize: BLOCK_SIZE,
    valueEncoding: 'UINT16_LE',
  };
}

async function initializeOrResume(
  identity: CarTravelTimeMatrixResumeIdentity,
  restart: boolean,
): Promise<CarTravelTimeMatrixCheckpoint> {
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  if (restart) {
    await removeIfPresent(PARTIAL_MATRIX_PATH);
    await removeIfPresent(CHECKPOINT_PATH);
    await removeIfPresent(STAGED_MANIFEST_PATH);
    console.log(
      'Restart requested: removed only the partial matrix and checkpoint; any completed matrix remains available until promotion.',
    );
  }

  const [partialSize, checkpointSize] = await Promise.all([
    regularFileSize(PARTIAL_MATRIX_PATH),
    regularFileSize(CHECKPOINT_PATH),
  ]);
  if ((partialSize === undefined) !== (checkpointSize === undefined)) {
    throw new Error(
      'Matrix resume state is incomplete: partial binary and checkpoint must either both exist or both be absent. Use --restart to intentionally start over.',
    );
  }
  if (partialSize !== undefined && checkpointSize !== undefined) {
    if (checkpointSize === 0) {
      throw new Error('Matrix checkpoint is empty. Use --restart to start over.');
    }
    const checkpoint = parseCarTravelTimeMatrixCheckpointJson(
      await readFile(CHECKPOINT_PATH, 'utf8'),
      CHECKPOINT_PATH,
    );
    validateCarTravelTimeMatrixResume(checkpoint, identity, partialSize);
    console.log(
      `Resuming validated matrix progress at source index ${checkpoint.nextSourceIndex}.`,
    );
    return checkpoint;
  }

  const handle = await open(PARTIAL_MATRIX_PATH, 'wx');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
  const checkpoint = createCarTravelTimeMatrixCheckpoint(identity, 0);
  await writeUtf8FileAtomically(
    CHECKPOINT_PATH,
    serializeCarTravelTimeMatrixCheckpoint(checkpoint),
  );
  return checkpoint;
}

async function recoverCompletedPromotion(
  identity: CarTravelTimeMatrixResumeIdentity,
  anchorsFile: CarLocalityRoadAnchorsFile,
  anchorsSha256: string,
  client: OsrmClient,
): Promise<boolean> {
  const [partialSize, checkpointSize] = await Promise.all([
    regularFileSize(PARTIAL_MATRIX_PATH),
    regularFileSize(CHECKPOINT_PATH),
  ]);
  if (checkpointSize === undefined || partialSize !== undefined) {
    return false;
  }

  const checkpoint = parseCarTravelTimeMatrixCheckpointJson(
    await readFile(CHECKPOINT_PATH, 'utf8'),
    CHECKPOINT_PATH,
  );
  const expectedByteLength = calculateTravelTimeMatrixByteLength(
    identity.localityCount,
  );
  validateCarTravelTimeMatrixResume(
    checkpoint,
    identity,
    expectedByteLength,
  );
  if (checkpoint.nextSourceIndex !== identity.localityCount) {
    throw new Error(
      'Matrix checkpoint exists without a partial binary before all source rows completed. Use --restart to intentionally start over.',
    );
  }

  const [matrixSize, stagedManifestSize, finalManifestSize] =
    await Promise.all([
      regularFileSize(MATRIX_PATH),
      regularFileSize(STAGED_MANIFEST_PATH),
      regularFileSize(MANIFEST_PATH),
    ]);
  if (matrixSize !== expectedByteLength) {
    throw new Error(
      `Completed-promotion recovery expected a ${expectedByteLength}-byte final matrix; found ${matrixSize ?? 'no file'}. Use --restart to regenerate.`,
    );
  }
  const recoveryManifestPath =
    stagedManifestSize === undefined ? MANIFEST_PATH : STAGED_MANIFEST_PATH;
  if (stagedManifestSize === undefined && finalManifestSize === undefined) {
    throw new Error(
      'Completed-promotion recovery found no validated staged or final manifest. Use --restart to regenerate.',
    );
  }

  const [matrixBytes, manifestJson] = await Promise.all([
    readFile(MATRIX_PATH),
    readFile(recoveryManifestPath, 'utf8'),
  ]);
  const manifest = parseCarTravelTimeMatrixManifestJson(
    manifestJson,
    recoveryManifestPath,
  );
  const loaded = loadCarTravelTimeMatrix(manifest, matrixBytes, {
    anchorsFile,
    anchorsSha256,
  });
  console.log('Recovering a fully generated matrix from interrupted final promotion.');
  const routeValidation = await validateIndependentRoutes(
    loaded,
    anchorsFile.anchors,
    anchorsSha256,
    client,
  );
  if (recoveryManifestPath === STAGED_MANIFEST_PATH) {
    await rename(STAGED_MANIFEST_PATH, MANIFEST_PATH);
  }
  const readBackManifest = parseCarTravelTimeMatrixManifestJson(
    await readFile(MANIFEST_PATH, 'utf8'),
    MANIFEST_PATH,
  );
  loadCarTravelTimeMatrix(readBackManifest, await readFile(MATRIX_PATH), {
    anchorsFile,
    anchorsSha256,
  });
  await unlink(CHECKPOINT_PATH);
  console.log(
    `Promotion recovery complete; Route validation ${routeValidation.exactMatches}/${routeValidation.sampleSize} exact with ${routeValidation.retriedAttempts} retries.`,
  );
  return true;
}

function deterministicValidationPairs(
  matrix: LoadedCarTravelTimeMatrix,
  anchorsSha256: string,
): readonly PairIndexes[] {
  if (matrix.localityCount < 2) {
    throw new Error('Route validation requires at least two localities.');
  }
  if (
    matrix.localityCount * (matrix.localityCount - 1) <
    ROUTE_VALIDATION_SAMPLE_SIZE
  ) {
    throw new Error(
      `Route validation requires at least ${ROUTE_VALIDATION_SAMPLE_SIZE} unique non-self pairs.`,
    );
  }
  const indexesById = new Map(
    matrix.localityIds.map((localityId, index) => [localityId, index]),
  );
  const pairs: PairIndexes[] = [];
  const seen = new Set<string>();

  function add(originId: string, destinationId: string): void {
    const originIndex = indexesById.get(originId);
    const destinationIndex = indexesById.get(destinationId);
    if (originIndex === undefined || destinationIndex === undefined) {
      throw new Error(
        `Required route-validation pair ${originId} → ${destinationId} is absent from the anchors.`,
      );
    }
    const key = `${originIndex}:${destinationIndex}`;
    if (!seen.has(key)) {
      seen.add(key);
      pairs.push({ originIndex, destinationIndex });
    }
  }

  for (const [originId, destinationId] of [
    ['8001:zurich', '3011:bern'],
    ['3011:bern', '8001:zurich'],
    ['8750:glarus', '8001:zurich'],
    ['8001:zurich', '8750:glarus'],
    ['3920:zermatt', '3930:visp'],
    ['3930:visp', '3920:zermatt'],
  ] as const) {
    add(originId, destinationId);
  }

  let state = Number.parseInt(anchorsSha256.slice(0, 8), 16) >>> 0;
  if (state === 0) {
    state = 0x9e37_79b9;
  }
  function randomUint32(): number {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state;
  }
  while (pairs.length < ROUTE_VALIDATION_SAMPLE_SIZE) {
    const originIndex = randomUint32() % matrix.localityCount;
    const destinationIndex = randomUint32() % matrix.localityCount;
    if (originIndex === destinationIndex) {
      continue;
    }
    const key = `${originIndex}:${destinationIndex}`;
    if (!seen.has(key)) {
      seen.add(key);
      pairs.push({ originIndex, destinationIndex });
    }
  }
  return pairs;
}

async function validateIndependentRoutes(
  matrix: LoadedCarTravelTimeMatrix,
  anchors: readonly CarLocalityRoadAnchor[],
  anchorsSha256: string,
  client: OsrmClient,
): Promise<RouteValidationStatistics> {
  const pairs = deterministicValidationPairs(matrix, anchorsSha256);
  let exactMatches = 0;
  let noRouteMatches = 0;
  let retriedAttempts = 0;
  const mismatches: string[] = [];

  await runBoundedTasks(pairs.length, TABLE_CONCURRENCY, async (pairIndex) => {
    const pair = pairs[pairIndex] as PairIndexes;
    const route = await requestRouteWithRetry(
      client,
      anchors[pair.originIndex] as CarLocalityRoadAnchor,
      anchors[pair.destinationIndex] as CarLocalityRoadAnchor,
      () => {
        retriedAttempts += 1;
      },
    );
    const matrixValue =
      matrix.values[
        getTravelTimeMatrixCellIndex(
          matrix.localityCount,
          pair.originIndex,
          pair.destinationIndex,
        )
      ] as number;
    const routeValue =
      route === undefined
        ? UNREACHABLE_TRAVEL_MINUTES
        : durationSecondsToTravelMinutes(route.durationSeconds);
    if (matrixValue === routeValue) {
      exactMatches += 1;
      if (route === undefined) {
        noRouteMatches += 1;
      }
      return;
    }
    mismatches.push(
      `${matrix.localityIds[pair.originIndex]} → ${matrix.localityIds[pair.destinationIndex]}: matrix ${matrixValue}, Route ${routeValue}`,
    );
  });

  if (mismatches.length > 0) {
    throw new Error(
      `Independent Route validation found ${mismatches.length} mismatch(es):\n${mismatches.slice(0, 20).join('\n')}`,
    );
  }
  return {
    sampleSize: pairs.length,
    exactMatches,
    noRouteMatches,
    mismatches: mismatches.length,
    retriedAttempts,
  };
}

async function loadExistingCompletedMatrix(
  anchorsFile: ReturnType<typeof parseCarLocalityRoadAnchorsJson>,
  anchorsSha256: string,
): Promise<LoadedCarTravelTimeMatrix | undefined> {
  const [matrixSize, manifestSize] = await Promise.all([
    regularFileSize(MATRIX_PATH),
    regularFileSize(MANIFEST_PATH),
  ]);
  if ((matrixSize === undefined) !== (manifestSize === undefined)) {
    throw new Error(
      'Completed matrix state is incomplete: travel-times.bin and manifest.json must either both exist or both be absent.',
    );
  }
  if (matrixSize === undefined || manifestSize === undefined) {
    return undefined;
  }
  const [matrixBytes, manifestJson] = await Promise.all([
    readFile(MATRIX_PATH),
    readFile(MANIFEST_PATH, 'utf8'),
  ]);
  const manifest = parseCarTravelTimeMatrixManifestJson(
    manifestJson,
    MANIFEST_PATH,
  );
  return loadCarTravelTimeMatrix(manifest, matrixBytes, {
    anchorsFile,
    anchorsSha256,
  });
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      restart: { type: 'boolean', default: false },
      'osrm-base-url': { type: 'string' },
    },
    allowPositionals: false,
  });
  const startedAt = performance.now();
  const anchorsBytes = await readFile(ANCHORS_PATH);
  const anchorsSha256 = sha256Bytes(anchorsBytes);
  const anchorsFile = parseCarLocalityRoadAnchorsJson(
    anchorsBytes.toString('utf8'),
    ANCHORS_PATH,
  );
  const localityInputs = buildCarLocalityInputs(
    parseLocalitiesCsv(await readFile(LOCALITIES_PATH, 'utf8')),
  );
  validateCarLocalityRoadAnchorsAgainstInputs(anchorsFile, localityInputs);
  if (
    anchorsFile.roadGraph.osrmVersion !== OSRM_VERSION ||
    anchorsFile.roadGraph.profile !== OSRM_PROFILE ||
    anchorsFile.roadGraph.algorithm !== OSRM_ALGORITHM
  ) {
    throw new Error(
      `Anchor graph provenance is not the expected OSRM ${OSRM_VERSION}, ${OSRM_PROFILE}, ${OSRM_ALGORITHM}.`,
    );
  }
  const hierarchySize = await regularFileSize(OSRM_HIERARCHY_PATH);
  if (hierarchySize === undefined || hierarchySize === 0) {
    throw new Error(
      `Prepared CH graph is missing at ${OSRM_HIERARCHY_PATH}. Run npm run car:osrm:prepare first.`,
    );
  }

  const localityCount = anchorsFile.localityCount;
  const cellCount = calculateTravelTimeMatrixCellCount(localityCount);
  const expectedByteLength = calculateTravelTimeMatrixByteLength(localityCount);
  const sourceBlockCount = Math.ceil(localityCount / BLOCK_SIZE);
  const destinationBlockCount = Math.ceil(localityCount / BLOCK_SIZE);
  const expectedLogicalRequests = sourceBlockCount * destinationBlockCount;
  const identity = createResumeIdentity(anchorsSha256, localityCount);
  const client = new OsrmClient({ baseUrl: values['osrm-base-url'] });

  console.log(`Anchors: ${formatInteger(localityCount)}`);
  console.log(`Anchor SHA-256: ${anchorsSha256}`);
  console.log(`Directional cells: ${formatInteger(cellCount)}`);
  console.log(`Expected binary size: ${formatInteger(expectedByteLength)} bytes`);
  console.log(`Block size: ${BLOCK_SIZE} × ${BLOCK_SIZE}`);
  console.log(`Source/destination blocks: ${sourceBlockCount} × ${destinationBlockCount}`);
  console.log(`Destination-block concurrency: ${TABLE_CONCURRENCY}`);
  console.log(`Expected logical Table requests: ${formatInteger(expectedLogicalRequests)}`);

  await client.getCarDurationTable(
    [anchorsFile.anchors[0] as CarLocalityRoadAnchor],
    [anchorsFile.anchors[0] as CarLocalityRoadAnchor],
  );
  console.log('OSRM Table service preflight: OK');
  console.log(
    'Graph identity note: OSRM HTTP does not expose graph provenance; local CH files and anchor metadata identify the expected graph.',
  );

  if (
    !values.restart &&
    (await recoverCompletedPromotion(
      identity,
      anchorsFile,
      anchorsSha256,
      client,
    ))
  ) {
    return;
  }

  const [partialSizeBefore, checkpointSizeBefore] = await Promise.all([
    regularFileSize(PARTIAL_MATRIX_PATH),
    regularFileSize(CHECKPOINT_PATH),
  ]);
  if (
    !values.restart &&
    partialSizeBefore === undefined &&
    checkpointSizeBefore === undefined
  ) {
    const completed = await loadExistingCompletedMatrix(
      anchorsFile,
      anchorsSha256,
    );
    if (completed !== undefined) {
      console.log('A complete matrix already exists and passed strict validation.');
      const routeValidation = await validateIndependentRoutes(
        completed,
        anchorsFile.anchors,
        anchorsSha256,
        client,
      );
      console.log(
        `Independent Route validation: ${routeValidation.exactMatches}/${routeValidation.sampleSize} exact, ${routeValidation.mismatches} mismatches (${routeValidation.noRouteMatches} NoRoute matches, ${routeValidation.retriedAttempts} retries).`,
      );
      console.log('Use --restart to intentionally regenerate every block.');
      return;
    }
  }

  let checkpoint = await initializeOrResume(identity, values.restart);
  const sourceStartForThisRun = checkpoint.nextSourceIndex;
  const generationStartedAt = performance.now();
  const requestStatistics: RequestStatistics = {
    totalAttempts: 0,
    successfulRequests: 0,
    retriedAttempts: 0,
  };

  for (
    let sourceStartIndex = checkpoint.nextSourceIndex;
    sourceStartIndex < localityCount;
    sourceStartIndex += BLOCK_SIZE
  ) {
    const sourceEndIndex = Math.min(sourceStartIndex + BLOCK_SIZE, localityCount);
    const sources = anchorsFile.anchors.slice(
      sourceStartIndex,
      sourceEndIndex,
    );
    const slab = createCarTravelTimeRowSlab(sources.length, localityCount);

    await runBoundedTasks(
      destinationBlockCount,
      TABLE_CONCURRENCY,
      async (destinationBlockIndex) => {
        const destinationStartIndex = destinationBlockIndex * BLOCK_SIZE;
        const destinationEndIndex = Math.min(
          destinationStartIndex + BLOCK_SIZE,
          localityCount,
        );
        const destinations = anchorsFile.anchors.slice(
          destinationStartIndex,
          destinationEndIndex,
        );
        const table = await requestTableWithRetry(
          client,
          sources,
          destinations,
          sourceStartIndex,
          destinationStartIndex,
          requestStatistics,
        );
        writeCarDurationBlockToRowSlab(slab, {
          destinationStartIndex,
          destinationCount: destinations.length,
          durationsSeconds: table.durationsSeconds,
        });
      },
    );

    const completedValues = finalizeCarTravelTimeRowSlab(
      slab,
      sourceStartIndex,
    );
    const completedBytes = encodeTravelMinutesLittleEndian(completedValues);
    const expectedOffset =
      sourceStartIndex * localityCount * TRAVEL_TIME_MATRIX_BYTES_PER_CELL;
    await appendCompletedSlab(completedBytes, expectedOffset);

    checkpoint = createCarTravelTimeMatrixCheckpoint(identity, sourceEndIndex);
    await writeUtf8FileAtomically(
      CHECKPOINT_PATH,
      serializeCarTravelTimeMatrixCheckpoint(checkpoint),
    );

    const elapsedSeconds = (performance.now() - generationStartedAt) / 1_000;
    const generatedCells =
      (sourceEndIndex - sourceStartForThisRun) * localityCount;
    const cellsPerSecond = generatedCells / elapsedSeconds;
    const remainingCells = (localityCount - sourceEndIndex) * localityCount;
    console.log(
      `Rows ${sourceStartIndex + 1}–${sourceEndIndex} / ${localityCount}`,
    );
    console.log(
      `  Cells completed: ${formatInteger(sourceEndIndex * localityCount)} / ${formatInteger(cellCount)}`,
    );
    console.log(
      `  Table requests: ${formatInteger(requestStatistics.successfulRequests)} successful, ${formatInteger(requestStatistics.retriedAttempts)} retries`,
    );
    console.log(
      `  Elapsed: ${formatSeconds(elapsedSeconds)}; ${formatInteger(Math.round(cellsPerSecond))} cells/sec; estimated remaining ${formatSeconds(remainingCells / cellsPerSecond)}`,
    );
  }
  const tableGenerationElapsedSeconds =
    (performance.now() - generationStartedAt) / 1_000;

  const finalPartialSize = await regularFileSize(PARTIAL_MATRIX_PATH);
  if (finalPartialSize !== expectedByteLength) {
    throw new Error(
      `Completed partial matrix has ${finalPartialSize ?? 'no'} bytes; expected ${expectedByteLength}.`,
    );
  }
  if (checkpoint.nextSourceIndex !== localityCount) {
    throw new Error(
      `All blocks returned but checkpoint ends at ${checkpoint.nextSourceIndex}, not ${localityCount}.`,
    );
  }

  const matrixBytes = await readFile(PARTIAL_MATRIX_PATH);
  const manifest = createCarTravelTimeMatrixManifest({
    anchorsFile,
    anchorsSha256,
    matrixBytes,
  });
  const loaded = loadCarTravelTimeMatrix(manifest, matrixBytes, {
    anchorsFile,
    anchorsSha256,
  });
  console.log('Validating a deterministic 100-pair sample with OSRM Route...');
  const routeValidation = await validateIndependentRoutes(
    loaded,
    anchorsFile.anchors,
    anchorsSha256,
    client,
  );

  const manifestJson = serializeCarTravelTimeMatrixManifest(manifest);
  await writeUtf8FileAtomically(STAGED_MANIFEST_PATH, manifestJson);
  await rename(PARTIAL_MATRIX_PATH, MATRIX_PATH);
  await rename(STAGED_MANIFEST_PATH, MANIFEST_PATH);

  const [readBackMatrix, readBackManifestJson] = await Promise.all([
    readFile(MATRIX_PATH),
    readFile(MANIFEST_PATH, 'utf8'),
  ]);
  const readBackManifest = parseCarTravelTimeMatrixManifestJson(
    readBackManifestJson,
    MANIFEST_PATH,
  );
  loadCarTravelTimeMatrix(readBackManifest, readBackMatrix, {
    anchorsFile,
    anchorsSha256,
  });
  await unlink(CHECKPOINT_PATH);

  const generatedCells =
    (localityCount - sourceStartForThisRun) * localityCount;
  const cellsPerSecond =
    tableGenerationElapsedSeconds === 0
      ? 0
      : generatedCells / tableGenerationElapsedSeconds;
  console.log('');
  console.log('Matrix generation complete:');
  console.log(`  Block size: ${BLOCK_SIZE} × ${BLOCK_SIZE}`);
  console.log(`  HTTP concurrency: ${TABLE_CONCURRENCY}`);
  console.log(
    `  Logical Table blocks represented by matrix: ${formatInteger(expectedLogicalRequests)}`,
  );
  console.log(
    `  Table HTTP attempts this invocation: ${formatInteger(requestStatistics.totalAttempts)}`,
  );
  console.log(
    `  Successful Table requests this invocation: ${formatInteger(requestStatistics.successfulRequests)}`,
  );
  console.log(
    `  Retried Table attempts this invocation: ${formatInteger(requestStatistics.retriedAttempts)}`,
  );
  console.log(`  Total cells: ${formatInteger(cellCount)}`);
  console.log(
    `  Table generation elapsed this invocation: ${formatSeconds(tableGenerationElapsedSeconds)}`,
  );
  console.log(
    `  Average this invocation: ${formatInteger(Math.round(cellsPerSecond))} cells/sec`,
  );
  console.log(
    `  Route validation: ${routeValidation.exactMatches}/${routeValidation.sampleSize} exact, ${routeValidation.mismatches} mismatches (${routeValidation.noRouteMatches} NoRoute matches, ${routeValidation.retriedAttempts} retries)`,
  );
  console.log(
    `  Binary: ${formatInteger(readBackMatrix.byteLength)} bytes, SHA-256 ${readBackManifest.matrixSha256}`,
  );
  console.log(
    `  Manifest: ${formatInteger(Buffer.byteLength(readBackManifestJson))} bytes, SHA-256 ${sha256Bytes(Buffer.from(readBackManifestJson))}`,
  );
  console.log(
    `  Total command elapsed: ${formatSeconds((performance.now() - startedAt) / 1_000)}`,
  );
}

try {
  await main();
} catch (error) {
  console.error(errorMessage(error));
  process.exitCode = 1;
}
