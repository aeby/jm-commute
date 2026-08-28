import { PROJECT_CONFIG } from '@core/config';
import {
  createLocalityId,
  normalizeCityName,
  type LocalityId,
} from '@core/localities';
import type { TransitCandidateSelectionMode } from '@core/transit/candidates';
import type {
  LocalityRoutingEntry,
  LocalityRoutingIndex,
} from '@core/transit/locality-routing';
import { buildPatternAdjacency } from '@core/transit/raptor/timetable/build-pattern-adjacency';
import type { RaptorTimetable } from '@core/transit/raptor/timetable/types';

import {
  decodeFloat32ArrayBase64,
  deserializeRaptorTimetable,
  type SerializedRaptorTimetable,
} from './browser-timetable';

export const COMMUTE_VIEWER_DATA_SCHEMA_VERSION = 2 as const;
export const COMMUTE_VIEWER_DATA_GLOBAL_KEY =
  '__SWISS_COMMUTE_VIEWER_DATA__' as const;

export interface ViewerLocality {
  readonly localityId: LocalityId;
  readonly postalCode: string;
  readonly city: string;
  readonly longitude: number;
  readonly latitude: number;
}

export interface ViewerLocalityRoutingEntry {
  readonly localityId: LocalityId;
  readonly selectionMode: TransitCandidateSelectionMode;
  readonly stopIndexes: readonly number[];
}

export interface CommuteViewerData {
  readonly schemaVersion: typeof COMMUTE_VIEWER_DATA_SCHEMA_VERSION;
  readonly feedVersion: string;
  readonly serviceDate: string;
  readonly routingWindowStart: string;
  readonly routingWindowEnd: string;
  readonly localities: readonly ViewerLocality[];
  readonly localityRoutingEntries: readonly ViewerLocalityRoutingEntry[];
  readonly timetable: SerializedRaptorTimetable;
  readonly stopCoordinatesBase64: string;
}

export interface ViewerRuntimeData {
  readonly feedVersion: string;
  readonly serviceDate: string;
  readonly routingWindowStart: string;
  readonly routingWindowEnd: string;
  readonly localities: readonly ViewerLocality[];
  readonly localityRoutingIndex: LocalityRoutingIndex;
  readonly timetable: RaptorTimetable;
  /** Longitude/latitude pairs aligned with the timetable's numeric stop indexes. */
  readonly stopCoordinates: Float32Array;
}

let cachedGeneratedRuntimeData: ViewerRuntimeData | undefined;

interface RankedLocality {
  readonly locality: ViewerLocality;
  readonly rank: number;
}

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

function invalidData(message: string, cause?: unknown): never {
  throw new Error(`Invalid generated commute viewer data: ${message}.`,
    cause === undefined ? undefined : { cause });
}

function requireRecord(value: unknown, name: string): UnknownRecord {
  if (!isRecord(value)) {
    return invalidData(`${name} must be an object`);
  }
  return value;
}

function requireArray(value: unknown, name: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    return invalidData(`${name} must be an array`);
  }
  return value;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string') {
    return invalidData(`${name} must be a string`);
  }
  return value;
}

function requireNonemptyString(value: unknown, name: string): string {
  const stringValue = requireString(value, name);
  if (stringValue.trim().length === 0) {
    return invalidData(`${name} must be nonempty`);
  }
  return stringValue;
}

function requireCoordinate(
  value: unknown,
  name: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    return invalidData(
      `${name} must be a finite number between ${minimum} and ${maximum}`,
    );
  }
  return value;
}

function parseLocalities(value: unknown): readonly ViewerLocality[] {
  const entries = requireArray(value, 'localities');
  const seenLocalityIds = new Set<LocalityId>();

  return entries.map((entry, index): ViewerLocality => {
    const record = requireRecord(entry, `localities[${index}]`);
    const postalCode = requireNonemptyString(
      record.postalCode,
      `localities[${index}].postalCode`,
    ).trim();
    const city = requireNonemptyString(
      record.city,
      `localities[${index}].city`,
    ).trim();
    const localityId = requireNonemptyString(
      record.localityId,
      `localities[${index}].localityId`,
    );
    let expectedLocalityId: LocalityId;
    try {
      expectedLocalityId = createLocalityId(postalCode, city);
    } catch (error) {
      return invalidData(`localities[${index}] has invalid ZIP/city metadata`, error);
    }
    if (localityId !== expectedLocalityId) {
      return invalidData(
        `localities[${index}].localityId must be "${expectedLocalityId}"`,
      );
    }
    if (seenLocalityIds.has(expectedLocalityId)) {
      return invalidData(`duplicate locality "${expectedLocalityId}"`);
    }
    seenLocalityIds.add(expectedLocalityId);

    return {
      localityId: expectedLocalityId,
      postalCode,
      city,
      longitude: requireCoordinate(
        record.longitude,
        `localities[${index}].longitude`,
        -180,
        180,
      ),
      latitude: requireCoordinate(
        record.latitude,
        `localities[${index}].latitude`,
        -90,
        90,
      ),
    };
  });
}

