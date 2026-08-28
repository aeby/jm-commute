import { createLocalityId, type LocalityId } from '../../localities';
import type { TransitCandidateSelectionMode } from '../candidates';
import type {
  LocalityRoutingEntry,
  LocalityRoutingIndex,
} from './types';

const MAXIMUM_UINT32 = 0xffff_ffff;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function invalidEntry(index: number, message: string): never {
  throw new Error(`Invalid locality routing entry at index ${index}: ${message}.`);
}

function parseSelectionMode(
  value: unknown,
  index: number,
): TransitCandidateSelectionMode {
  if (value !== 'WITHIN_ACCESS_RADIUS' && value !== 'NEAREST_FALLBACK') {
    return invalidEntry(index, 'unsupported selectionMode');
  }
  return value;
}

function parseStopIndexes(value: unknown, index: number): Uint32Array {
  if (!Array.isArray(value)) {
    return invalidEntry(index, 'stopIndexes must be an array');
  }

  let previousStopIndex = -1;
  for (const stopIndex of value) {
    if (
      !Number.isInteger(stopIndex) ||
      (stopIndex as number) < 0 ||
      (stopIndex as number) > MAXIMUM_UINT32
    ) {
      return invalidEntry(index, 'stopIndexes must contain Uint32 integers');
    }
    if ((stopIndex as number) <= previousStopIndex) {
      return invalidEntry(
        index,
        'stopIndexes must be unique and sorted in ascending order',
      );
    }
    previousStopIndex = stopIndex as number;
  }

  return Uint32Array.from(value as number[]);
}

export function parseLocalityRoutingIndexJson(
  json: string,
): LocalityRoutingIndex {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to parse locality routing index JSON: ${message}`, {
      cause: error,
    });
  }

  if (!isRecord(value)) {
    throw new Error('Locality routing index must contain a JSON object.');
  }
  if (value.schemaVersion !== 1) {
    throw new Error('Locality routing index schemaVersion must be 1.');
  }
  if (!Array.isArray(value.entries)) {
    throw new Error('Locality routing index entries must be an array.');
  }

  const seenLocalityIds = new Set<LocalityId>();
  const entries = value.entries.map((entry, index): LocalityRoutingEntry => {
    if (!isRecord(entry)) {
      return invalidEntry(index, 'expected an object');
    }

    const { localityId, postalCode, city, selectionMode, stopIndexes } = entry;
    if (typeof postalCode !== 'string' || typeof city !== 'string') {
      return invalidEntry(index, 'postalCode and city must be strings');
    }
    const expectedLocalityId = createLocalityId(postalCode, city);
    if (localityId !== expectedLocalityId) {
      return invalidEntry(
        index,
        `localityId must be "${expectedLocalityId}"`,
      );
    }
    if (seenLocalityIds.has(expectedLocalityId)) {
      return invalidEntry(index, `duplicate localityId "${expectedLocalityId}"`);
    }
    seenLocalityIds.add(expectedLocalityId);

    return {
      localityId: expectedLocalityId,
      postalCode: postalCode.trim(),
      city: city.trim(),
      selectionMode: parseSelectionMode(selectionMode, index),
      stopIndexes: parseStopIndexes(stopIndexes, index),
    };
  });

  return { entries };
}

export function createLocalityRoutingEntryMap(
  index: LocalityRoutingIndex,
): ReadonlyMap<LocalityId, LocalityRoutingEntry> {
  const entriesById = new Map<LocalityId, LocalityRoutingEntry>();
  for (const entry of index.entries) {
    if (entriesById.has(entry.localityId)) {
      throw new Error(`Duplicate locality routing entry "${entry.localityId}".`);
    }
    entriesById.set(entry.localityId, entry);
  }
  return entriesById;
}
