import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

export interface RoadNetworkFiles {
  readonly fileCount: number;
  readonly totalByteLength: number;
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

export async function requireNonemptyFile(
  path: string,
  description: string,
): Promise<void> {
  let fileStat;
  try {
    fileStat = await stat(path);
  } catch (error) {
    throw new Error(`Unable to read ${description} at "${path}".`, {
      cause: error,
    });
  }
  if (!fileStat.isFile() || fileStat.size === 0) {
    throw new Error(`${description} must be a nonempty file at "${path}".`);
  }
}

export async function inspectRoadNetworkFiles(
  directory: string,
  datasetBasename: string,
): Promise<RoadNetworkFiles> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    throw new Error(`Unable to read prepared road network at "${directory}".`, {
      cause: error,
    });
  }

  const files = entries.filter(
    (entry) =>
      entry.isFile() &&
      (entry.name === datasetBasename ||
        entry.name.startsWith(`${datasetBasename}.`)),
  );
  const sizes = await Promise.all(
    files.map(async ({ name }) => ({
      name,
      size: (await stat(join(directory, name))).size,
    })),
  );
  const empty = sizes.find(({ size }) => size === 0);
  if (empty !== undefined) {
    throw new Error(`Prepared road-network file "${empty.name}" is empty.`);
  }
  for (const suffix of ['hsgr', 'edges', 'geometry', 'properties']) {
    const requiredName = `${datasetBasename}.${suffix}`;
    if (!sizes.some(({ name }) => name === requiredName)) {
      throw new Error(
        `Prepared road network is missing required file "${requiredName}".`,
      );
    }
  }

  return {
    fileCount: sizes.length,
    totalByteLength: sizes.reduce((sum, { size }) => sum + size, 0),
  };
}
