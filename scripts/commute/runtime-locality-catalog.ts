import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  parseLocalityCatalogFileJson,
  serializeOrderedLocalityIds,
  type LocalityCatalogFile,
} from '../../packages/commute/src/localities/locality-catalog.js';
import { createLocalityId } from '../../packages/commute/src/localities/locality-id.js';
import type {
  Locality,
  LocalityId,
} from '../../packages/commute/src/localities/types.js';
import { parseLocalitiesCsv } from '../../src/localities/node.js';
import {
  OFFICIAL_LOCALITIES_CSV_PATH,
  ROOT_RUNTIME_LOCALITIES_PATH,
} from './paths';

export interface RuntimeLocalityCatalogArtifact {
  readonly path: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly localityCount: number;
  readonly orderedLocalitySha256: string;
}

export interface RuntimeLocalityCatalogBuild
  extends RuntimeLocalityCatalogArtifact {
  readonly sourceCsvPath: string;
  readonly sourceCsvSha256: string;
  readonly elapsedMilliseconds: number;
}

export interface GeneratedRuntimeLocalityCatalog {
  readonly file: LocalityCatalogFile;
  readonly serialized: string;
}

export interface AuthenticatedLocalityCatalog {
  readonly artifact: RuntimeLocalityCatalogArtifact;
  readonly file: LocalityCatalogFile;
  readonly bytes: Buffer;
}

function sha256(bytes: string | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertOrderedLocalityDigest(
  file: LocalityCatalogFile,
  source: string,
): void {
  const actual = sha256(serializeOrderedLocalityIds(file.localities));
  if (actual !== file.orderedLocalitySha256) {
    throw new Error(
      `Locality catalog ${source} has ordered-locality SHA-256 ` +
        `${file.orderedLocalitySha256}; recomputed ${actual}.`,
    );
  }
}

export function assertCatalogLocalityOrdering(
  file: LocalityCatalogFile,
  orderedLocalityIds: readonly LocalityId[],
  source: string,
): void {
  if (file.localityCount !== orderedLocalityIds.length) {
    throw new Error(
      `Locality catalog ${source} contains ${file.localityCount} localities; ` +
        `matrices contain ${orderedLocalityIds.length}.`,
    );
  }
  for (let index = 0; index < orderedLocalityIds.length; index += 1) {
    const actual = file.localities[index]?.localityId;
    const expected = orderedLocalityIds[index];
    if (actual !== expected) {
      throw new Error(
        `Locality catalog ${source} differs from matrix order at index ` +
          `${index}: ${String(actual)} versus ${String(expected)}.`,
      );
    }
  }
}

export async function authenticateRuntimeLocalityCatalog(
  path: string,
  orderedLocalityIds: readonly LocalityId[],
): Promise<AuthenticatedLocalityCatalog> {
  const bytes = await readFile(path);
  const file = parseLocalityCatalogFileJson(bytes.toString('utf8'), path);
  assertOrderedLocalityDigest(file, path);
  assertCatalogLocalityOrdering(file, orderedLocalityIds, path);
  return {
    artifact: {
      path,
      byteLength: bytes.byteLength,
      sha256: sha256(bytes),
      localityCount: file.localityCount,
      orderedLocalitySha256: file.orderedLocalitySha256,
    },
    file,
    bytes,
  };
}

function createOrderedLocalities(
  csv: string,
  orderedLocalityIds: readonly LocalityId[],
): readonly Locality[] {
  const parsed = parseLocalitiesCsv(csv);
  const localitiesById = new Map<LocalityId, Locality>();
  for (const locality of parsed) {
    const localityId = createLocalityId(locality.postalCode, locality.city);
    if (locality.localityId !== localityId) {
      throw new Error(
        `Official locality parser produced ID "${locality.localityId}"; ` +
          `expected "${localityId}".`,
      );
    }
    if (localitiesById.has(localityId)) {
      throw new Error(
        `Official locality input contains duplicate canonical ID "${localityId}" ` +
          'after applying the established duplicate policy.',
      );
    }
    localitiesById.set(localityId, Object.freeze({ ...locality }));
  }
  if (localitiesById.size !== orderedLocalityIds.length) {
    throw new Error(
      `Official locality input contains ${localitiesById.size} canonical ` +
        `localities; matrices contain ${orderedLocalityIds.length}.`,
    );
  }

  const ordered = orderedLocalityIds.map((localityId) => {
    const locality = localitiesById.get(localityId);
    if (locality === undefined) {
      throw new Error(
        `Matrix locality "${localityId}" is missing from the official input.`,
      );
    }
    return locality;
  });
  if (new Set(orderedLocalityIds).size !== orderedLocalityIds.length) {
    throw new Error('Matrix locality ordering contains duplicate IDs.');
  }
  return Object.freeze(ordered);
}

function serializeCatalog(file: LocalityCatalogFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

export function generateRuntimeLocalityCatalog(
  csv: string,
  orderedLocalityIds: readonly LocalityId[],
): GeneratedRuntimeLocalityCatalog {
  const localities = createOrderedLocalities(csv, orderedLocalityIds);
  const file: LocalityCatalogFile = {
    schemaVersion: 1,
    localityCount: localities.length,
    orderedLocalitySha256: sha256(serializeOrderedLocalityIds(localities)),
    localities,
  };
  const serialized = serializeCatalog(file);
  const parsed = parseLocalityCatalogFileJson(
    serialized,
    'generated runtime locality catalog',
  );
  assertOrderedLocalityDigest(parsed, 'generated catalog');
  assertCatalogLocalityOrdering(
    parsed,
    orderedLocalityIds,
    'generated catalog',
  );
  if (serializeCatalog(parsed) !== serialized) {
    throw new Error('Runtime locality catalog serialization is not canonical.');
  }
  return { file: parsed, serialized };
}

export async function buildRuntimeLocalityCatalog(
  orderedLocalityIds: readonly LocalityId[],
): Promise<RuntimeLocalityCatalogBuild> {
  const startedAt = performance.now();
  const csvBytes = await readFile(OFFICIAL_LOCALITIES_CSV_PATH);
  const generated = generateRuntimeLocalityCatalog(
    csvBytes.toString('utf8'),
    orderedLocalityIds,
  );

  await mkdir(dirname(ROOT_RUNTIME_LOCALITIES_PATH), { recursive: true });
  const stagedPath = resolve(
    dirname(ROOT_RUNTIME_LOCALITIES_PATH),
    `.localities-${process.pid}-${randomUUID()}.tmp`,
  );
  try {
    await writeFile(stagedPath, generated.serialized, { flag: 'wx' });
    const staged = await authenticateRuntimeLocalityCatalog(
      stagedPath,
      orderedLocalityIds,
    );
    if (!staged.bytes.equals(Buffer.from(generated.serialized))) {
      throw new Error('Staged locality catalog differs from generated bytes.');
    }
    await rename(stagedPath, ROOT_RUNTIME_LOCALITIES_PATH);
    const published = await authenticateRuntimeLocalityCatalog(
      ROOT_RUNTIME_LOCALITIES_PATH,
      orderedLocalityIds,
    );
    if (!published.bytes.equals(staged.bytes)) {
      throw new Error('Published locality catalog differs from staged bytes.');
    }
    return {
      ...published.artifact,
      sourceCsvPath: OFFICIAL_LOCALITIES_CSV_PATH,
      sourceCsvSha256: sha256(csvBytes),
      elapsedMilliseconds: performance.now() - startedAt,
    };
  } finally {
    await rm(stagedPath, { force: true });
  }
}
