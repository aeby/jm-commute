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

async function main(): Promise<void> {
  const result = await publishRuntimeCarData({
    sourceManifestPath: resolve(SOURCE_DIRECTORY, 'manifest.json'),
    sourceMatrixPath: resolve(SOURCE_DIRECTORY, 'travel-times.bin'),
    outputManifestPath: resolve(OUTPUT_DIRECTORY, 'manifest.json'),
    outputMatrixPath: resolve(OUTPUT_DIRECTORY, 'travel-times.bin'),
  });

  console.log('Published authenticated car runtime data.');
  console.log(`Localities: ${formatInteger(result.localityCount)}`);
  console.log('');
  console.log('Manifest:');
  console.log(`  Source: ${result.manifest.sourcePath}`);
  console.log(`  Output: ${result.manifest.outputPath}`);
  console.log(`  Size: ${formatInteger(result.manifest.byteLength)} bytes`);
  console.log(`  SHA-256: ${result.manifest.sha256}`);
  console.log('');
  console.log('Matrix:');
  console.log(`  Source: ${result.matrix.sourcePath}`);
  console.log(`  Output: ${result.matrix.outputPath}`);
  console.log(`  Size: ${formatInteger(result.matrix.byteLength)} bytes`);
  console.log(`  SHA-256: ${result.matrix.sha256}`);
  console.log(
    `Combined size: ${formatInteger(result.manifest.byteLength + result.matrix.byteLength)} bytes`,
  );
  console.log('');
  console.log('Timings:');
  console.log(
    `  Source read and validation: ${formatMilliseconds(result.timings.sourceReadAndValidationMilliseconds)}`,
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
