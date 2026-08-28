import { promisify } from 'node:util';
import {
  brotliCompress,
  brotliDecompress,
  constants,
  gunzip,
  gzip,
} from 'node:zlib';

import type { LocalityId } from '@jm/commute';
import { loadCommuteRuntime } from '@jm/commute/node';

import type { CommuteMode } from '../../apps/commute-api/src/api-types.js';
import { isMainModule } from '../commute/main-module.js';
import {
  COMMUTE_API_SERVER_TIMING_STAGES,
  parseCommuteApiServerTiming,
  postApiReachability,
  startCommuteApi,
  type CommuteApiServerTimingStage,
  type HttpJsonResult,
} from './api-harness.js';

const ORIGIN_LOCALITY_ID: LocalityId = '8001:zurich';
const MODES = ['car', 'transit'] as const satisfies readonly CommuteMode[];
const THRESHOLDS = [90, 120] as const;
const WARMUP_ITERATIONS = 10;
const MEASURED_ITERATIONS = 30;
const BROTLI_QUALITY = 6;

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const brotliCompressAsync = promisify(brotliCompress);
const brotliDecompressAsync = promisify(brotliDecompress);

export interface TimingSummary {
  readonly samples: number;
  readonly minimumMilliseconds: number;
  readonly medianMilliseconds: number;
  readonly meanMilliseconds: number;
  readonly p95Milliseconds: number;
  readonly maximumMilliseconds: number;
}

export interface CommuteApiEndpointBenchmark {
  readonly mode: CommuteMode;
  readonly maxTravelMinutes: number;
  readonly reachableLocalityCount: number;
  readonly hexagonCount: number;
  readonly responseByteLength: number;
  readonly httpTimings: TimingSummary;
  readonly serverTimings: Readonly<
    Record<CommuteApiServerTimingStage, TimingSummary>
  >;
}

export interface CompressionMeasurement {
  readonly rawByteLength: number;
  readonly gzipByteLength: number;
  readonly brotliByteLength: number;
  readonly gzipCompressionMilliseconds: number;
  readonly gzipDecompressionMilliseconds: number;
  readonly brotliCompressionMilliseconds: number;
  readonly brotliDecompressionMilliseconds: number;
}

export interface CommuteApiBenchmark {
  readonly warmupIterations: number;
  readonly measuredIterations: number;
  readonly endpointBenchmarks: readonly CommuteApiEndpointBenchmark[];
  readonly compressionAt120Minutes: Readonly<
    Record<CommuteMode, CompressionMeasurement>
  >;
}

function percentile(sorted: readonly number[], fraction: number): number {
  const index = Math.min(
    sorted.length - 1,
    Math.floor(sorted.length * fraction),
  );
  return sorted[index] as number;
}

function summarize(samples: readonly number[]): TimingSummary {
  if (samples.length === 0) {
    throw new Error('Cannot summarize an empty benchmark sample.');
  }
  const sorted = samples.toSorted((left, right) => left - right);
  return {
    samples: sorted.length,
    minimumMilliseconds: sorted[0] as number,
    medianMilliseconds: percentile(sorted, 0.5),
    meanMilliseconds:
      sorted.reduce((total, sample) => total + sample, 0) / sorted.length,
    p95Milliseconds: percentile(sorted, 0.95),
    maximumMilliseconds: sorted.at(-1) as number,
  };
}

function createServerTimingSamples(): Record<
  CommuteApiServerTimingStage,
  number[]
> {
  return {
    lookup: [],
    join: [],
    hex: [],
    geojson: [],
    serialization: [],
    total: [],
  };
}

function summarizeServerTimings(
  samples: Readonly<Record<CommuteApiServerTimingStage, readonly number[]>>,
): Readonly<Record<CommuteApiServerTimingStage, TimingSummary>> {
  return {
    lookup: summarize(samples.lookup),
    join: summarize(samples.join),
    hex: summarize(samples.hex),
    geojson: summarize(samples.geojson),
    serialization: summarize(samples.serialization),
    total: summarize(samples.total),
  };
}

