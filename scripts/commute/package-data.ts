import { createHash, randomUUID } from 'node:crypto';
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { createCarTravelTimeIndex } from '../../packages/commute/src/car/travel-time-index.js';
import {
  parseCarTravelTimeManifestJson,
  type CarTravelTimeManifest,
} from '../../packages/commute/src/car/travel-time-manifest.js';
import { createTransitTravelTimeIndex } from '../../packages/commute/src/transit/travel-time-index.js';
import {
  parseTransitTravelTimeManifestJson,
  type TransitTravelTimeManifest,
} from '../../packages/commute/src/transit/travel-time-manifest.js';
import {
  COMMUTE_PACKAGE_DATA_DIRECTORY,
  COMMUTE_PACKAGE_DIRECTORY,
  ROOT_RUNTIME_DATA_DIRECTORY,
} from './paths';
import {
  assertCatalogLocalityOrdering,
  authenticateRuntimeLocalityCatalog,
  buildRuntimeLocalityCatalog,
  type RuntimeLocalityCatalogArtifact,
} from './runtime-locality-catalog';

export type RuntimeMode = 'car' | 'transit';
type RuntimeManifest = CarTravelTimeManifest | TransitTravelTimeManifest;

interface AuthenticatedRuntimeData {
  readonly mode: RuntimeMode;
  readonly directory: string;
  readonly manifest: RuntimeManifest;
  readonly manifestBytes: Buffer;
  readonly manifestSha256: string;
  readonly matrixBytes: Buffer;
  readonly matrixSha256: string;
}

export interface PackageRuntimeDataArtifact {
  readonly mode: RuntimeMode;
  readonly localityCount: number;
  readonly manifestByteLength: number;
  readonly manifestSha256: string;
  readonly matrixByteLength: number;
  readonly matrixSha256: string;
}

export interface PackageDataVerification {
  readonly sourceDirectory: string;
  readonly packageDirectory: string;
  readonly localityCount: number;
  readonly localityCatalog: RuntimeLocalityCatalogArtifact;
  readonly artifacts: readonly PackageRuntimeDataArtifact[];
}

export interface PackageDataPublication extends PackageDataVerification {
  readonly localityCatalogBuildMilliseconds: number;
  readonly localitySourceCsvPath: string;
  readonly localitySourceCsvSha256: string;
  readonly stagingAndAuthenticationMilliseconds: number;
  readonly promotionAndReadbackMilliseconds: number;
  readonly totalMilliseconds: number;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return false;
    }
    throw error;
  }
}

function requireMatrixAuthentication(
  mode: RuntimeMode,
  manifest: RuntimeManifest,
  matrixBytes: Buffer,
  matrixPath: string,
): string {
  const actualSha256 = sha256(matrixBytes);
  if (matrixBytes.byteLength !== manifest.matrix.matrixByteLength) {
    throw new Error(
      `${mode} matrix ${matrixPath} has ${matrixBytes.byteLength} bytes; ` +
        `manifest expects ${manifest.matrix.matrixByteLength}.`,
    );
  }
  if (actualSha256 !== manifest.matrix.matrixSha256) {
    throw new Error(
      `${mode} matrix ${matrixPath} has SHA-256 ${actualSha256}; ` +
        `manifest expects ${manifest.matrix.matrixSha256}.`,
    );
  }
  if (mode === 'car') {
    createCarTravelTimeIndex(manifest, matrixBytes);
  } else {
    createTransitTravelTimeIndex(manifest, matrixBytes);
  }
  return actualSha256;
}

async function authenticateRuntimeData(
  mode: RuntimeMode,
  directory: string,
): Promise<AuthenticatedRuntimeData> {
  const manifestPath = resolve(directory, 'manifest.json');
  const matrixPath = resolve(directory, 'travel-times.bin');
  const [manifestBytes, matrixBytes] = await Promise.all([
    readFile(manifestPath),
    readFile(matrixPath),
  ]);
  const manifestJson = manifestBytes.toString('utf8');
  const manifest = mode === 'car'
    ? parseCarTravelTimeManifestJson(manifestJson, manifestPath)
    : parseTransitTravelTimeManifestJson(manifestJson, manifestPath);
  const matrixSha256 = requireMatrixAuthentication(
    mode,
    manifest,
    matrixBytes,
    matrixPath,
  );
  return {
    mode,
    directory,
    manifest,
    manifestBytes,
    manifestSha256: sha256(manifestBytes),
    matrixBytes,
    matrixSha256,
  };
}

function assertLocalityOrdering(
  car: AuthenticatedRuntimeData,
  transit: AuthenticatedRuntimeData,
): void {
  const carIds = car.manifest.matrix.localityIds;
  const transitIds = transit.manifest.matrix.localityIds;
  if (carIds.length !== transitIds.length) {
    throw new Error(
      `Car has ${carIds.length} locality IDs while transit has ${transitIds.length}.`,
    );
  }
  for (let index = 0; index < carIds.length; index += 1) {
    if (carIds[index] !== transitIds[index]) {
      throw new Error(
        `Car/transit locality ordering differs at index ${index}: ` +
          `${String(carIds[index])} versus ${String(transitIds[index])}.`,
      );
    }
  }
}

