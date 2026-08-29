import type { TransitStop } from './types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function parseTransitStopsJson(
  json: string,
  sourceDescription: string,
): readonly TransitStop[] {
  let value: unknown;

  try {
    value = JSON.parse(json);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Unable to parse ${sourceDescription} as JSON: ${message}`,
      { cause: error },
    );
  }

  if (!Array.isArray(value)) {
    throw new Error(`${sourceDescription} must contain a JSON array.`);
  }

  const stopIds = new Set<string>();

  return value.map((entry, index): TransitStop => {
    const invalid = (message: string): never => {
      throw new Error(
        `Invalid transit stop at index ${index} in ${sourceDescription}: ${message}.`,
      );
    };

    if (!isRecord(entry)) {
      return invalid('expected an object');
    }

    const { id, latitude, longitude, kind, parentStationId } = entry;

    if (typeof id !== 'string' || id.trim().length === 0) {
      return invalid('"id" must be a nonempty string');
    }
    if (stopIds.has(id)) {
      return invalid(`duplicate "id" ${JSON.stringify(id)}`);
    }
    if (typeof latitude !== 'number' || !Number.isFinite(latitude)) {
      return invalid('"latitude" must be a finite number');
    }
    if (typeof longitude !== 'number' || !Number.isFinite(longitude)) {
      return invalid('"longitude" must be a finite number');
    }
    if (kind !== 'STOP_OR_PLATFORM' && kind !== 'STATION') {
      return invalid(
        '"kind" must be "STOP_OR_PLATFORM" or "STATION"',
      );
    }
    if (
      parentStationId !== undefined &&
      (typeof parentStationId !== 'string' ||
        parentStationId.trim().length === 0)
    ) {
      return invalid(
        '"parentStationId" must be a nonempty string when present',
      );
    }

    stopIds.add(id);

    return {
      id,
      latitude,
      longitude,
      kind,
      ...(parentStationId === undefined ? {} : { parentStationId }),
    };
  });
}
