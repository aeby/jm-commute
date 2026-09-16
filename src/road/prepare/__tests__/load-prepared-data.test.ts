import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadPreparedData } from '..';

const osrm = {
  image: 'example/osrm:26.8.0',
  version: '26.8.0',
  profile: 'car.lua',
  algorithm: 'ch',
  datasetBasename: 'fixture.osrm',
} as const;

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'prepared-road-'));
  const networkDirectory = join(directory, 'network');
  const osmPbfPath = join(directory, 'source.osm.pbf');
  const localitiesPath = join(directory, 'localities.csv');
  const pbf = Buffer.from('fixture pbf');
  const sourcePbfSha256 = createHash('sha256').update(pbf).digest('hex');
  await mkdir(networkDirectory);
  await Promise.all([
    writeFile(osmPbfPath, pbf),
    writeFile(
      localitiesPath,
      [
        'Ortschaftsname;PLZ4;E;N;Adressenanteil',
        'Beta;2000;8.2;47.2;100',
        'Alpha;1000;7.1;46.1;100',
        '',
      ].join('\n'),
    ),
    ...['hsgr', 'edges', 'geometry', 'properties'].map((suffix) =>
      writeFile(join(networkDirectory, `fixture.osrm.${suffix}`), suffix),
    ),
    writeFile(
      join(networkDirectory, 'manifest.json'),
      `${JSON.stringify(
        {
          roadGraph: {
            sourcePbfSha256,
            osrmVersion: osrm.version,
            profile: osrm.profile,
            algorithm: osrm.algorithm,
          },
        },
        null,
        2,
      )}\n`,
    ),
  ]);
  return { networkDirectory, osmPbfPath, localitiesPath };
}

describe('loadPreparedData', () => {
  it('authenticates the graph and returns canonical locality order', async () => {
    const paths = await fixture();
    const result = await loadPreparedData({ ...paths, osrm });

    expect(result.localities.map(({ localityId }) => localityId)).toEqual([
      '1000:alpha',
      '2000:beta',
    ]);
    expect(result.roadGraph.osrmVersion).toBe('26.8.0');
  });

  it('rejects a graph prepared from different OSM bytes', async () => {
    const paths = await fixture();
    await writeFile(paths.osmPbfPath, 'changed pbf');

    await expect(loadPreparedData({ ...paths, osrm })).rejects.toThrow(
      'does not match the current input',
    );
  });
});