function assertByteIdentity(
  source: AuthenticatedRuntimeData,
  published: AuthenticatedRuntimeData,
): void {
  if (!source.manifestBytes.equals(published.manifestBytes)) {
    throw new Error(
      `Published ${source.mode} manifest is not byte-identical to its runtime source.`,
    );
  }
  if (!source.matrixBytes.equals(published.matrixBytes)) {
    throw new Error(
      `Published ${source.mode} matrix is not byte-identical to its runtime source.`,
    );
  }
}

function publicArtifact(
  artifact: AuthenticatedRuntimeData,
): PackageRuntimeDataArtifact {
  return {
    mode: artifact.mode,
    localityCount: artifact.manifest.matrix.localityCount,
    manifestByteLength: artifact.manifestBytes.byteLength,
    manifestSha256: artifact.manifestSha256,
    matrixByteLength: artifact.matrixBytes.byteLength,
    matrixSha256: artifact.matrixSha256,
  };
}

async function authenticatePair(directory: string): Promise<
  readonly [AuthenticatedRuntimeData, AuthenticatedRuntimeData]
> {
  const [car, transit] = await Promise.all([
    authenticateRuntimeData('car', resolve(directory, 'car')),
    authenticateRuntimeData('transit', resolve(directory, 'transit')),
  ]);
  assertLocalityOrdering(car, transit);
  return [car, transit];
}

export async function verifyPackageDataDirectories(
  sourceDirectory: string,
  packageDirectory: string,
): Promise<PackageDataVerification> {
  const [sourcePair, packagePair] = await Promise.all([
    authenticatePair(sourceDirectory),
    authenticatePair(packageDirectory),
  ]);
  for (let index = 0; index < sourcePair.length; index += 1) {
    assertByteIdentity(
      sourcePair[index] as AuthenticatedRuntimeData,
      packagePair[index] as AuthenticatedRuntimeData,
    );
  }
  const orderedLocalityIds = sourcePair[0].manifest.matrix.localityIds;
  const [sourceCatalog, packageCatalog] = await Promise.all([
    authenticateRuntimeLocalityCatalog(
      resolve(sourceDirectory, 'localities.json'),
      orderedLocalityIds,
    ),
    authenticateRuntimeLocalityCatalog(
      resolve(packageDirectory, 'localities.json'),
      orderedLocalityIds,
    ),
  ]);
  if (!sourceCatalog.bytes.equals(packageCatalog.bytes)) {
    throw new Error(
      'Published locality catalog is not byte-identical to its runtime source.',
    );
  }
  return {
    sourceDirectory,
    packageDirectory,
    localityCount: sourcePair[0].manifest.matrix.localityCount,
    localityCatalog: packageCatalog.artifact,
    artifacts: packagePair.map(publicArtifact),
  };
}

export async function verifyPublishedPackageData(): Promise<PackageDataVerification> {
  return await verifyPackageDataDirectories(
    ROOT_RUNTIME_DATA_DIRECTORY,
    COMMUTE_PACKAGE_DATA_DIRECTORY,
  );
}

async function copyRuntimeAssets(stageDirectory: string): Promise<void> {
  await copyFile(
    resolve(ROOT_RUNTIME_DATA_DIRECTORY, 'localities.json'),
    resolve(stageDirectory, 'localities.json'),
  );
  for (const mode of ['car', 'transit'] as const) {
    const source = resolve(ROOT_RUNTIME_DATA_DIRECTORY, mode);
    const target = resolve(stageDirectory, mode);
    await mkdir(target, { recursive: true });
    await Promise.all([
      copyFile(resolve(source, 'manifest.json'), resolve(target, 'manifest.json')),
      copyFile(
        resolve(source, 'travel-times.bin'),
        resolve(target, 'travel-times.bin'),
      ),
      writeFile(resolve(target, '.gitkeep'), ''),
    ]);
  }
}

async function restorePreviousData(
  outputDirectory: string,
  backupDirectory: string,
  newOutputWasPromoted: boolean,
  previousOutputWasMoved: boolean,
): Promise<void> {
  if (newOutputWasPromoted) {
    await rm(outputDirectory, { recursive: true, force: true });
  }
  if (previousOutputWasMoved) {
    await rename(backupDirectory, outputDirectory);
  }
}