function parseSourceStopIds(value: unknown): readonly string[] {
  const entries = requireArray(value, 'timetable.sourceStopIds');
  const seenStopIds = new Set<string>();

  return entries.map((entry, index) => {
    const stopId = requireNonemptyString(
      entry,
      `timetable.sourceStopIds[${index}]`,
    );
    if (seenStopIds.has(stopId)) {
      return invalidData(`duplicate timetable source stop ID "${stopId}"`);
    }
    seenStopIds.add(stopId);
    return stopId;
  });
}

function parseSerializedTimetable(value: unknown): SerializedRaptorTimetable {
  const timetable = requireRecord(value, 'timetable');
  return {
    sourceStopIds: parseSourceStopIds(timetable.sourceStopIds),
    patternStopOffsetsBase64: requireString(
      timetable.patternStopOffsetsBase64,
      'timetable.patternStopOffsetsBase64',
    ),
    patternStopsBase64: requireString(
      timetable.patternStopsBase64,
      'timetable.patternStopsBase64',
    ),
    patternTripCountsBase64: requireString(
      timetable.patternTripCountsBase64,
      'timetable.patternTripCountsBase64',
    ),
    patternStopTimeOffsetsBase64: requireString(
      timetable.patternStopTimeOffsetsBase64,
      'timetable.patternStopTimeOffsetsBase64',
    ),
    stopTimesBase64: requireString(
      timetable.stopTimesBase64,
      'timetable.stopTimesBase64',
    ),
    patternPickupDropOffOffsetsBase64: requireString(
      timetable.patternPickupDropOffOffsetsBase64,
      'timetable.patternPickupDropOffOffsetsBase64',
    ),
    pickupDropOffTypesBase64: requireString(
      timetable.pickupDropOffTypesBase64,
      'timetable.pickupDropOffTypesBase64',
    ),
    patternOccurrenceOffsetsBase64: requireString(
      timetable.patternOccurrenceOffsetsBase64,
      'timetable.patternOccurrenceOffsetsBase64',
    ),
    patternOccurrenceValuesBase64: requireString(
      timetable.patternOccurrenceValuesBase64,
      'timetable.patternOccurrenceValuesBase64',
    ),
    transferOffsetsBase64: requireString(
      timetable.transferOffsetsBase64,
      'timetable.transferOffsetsBase64',
    ),
    transferValuesBase64: requireString(
      timetable.transferValuesBase64,
      'timetable.transferValuesBase64',
    ),
    accessTransferOffsetsBase64: requireString(
      timetable.accessTransferOffsetsBase64,
      'timetable.accessTransferOffsetsBase64',
    ),
    accessTransferValuesBase64: requireString(
      timetable.accessTransferValuesBase64,
      'timetable.accessTransferValuesBase64',
    ),
  };
}

function reconstructTimetable(value: unknown): RaptorTimetable {
  try {
    return deserializeRaptorTimetable(parseSerializedTimetable(value));
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith('Invalid generated commute viewer data:')
    ) {
      throw error;
    }
    return invalidData('timetable structure is incompatible', error);
  }
}

function validatePairArray(
  name: string,
  values: Uint32Array,
  stopCount: number,
): void {
  if (values.length % 2 !== 0) {
    return invalidData(`${name} must contain numeric stop/duration pairs`);
  }
  for (let index = 0; index < values.length; index += 2) {
    const stopIndex = values[index] ?? stopCount;
    if (stopIndex >= stopCount) {
      return invalidData(`${name} references unknown stop index ${stopIndex}`);
    }
  }
}

