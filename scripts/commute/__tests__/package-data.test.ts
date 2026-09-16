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
          source: {
            dataset: 'fixture',
            ...(mode === 'public_transport'
              ? { stationNames: ['Bern', 'Zürich, Central'] }
              : {}),
          },
        })}\n`,
      ),
      writeFile(resolve(directory, 'travel-times.bin'), matrix),
    ]);
  }
  return { runtimeDataDirectory, packageDataDirectory, localitiesCsvPath };
}

describe('runtime data assembly', () => {
  it('stores station names in the locality index and keeps the package manifest as provenance', async () => {
    const paths = await fixture();
    const manifestPath = resolve(paths.runtimeDataDirectory, 'public_transport', 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    await assembleRuntimeData(paths);
    expect(JSON.parse(await readFile(
      resolve(paths.packageDataDirectory, 'public_transport', 'manifest.json'), 'utf8',
    )).source).toEqual({ dataset: 'fixture' });
    const localities = JSON.parse(await readFile(
      resolve(paths.packageDataDirectory, 'localities.json'), 'utf8',
    ));
    expect(localities.map((locality: { publicTransportStationName: string }) =>
      locality.publicTransportStationName,
    )).toEqual(['Bern', 'Zürich, Central']);
    await assembleRuntimeData(paths);
    expect(JSON.parse(await readFile(manifestPath, 'utf8')).source.stationNames)
      .toEqual(['Bern', 'Zürich, Central']);
    manifest.source.stationNames = ['Bern'];
    await writeFile(manifestPath, JSON.stringify(manifest));
    await expect(assembleRuntimeData(paths)).rejects.toThrow(/stationNames must contain 2 entries/u);
  });

  it.each([undefined, [], {}, [123, 'Zürich'], ['', 'Zürich']])(
    'rejects missing or malformed station selections: %j', async (stationNames) => {
      const paths = await fixture();
      const path = resolve(paths.runtimeDataDirectory, 'public_transport', 'manifest.json');
      await writeFile(path, JSON.stringify({ source: { stationNames } }));
      await expect(assembleRuntimeData(paths)).rejects.toThrow(/stationNames/u);
    },
  );

  it('leaves a station name absent when no active station was selected', async () => {
    const paths = await fixture();
    const path = resolve(paths.runtimeDataDirectory, 'public_transport', 'manifest.json');
    await writeFile(path, JSON.stringify({ source: { stationNames: [null, 'Zürich'] } }));
    await assembleRuntimeData(paths);
    const localities = JSON.parse(await readFile(
      resolve(paths.packageDataDirectory, 'localities.json'), 'utf8',
    ));
    expect(localities[0].publicTransportStationName).toBeUndefined();
    expect(localities[1].publicTransportStationName).toBe('Zürich');
  });

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
