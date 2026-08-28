import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import {
  brotliCompress,
  brotliDecompress,
  constants,
  gunzip,
  gzip,
} from 'node:zlib';

import {
  COMMUTE_MATRIX_MAX_TRAVEL_MINUTES,
  type LocalityId,
} from '@jm/commute';
import { loadCommuteRuntime } from '@jm/commute/node';

import type {
  CommuteMode,
  ReachabilityResponse,
} from '../../apps/commute-api/src/api-types.js';
import { isMainModule } from '../commute/main-module.js';
import {
  postApiReachability,
  startCommuteApi,
} from '../commute-api/api-harness.js';

export const VIEWER_PAYLOAD_MAX_TRAVEL_MINUTES = 240 as const;
export const VIEWER_PAYLOAD_BROTLI_QUALITY = 6 as const;

export const VIEWER_PAYLOAD_BENCHMARK_ORIGINS = Object.freeze([
  Object.freeze({
    localityId: '8001:zurich' as LocalityId,
    label: 'Zürich',
  }),
  Object.freeze({
    localityId: '3011:bern' as LocalityId,
    label: 'Bern',
  }),
]);

const VIEWER_PAYLOAD_BENCHMARK_MODES = Object.freeze([
  'car',
  'transit',
] as const satisfies readonly CommuteMode[]);

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const brotliCompressAsync = promisify(brotliCompress);
const brotliDecompressAsync = promisify(brotliDecompress);

export interface ViewerPayloadCompressionMeasurement {
  readonly rawByteLength: number;
  readonly rawSha256: string;
  readonly gzipByteLength: number;
  readonly gzipCompressionMilliseconds: number;
  readonly gzipDecompressionMilliseconds: number;
  readonly brotliByteLength: number;
  readonly brotliCompressionMilliseconds: number;
  readonly brotliDecompressionMilliseconds: number;
}

export interface ViewerPayloadBenchmarkCase {
  readonly originLocalityId: LocalityId;
  readonly originLabel: string;
  readonly mode: CommuteMode;
  readonly maxTravelMinutes: typeof VIEWER_PAYLOAD_MAX_TRAVEL_MINUTES;
  readonly reachableLocalityCount: number;
  readonly hexagonCount: number;
  readonly requestMilliseconds: number;
  readonly compression: ViewerPayloadCompressionMeasurement;
}

export interface ViewerPayloadBenchmarkResult {
  readonly cases: readonly ViewerPayloadBenchmarkCase[];
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function bufferView(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export function authenticateDecompressedBytes(
  encoding: 'gzip' | 'Brotli',
  source: Uint8Array,
  decompressed: Uint8Array,
): void {
  const sourceBuffer = bufferView(source);
  const decompressedBuffer = bufferView(decompressed);
  if (!decompressedBuffer.equals(sourceBuffer)) {
    throw new Error(
      `${encoding} decompression did not reproduce the exact API response bytes.`,
    );
  }
}

export async function measureViewerPayloadCompression(
  bytes: Uint8Array,
): Promise<ViewerPayloadCompressionMeasurement> {
  const input = bufferView(bytes);

  const gzipStartedAt = performance.now();
  const gzipBytes = await gzipAsync(input, { level: 6 });
  const gzipCompressionMilliseconds = performance.now() - gzipStartedAt;
  const gunzipStartedAt = performance.now();
  const gunzipped = await gunzipAsync(gzipBytes);
  authenticateDecompressedBytes('gzip', input, gunzipped);
  const gzipDecompressionMilliseconds = performance.now() - gunzipStartedAt;

  const brotliStartedAt = performance.now();
  const brotliBytes = await brotliCompressAsync(input, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: VIEWER_PAYLOAD_BROTLI_QUALITY,
    },
  });
  const brotliCompressionMilliseconds = performance.now() - brotliStartedAt;
  const brotliDecompressionStartedAt = performance.now();
  const decompressedBrotli = await brotliDecompressAsync(brotliBytes);
  authenticateDecompressedBytes('Brotli', input, decompressedBrotli);
  const brotliDecompressionMilliseconds =
    performance.now() - brotliDecompressionStartedAt;

  return {
    rawByteLength: input.byteLength,
    rawSha256: sha256(input),
    gzipByteLength: gzipBytes.byteLength,
    gzipCompressionMilliseconds,
    gzipDecompressionMilliseconds,
    brotliByteLength: brotliBytes.byteLength,
    brotliCompressionMilliseconds,
    brotliDecompressionMilliseconds,
  };
}

