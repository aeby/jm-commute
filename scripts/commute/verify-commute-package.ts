import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { buildCommutePackage } from './build-commute-package';
import { formatBytes, formatMilliseconds } from './format';
import { isMainModule } from './main-module';
import { createNpmPackageTarball } from './npm-pack';
import { COMMUTE_PACKAGE_DIRECTORY, PROJECT_ROOT } from './paths';
import { runCommand } from './run-command';

const EXPECTED_PACKAGE_NAME = '@jobmate/commute';
const PUBLIC_NPM_REGISTRY = 'https://registry.npmjs.org/';
const SEMANTIC_VERSION =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

interface PackageIdentity {
  readonly name: string;
  readonly version: string;
}

interface SmokeResult {
  readonly localityCount: number;
  readonly roadMinutes: number;
  readonly publicTransportMinutes: number;
}

export interface CommutePackageVerificationResult extends PackageIdentity {
  readonly elapsedMilliseconds: number;
  readonly packedSize: number;
  readonly unpackedSize: number;
  readonly localityCount: number;
  readonly roadMinutes: number;
  readonly publicTransportMinutes: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(
  record: Record<string, unknown>,
  key: string,
): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Package metadata must contain a nonempty "${key}".`);
  }
  return value;
}

async function verifyPackageMetadata(): Promise<PackageIdentity> {
  const packageJsonPath = resolve(COMMUTE_PACKAGE_DIRECTORY, 'package.json');
  let value: unknown;
  try {
    value = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  } catch (error) {
    throw new Error('Unable to read the commute package metadata.', {
      cause: error,
    });
  }
  if (!isRecord(value)) {
    throw new Error('Commute package metadata must be a JSON object.');
  }

  const name = requireString(value, 'name');
  const version = requireString(value, 'version');
  if (name !== EXPECTED_PACKAGE_NAME) {
    throw new Error(
      `Package name is ${JSON.stringify(name)}; expected ${JSON.stringify(EXPECTED_PACKAGE_NAME)}. Update the verifier intentionally when changing the public package identity.`,
    );
  }
  if (!SEMANTIC_VERSION.test(version) || version === '0.0.0') {
    throw new Error(
      `Package version ${JSON.stringify(version)} is not a publishable semantic version.`,
    );
  }
  if (value.private === true) {
    throw new Error('The commute package is still marked private.');
  }
  if (value.license !== 'MIT' || value.author !== 'Jobmate') {
    throw new Error(
      'Package metadata must identify Jobmate and use the MIT license.',
    );
  }

  const files = value.files;
  if (
    !Array.isArray(files) ||
    !files.includes('DATA_SOURCES.md') ||
    !files.includes('LICENSE')
  ) {
    throw new Error('Package files must include DATA_SOURCES.md and LICENSE.');
  }
  const publishConfig = value.publishConfig;
  if (
    !isRecord(publishConfig) ||
    publishConfig.access !== 'public' ||
    publishConfig.registry !== PUBLIC_NPM_REGISTRY
  ) {
    throw new Error(
      `publishConfig must pin public access at ${PUBLIC_NPM_REGISTRY}.`,
    );
  }
  const repository = value.repository;
  if (
    !isRecord(repository) ||
    repository.url !== 'git+https://github.com/aeby/jm-commute.git' ||
    repository.directory !== 'packages/commute'
  ) {
    throw new Error(
      'Package repository metadata must identify its monorepo directory.',
    );
  }

  const notice = await readFile(
    resolve(COMMUTE_PACKAGE_DIRECTORY, 'DATA_SOURCES.md'),
    'utf8',
  );
  for (const requiredText of [
    'OpenStreetMap contributors',
    'opentransportdata.swiss',
    'Bundesamt für Landestopografie swisstopo',
  ]) {
    if (!notice.includes(requiredText)) {
      throw new Error(
        `DATA_SOURCES.md is missing required attribution text: ${JSON.stringify(requiredText)}.`,
      );
    }
  }
  const license = await readFile(
    resolve(COMMUTE_PACKAGE_DIRECTORY, 'LICENSE'),
    'utf8',
  );
  if (
    !license.startsWith('MIT License') ||
    !license.includes('Copyright (c) 2026 Jobmate')
  ) {
    throw new Error('LICENSE must contain Jobmate\'s MIT license notice.');
  }

  return { name, version };
}

function parseSmokeResult(stdout: string): SmokeResult {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch (error) {
    throw new Error('Installed package smoke test returned unreadable JSON.', {
      cause: error,
    });
  }
  if (
    !isRecord(value) ||
    !Number.isSafeInteger(value.localityCount) ||
    (value.localityCount as number) <= 0 ||
    !Number.isSafeInteger(value.roadMinutes) ||
    !Number.isSafeInteger(value.publicTransportMinutes)
  ) {
    throw new Error('Installed package smoke test returned incompatible data.');
  }
  return value as unknown as SmokeResult;
}

async function smokeTestTarball(
  tarballPath: string,
  expected: PackageIdentity,
): Promise<SmokeResult> {
  const consumerDirectory = await mkdtemp(
    resolve(tmpdir(), 'jobmate-commute-consumer-'),
  );
  try {
    await writeFile(
      resolve(consumerDirectory, 'package.json'),
      `${JSON.stringify({ private: true, type: 'module' }, null, 2)}\n`,
    );
    await runCommand(
      'npm',
      [
        'install',
        '--offline',
        '--ignore-scripts',
        '--dry-run=false',
        '--no-audit',
        '--no-fund',
        '--cache',
        resolve(consumerDirectory, '.npm-cache'),
        tarballPath,
      ],
      { cwd: consumerDirectory, captureOutput: true },
    );

    const installedDirectory = resolve(
      consumerDirectory,
      'node_modules',
      ...expected.name.split('/'),
    );
    const installedMetadata = JSON.parse(
      await readFile(resolve(installedDirectory, 'package.json'), 'utf8'),
    ) as { name?: unknown; version?: unknown };
    if (
      installedMetadata.name !== expected.name ||
      installedMetadata.version !== expected.version
    ) {
      throw new Error('Installed tarball identity does not match package metadata.');
    }
    await readFile(resolve(installedDirectory, 'DATA_SOURCES.md'), 'utf8');

    const smoke = await runCommand(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        [
          "import { MAX_TRAVEL_MINUTES } from '@jobmate/commute';",
          "import { loadCommuteRuntime } from '@jobmate/commute/node';",
          "if (MAX_TRAVEL_MINUTES !== 240) throw new Error('Unexpected travel horizon.');",
          'const runtime = await loadCommuteRuntime();',
          "const zurich = runtime.resolve({ postalCode: '8001', city: 'Zürich' });",
          "const bern = runtime.resolve({ postalCode: '3011', city: 'Bern' });",
          "if (!zurich || !bern) throw new Error('Unable to resolve smoke-test localities.');",
          "const roadMinutes = runtime.travelTime(zurich, bern, 'road');",
          "const publicTransportMinutes = runtime.travelTime(zurich, bern, 'public_transport');",
          "if (roadMinutes === undefined || publicTransportMinutes === undefined) throw new Error('Smoke-test route is unavailable.');",
          'console.log(JSON.stringify({ localityCount: runtime.localities.length, roadMinutes, publicTransportMinutes }));',
        ].join('\n'),
      ],
      { cwd: consumerDirectory, captureOutput: true },
    );
    return parseSmokeResult(smoke.stdout);
  } finally {
    await rm(consumerDirectory, { recursive: true, force: true });
  }
}

export async function verifyCommutePackage(): Promise<CommutePackageVerificationResult> {
  const startedAt = performance.now();
  const identity = await verifyPackageMetadata();

  await runCommand('npm', ['test', '--', 'packages/commute/src'], {
    cwd: PROJECT_ROOT,
  });
  await runCommand('npm', ['run', 'typecheck:runtime'], {
    cwd: PROJECT_ROOT,
  });
  await buildCommutePackage();

  const packDirectory = await mkdtemp(
    resolve(tmpdir(), 'jobmate-commute-verify-'),
  );
  try {
    const packed = await createNpmPackageTarball(packDirectory);
    const smoke = await smokeTestTarball(packed.tarballPath, identity);
    return {
      ...identity,
      elapsedMilliseconds: performance.now() - startedAt,
      packedSize: packed.size,
      unpackedSize: packed.unpackedSize,
      ...smoke,
    };
  } finally {
    await rm(packDirectory, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const result = await verifyCommutePackage();
  console.log(`Verified ${result.name}@${result.version} for npm publication.`);
  console.log(
    `  Tarball: ${formatBytes(result.packedSize)} packed, ` +
      `${formatBytes(result.unpackedSize)} installed`,
  );
  console.log(`  Localities: ${result.localityCount}`);
  console.log(
    `  Zürich → Bern: ${result.roadMinutes} min road, ` +
      `${result.publicTransportMinutes} min public transport`,
  );
  console.log(`  Verification time: ${formatMilliseconds(result.elapsedMilliseconds)}`);
}

if (isMainModule(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
