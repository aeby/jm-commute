import { createHash } from 'node:crypto';

import type {
  CommuteApiRuntime,
  LocalitiesResponse,
} from '../api-types.js';

export interface LocalitiesRepresentation {
  readonly body: string;
  readonly etag: string;
}

/** Serialize and fingerprint the immutable locality response exactly once. */
export function createLocalitiesRepresentation(
  runtime: Pick<CommuteApiRuntime, 'localities'>,
): LocalitiesRepresentation {
  const response: LocalitiesResponse = {
    localities: runtime.localities,
  };
  const body = JSON.stringify(response);
  const sha256 = createHash('sha256').update(body, 'utf8').digest('hex');
  return Object.freeze({ body, etag: `"${sha256}"` });
}

export function etagMatches(
  ifNoneMatch: string | undefined,
  etag: string,
): boolean {
  if (ifNoneMatch === undefined) {
    return false;
  }
  return ifNoneMatch
    .split(',')
    .map((candidate) => candidate.trim())
    .some(
      (candidate) =>
        candidate === '*' || candidate === etag || candidate === `W/${etag}`,
    );
}
