import { formatBytes } from './format';
import { isMainModule } from './main-module';
import { assembleRuntimeData } from './package-data';

async function main(): Promise<void> {
  const result = await assembleRuntimeData();
  console.log('Assembled runtime assets for @jobmate/commute.');
  console.log(`  Source: ${result.runtimeDataDirectory}`);
  console.log(`  Package: ${result.packageDataDirectory}`);
  console.log(`  Localities: ${result.localityCount}`);
  console.log(`  Matrix: ${formatBytes(result.matrixByteLength)} per mode`);
}

if (isMainModule(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
