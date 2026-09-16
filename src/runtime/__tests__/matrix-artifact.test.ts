import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createTemporaryDirectory,
  removeTemporaryDirectories,
} from '../../../scripts/commute/__tests__/temporary-directories';
import { publishMatrixArtifact } from '..';

afterEach(removeTemporaryDirectories);

describe('matrix artifact publication', () => {
  it('writes the matrix and a minimal manifest', async () => {
    const directory = await createTemporaryDirectory('matrix-artifact');
    const matrixBytes = Uint8Array.of(0, 12, 18, 0);
    const result = await publishMatrixArtifact(
      matrixBytes,
      { dataset: 'fixture' },
      {
        manifestPath: join(directory, 'manifest.json'),
        matrixPath: join(directory, 'travel-times.bin'),
      },
      new Date('2026-08-31T10:00:00.000Z'),
    );

    expect(JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')))
      .toEqual({
        date: '2026-08-31T10:00:00.000Z',
        fingerprint: result.fingerprint,
        source: { dataset: 'fixture' },
      });
    expect(await readFile(join(directory, 'travel-times.bin'))).toEqual(
      Buffer.from(matrixBytes),
    );
  });
});