function validateTimetableReferences(timetable: RaptorTimetable): void {
  const stopCount = timetable.sourceStopIds.length;
  timetable.patterns.forEach((pattern, patternIndex) => {
    for (const stopIndex of pattern.stops) {
      if (stopIndex >= stopCount) {
        return invalidData(
          `timetable pattern ${patternIndex} references unknown stop index ${stopIndex}`,
        );
      }
    }
  });

  const expectedOccurrences = buildPatternAdjacency(
    timetable.patterns,
    stopCount,
  );
  timetable.patternOccurrencesByStop.forEach((occurrences, stopIndex) => {
    if (occurrences.length % 2 !== 0) {
      return invalidData(
        `timetable occurrences for stop ${stopIndex} must contain pattern/position pairs`,
      );
    }
    const expected = expectedOccurrences[stopIndex] ?? new Uint32Array();
    if (occurrences.length !== expected.length) {
      return invalidData(
        `timetable occurrences for stop ${stopIndex} do not exactly match patterns: expected ${expected.length / 2} complete unique pairs, found ${occurrences.length / 2}`,
      );
    }
    for (let index = 0; index < expected.length; index += 2) {
      const patternIndex = occurrences[index];
      const position = occurrences[index + 1];
      const expectedPatternIndex = expected[index];
      const expectedPosition = expected[index + 1];
      if (
        patternIndex !== expectedPatternIndex ||
        position !== expectedPosition
      ) {
        return invalidData(
          `timetable occurrences for stop ${stopIndex} do not match deterministic pattern order at pair ${index / 2}: expected pattern ${String(expectedPatternIndex)} position ${String(expectedPosition)}, found pattern ${String(patternIndex)} position ${String(position)}`,
        );
      }
    }
  });

  timetable.transfersByStop.forEach((edges, stopIndex) =>
    validatePairArray(`timetable transfers for stop ${stopIndex}`, edges, stopCount),
  );
  timetable.accessTransfersByStop.forEach((edges, stopIndex) =>
    validatePairArray(
      `timetable initial-access transfers for stop ${stopIndex}`,
      edges,
      stopCount,
    ),
  );
}

function parseSelectionMode(
  value: unknown,
  name: string,
): TransitCandidateSelectionMode {
  if (value !== 'WITHIN_ACCESS_RADIUS' && value !== 'NEAREST_FALLBACK') {
    return invalidData(`${name} has an unsupported selectionMode`);
  }
  return value;
}

function parseStopIndexes(
  value: unknown,
  name: string,
  stopCount: number,
): Uint32Array {
  const indexes = requireArray(value, `${name}.stopIndexes`);
  let previous = -1;
  const parsed = indexes.map((entry, index) => {
    if (!Number.isInteger(entry) || (entry as number) < 0) {
      return invalidData(
        `${name}.stopIndexes[${index}] must be a nonnegative integer`,
      );
    }
    const stopIndex = entry as number;
    if (stopIndex >= stopCount) {
      return invalidData(
        `${name}.stopIndexes[${index}] references unknown stop index ${stopIndex}`,
      );
    }
    if (stopIndex <= previous) {
      return invalidData(
        `${name}.stopIndexes must be unique and sorted in ascending order`,
      );
    }
    previous = stopIndex;
    return stopIndex;
  });
  return Uint32Array.from(parsed);
}

function parseLocalityRoutingIndex(
  value: unknown,
  localities: readonly ViewerLocality[],
  stopCount: number,
): LocalityRoutingIndex {
  const entries = requireArray(value, 'localityRoutingEntries');
  const localityById = new Map(
    localities.map((locality) => [locality.localityId, locality]),
  );
  const seenLocalityIds = new Set<LocalityId>();

  const parsed = entries.map((entry, index): LocalityRoutingEntry => {
    const name = `localityRoutingEntries[${index}]`;
    const record = requireRecord(entry, name);
    const localityId = requireNonemptyString(
      record.localityId,
      `${name}.localityId`,
    );
    const locality = localityById.get(localityId);
    if (locality === undefined) {
      return invalidData(`${name} references unknown locality "${localityId}"`);
    }
    if (seenLocalityIds.has(locality.localityId)) {
      return invalidData(
        `duplicate locality routing entry "${locality.localityId}"`,
      );
    }
    seenLocalityIds.add(locality.localityId);

    return {
      localityId: locality.localityId,
      postalCode: locality.postalCode,
      city: locality.city,
      selectionMode: parseSelectionMode(record.selectionMode, name),
      stopIndexes: parseStopIndexes(record.stopIndexes, name, stopCount),
    };
  });

  if (parsed.length !== localities.length) {
    return invalidData(
      'localityRoutingEntries must contain exactly one entry for every locality',
    );
  }
  for (const locality of localities) {
    if (!seenLocalityIds.has(locality.localityId)) {
      return invalidData(
        `localityRoutingEntries is missing locality "${locality.localityId}"`,
      );
    }
  }
  return { entries: parsed };
}

function decodeStopCoordinates(
  value: unknown,
  stopCount: number,
): Float32Array {
  const encoded = requireString(value, 'stopCoordinatesBase64');
  let coordinates: Float32Array;
  try {
    coordinates = decodeFloat32ArrayBase64(encoded);
  } catch (error) {
    return invalidData('stopCoordinatesBase64 is malformed', error);
  }
  if (coordinates.length !== stopCount * 2) {
    return invalidData(
      `stop coordinate length ${coordinates.length} does not match ${stopCount} timetable stops`,
    );
  }

  for (let stopIndex = 0; stopIndex < stopCount; stopIndex += 1) {
    const longitude = coordinates[stopIndex * 2] ?? Number.NaN;
    const latitude = coordinates[stopIndex * 2 + 1] ?? Number.NaN;
    const longitudeMissing = Number.isNaN(longitude);
    const latitudeMissing = Number.isNaN(latitude);
    if (longitudeMissing || latitudeMissing) {
      if (longitudeMissing && latitudeMissing) {
        continue;
      }
      return invalidData(
        `stop coordinate ${stopIndex} must contain either two numbers or a NaN/NaN pair`,
      );
    }
    if (
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180 ||
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90
    ) {
      return invalidData(`stop coordinate ${stopIndex} is outside WGS84 bounds`);
    }
  }
  return coordinates;
}

