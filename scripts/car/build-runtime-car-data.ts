import { resolve } from 'node:path';

import { publishRuntimeCarData } from './runtime-car-data';

const PROJECT_ROOT = resolve(import.meta.dirname, '..', '..');
const SOURCE_DIRECTORY = resolve(
  PROJECT_ROOT,
  'data/processed/car/travel-time-matrix',
);
const OUTPUT_DIRECTORY = resolve(PROJECT_ROOT, 'data/runtime/car');

function formatInteger(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatMilliseconds(milliseconds: number): string {
  return `${milliseconds.toFixed(1)} ms`;
}

function formatPercent(value: number, total: number): string {
  return `${((value / total) * 100).toFixed(3)}%`;
}

function printCellStatistic(
  label: string,
  value: number,
  total: number,
): void {
  console.log(
    `  ${label}: ${formatInteger(value)} (${formatPercent(value, total)})`,
  );
}

async function main(): Promise<void> {
  const result = await publishRuntimeCarData({
    sourceManifestPath: resolve(SOURCE_DIRECTORY, 'manifest.json'),
    sourceMatrixPath: resolve(SOURCE_DIRECTORY, 'travel-times.bin'),
    outputManifestPath: resolve(OUTPUT_DIRECTORY, 'manifest.json'),
    outputMatrixPath: resolve(OUTPUT_DIRECTORY, 'travel-times.bin'),
  });

  console.log('Published authenticated UInt8 car runtime data.');
  console.log(`Localities: ${formatInteger(result.localityCount)}`);
  console.log('');
  console.log('Trusted UInt16 source:');
  console.log(`  Manifest: ${result.sourceManifest.path}`);
  console.log(`  Manifest SHA-256: ${result.sourceManifest.sha256}`);
  console.log(`  Matrix: ${result.sourceMatrix.path}`);
  console.log(`  Matrix size: ${formatInteger(result.sourceMatrix.byteLength)} bytes`);
  console.log(`  Matrix SHA-256: ${result.sourceMatrix.sha256}`);
  console.log('');
  console.log('Manifest:');
  console.log(`  Output: ${result.manifest.path}`);
  console.log(`  Size: ${formatInteger(result.manifest.byteLength)} bytes`);
  console.log(`  SHA-256: ${result.manifest.sha256}`);
  console.log('');
  console.log('UInt8 runtime matrix:');
  console.log(`  Output: ${result.matrix.path}`);
  console.log(`  Size: ${formatInteger(result.matrix.byteLength)} bytes`);
  console.log(`  SHA-256: ${result.matrix.sha256}`);
  const savedBytes = result.sourceMatrix.byteLength - result.matrix.byteLength;
  console.log(
    `  Bytes saved: ${formatInteger(savedBytes)} ` +
      `(${formatPercent(savedBytes, result.sourceMatrix.byteLength)})`,
  );
  console.log(
    `Combined size: ${formatInteger(result.manifest.byteLength + result.matrix.byteLength)} bytes`,
  );
  console.log('');
  console.log('Conversion statistics:');
  const { statistics } = result;
  console.log(`  Total cells: ${formatInteger(statistics.totalCells)}`);
  printCellStatistic(
    'Retained 0–120 min',
    statistics.cellsRetainedZeroTo120,
    statistics.totalCells,
  );
  printCellStatistic(
    'Retained 121–240 min',
    statistics.cellsRetained121To240,
    statistics.totalCells,
  );
  printCellStatistic(
    'Converted from >240 min to 255',
    statistics.cellsConvertedAbove240,
    statistics.totalCells,
  );
  printCellStatistic(
    'Converted from source 65535 to 255',
    statistics.cellsConvertedFromSourceUnavailable,
    statistics.totalCells,
  );
  printCellStatistic(
    'Zero-minute cells',
    statistics.zeroMinuteCells,
    statistics.totalCells,
  );
  printCellStatistic(
    'Exactly 120-minute cells',
    statistics.exact120MinuteCells,
    statistics.totalCells,
  );
  printCellStatistic(
    'Exactly 240-minute cells',
    statistics.exact240MinuteCells,
    statistics.totalCells,
  );
  printCellStatistic(
    'Runtime 255 cells',
    statistics.unavailableCells,
    statistics.totalCells,
  );
  console.log('');
  console.log('Timings:');
  console.log(
    `  Source read, conversion, and validation: ${formatMilliseconds(result.timings.sourceReadConversionAndValidationMilliseconds)}`,
  );
  console.log(
    `  Staging and validation: ${formatMilliseconds(result.timings.stagingAndValidationMilliseconds)}`,
  );
  console.log(
    `  Promotion and final readback: ${formatMilliseconds(result.timings.promotionAndReadbackMilliseconds)}`,
  );
  console.log(
    `  Total: ${formatMilliseconds(result.timings.totalMilliseconds)}`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
