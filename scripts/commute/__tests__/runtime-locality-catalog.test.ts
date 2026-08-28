import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  authenticateRuntimeLocalityCatalog,
  generateRuntimeLocalityCatalog,
} from '../runtime-locality-catalog';
import { createTemporaryDirectory, removeTemporaryDirectories } from './temporary-directories';

const CSV = [
  'Ortschaftsname;PLZ4;E;N;Adressenanteil',
  'Zürich;8001;8.50;47.30;10',
  'Bern;3011;7.44;46.95;100',
  'Zürich;8001;8.54;47.37;90',
  '',
].join('\n');

const ORDER = ['8001:zurich', '3011:bern'] as const;

afterEach(removeTemporaryDirectories);

describe('runtime locality catalog publication primitives', () => {
  it('uses established duplicate selection while preserving matrix order', () => {
    const generated = generateRuntimeLocalityCatalog(CSV, ORDER);

    expect(generated.file.localities.map(({ localityId }) => localityId)).toEqual(
      ORDER,
    );
    expect(generated.file.localities[0]).toMatchObject({
      localityId: '8001:zurich',
      city: 'Zürich',
      longitude: 8.54,
      latitude: 47.37,
    });
  });

  it('is byte-deterministic for identical CSV and ordering', () => {
    const first = generateRuntimeLocalityCatalog(CSV, ORDER);
    const second = generateRuntimeLocalityCatalog(CSV, ORDER);

    expect(second.serialized).toBe(first.serialized);
    expect(second.file.orderedLocalitySha256).toBe(
      first.file.orderedLocalitySha256,
    );
  });

  it('authenticates its digest and exact matrix order on readback', async () => {
    const directory = await createTemporaryDirectory('catalog');
    const path = resolve(directory, 'localities.json');
    const generated = generateRuntimeLocalityCatalog(CSV, ORDER);
    await writeFile(path, generated.serialized);

    const authenticated = await authenticateRuntimeLocalityCatalog(path, ORDER);
    expect(authenticated.artifact.localityCount).toBe(2);
    await expect(
      authenticateRuntimeLocalityCatalog(path, ORDER.toReversed()),
    ).rejects.toThrow('differs from matrix order');

    const tampered = JSON.parse(generated.serialized) as {
      orderedLocalitySha256: string;
    };
    tampered.orderedLocalitySha256 = '0'.repeat(64);
    await writeFile(path, `${JSON.stringify(tampered, null, 2)}\n`);
    await expect(
      authenticateRuntimeLocalityCatalog(path, ORDER),
    ).rejects.toThrow('recomputed');
  });
});