export async function publishCommutePackageData(): Promise<PackageDataPublication> {
  const totalStartedAt = performance.now();
  await mkdir(COMMUTE_PACKAGE_DIRECTORY, { recursive: true });
  const identity = `${process.pid}-${randomUUID()}`;
  const stageDirectory = resolve(
    COMMUTE_PACKAGE_DIRECTORY,
    `.data-stage-${identity}`,
  );
  const backupDirectory = resolve(
    COMMUTE_PACKAGE_DIRECTORY,
    `.data-backup-${identity}`,
  );
  if (
    dirname(stageDirectory) !== COMMUTE_PACKAGE_DIRECTORY ||
    dirname(backupDirectory) !== COMMUTE_PACKAGE_DIRECTORY
  ) {
    throw new Error('Refusing to stage package data outside the package directory.');
  }

  const stagingStartedAt = performance.now();
  const sourcePair = await authenticatePair(ROOT_RUNTIME_DATA_DIRECTORY);
  const orderedLocalityIds = sourcePair[0].manifest.matrix.localityIds;
  const localityCatalogBuild = await buildRuntimeLocalityCatalog(
    orderedLocalityIds,
  );
  const sourceCatalog = await authenticateRuntimeLocalityCatalog(
    resolve(ROOT_RUNTIME_DATA_DIRECTORY, 'localities.json'),
    orderedLocalityIds,
  );
  await mkdir(stageDirectory, { recursive: true });
  await copyRuntimeAssets(stageDirectory);
  const stagedPair = await authenticatePair(stageDirectory);
  const stagedCatalog = await authenticateRuntimeLocalityCatalog(
    resolve(stageDirectory, 'localities.json'),
    orderedLocalityIds,
  );
  assertCatalogLocalityOrdering(
    stagedCatalog.file,
    stagedPair[0].manifest.matrix.localityIds,
    'staged package data',
  );
  if (!sourceCatalog.bytes.equals(stagedCatalog.bytes)) {
    throw new Error('Staged locality catalog differs from its runtime source.');
  }
  for (let index = 0; index < sourcePair.length; index += 1) {
    assertByteIdentity(
      sourcePair[index] as AuthenticatedRuntimeData,
      stagedPair[index] as AuthenticatedRuntimeData,
    );
  }
  const stagingAndAuthenticationMilliseconds =
    performance.now() - stagingStartedAt;

  const promotionStartedAt = performance.now();
  let previousOutputWasMoved = false;
  let newOutputWasPromoted = false;
  try {
    if (await pathExists(COMMUTE_PACKAGE_DATA_DIRECTORY)) {
      await rename(COMMUTE_PACKAGE_DATA_DIRECTORY, backupDirectory);
      previousOutputWasMoved = true;
    }
    await rename(stageDirectory, COMMUTE_PACKAGE_DATA_DIRECTORY);
    newOutputWasPromoted = true;

    const publishedPair = await authenticatePair(COMMUTE_PACKAGE_DATA_DIRECTORY);
    const publishedCatalog = await authenticateRuntimeLocalityCatalog(
      resolve(COMMUTE_PACKAGE_DATA_DIRECTORY, 'localities.json'),
      orderedLocalityIds,
    );
    for (let index = 0; index < sourcePair.length; index += 1) {
      assertByteIdentity(
        sourcePair[index] as AuthenticatedRuntimeData,
        publishedPair[index] as AuthenticatedRuntimeData,
      );
    }
    if (!sourceCatalog.bytes.equals(publishedCatalog.bytes)) {
      throw new Error(
        'Published locality catalog differs from its runtime source.',
      );
    }
    if (previousOutputWasMoved) {
      await rm(backupDirectory, { recursive: true, force: true });
      previousOutputWasMoved = false;
    }

    return {
      sourceDirectory: ROOT_RUNTIME_DATA_DIRECTORY,
      packageDirectory: COMMUTE_PACKAGE_DATA_DIRECTORY,
      localityCount: sourcePair[0].manifest.matrix.localityCount,
      localityCatalog: publishedCatalog.artifact,
      artifacts: publishedPair.map(publicArtifact),
      localityCatalogBuildMilliseconds:
        localityCatalogBuild.elapsedMilliseconds,
      localitySourceCsvPath: localityCatalogBuild.sourceCsvPath,
      localitySourceCsvSha256: localityCatalogBuild.sourceCsvSha256,
      stagingAndAuthenticationMilliseconds,
      promotionAndReadbackMilliseconds:
        performance.now() - promotionStartedAt,
      totalMilliseconds: performance.now() - totalStartedAt,
    };
  } catch (error) {
    try {
      await restorePreviousData(
        COMMUTE_PACKAGE_DATA_DIRECTORY,
        backupDirectory,
        newOutputWasPromoted,
        previousOutputWasMoved,
      );
    } catch (restoreError) {
      const restoreDetail = restoreError instanceof Error
        ? restoreError.message
        : String(restoreError);
      throw new Error(
        'Package data publication failed and the previous data could not be ' +
          `restored after ${String(error)}: ${restoreDetail}`,
        { cause: restoreError },
      );
    }
    throw error;
  } finally {
    await rm(stageDirectory, { recursive: true, force: true });
  }
}
