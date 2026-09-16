import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readGtfsRailRoutes } from '../read-gtfs-rail-routes';

const roots: string[] = [];
async function readRoutes(csv: string) {
  const root = await mkdtemp(join(tmpdir(), 'jm-rail-routes-'));
  roots.push(root);
  const path = join(root, 'routes.txt');
  await writeFile(path, csv);
  return readGtfsRailRoutes(path);
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('readGtfsRailRoutes', () => {
  it('recognizes standard and extended passenger rail without boosting other modes', async () => {
    const rail = [2, 100, 101, 102, 103, 105, 106, 107, 108, 109, 111, 113, 114, 116, 117];
    const other = [0, 1, 3, 104, 110, 112, 115, 401, 700, 714, 900, 1000, 1300, 1400];
    const result = await readRoutes('\uFEFFroute_id,route_type\r\n' +
      [...rail, ...other].map((type) => `"route-${type}",${type}`).join('\r\n'));
    expect([...result].filter(([, isRail]) => isRail).map(([id]) => id))
      .toEqual(rail.map((type) => `route-${type}`));
    for (const type of other) expect(result.get(`route-${type}`)).toBe(false);
  });

  it.each(['', '-1', 'train', '2.5', '9007199254740992'])(
    'rejects malformed route type %j', async (type) => {
      await expect(readRoutes(`route_id,route_type\na,${type}\n`)).rejects.toThrow(/invalid route_type/);
    },
  );

  it('rejects duplicate routes and missing columns', async () => {
    await expect(readRoutes('route_id,route_type\na,2\na,700\n')).rejects.toThrow(/duplicate route_id/i);
    await expect(readRoutes('route_id\na\n')).rejects.toThrow(/missing required column/i);
  });
});
