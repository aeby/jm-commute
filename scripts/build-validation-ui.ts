import { mkdir, readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

import { build as buildWithVite } from 'vite';

import { buildValidationData } from './build-validation-data';
import { writeUtf8FileAtomically } from './write-utf8-file-atomically';

const PROJECT_ROOT = resolve(import.meta.dirname, '..');
const OUTPUT_DIRECTORY = resolve(PROJECT_ROOT, 'dist-validation');
const INDEX_SOURCE_PATH = resolve(
  PROJECT_ROOT,
  'src/validation-ui/index.html',
);
const INDEX_OUTPUT_PATH = resolve(OUTPUT_DIRECTORY, 'index.html');
const APP_ENTRY_PATH = resolve(PROJECT_ROOT, 'src/validation-ui/app.ts');
const APP_OUTPUT_PATH = resolve(OUTPUT_DIRECTORY, 'app.js');
const DATA_OUTPUT_PATH = resolve(OUTPUT_DIRECTORY, 'validation-data.js');
const SCRIPT_MARKER = '<!-- VALIDATION_UI_SCRIPTS -->';
const CLASSIC_SCRIPT_TAGS = [
  '<script src="./validation-data.js"></script>',
  '<script src="./app.js"></script>',
].join('\n    ');

function formatBytes(value: number): string {
  return `${new Intl.NumberFormat('en-US').format(value)} bytes (${(value / 1024 / 1024).toFixed(2)} MiB)`;
}

async function main(): Promise<void> {
  const buildStart = performance.now();
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const dataResult = await buildValidationData(DATA_OUTPUT_PATH);

  await buildWithVite({
    root: PROJECT_ROOT,
    configFile: false,
    publicDir: false,
    build: {
      outDir: OUTPUT_DIRECTORY,
      emptyOutDir: false,
      copyPublicDir: false,
      target: 'es2022',
      minify: true,
      sourcemap: false,
      lib: {
        entry: APP_ENTRY_PATH,
        name: 'SwissCommuteValidationApp',
        formats: ['iife'],
        fileName: () => 'app.js',
      },
    },
  });
  const indexTemplate = await readFile(INDEX_SOURCE_PATH, 'utf8');
  if (!indexTemplate.includes(SCRIPT_MARKER)) {
    throw new Error(`Validation UI template is missing ${SCRIPT_MARKER}.`);
  }
  await writeUtf8FileAtomically(
    INDEX_OUTPUT_PATH,
    indexTemplate.replace(SCRIPT_MARKER, CLASSIC_SCRIPT_TAGS),
  );

  const [indexStats, appStats, dataStats] = await Promise.all([
    stat(INDEX_OUTPUT_PATH),
    stat(APP_OUTPUT_PATH),
    stat(DATA_OUTPUT_PATH),
  ]);
  const buildMilliseconds = performance.now() - buildStart;

  console.log(`Localities: ${dataResult.localityCount}`);
  console.log(`Hub candidates: ${dataResult.hubCandidateCount}`);
  console.log(
    `Raw timetable typed-array bytes: ${formatBytes(dataResult.rawTimetableTypedArrayBytes)}`,
  );
  console.log(`index.html: ${formatBytes(indexStats.size)}`);
  console.log(`app.js: ${formatBytes(appStats.size)}`);
  console.log(`validation-data.js: ${formatBytes(dataStats.size)}`);
  console.log(`Validation data SHA-256: ${dataResult.sha256}`);
  console.log(`Build time: ${(buildMilliseconds / 1000).toFixed(3)} s`);
  console.log('');
  console.log('Open:');
  console.log(pathToFileURL(INDEX_OUTPUT_PATH).href);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
