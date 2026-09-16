import type {
  RoadGraphMetadata,
  RoadPreparedDataManifest,
} from './types';

function invalid(source: string, path: string, detail: string): never {
  throw new Error(
    `Invalid prepared road data in ${source} at ${path}: ${detail}.`,
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseRoadGraphMetadata(
  value: unknown,
  source: string,
): RoadGraphMetadata {
  if (!isRecord(value)) {
    return invalid(source, 'roadGraph', 'expected an object');
  }
  if (
    typeof value.sourcePbfSha256 !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(value.sourcePbfSha256)
  ) {
    return invalid(
      source,
      'roadGraph.sourcePbfSha256',
      'expected a lowercase SHA-256 digest',
    );
  }
  if (
    typeof value.osrmVersion !== 'string' ||
    !/^\d+\.\d+\.\d+$/u.test(value.osrmVersion)
  ) {
    return invalid(source, 'roadGraph.osrmVersion', 'expected a version');
  }
  if (value.profile !== 'car.lua') {
    return invalid(source, 'roadGraph.profile', 'expected "car.lua"');
  }
  if (value.algorithm !== 'ch') {
    return invalid(source, 'roadGraph.algorithm', 'expected "ch"');
  }
  return {
    sourcePbfSha256: value.sourcePbfSha256,
    osrmVersion: value.osrmVersion,
    profile: value.profile,
    algorithm: value.algorithm,
  };
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
    keys.length !== 1 ||
    !keys.includes('roadGraph')
  ) {
    return invalid(
      source,
      '$',
      'expected exactly roadGraph',
    );
  }

  return Object.freeze({
    roadGraph: parseRoadGraphMetadata(value.roadGraph, source),
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
