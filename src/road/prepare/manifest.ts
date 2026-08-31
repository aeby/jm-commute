import { parseCarRoadGraphMetadata } from '@commute-internal/car/road-graph-metadata';

import type { RoadPreparedDataManifest } from './types';

export const ROAD_PREPARED_DATA_SCHEMA_VERSION = 1;

function invalid(source: string, path: string, detail: string): never {
  throw new Error(
    `Invalid prepared road data in ${source} at ${path}: ${detail}.`,
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseRoadPreparedDataManifest(
  value: unknown,
  source = 'value',
): RoadPreparedDataManifest {
  if (!isRecord(value)) {
    return invalid(source, '$', 'expected an object');
  }
  const keys = Object.keys(value);
  if (
    keys.length !== 2 ||
    !keys.includes('schemaVersion') ||
    !keys.includes('roadGraph')
  ) {
    return invalid(
      source,
      '$',
      'expected exactly schemaVersion and roadGraph',
    );
  }
  if (value.schemaVersion !== ROAD_PREPARED_DATA_SCHEMA_VERSION) {
    return invalid(source, 'schemaVersion', 'expected 1');
  }

  return Object.freeze({
    schemaVersion: ROAD_PREPARED_DATA_SCHEMA_VERSION,
    roadGraph: parseCarRoadGraphMetadata(
      value.roadGraph,
      'roadGraph',
      (path, detail) => invalid(source, path, detail),
    ),
  });
}

export function parseRoadPreparedDataManifestJson(
  json: string,
  source = 'prepared road data JSON',
): RoadPreparedDataManifest {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to parse ${source}: ${message}`, { cause: error });
  }
  return parseRoadPreparedDataManifest(value, source);
}

export function serializeRoadPreparedDataManifest(
  manifest: RoadPreparedDataManifest,
): string {
  const validated = parseRoadPreparedDataManifest(
    manifest,
    'prepared road data serialization input',
  );
  return `${JSON.stringify(validated, null, 2)}\n`;
}
