import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  brotliCompress,
  brotliDecompress,
  constants,
  gunzip,
  gzip,
} from 'node:zlib';

import { formatBytes, formatMilliseconds, formatRatio } from './format';
import { isMainModule } from './main-module';
import { verifyPublishedPackageData } from './package-data';
import { COMMUTE_PACKAGE_DATA_DIRECTORY } from './paths';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const brotliCompressAsync = promisify(brotliCompress);
const brotliDecompressAsync = promisify(brotliDecompress);

export interface CompressionMeasurement {
  readonly rawBytes: number;
  readonly compressedBytes: number;
  readonly compressionMilliseconds: number;
  readonly decompressionMilliseconds: number;
}

export interface CompressionBenchmarkRow {
  readonly label: string;
  readonly rawBytes: number;
  readonly gzip: CompressionMeasurement;
  readonly brotli: CompressionMeasurement;
}

async function measureCodec(
  input: Buffer,
  compress: () => Promise<Buffer>,
  decompress: (compressed: Buffer) => Promise<Buffer>,
  label: string,
): Promise<CompressionMeasurement> {
  const compressionStartedAt = performance.now();
  const compressed = await compress();
  const compressionMilliseconds = performance.now() - compressionStartedAt;
  const decompressionStartedAt = performance.now();
  const decompressed = await decompress(compressed);
  const decompressionMilliseconds = performance.now() - decompressionStartedAt;
  if (!decompressed.equals(input)) {
    throw new Error(`${label} decompression did not reproduce the input bytes.`);
  }
  return {
    rawBytes: input.byteLength,
    compressedBytes: compressed.byteLength,
    compressionMilliseconds,
    decompressionMilliseconds,
  };
}

async function benchmarkPayload(
  label: string,
  bytes: Buffer,
): Promise<CompressionBenchmarkRow> {
  const gzipMeasurement = await measureCodec(
    bytes,
    async () => await gzipAsync(bytes, { level: 6 }),
    async (compressed) => await gunzipAsync(compressed),
    `${label} gzip`,
  );
  const brotliMeasurement = await measureCodec(
    bytes,
    async () => await brotliCompressAsync(bytes, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: 6,
      },
    }),
    async (compressed) => await brotliDecompressAsync(compressed),
    `${label} Brotli`,
  );
  return {
    label,
    rawBytes: bytes.byteLength,
    gzip: gzipMeasurement,
    brotli: brotliMeasurement,
  };
}

export async function benchmarkPackageDataCompression(): Promise<
  readonly CompressionBenchmarkRow[]
> {
  await verifyPublishedPackageData();
  const [car, transit] = await Promise.all([
    readFile(resolve(COMMUTE_PACKAGE_DATA_DIRECTORY, 'car/travel-times.bin')),
    readFile(
      resolve(COMMUTE_PACKAGE_DATA_DIRECTORY, 'transit/travel-times.bin'),
    ),
  ]);
  const combined = Buffer.concat([car, transit]);
  const rows: CompressionBenchmarkRow[] = [];
  for (const [label, bytes] of [
    ['Car matrix', car],
    ['Transit matrix', transit],
    ['Combined matrices', combined],
  ] as const) {
    rows.push(await benchmarkPayload(label, bytes));
  }
  return rows;
}

function printMeasurement(
  codec: string,
  measurement: CompressionMeasurement,
): void {
  console.log(
    `  ${codec}: ${formatBytes(measurement.compressedBytes)} ` +
      `(${formatRatio(measurement.compressedBytes, measurement.rawBytes)})`,
  );
  console.log(
    `    compress ${formatMilliseconds(measurement.compressionMilliseconds)}, ` +
      `decompress ${formatMilliseconds(measurement.decompressionMilliseconds)}`,
  );
}

async function main(): Promise<void> {
  console.log('Compression experiment (canonical package assets remain raw):');
  console.log('  gzip level: 6');
  console.log('  Brotli quality: 6');
  for (const row of await benchmarkPackageDataCompression()) {
    console.log('');
    console.log(`${row.label}: ${formatBytes(row.rawBytes)} raw`);
    printMeasurement('gzip', row.gzip);
    printMeasurement('Brotli', row.brotli);
  }
}

if (isMainModule(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
