import { lstat, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { buildCommutePackage } from './build-commute-package';
import { formatBytes, formatMilliseconds } from './format';
import { isMainModule } from './main-module';
import {
  assertExpectedPackageInventory,
  createNpmPackageTarball,
  type NpmPackResult,
} from './npm-pack';
import { verifyPublishedPackageData } from './package-data';
import { runCommand } from './run-command';

const CONSUMER_SOURCE = String.raw`
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

function assertEqual(actual, expected, description) {
  if (actual !== expected) {
    throw new Error(
      description + ': expected ' + String(expected) + ', received ' + String(actual),
    );
  }
}

function assertLocalityRecord(actual, expectedId, expectedPostalCode, expectedCity) {
  if (actual === undefined) {
    throw new Error('Missing locality record ' + expectedId + '.');
  }
  assertEqual(actual.localityId, expectedId, expectedCity + ' locality ID');
  assertEqual(actual.postalCode, expectedPostalCode, expectedCity + ' postal code');
  assertEqual(actual.city, expectedCity, expectedCity + ' display name');
  if (!Number.isFinite(actual.latitude) || !Number.isFinite(actual.longitude)) {
    throw new Error(expectedCity + ' has invalid representative coordinates.');
  }
  assertEqual(
    Object.keys(actual).sort().join(','),
    'city,latitude,localityId,longitude,postalCode',
    expectedCity + ' locality record shape',
  );
}

function memoryDelta(after, before) {
  return {
    rss: after.rss - before.rss,
    heapTotal: after.heapTotal - before.heapTotal,
    heapUsed: after.heapUsed - before.heapUsed,
    external: after.external - before.external,
    arrayBuffers: after.arrayBuffers - before.arrayBuffers,
  };
}

function summarize(samples) {
  const sorted = [...samples].sort((left, right) => left - right);
  const percentile = (fraction) =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
  return {
    iterations: sorted.length,
    minMilliseconds: sorted[0],
    medianMilliseconds: percentile(0.5),
    meanMilliseconds:
      sorted.reduce((total, value) => total + value, 0) / sorted.length,
    p95Milliseconds: percentile(0.95),
    maxMilliseconds: sorted[sorted.length - 1],
  };
}

function benchmarkReachability(query) {
  for (let iteration = 0; iteration < 10; iteration += 1) {
    query();
  }
  const samples = [];
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const startedAt = performance.now();
    query();
    samples.push(performance.now() - startedAt);
  }
  return summarize(samples);
}

function benchmarkOperation(operation, iterations = 10000) {
  const startedAt = performance.now();
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    operation();
  }
  const totalMilliseconds = performance.now() - startedAt;
  return {
    iterations,
    totalMilliseconds,
    meanMicroseconds: (totalMilliseconds * 1000) / iterations,
  };
}

async function requireBlockedImport(specifier) {
  try {
    await import(specifier);
  } catch (error) {
    if (
      error !== null &&
      typeof error === 'object' &&
      error.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED'
    ) {
      return { specifier, code: error.code };
    }
    throw new Error(
      'Import ' + specifier + ' failed for the wrong reason: ' + String(error),
      { cause: error },
    );
  }
  throw new Error('Package-internal import unexpectedly resolved: ' + specifier);
}

const importStartedAt = performance.now();
const publicApi = await import('@jm/commute');
const nodeApi = await import('@jm/commute/node');
const packageImportMilliseconds = performance.now() - importStartedAt;

for (const exportName of [
  'createCarTravelTimeIndex',
  'getCarTravelMinutes',
  'getReachableLocalitiesByCar',
  'createTransitTravelTimeIndex',
  'getTransitTravelMinutes',
  'getReachableLocalitiesByTransit',
]) {
  if (typeof publicApi[exportName] !== 'function') {
    throw new Error('Missing public function export ' + exportName + '.');
  }
}
if (typeof nodeApi.loadCommuteRuntime !== 'function') {
  throw new Error('Missing @jm/commute/node loadCommuteRuntime export.');
}

globalThis.gc?.();
const memoryBeforeLoad = process.memoryUsage();
const initializationStartedAt = performance.now();
const commute = await nodeApi.loadCommuteRuntime();
const initializationMilliseconds = performance.now() - initializationStartedAt;
globalThis.gc?.();
const memoryAfterLoad = process.memoryUsage();

const nodeModuleUrl = import.meta.resolve('@jm/commute/node');
let [catalogBytes, carManifestBytes, carMatrixBytes, transitManifestBytes, transitMatrixBytes] =
  await Promise.all([
    readFile(new URL('../data/localities.json', nodeModuleUrl)),
    readFile(new URL('../data/car/manifest.json', nodeModuleUrl)),
    readFile(new URL('../data/car/travel-times.bin', nodeModuleUrl)),
    readFile(new URL('../data/transit/manifest.json', nodeModuleUrl)),
    readFile(new URL('../data/transit/travel-times.bin', nodeModuleUrl)),
  ]);
const constructorTimings = (() => {
  let startedAt = performance.now();
  const localities = publicApi.createLocalityCatalog(
    JSON.parse(catalogBytes.toString('utf8')),
  );
  const localityCatalogMilliseconds = performance.now() - startedAt;
  startedAt = performance.now();
  const car = publicApi.createCarTravelTimeIndex(
    JSON.parse(carManifestBytes.toString('utf8')),
    carMatrixBytes,
  );
  const carIndexMilliseconds = performance.now() - startedAt;
  startedAt = performance.now();
  const transit = publicApi.createTransitTravelTimeIndex(
    JSON.parse(transitManifestBytes.toString('utf8')),
    transitMatrixBytes,
  );
  const transitIndexMilliseconds = performance.now() - startedAt;
  assertEqual(localities.all().length, 4073, 'Injected locality catalog');
  assertEqual(
    publicApi.getCarTravelMinutes(car, '8001:zurich', '3011:bern'),
    93,
    'Injected car constructor',
  );
  assertEqual(
    publicApi.getTransitTravelMinutes(transit, '8001:zurich', '3011:bern'),
    62,
    'Injected transit constructor',
  );
  return {
    localityCatalogMilliseconds,
    carIndexMilliseconds,
    transitIndexMilliseconds,
  };
})();
catalogBytes = undefined;
carManifestBytes = undefined;
carMatrixBytes = undefined;
transitManifestBytes = undefined;
transitMatrixBytes = undefined;

const ZURICH = '8001:zurich';
const BERN = '3011:bern';
const GLARUS = '8750:glarus';
const ZERMATT = '3920:zermatt';
const allLocalities = commute.localities.all();
assertEqual(allLocalities.length, 4073, 'Locality catalog count');
const zurich = commute.localities.get(ZURICH);
const bern = commute.localities.get(BERN);
const glarus = commute.localities.get(GLARUS);
const zermatt = commute.localities.get(ZERMATT);
assertLocalityRecord(zurich, ZURICH, '8001', 'Zürich');
assertLocalityRecord(bern, BERN, '3011', 'Bern');
assertLocalityRecord(glarus, GLARUS, '8750', 'Glarus');
assertLocalityRecord(zermatt, ZERMATT, '3920', 'Zermatt');
assertEqual(commute.localities.get('9999:missing'), undefined, 'Unknown locality');
const resolvedZurich = commute.localities.resolve({
  postalCode: ' 8001 ',
  city: '  ZU\u0308RICH  ',
});
assertEqual(
  resolvedZurich?.localityId,
  ZURICH,
  'Accent/case/whitespace locality resolution',
);
for (const [query, expectedId] of [
  [{ postalCode: '3011', city: 'Bern' }, BERN],
  [{ postalCode: '8750', city: 'Glarus' }, GLARUS],
  [{ postalCode: '3920', city: 'Zermatt' }, ZERMATT],
]) {
  assertEqual(
    commute.localities.resolve(query)?.localityId,
    expectedId,
    'Reference locality resolution ' + expectedId,
  );
}
for (const locality of allLocalities) {
  if (commute.localities.get(locality.localityId) !== locality) {
    throw new Error(
      'Catalog get() did not resolve its own entry: ' + locality.localityId,
    );
  }
}
const pointChecks = {
  carZurichToBern: commute.car.getTravelMinutes(ZURICH, BERN),
  carBernToZurich: commute.car.getTravelMinutes(BERN, ZURICH),
  transitZurichToBern: commute.transit.getTravelMinutes(ZURICH, BERN),
  transitBernToZurich: commute.transit.getTravelMinutes(BERN, ZURICH),
};
assertEqual(pointChecks.carZurichToBern, 93, 'Car Zürich → Bern');
assertEqual(pointChecks.carBernToZurich, 95, 'Car Bern → Zürich');
assertEqual(pointChecks.transitZurichToBern, 62, 'Transit Zürich → Bern');
assertEqual(pointChecks.transitBernToZurich, 62, 'Transit Bern → Zürich');

const thresholds = [30, 60, 90, 120];
const expectedCarCounts = [271, 1091, 1770, 2430];
const expectedTransitCounts = [176, 768, 1626, 2236];
const carCounts = thresholds.map((maximum, index) => {
  const reachable = commute.car.getReachableLocalities(ZURICH, maximum);
  assertEqual(reachable.length, expectedCarCounts[index], 'Car Zürich ' + maximum);
  return reachable.length;
});
const transitCounts = thresholds.map((maximum, index) => {
  const reachable = commute.transit.getReachableLocalities(ZURICH, maximum);
  assertEqual(
    reachable.length,
    expectedTransitCounts[index],
    'Transit Zürich ' + maximum,
  );
  return reachable.length;
});

for (const [mode, reachable] of [
  ['car', commute.car.getReachableLocalities(ZURICH, 90)],
  ['transit', commute.transit.getReachableLocalities(ZURICH, 90)],
]) {
  const missing = reachable.find(
    ({ localityId }) => commute.localities.get(localityId) === undefined,
  );
  if (missing !== undefined) {
    throw new Error(
      mode + ' result locality does not resolve through catalog: ' +
        missing.localityId,
    );
  }
}

const resultShape = commute.car.getReachableLocalities(ZURICH, 0)[0];
assertEqual(resultShape.localityId, ZURICH, 'ReachableLocality localityId');
assertEqual(resultShape.travelMinutes, 0, 'ReachableLocality travelMinutes');
assertEqual(
  Object.keys(resultShape).sort().join(','),
  'localityId,travelMinutes',
  'ReachableLocality property shape',
);

const blockedImports = [];
for (const specifier of [
  '@jm/commute/src/index.js',
  '@jm/commute/preprocessing',
  '@jm/commute/raptor',
]) {
  blockedImports.push(await requireBlockedImport(specifier));
}

const carNinetyBenchmark = benchmarkReachability(() =>
  commute.car.getReachableLocalities(ZURICH, 90),
);
const transitNinetyBenchmark = benchmarkReachability(() =>
  commute.transit.getReachableLocalities(ZURICH, 90),
);
const localityBenchmarks = {
  createLocalityId: benchmarkOperation(() =>
    publicApi.createLocalityId('8001', '  ZU\u0308RICH  '),
  ),
  get: benchmarkOperation(() => commute.localities.get(ZURICH)),
  resolve: benchmarkOperation(() =>
    commute.localities.resolve({ postalCode: ' 8001 ', city: ' ZÜRICH ' }),
  ),
};

console.log(JSON.stringify({
  packageImportMilliseconds,
  constructorTimings,
  initializationMilliseconds,
  pointChecks,
  reachability: {
    thresholds,
    carCounts,
    transitCounts,
  },
  localities: {
    count: allLocalities.length,
    zurich,
    bern,
    glarus,
    zermatt,
    resolvedZurich,
    allCatalogIdsResolve: true,
    allReachabilityIdsResolved: true,
  },
  blockedImports,
  benchmarks: {
    carZurich90: carNinetyBenchmark,
    transitZurich90: transitNinetyBenchmark,
    localities: localityBenchmarks,
  },
  memory: {
    before: memoryBeforeLoad,
    after: memoryAfterLoad,
    delta: memoryDelta(memoryAfterLoad, memoryBeforeLoad),
  },
}));
`;

interface BenchmarkSummary {
  readonly iterations: number;
  readonly minMilliseconds: number;
  readonly medianMilliseconds: number;
  readonly meanMilliseconds: number;
  readonly p95Milliseconds: number;
  readonly maxMilliseconds: number;
}

interface OperationBenchmark {
  readonly iterations: number;
  readonly totalMilliseconds: number;
  readonly meanMicroseconds: number;
}

interface ConsumerResult {
  readonly packageImportMilliseconds: number;
  readonly constructorTimings: {
    readonly localityCatalogMilliseconds: number;
    readonly carIndexMilliseconds: number;
    readonly transitIndexMilliseconds: number;
  };
  readonly initializationMilliseconds: number;
  readonly pointChecks: Readonly<Record<string, number>>;
  readonly reachability: {
    readonly thresholds: readonly number[];
    readonly carCounts: readonly number[];
    readonly transitCounts: readonly number[];
  };
  readonly localities: {
    readonly count: number;
    readonly zurich: Readonly<Record<string, unknown>>;
    readonly bern: Readonly<Record<string, unknown>>;
    readonly glarus: Readonly<Record<string, unknown>>;
    readonly zermatt: Readonly<Record<string, unknown>>;
    readonly resolvedZurich: Readonly<Record<string, unknown>>;
    readonly allReachabilityIdsResolved: boolean;
    readonly allCatalogIdsResolve: boolean;
  };
  readonly blockedImports: readonly {
    readonly specifier: string;
    readonly code: string;
  }[];
  readonly benchmarks: {
    readonly carZurich90: BenchmarkSummary;
    readonly transitZurich90: BenchmarkSummary;
    readonly localities: {
      readonly createLocalityId: OperationBenchmark;
      readonly get: OperationBenchmark;
      readonly resolve: OperationBenchmark;
    };
  };
  readonly memory: {
    readonly before: NodeJS.MemoryUsage;
    readonly after: NodeJS.MemoryUsage;
    readonly delta: NodeJS.MemoryUsage;
  };
}

export interface PackedPackageVerification {
  readonly packageDataByteLength: number;
  readonly packageBuildMilliseconds: number;
  readonly packageBuildByteLength: number;
  readonly packageBuildFileCount: number;
  readonly packed: NpmPackResult;
  readonly installMilliseconds: number;
  readonly consumer: ConsumerResult;
  readonly installedPackageIsSymlink: boolean;
  readonly temporaryDirectory?: string;
}

function parseConsumerResult(stdout: string): ConsumerResult {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`Installed package consumer returned invalid JSON:\n${stdout}`, {
      cause: error,
    });
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Installed package consumer returned a non-object result.');
  }
  return value as ConsumerResult;
}

