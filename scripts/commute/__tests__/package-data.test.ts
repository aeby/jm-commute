import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { assembleRuntimeData, RUNTIME_MODES } from '../package-data';
import {
  createTemporaryDirectory,
  removeTemporaryDirectories,
} from './temporary-directories';

const CSV = [
  'Ortschaftsname;PLZ4;E;N;Adressenanteil',
  'Zürich;8001;8.50;47.30;10',
  'Bern;3011;7.44;46.95;100',
  'Zürich;8001;8.54;47.37;90',
  '',
].join('\n');

afterEach(removeTemporaryDirectories);

async function fixture(matrix = Uint8Array.of(0, 12, 18, 0)) {
  const root = await createTemporaryDirectory('runtime-data');
  const runtimeDataDirectory = resolve(root, 'runtime');
  const packageDataDirectory = resolve(root, 'package');
  const localitiesCsvPath = resolve(root, 'localities.csv');
  await writeFile(localitiesCsvPath, CSV);
  for (const mode of RUNTIME_MODES) {
    const directory = resolve(runtimeDataDirectory, mode);
    await mkdir(directory, { recursive: true });
    await Promise.all([
      writeFile(
        resolve(directory, 'manifest.json'),
        `${JSON.stringify({
          date: '2026-08-31T10:00:00.000Z',
          fingerprint: 'a'.repeat(64),
          source: { dataset: 'fixture' },
        })}\n`,
      ),
      writeFile(resolve(directory, 'travel-times.bin'), matrix),
    ]);
  }
  return { runtimeDataDirectory, packageDataDirectory, localitiesCsvPath };
}

describe('runtime data assembly', () => {
  it('writes one ordered locality index and copies both matrix artifacts', async () => {
    const paths = await fixture();
    const result = await assembleRuntimeData(paths);

    expect(result).toMatchObject({ localityCount: 2, matrixByteLength: 4 });
    const localities = JSON.parse(
      await readFile(
        resolve(paths.packageDataDirectory, 'localities.json'),
        'utf8',
      ),
    ) as Array<{ localityId: string; longitude: number }>;
    expect(localities.map(({ localityId }) => localityId)).toEqual([
      '3011:bern',
      '8001:zurich',
    ]);
    expect(localities[1]?.longitude).toBe(8.54);
    for (const mode of RUNTIME_MODES) {
      expect(
        await readFile(
          resolve(paths.packageDataDirectory, mode, 'travel-times.bin'),
        ),
      ).toEqual(Buffer.from([0, 12, 18, 0]));
    }
  });

  it('rejects a matrix that cannot index the locality array', async () => {
    const paths = await fixture(Uint8Array.of(0, 12, 18));
    await expect(assembleRuntimeData(paths)).rejects.toThrow(
      'expected 4',
    );
  });
});
