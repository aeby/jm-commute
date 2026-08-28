import { readFile } from 'node:fs/promises';

import { parseLocalityRoutingIndexJson } from './parse-locality-routing-index';
import type { LocalityRoutingIndex } from './types';

export async function loadLocalityRoutingIndex(
  path: string,
): Promise<LocalityRoutingIndex> {
  let json: string;
  try {
    json = await readFile(path, 'utf8');
  } catch (error) {
    throw new Error(`Unable to read locality routing index at "${path}".`, {
      cause: error,
    });
  }

  return parseLocalityRoutingIndexJson(json);
}