export function loadCommuteViewerRuntimeData(
  value: unknown,
): ViewerRuntimeData {
  if (value === undefined) {
    return invalidData(
      `commute-data.js did not define ${COMMUTE_VIEWER_DATA_GLOBAL_KEY}`,
    );
  }
  const data = requireRecord(value, 'root');
  if (data.schemaVersion !== COMMUTE_VIEWER_DATA_SCHEMA_VERSION) {
    return invalidData(
      `unsupported schema version ${String(data.schemaVersion)}`,
    );
  }

  const feedVersion = requireNonemptyString(data.feedVersion, 'feedVersion');
  const serviceDate = requireNonemptyString(data.serviceDate, 'serviceDate');
  const routingWindowStart = requireNonemptyString(
    data.routingWindowStart,
    'routingWindowStart',
  );
  const routingWindowEnd = requireNonemptyString(
    data.routingWindowEnd,
    'routingWindowEnd',
  );
  const scenario = PROJECT_CONFIG.transit.referenceScenario;
  if (
    serviceDate !== scenario.serviceDate ||
    routingWindowStart !== scenario.morningWindow.start ||
    routingWindowEnd !== scenario.morningWindow.end
  ) {
    return invalidData(
      'service date or morning routing window does not match PROJECT_CONFIG; rebuild viewer data',
    );
  }

  const timetable = reconstructTimetable(data.timetable);
  validateTimetableReferences(timetable);
  const localities = parseLocalities(data.localities);
  const localityRoutingIndex = parseLocalityRoutingIndex(
    data.localityRoutingEntries,
    localities,
    timetable.sourceStopIds.length,
  );
  const stopCoordinates = decodeStopCoordinates(
    data.stopCoordinatesBase64,
    timetable.sourceStopIds.length,
  );

  return {
    feedVersion,
    serviceDate,
    routingWindowStart,
    routingWindowEnd,
    localities,
    localityRoutingIndex,
    timetable,
    stopCoordinates,
  };
}

export function loadGeneratedCommuteViewerData(): ViewerRuntimeData {
  const globals = globalThis as typeof globalThis & Record<string, unknown>;
  const generated = globals[COMMUTE_VIEWER_DATA_GLOBAL_KEY];
  if (generated === undefined && cachedGeneratedRuntimeData !== undefined) {
    return cachedGeneratedRuntimeData;
  }
  const runtime = loadCommuteViewerRuntimeData(generated);
  cachedGeneratedRuntimeData = runtime;
  Reflect.deleteProperty(globals, COMMUTE_VIEWER_DATA_GLOBAL_KEY);
  return runtime;
}

function matchRank(
  locality: ViewerLocality,
  rawQuery: string,
  normalizedQuery: string,
): number | undefined {
  const normalizedCity = normalizeCityName(locality.city);
  const normalizedLabel = `${locality.postalCode} ${normalizedCity}`;
  if (normalizedQuery === normalizedLabel) {
    return 0;
  }
  if (rawQuery === locality.postalCode) {
    return 1;
  }
  if (/^[0-9]+$/.test(rawQuery) && locality.postalCode.startsWith(rawQuery)) {
    return 2;
  }
  if (normalizedCity === normalizedQuery) {
    return 3;
  }
  if (normalizedCity.startsWith(normalizedQuery)) {
    return 4;
  }
  if (normalizedCity.includes(normalizedQuery)) {
    return 5;
  }
  return undefined;
}

export function searchCommuteViewerLocalities(
  localities: readonly ViewerLocality[],
  query: string,
  resultLimit: number,
): readonly ViewerLocality[] {
  if (!Number.isInteger(resultLimit) || resultLimit <= 0) {
    throw new RangeError('Autocomplete resultLimit must be a positive integer.');
  }
  const rawQuery = query.trim().toLowerCase();
  const normalizedQuery = normalizeCityName(query);
  if (normalizedQuery.length === 0) {
    return [];
  }

  const matches: RankedLocality[] = [];
  for (const locality of localities) {
    const rank = matchRank(locality, rawQuery, normalizedQuery);
    if (rank !== undefined) {
      matches.push({ locality, rank });
    }
  }
  return matches
    .toSorted(
      (left, right) =>
        left.rank - right.rank ||
        compareStrings(left.locality.localityId, right.locality.localityId),
    )
    .slice(0, resultLimit)
    .map(({ locality }) => locality);
}
