import { readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import { formatBytes, formatMilliseconds } from './format';
import { isMainModule } from './main-module';
import { COMMUTE_PACKAGE_DIRECTORY, PROJECT_ROOT } from './paths';
import { runCommand } from './run-command';

export interface CommutePackageBuildResult {
  readonly elapsedMilliseconds: number;
  readonly outputByteLength: number;
  readonly outputFileCount: number;
}

async function measureDirectory(path: string): Promise<{
  readonly byteLength: number;
  readonly fileCount: number;
}> {
  let byteLength = 0;
  let fileCount = 0;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const entryPath = resolve(path, entry.name);
    if (entry.isDirectory()) {
      const nested = await measureDirectory(entryPath);
      byteLength += nested.byteLength;
      fileCount += nested.fileCount;
    } else if (entry.isFile()) {
      byteLength += (await stat(entryPath)).size;
      fileCount += 1;
    }
  }
  return { byteLength, fileCount };
}

export async function buildCommutePackage(): Promise<CommutePackageBuildResult> {
  const command = await runCommand(
    'npm',
    ['run', 'build', '--workspace', '@jm/commute'],
    { cwd: PROJECT_ROOT },
  );
  const output = await measureDirectory(
    resolve(COMMUTE_PACKAGE_DIRECTORY, 'dist'),
  );
  return {
    elapsedMilliseconds: command.elapsedMilliseconds,
    outputByteLength: output.byteLength,
    outputFileCount: output.fileCount,
  };
}

async function main(): Promise<void> {
  const result = await buildCommutePackage();
  console.log('Built @jm/commute with TypeScript (no bundler).');
  console.log(`  Time: ${formatMilliseconds(result.elapsedMilliseconds)}`);
  console.log(`  Output files: ${result.outputFileCount}`);
  console.log(`  Output size: ${formatBytes(result.outputByteLength)}`);
}

if (isMainModule(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
