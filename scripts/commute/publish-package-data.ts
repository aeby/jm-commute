import { formatBytes, formatMilliseconds } from './format';
import { isMainModule } from './main-module';
import { publishCommutePackageData } from './package-data';

async function main(): Promise<void> {
  const result = await publishCommutePackageData();
  console.log('Published authenticated runtime assets into @jm/commute.');
  console.log(`  Source: ${result.sourceDirectory}`);
  console.log(`  Package: ${result.packageDirectory}`);
  console.log(`  Localities: ${result.localityCount}`);
  console.log(
    `  Catalog: ${formatBytes(result.localityCatalog.byteLength)}, ` +
      `SHA-256 ${result.localityCatalog.sha256}`,
  );
  console.log(
    `  Ordered locality SHA-256: ${result.localityCatalog.orderedLocalitySha256}`,
  );
  console.log('  Source/package byte identity: verified');
  for (const artifact of result.artifacts) {
    console.log('');
    console.log(`${artifact.mode.toUpperCase()}:`);
    console.log(
      `  Manifest: ${formatBytes(artifact.manifestByteLength)}, ` +
        `SHA-256 ${artifact.manifestSha256}`,
    );
    console.log(
      `  Matrix: ${formatBytes(artifact.matrixByteLength)}, ` +
        `SHA-256 ${artifact.matrixSha256}`,
    );
    console.log('  Source/package byte identity: verified');
  }
  console.log('');
  console.log('Timings:');
  console.log(
    `  Catalog build/readback: ${formatMilliseconds(result.localityCatalogBuildMilliseconds)}`,
  );
  console.log(
    `  Stage/authenticate: ${formatMilliseconds(result.stagingAndAuthenticationMilliseconds)}`,
  );
  console.log(
    `  Promote/readback: ${formatMilliseconds(result.promotionAndReadbackMilliseconds)}`,
  );
  console.log(`  Total: ${formatMilliseconds(result.totalMilliseconds)}`);
  console.log('');
  console.log(
    `Official locality source SHA-256: ${result.localitySourceCsvSha256}`,
  );
  console.log(`Official locality source: ${result.localitySourceCsvPath}`);
}

if (isMainModule(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
