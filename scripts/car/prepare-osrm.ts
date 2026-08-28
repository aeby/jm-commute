import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import {
  OSRM_ALGORITHM,
  OSRM_IMAGE,
  OSRM_PROFILE,
  OSRM_VERSION,
} from '@core/car/preprocessing';

const PROJECT_ROOT = resolve(import.meta.dirname, '..', '..');
const INPUT_RELATIVE_PATH =
  'data/raw/osm/switzerland-latest.osm.pbf';
const INPUT_PATH = resolve(PROJECT_ROOT, INPUT_RELATIVE_PATH);
const INPUT_DIRECTORY = resolve(PROJECT_ROOT, 'data/raw/osm');
const OUTPUT_RELATIVE_DIRECTORY = 'data/processed/car/osrm';
const OUTPUT_DIRECTORY = resolve(PROJECT_ROOT, OUTPUT_RELATIVE_DIRECTORY);
const OUTPUT_PARENT_DIRECTORY = resolve(
  PROJECT_ROOT,
  'data/processed/car',
);
const OUTPUT_BASENAME = 'switzerland.osrm';
const UNUSED_CH_SERVING_INTERMEDIATE_SUFFIXES = [
  'cnbg',
  'cnbg_to_ebg',
] as const;
const CONTAINER_INPUT_PATH = '/input/switzerland-latest.osm.pbf';
const CONTAINER_OUTPUT_PATH = `/data/${OUTPUT_BASENAME}`;

interface InputSnapshot {
  readonly size: number;
  readonly modifiedMilliseconds: number;
  readonly sha256: string;
}

interface GeneratedFile {
  readonly name: string;
  readonly size: number;
}

function assertInsideProject(path: string, description: string): void {
  const projectRelativePath = relative(PROJECT_ROOT, path);
  if (
    projectRelativePath === '' ||
    projectRelativePath === '..' ||
    projectRelativePath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) ||
    isAbsolute(projectRelativePath)
  ) {
    throw new Error(`${description} must resolve inside the repository.`);
  }
}

function isGeneratedDatasetName(name: string): boolean {
  return name === OUTPUT_BASENAME || name.startsWith(`${OUTPUT_BASENAME}.`);
}

function formatBytes(bytes: number): string {
  return new Intl.NumberFormat('en-US').format(bytes);
}