export async function verifyPackedCommutePackage(options: {
  readonly keepTemporaryDirectory?: boolean;
} = {}): Promise<PackedPackageVerification> {
  const temporaryDirectory = await mkdtemp(
    resolve(tmpdir(), 'jm-commute-consumer-'),
  );
  try {
    const packageData = await verifyPublishedPackageData();
    const packageDataByteLength = packageData.artifacts.reduce(
      (total, artifact) =>
        total + artifact.manifestByteLength + artifact.matrixByteLength,
      0,
    ) + packageData.localityCatalog.byteLength;
    const build = await buildCommutePackage();
    const packDirectory = resolve(temporaryDirectory, 'pack');
    const packed = await createNpmPackageTarball(packDirectory);
    assertExpectedPackageInventory(packed);

    const consumerDirectory = resolve(temporaryDirectory, 'consumer');
    await mkdir(consumerDirectory, { recursive: true });
    await Promise.all([
      writeFile(
        resolve(consumerDirectory, 'package.json'),
        `${JSON.stringify({ private: true, type: 'module' }, null, 2)}\n`,
      ),
      writeFile(resolve(consumerDirectory, 'verify.mjs'), CONSUMER_SOURCE),
    ]);
    const install = await runCommand(
      'npm',
      [
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--offline',
        '--package-lock=false',
        '--cache',
        resolve(temporaryDirectory, 'npm-cache'),
        packed.tarballPath,
      ],
      { cwd: consumerDirectory, captureOutput: true },
    );

    const installedPackagePath = resolve(
      consumerDirectory,
      'node_modules/@jm/commute',
    );
    const installedPackageIsSymlink = (
      await lstat(installedPackagePath)
    ).isSymbolicLink();
    if (installedPackageIsSymlink) {
      throw new Error(
        'Independent consumer unexpectedly installed @jm/commute as a symlink.',
      );
    }

    const executed = await runCommand(
      process.execPath,
      ['--expose-gc', resolve(consumerDirectory, 'verify.mjs')],
      { cwd: consumerDirectory, captureOutput: true },
    );
    const consumer = parseConsumerResult(executed.stdout);
    return {
      packageDataByteLength,
      packageBuildMilliseconds: build.elapsedMilliseconds,
      packageBuildByteLength: build.outputByteLength,
      packageBuildFileCount: build.outputFileCount,
      packed,
      installMilliseconds: install.elapsedMilliseconds,
      consumer,
      installedPackageIsSymlink,
      temporaryDirectory: options.keepTemporaryDirectory
        ? temporaryDirectory
        : undefined,
    };
  } finally {
    if (!options.keepTemporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
}

function printBenchmark(label: string, benchmark: BenchmarkSummary): void {
  console.log(
    `  ${label}: min ${formatMilliseconds(benchmark.minMilliseconds)}, ` +
      `median ${formatMilliseconds(benchmark.medianMilliseconds)}, ` +
      `mean ${formatMilliseconds(benchmark.meanMilliseconds)}, ` +
      `p95 ${formatMilliseconds(benchmark.p95Milliseconds)}, ` +
      `max ${formatMilliseconds(benchmark.maxMilliseconds)} ` +
      `(${benchmark.iterations} iterations)`,
  );
}

async function main(): Promise<void> {
  const keepTemporaryDirectory = process.argv.slice(2).includes('--keep-temporary');
  const unexpectedArguments = process.argv
    .slice(2)
    .filter((argument) => argument !== '--keep-temporary');
  if (unexpectedArguments.length > 0) {
    throw new Error(
      'Usage: verify-packed-commute-package.ts [--keep-temporary]',
    );
  }
  const result = await verifyPackedCommutePackage({ keepTemporaryDirectory });
  console.log('Verified @jm/commute from an independently installed npm tarball.');
  console.log(`  Runtime data: ${formatBytes(result.packageDataByteLength)}`);
  console.log(
    `  Build: ${formatMilliseconds(result.packageBuildMilliseconds)}, ` +
      `${result.packageBuildFileCount} files, ` +
      formatBytes(result.packageBuildByteLength),
  );
  console.log(
    `  npm pack: ${formatBytes(result.packed.size)} packed, ` +
      `${formatBytes(result.packed.unpackedSize)} unpacked, ` +
      formatMilliseconds(result.packed.elapsedMilliseconds),
  );
  console.log(`  npm install: ${formatMilliseconds(result.installMilliseconds)}`);
  console.log(`  Workspace symlink: ${String(result.installedPackageIsSymlink)}`);
  console.log('');
  console.log('Installed-package initialization:');
  console.log(
    `  Module import: ${formatMilliseconds(result.consumer.packageImportMilliseconds)}`,
  );
  console.log(
    `  LocalityCatalog constructor: ` +
      formatMilliseconds(
        result.consumer.constructorTimings.localityCatalogMilliseconds,
      ),
  );
  console.log(
    `  Car index constructor: ` +
      formatMilliseconds(result.consumer.constructorTimings.carIndexMilliseconds),
  );
  console.log(
    `  Transit index constructor: ` +
      formatMilliseconds(
        result.consumer.constructorTimings.transitIndexMilliseconds,
      ),
  );
  console.log(
    `  CommuteRuntime: ${formatMilliseconds(result.consumer.initializationMilliseconds)}`,
  );
  console.log('');
  console.log('Reference point checks:');
  for (const [label, minutes] of Object.entries(result.consumer.pointChecks)) {
    console.log(`  ${label}: ${minutes} min`);
  }
  console.log('Reference Zürich reachability (30/60/90/120 min):');
  console.log(`  Car: ${result.consumer.reachability.carCounts.join(', ')}`);
  console.log(`  Transit: ${result.consumer.reachability.transitCounts.join(', ')}`);
  console.log('Locality catalog:');
  console.log(`  Entries: ${result.consumer.localities.count}`);
  console.log(
    `  Known localities: ${[
      result.consumer.localities.zurich.city,
      result.consumer.localities.bern.city,
      result.consumer.localities.glarus.city,
      result.consumer.localities.zermatt.city,
    ].map(String).join(', ')}`,
  );
  console.log('  Accent/case/whitespace resolution: verified');
  console.log('  All 4,073 catalog IDs round-trip through get(): verified');
  console.log('  All checked reachability IDs resolve: verified');
  console.log('');
  console.log('Reachability scan benchmarks:');
  printBenchmark('Car Zürich, 90 min', result.consumer.benchmarks.carZurich90);
  printBenchmark(
    'Transit Zürich, 90 min',
    result.consumer.benchmarks.transitZurich90,
  );
  console.log('Locality lookup benchmarks:');
  for (const [label, benchmark] of Object.entries(
    result.consumer.benchmarks.localities,
  )) {
    console.log(
      `  ${label}: ${benchmark.meanMicroseconds.toFixed(3)} µs/op ` +
        `(${benchmark.iterations} iterations, ` +
        `${formatMilliseconds(benchmark.totalMilliseconds)} total)`,
    );
  }
  console.log('');
  console.log('Runtime memory delta after loading both matrices:');
  console.log(`  RSS: ${formatBytes(result.consumer.memory.delta.rss)}`);
  console.log(`  Heap used: ${formatBytes(result.consumer.memory.delta.heapUsed)}`);
  console.log(`  External: ${formatBytes(result.consumer.memory.delta.external)}`);
  console.log(
    `  ArrayBuffers: ${formatBytes(result.consumer.memory.delta.arrayBuffers)}`,
  );
  console.log('Package-internal imports blocked:');
  for (const blocked of result.consumer.blockedImports) {
    console.log(`  ${blocked.specifier}: ${blocked.code}`);
  }
  if (result.temporaryDirectory !== undefined) {
    console.log(`Temporary files retained at: ${result.temporaryDirectory}`);
  }
}

if (isMainModule(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
