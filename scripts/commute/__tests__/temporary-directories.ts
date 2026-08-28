import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const directories: string[] = [];

export async function createTemporaryDirectory(label: string): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), `jm-commute-${label}-`));
  directories.push(directory);
  return directory;
}

export async function removeTemporaryDirectories(): Promise<void> {
  await Promise.all(
    directories.splice(0).map(async (directory) =>
      await rm(directory, { recursive: true, force: true }),
    ),
  );
}