function formatSeconds(milliseconds: number): string {
  return `${(milliseconds / 1_000).toFixed(3)} s`;
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

async function inspectInput(): Promise<InputSnapshot> {
  let inputStat;
  try {
    inputStat = await stat(INPUT_PATH);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Required Swiss OSM PBF is unavailable at ${INPUT_RELATIVE_PATH}: ${message}`,
      { cause: error },
    );
  }

  if (!inputStat.isFile()) {
    throw new Error(
      `Required Swiss OSM PBF at ${INPUT_RELATIVE_PATH} is not a regular file.`,
    );
  }
  if (inputStat.size === 0) {
    throw new Error(
      `Required Swiss OSM PBF at ${INPUT_RELATIVE_PATH} is empty.`,
    );
  }

  return {
    size: inputStat.size,
    modifiedMilliseconds: inputStat.mtimeMs,
    sha256: await sha256File(INPUT_PATH),
  };
}

function runCommand(
  command: string,
  arguments_: readonly string[],
  description: string,
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, arguments_, {
      cwd: PROJECT_ROOT,
      shell: false,
      stdio: 'inherit',
    });

    child.once('error', (error) => {
      reject(
        new Error(`Unable to start ${description}: ${error.message}`, {
          cause: error,
        }),
      );
    });
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      const result = signal === null ? `exit code ${code}` : `signal ${signal}`;
      reject(new Error(`${description} failed with ${result}.`));
    });
  });
}

function runCapturedCommand(
  command: string,
  arguments_: readonly string[],
  description: string,
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, arguments_, {
      cwd: PROJECT_ROOT,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.once('error', (error) => {
      reject(
        new Error(`Unable to start ${description}: ${error.message}`, {
          cause: error,
        }),
      );
    });
    child.once('close', (code, signal) => {
      const output = Buffer.concat(chunks).toString('utf8').trim();
      if (code === 0) {
        resolvePromise(output);
        return;
      }
      const result = signal === null ? `exit code ${code}` : `signal ${signal}`;
      reject(
        new Error(
          `${description} failed with ${result}${output.length === 0 ? '.' : `: ${output}`}`,
        ),
      );
    });
  });
}

function dockerUserArguments(): readonly string[] {
  return typeof process.getuid === 'function' &&
    typeof process.getgid === 'function'
    ? ['--user', `${process.getuid()}:${process.getgid()}`]
    : [];
}

function dockerRunArguments(
  stagingDirectory: string,
  osrmArguments: readonly string[],
  includeInput: boolean,
): readonly string[] {
  return [
    'run',
    '--rm',
    ...dockerUserArguments(),
    ...(includeInput
      ? [
          '--mount',
          `type=bind,source=${INPUT_DIRECTORY},target=/input,readonly`,
        ]
      : []),
    '--mount',
    `type=bind,source=${stagingDirectory},target=/data`,
    OSRM_IMAGE,
    ...osrmArguments,
  ];
}

async function generatedFiles(directory: string): Promise<readonly GeneratedFile[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: GeneratedFile[] = [];

  for (const entry of entries.toSorted((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  )) {
    if (!entry.isFile() || !isGeneratedDatasetName(entry.name)) {
      continue;
    }
    const fileStat = await stat(join(directory, entry.name));
    files.push({ name: entry.name, size: fileStat.size });
  }

  return files;
}

async function verifyContractedGraph(
  directory: string,
): Promise<readonly GeneratedFile[]> {
  const files = await generatedFiles(directory);
  const hierarchy = files.find(
    ({ name }) => name === `${OUTPUT_BASENAME}.hsgr`,
  );
  if (hierarchy === undefined || hierarchy.size === 0) {
    throw new Error(
      `OSRM contraction did not create a nonempty ${OUTPUT_BASENAME}.hsgr file.`,
    );
  }
  return files;
}

async function removeUnusedServingIntermediates(
  directory: string,
): Promise<void> {
  await Promise.all(
    UNUSED_CH_SERVING_INTERMEDIATE_SUFFIXES.map((suffix) =>
      rm(join(directory, `${OUTPUT_BASENAME}.${suffix}`), { force: true }),
    ),
  );
}

async function promoteDataset(
  stagingDirectory: string,
): Promise<void> {
  const backupDirectory = await mkdtemp(
    join(OUTPUT_PARENT_DIRECTORY, '.osrm-backup-'),
  );
  await rm(backupDirectory, { recursive: true });

  let previousDatasetMoved = false;
  try {
    await rename(OUTPUT_DIRECTORY, backupDirectory);
    previousDatasetMoved = true;
    await rename(stagingDirectory, OUTPUT_DIRECTORY);
  } catch (error) {
    if (previousDatasetMoved) {
      await rm(OUTPUT_DIRECTORY, { recursive: true, force: true });
      await rename(backupDirectory, OUTPUT_DIRECTORY);
    }
    throw error;
  }

  await rm(backupDirectory, { recursive: true, force: true });
}

function assertInputUnchanged(
  before: InputSnapshot,
  after: InputSnapshot,
): void {
  if (
    after.size !== before.size ||
    after.modifiedMilliseconds !== before.modifiedMilliseconds ||
    after.sha256 !== before.sha256
  ) {
    throw new Error('Source PBF changed during OSRM preprocessing.');
  }
}

function printStartCommand(): void {
  console.log('Start the local CH routing service (loopback only):');
  console.log('docker run --rm \\');
  console.log('  --publish 127.0.0.1:5000:5000 \\');
  console.log(
    `  --mount type=bind,source="${OUTPUT_DIRECTORY}",target=/data,readonly \\`,
  );
  console.log(`  ${OSRM_IMAGE} \\`);
  console.log(
    `  osrm-routed --algorithm ${OSRM_ALGORITHM} /data/${OUTPUT_BASENAME}`,
  );
}

async function main(): Promise<void> {
  assertInsideProject(INPUT_PATH, 'OSM input path');
  assertInsideProject(OUTPUT_DIRECTORY, 'OSRM output path');

  const inputBefore = await inspectInput();
  console.log(`Input PBF: ${INPUT_RELATIVE_PATH}`);
  console.log(`Input PBF size: ${formatBytes(inputBefore.size)} bytes`);
  console.log(`Input SHA-256: ${inputBefore.sha256}`);
  console.log('');

  const dockerVersion = await runCapturedCommand(
    'docker',
    ['version', '--format', '{{.Server.Version}}'],
    'Docker daemon check',
  );
  console.log(`Docker server version: ${dockerVersion}`);
  console.log(`OSRM image: ${OSRM_IMAGE}`);
  console.log(`OSRM version: ${OSRM_VERSION}`);

  const reportedOsrmVersion = await runCapturedCommand(
    'docker',
    ['run', '--rm', OSRM_IMAGE, 'osrm-extract', '--version'],
    'pinned OSRM version check',
  );
  const versionLine = reportedOsrmVersion
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line === OSRM_VERSION || line === `v${OSRM_VERSION}`);
  if (versionLine === undefined) {
    throw new Error(
      `Pinned container reported an unexpected OSRM version: ${reportedOsrmVersion}`,
    );
  }
  console.log(`Container version check: ${versionLine}`);
  console.log('');

  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const stagingDirectory = await mkdtemp(
    join(OUTPUT_PARENT_DIRECTORY, '.osrm-prepare-'),
  );

  let extractMilliseconds = 0;
  let contractMilliseconds = 0;
  let inputAfter: InputSnapshot | undefined;
  try {
    const extractStart = performance.now();
    await runCommand(
      'docker',
      dockerRunArguments(
        stagingDirectory,
        [
          'osrm-extract',
          '--profile',
          `/opt/${OSRM_PROFILE}`,
          '--output',
          CONTAINER_OUTPUT_PATH,
          CONTAINER_INPUT_PATH,
        ],
        true,
      ),
      'OSRM extraction',
    );
    extractMilliseconds = performance.now() - extractStart;
    console.log(`OSRM extraction time: ${formatSeconds(extractMilliseconds)}`);
    console.log('');

    const contractStart = performance.now();
    await runCommand(
      'docker',
      dockerRunArguments(
        stagingDirectory,
        ['osrm-contract', CONTAINER_OUTPUT_PATH],
        false,
      ),
      'OSRM CH contraction',
    );
    contractMilliseconds = performance.now() - contractStart;
    console.log(
      `OSRM CH contraction time: ${formatSeconds(contractMilliseconds)}`,
    );
    console.log('');

    await verifyContractedGraph(stagingDirectory);
    await removeUnusedServingIntermediates(stagingDirectory);
    inputAfter = await inspectInput();
    assertInputUnchanged(inputBefore, inputAfter);
    await writeFile(join(stagingDirectory, '.gitkeep'), '');
    await promoteDataset(stagingDirectory);
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true });
  }

  if (inputAfter === undefined) {
    throw new Error('Source PBF integrity recheck did not complete.');
  }

  const files = await verifyContractedGraph(OUTPUT_DIRECTORY);
  const totalSize = files.reduce((total, file) => total + file.size, 0);
  console.log('Generated OSRM files:');
  for (const file of files) {
    console.log(`  ${file.name}: ${formatBytes(file.size)} bytes`);
  }
  console.log(`Generated OSRM file count: ${formatBytes(files.length)}`);
  console.log(`Processed OSRM total size: ${formatBytes(totalSize)} bytes`);
  console.log(
    `Source PBF integrity recheck: unchanged (${inputAfter.sha256})`,
  );
  console.log('');
  printStartCommand();
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