function bufferView(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

async function measureCompression(
  bytes: Uint8Array,
): Promise<CompressionMeasurement> {
  const input = bufferView(bytes);

  const gzipStartedAt = performance.now();
  const gzipBytes = await gzipAsync(input, { level: 6 });
  const gzipCompressionMilliseconds = performance.now() - gzipStartedAt;
  const gunzipStartedAt = performance.now();
  const gunzipped = await gunzipAsync(gzipBytes);
  const gzipDecompressionMilliseconds = performance.now() - gunzipStartedAt;
  if (!gunzipped.equals(input)) {
    throw new Error('Gzip did not reproduce the API response bytes.');
  }

  const brotliStartedAt = performance.now();
  const brotliBytes = await brotliCompressAsync(input, {
    params: { [constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY },
  });
  const brotliCompressionMilliseconds = performance.now() - brotliStartedAt;
  const brotliDecompressionStartedAt = performance.now();
  const decompressedBrotli = await brotliDecompressAsync(brotliBytes);
  const brotliDecompressionMilliseconds =
    performance.now() - brotliDecompressionStartedAt;
  if (!decompressedBrotli.equals(input)) {
    throw new Error('Brotli did not reproduce the API response bytes.');
  }

  return {
    rawByteLength: input.byteLength,
    gzipByteLength: gzipBytes.byteLength,
    brotliByteLength: brotliBytes.byteLength,
    gzipCompressionMilliseconds,
    gzipDecompressionMilliseconds,
    brotliCompressionMilliseconds,
    brotliDecompressionMilliseconds,
  };
}

export async function benchmarkCommuteApi(): Promise<CommuteApiBenchmark> {
  const runtime = await loadCommuteRuntime();
  const api = await startCommuteApi(runtime);
  const representativeResponses = new Map<
    CommuteMode,
    HttpJsonResult<unknown>
  >();
  try {
    const endpointBenchmarks: CommuteApiEndpointBenchmark[] = [];
    for (const mode of MODES) {
      for (const maxTravelMinutes of THRESHOLDS) {
        const expectedReachableCount = runtime[mode].getReachableLocalities(
          ORIGIN_LOCALITY_ID,
          maxTravelMinutes,
        ).length;
        const request = {
          originLocalityId: ORIGIN_LOCALITY_ID,
          mode,
          maxTravelMinutes,
        } as const;
        for (
          let iteration = 0;
          iteration < WARMUP_ITERATIONS;
          iteration += 1
        ) {
          await postApiReachability(api.baseUrl, request);
        }

        const samples: number[] = [];
        const serverTimingSamples = createServerTimingSamples();
        let representative:
          Awaited<ReturnType<typeof postApiReachability>> | undefined;
        for (
          let iteration = 0;
          iteration < MEASURED_ITERATIONS;
          iteration += 1
        ) {
          const result = await postApiReachability(api.baseUrl, request);
          if (result.value.reachableLocalityCount !== expectedReachableCount) {
            throw new Error(
              `${mode} ${maxTravelMinutes}-minute HTTP result returned ` +
                `${result.value.reachableLocalityCount} reachable localities; ` +
                `direct runtime returned ${expectedReachableCount}.`,
            );
          }
          if (
            representative !== undefined &&
            result.bytes.byteLength !== representative.bytes.byteLength
          ) {
            throw new Error(
              `${mode} ${maxTravelMinutes}-minute response byte length changed ` +
                `during the benchmark.`,
            );
          }
          representative = result;
          samples.push(result.elapsedMilliseconds);
          const serverTimings = parseCommuteApiServerTiming(result.headers);
          for (const stage of COMMUTE_API_SERVER_TIMING_STAGES) {
            serverTimingSamples[stage].push(serverTimings[stage]);
          }
        }
        if (representative === undefined) {
          throw new Error('Benchmark did not capture a representative response.');
        }
        endpointBenchmarks.push({
          mode,
          maxTravelMinutes,
          reachableLocalityCount:
            representative.value.reachableLocalityCount,
          hexagonCount: representative.value.hexagonCount,
          responseByteLength: representative.bytes.byteLength,
          httpTimings: summarize(samples),
          serverTimings: summarizeServerTimings(serverTimingSamples),
        });
        if (maxTravelMinutes === 120) {
          representativeResponses.set(mode, representative);
        }
      }
    }

    const carResponse = representativeResponses.get('car');
    const transitResponse = representativeResponses.get('transit');
    if (carResponse === undefined || transitResponse === undefined) {
      throw new Error('Benchmark is missing a 120-minute response.');
    }
    const carCompression = await measureCompression(carResponse.bytes);
    const transitCompression = await measureCompression(transitResponse.bytes);
    return {
      warmupIterations: WARMUP_ITERATIONS,
      measuredIterations: MEASURED_ITERATIONS,
      endpointBenchmarks,
      compressionAt120Minutes: {
        car: carCompression,
        transit: transitCompression,
      },
    };
  } finally {
    await api.close();
  }
}

function formatBytes(bytes: number): string {
  return new Intl.NumberFormat('en-US').format(bytes);
}

function formatTiming(summary: TimingSummary): string {
  return [
    `min ${summary.minimumMilliseconds.toFixed(2)}`,
    `median ${summary.medianMilliseconds.toFixed(2)}`,
    `mean ${summary.meanMilliseconds.toFixed(2)}`,
    `p95 ${summary.p95Milliseconds.toFixed(2)}`,
    `max ${summary.maximumMilliseconds.toFixed(2)}`,
  ].join(', ');
}

function printCompression(mode: CommuteMode, value: CompressionMeasurement): void {
  console.log(`${mode} 120-minute response:`);
  console.log(`  raw: ${formatBytes(value.rawByteLength)} bytes`);
  console.log(
    `  gzip: ${formatBytes(value.gzipByteLength)} bytes ` +
      `(${(value.gzipByteLength / value.rawByteLength * 100).toFixed(2)}%), ` +
      `compress ${value.gzipCompressionMilliseconds.toFixed(2)} ms, ` +
      `decompress ${value.gzipDecompressionMilliseconds.toFixed(2)} ms`,
  );
  console.log(
    `  Brotli q${BROTLI_QUALITY}: ` +
      `${formatBytes(value.brotliByteLength)} bytes ` +
      `(${(value.brotliByteLength / value.rawByteLength * 100).toFixed(2)}%), ` +
      `compress ${value.brotliCompressionMilliseconds.toFixed(2)} ms, ` +
      `decompress ${value.brotliDecompressionMilliseconds.toFixed(2)} ms`,
  );
}

function printBenchmark(result: CommuteApiBenchmark): void {
  console.log(
    `Commute API loopback benchmark (${result.warmupIterations} warmup, ` +
      `${result.measuredIterations} measured requests per case):`,
  );
  for (const benchmark of result.endpointBenchmarks) {
    console.log('');
    console.log(
      `${benchmark.mode} Zürich ${benchmark.maxTravelMinutes} minutes: ` +
        `${formatBytes(benchmark.reachableLocalityCount)} localities, ` +
        `${formatBytes(benchmark.hexagonCount)} hexes, ` +
        `${formatBytes(benchmark.responseByteLength)} response bytes`,
    );
    console.log(`  End-to-end HTTP ms: ${formatTiming(benchmark.httpTimings)}`);
    console.log('  Server stages ms:');
    for (const stage of COMMUTE_API_SERVER_TIMING_STAGES) {
      console.log(
        `    ${stage.padEnd(13)} ${formatTiming(benchmark.serverTimings[stage])}`,
      );
    }
  }
  console.log('');
  console.log('Actual JSON response compression:');
  printCompression('car', result.compressionAt120Minutes.car);
  printCompression('transit', result.compressionAt120Minutes.transit);
}

if (isMainModule(import.meta.url)) {
  benchmarkCommuteApi()
    .then(printBenchmark)
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
