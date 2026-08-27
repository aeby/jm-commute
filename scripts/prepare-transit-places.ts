import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildTransitPlaces } from '../src/transit/places';
import type { TransitStop } from '../src/transit/stops';

const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const INPUT_RELATIVE_PATH = 'data/processed/transit-stops.json';
const INPUT_PATH = join(PROJECT_ROOT, INPUT_RELATIVE_PATH);
const OUTPUT_RELATIVE_PATH = 'data/processed/transit-places.json';
const OUTPUT_PATH = join(PROJECT_ROOT, OUTPUT_RELATIVE_PATH);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidEntry(index: number, message: string): never {
  throw new Error(
    `Invalid transit stop at index ${index} in ${INPUT_RELATIVE_PATH}: ${message}.`,
  );
}

function parseTransitStopsJson(json: string): readonly TransitStop[] {
  let value: unknown;

  try {
    value = JSON.parse(json);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Unable to parse ${INPUT_RELATIVE_PATH} as JSON: ${message}`,
      { cause: error },
    );
  }

  if (!Array.isArray(value)) {
    throw new Error(`${INPUT_RELATIVE_PATH} must contain a JSON array.`);
  }

  return value.map((entry, index): TransitStop => {
    if (!isRecord(entry)) {
      return invalidEntry(index, 'expected an object');
    }

    const { id, name, latitude, longitude, kind, parentStationId } = entry;

    if (typeof id !== 'string' || id.length === 0) {
      return invalidEntry(index, '"id" must be a non-empty string');
    }

    if (typeof name !== 'string') {
      return invalidEntry(index, '"name" must be a string');
    }

    if (kind !== 'STOP_OR_PLATFORM' && kind !== 'STATION') {
      return invalidEntry(
        index,
        '"kind" must be "STOP_OR_PLATFORM" or "STATION"',
      );
    }

    if (typeof latitude !== 'number' || !Number.isFinite(latitude)) {
      return invalidEntry(index, '"latitude" must be a finite number');
    }

    if (typeof longitude !== 'number' || !Number.isFinite(longitude)) {
      return invalidEntry(index, '"longitude" must be a finite number');
    }

    if (
      parentStationId !== undefined &&
      typeof parentStationId !== 'string'
    ) {
      return invalidEntry(
        index,
        '"parentStationId" must be a string when present',
      );
    }

    return {
      id,
      name,
      latitude,
      longitude,
      kind,
      ...(parentStationId === undefined ? {} : { parentStationId }),
    };
  });
}

const json = await readFile(INPUT_PATH, 'utf8');
const stops = parseTransitStopsJson(json);
const places = buildTransitPlaces(stops);
const stationIds = new Set<string>();
let inputStationCount = 0;
let inputStopCount = 0;

for (const stop of stops) {
  if (stop.kind === 'STATION') {
    inputStationCount += 1;
    stationIds.add(stop.id);
  } else {
    inputStopCount += 1;
  }
}

let parentStationPlaceCount = 0;

for (const place of places) {
  if (stationIds.has(place.id)) {
    parentStationPlaceCount += 1;
  }
}

const standaloneStopPlaceCount = places.length - parentStationPlaceCount;
const excludedStationCount = inputStationCount - parentStationPlaceCount;

await mkdir(dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify(places, null, 2)}\n`, 'utf8');

console.log(`Input stations: ${inputStationCount}`);
console.log(`Input stops/platforms: ${inputStopCount}`);
console.log(`Parent-station transit places: ${parentStationPlaceCount}`);
console.log(`Standalone-stop transit places: ${standaloneStopPlaceCount}`);
console.log(
  `Stations without children excluded: ${excludedStationCount}`,
);
console.log(`Total transit places: ${places.length}`);
console.log(`Output: ${OUTPUT_RELATIVE_PATH}`);