export function assertViewerPayloadResponse(
  response: ReachabilityResponse,
  expected: {
    readonly originLocalityId: LocalityId;
    readonly mode: CommuteMode;
    readonly reachableLocalityCount: number;
  },
): void {
  if (response.origin.localityId !== expected.originLocalityId) {
    throw new Error(
      `Viewer payload returned origin ${response.origin.localityId}; ` +
        `expected ${expected.originLocalityId}.`,
    );
  }
  if (response.mode !== expected.mode) {
    throw new Error(
      `Viewer payload returned mode ${response.mode}; expected ${expected.mode}.`,
    );
  }
  if (response.maxTravelMinutes !== VIEWER_PAYLOAD_MAX_TRAVEL_MINUTES) {
    throw new Error(
      `Viewer payload returned ${response.maxTravelMinutes} minutes; ` +
        `expected exactly ${VIEWER_PAYLOAD_MAX_TRAVEL_MINUTES}.`,
    );
  }
  if (response.reachableLocalityCount !== expected.reachableLocalityCount) {
    throw new Error(
      `Viewer payload returned ${response.reachableLocalityCount} reachable ` +
        `localities; direct runtime returned ` +
        `${expected.reachableLocalityCount}.`,
    );
  }
  if (response.hexagonCount !== response.geojson.features.length) {
    throw new Error(
      `Viewer payload declared ${response.hexagonCount} hexagons but returned ` +
        `${response.geojson.features.length} GeoJSON features.`,
    );
  }
}

export async function benchmarkViewerPayloads(): Promise<ViewerPayloadBenchmarkResult> {
  if (
    COMMUTE_MATRIX_MAX_TRAVEL_MINUTES !==
    VIEWER_PAYLOAD_MAX_TRAVEL_MINUTES
  ) {
    throw new Error(
      `Viewer horizon ${VIEWER_PAYLOAD_MAX_TRAVEL_MINUTES} does not match ` +
        `the commute matrix horizon ${COMMUTE_MATRIX_MAX_TRAVEL_MINUTES}.`,
    );
  }

  const runtime = await loadCommuteRuntime();
  const api = await startCommuteApi(runtime);
  try {
    const cases: ViewerPayloadBenchmarkCase[] = [];
    for (const origin of VIEWER_PAYLOAD_BENCHMARK_ORIGINS) {
      for (const mode of VIEWER_PAYLOAD_BENCHMARK_MODES) {
        const expectedReachableLocalityCount =
          runtime[mode].getReachableLocalities(
            origin.localityId,
            VIEWER_PAYLOAD_MAX_TRAVEL_MINUTES,
          ).length;
        const result = await postApiReachability(api.baseUrl, {
          originLocalityId: origin.localityId,
          mode,
          maxTravelMinutes: VIEWER_PAYLOAD_MAX_TRAVEL_MINUTES,
        });
        assertViewerPayloadResponse(result.value, {
          originLocalityId: origin.localityId,
          mode,
          reachableLocalityCount: expectedReachableLocalityCount,
        });
        cases.push({
          originLocalityId: origin.localityId,
          originLabel: origin.label,
          mode,
          maxTravelMinutes: VIEWER_PAYLOAD_MAX_TRAVEL_MINUTES,
          reachableLocalityCount: result.value.reachableLocalityCount,
          hexagonCount: result.value.hexagonCount,
          requestMilliseconds: result.elapsedMilliseconds,
          compression: await measureViewerPayloadCompression(result.bytes),
        });
      }
    }
    return { cases };
  } finally {
    await api.close();
  }
}

const formatBytes = (bytes: number): string =>
  new Intl.NumberFormat('en-US').format(bytes);

function formatCompression(
  label: string,
  byteLength: number,
  rawByteLength: number,
  compressionMilliseconds: number,
  decompressionMilliseconds: number,
): string {
  return (
    `${label}: ${formatBytes(byteLength)} bytes ` +
    `(${(byteLength / rawByteLength * 100).toFixed(2)}%), ` +
    `compress ${compressionMilliseconds.toFixed(2)} ms, ` +
    `decompress+authenticate ${decompressionMilliseconds.toFixed(2)} ms`
  );
}

export function printViewerPayloadBenchmark(
  result: ViewerPayloadBenchmarkResult,
): void {
  console.log(
    `Viewer payload benchmark at exactly ` +
      `${VIEWER_PAYLOAD_MAX_TRAVEL_MINUTES} minutes:`,
  );
  for (const benchmarkCase of result.cases) {
    const compression = benchmarkCase.compression;
    console.log('');
    console.log(
      `${benchmarkCase.originLabel} ${benchmarkCase.mode}: ` +
        `${formatBytes(benchmarkCase.reachableLocalityCount)} localities, ` +
        `${formatBytes(benchmarkCase.hexagonCount)} hexagons`,
    );
    console.log(
      `  HTTP request: ${benchmarkCase.requestMilliseconds.toFixed(2)} ms`,
    );
    console.log(
      `  raw: ${formatBytes(compression.rawByteLength)} bytes, ` +
        `SHA-256 ${compression.rawSha256}`,
    );
    console.log(
      `  ${formatCompression(
        'gzip level 6',
        compression.gzipByteLength,
        compression.rawByteLength,
        compression.gzipCompressionMilliseconds,
        compression.gzipDecompressionMilliseconds,
      )}`,
    );
    console.log(
      `  ${formatCompression(
        `Brotli quality ${VIEWER_PAYLOAD_BROTLI_QUALITY}`,
        compression.brotliByteLength,
        compression.rawByteLength,
        compression.brotliCompressionMilliseconds,
        compression.brotliDecompressionMilliseconds,
      )}`,
    );
  }
}

if (isMainModule(import.meta.url)) {
  benchmarkViewerPayloads()
    .then(printViewerPayloadBenchmark)
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
