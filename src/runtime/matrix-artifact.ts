import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

export interface MatrixArtifactManifest<
  TSource extends object,
> {
  readonly date: string;
  readonly fingerprint: string;
  readonly source: TSource;
}

export interface MatrixArtifactPaths {
  readonly manifestPath: string;
  readonly matrixPath: string;
}

export interface PublishedMatrixArtifact<
  TSource extends object,
> {
  readonly manifest: MatrixArtifactManifest<TSource>;
  readonly matrixByteLength: number;
  readonly fingerprint: string;
}

function fingerprint(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function writeSynced(path: string, bytes: Uint8Array): Promise<void> {
  const handle = await open(path, 'wx');
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** Publishes a finished matrix first and its small metadata file last. */
export async function publishMatrixArtifact<
  TSource extends object,
>(
  matrixBytes: Uint8Array,
  source: TSource,
  paths: MatrixArtifactPaths,
  date = new Date(),
): Promise<PublishedMatrixArtifact<TSource>> {
  const manifestPath = resolve(paths.manifestPath);
  const matrixPath = resolve(paths.matrixPath);
  const outputDirectory = dirname(manifestPath);
  if (manifestPath === matrixPath) {
    throw new Error('Matrix manifest and binary paths must differ.');
  }
  if (outputDirectory !== dirname(matrixPath)) {
    throw new Error('Matrix manifest and binary must share a directory.');
  }

  const matrixFingerprint = fingerprint(matrixBytes);
  const manifest: MatrixArtifactManifest<TSource> = {
    date: date.toISOString(),
    fingerprint: matrixFingerprint,
    source,
  };
  const manifestBytes = Buffer.from(
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );

  await mkdir(outputDirectory, { recursive: true });
  const publicationId = `${process.pid}.${randomUUID()}`;
  const stagedManifestPath = resolve(
    outputDirectory,
    `.${basename(manifestPath)}.${publicationId}.staged`,
  );
  const stagedMatrixPath = resolve(
    outputDirectory,
    `.${basename(matrixPath)}.${publicationId}.staged`,
  );
  try {
    await Promise.all([
      writeSynced(stagedManifestPath, manifestBytes),
      writeSynced(stagedMatrixPath, matrixBytes),
    ]);
    await rename(stagedMatrixPath, matrixPath);
    await rename(stagedManifestPath, manifestPath);
  } finally {
    await Promise.all([
      unlink(stagedManifestPath).catch(() => undefined),
      unlink(stagedMatrixPath).catch(() => undefined),
    ]);
  }

  return {
    manifest,
    matrixByteLength: matrixBytes.byteLength,
    fingerprint: matrixFingerprint,
  };
}
