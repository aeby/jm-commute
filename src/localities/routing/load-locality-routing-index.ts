import { readFile } from 'node:fs/promises';

import { parseLocalityRoutingIndexJson } from './parse-locality-routing-index';
import type { LocalityRoutingIndex } from './types';

export async function loadLocalityRoutingIndex(
  path: string,
): Promise<LocalityRoutingIndex> {
  try {
    return parseLocalityRoutingIndexJson(await readFile(path, 'utf8'));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Unable to parse')) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to load locality routing index at "${path}": ${message}`, {
      cause: error,
    });
  }
}
