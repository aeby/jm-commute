import { buildCommutePackage } from './build-commute-package';
import { formatBytes, formatMilliseconds } from './format';
import { isMainModule } from './main-module';
import {
  assertExpectedPackageInventory,
  createNpmPackageTarball,
} from './npm-pack';

function requestedOutputDirectory(arguments_: readonly string[]): string | undefined {
  if (arguments_.length === 0) {
    return undefined;
  }
  if (arguments_.length === 2 && arguments_[0] === '--output-directory') {
    return arguments_[1];
  }
  throw new Error(
    'Usage: pack-commute-package.ts [--output-directory <directory>]',
  );
}

async function main(): Promise<void> {
  const build = await buildCommutePackage();
  const packed = await createNpmPackageTarball(
    requestedOutputDirectory(process.argv.slice(2)),
  );
  assertExpectedPackageInventory(packed);

  console.log('Built and packed @jm/commute.');
  console.log(
    `  Build: ${formatMilliseconds(build.elapsedMilliseconds)}, ` +
      `${build.outputFileCount} files, ${formatBytes(build.outputByteLength)}`,
  );
  console.log(`  Tarball: ${packed.tarballPath}`);
  console.log(`  Packed size: ${formatBytes(packed.size)}`);
  console.log(`  Unpacked size: ${formatBytes(packed.unpackedSize)}`);
  console.log(`  npm pack time: ${formatMilliseconds(packed.elapsedMilliseconds)}`);
  console.log(`  SHA-1: ${packed.shasum}`);
  console.log(`  Integrity: ${packed.integrity}`);
}

if (isMainModule(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

