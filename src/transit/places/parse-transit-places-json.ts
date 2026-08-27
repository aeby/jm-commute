import type { TransitPlace } from './types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function parseTransitPlacesJson(
  json: string,
  sourceDescription: string,
): readonly TransitPlace[] {
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

  return value.map((entry, index): TransitPlace => {
    const invalid = (message: string): never => {
      throw new Error(
        `Invalid transit place at index ${index} in ${sourceDescription}: ${message}.`,
      );
    };

    if (!isRecord(entry)) {
      return invalid('expected an object');
    }

    const { id, name, latitude, longitude, stopIds } = entry;
    if (typeof id !== 'string' || id.trim().length === 0) {
      return invalid('"id" must be a nonempty string');
    }
    if (typeof name !== 'string' || name.trim().length === 0) {
      return invalid('"name" must be a nonempty string');
    }
    if (typeof latitude !== 'number' || !Number.isFinite(latitude)) {
      return invalid('"latitude" must be a finite number');
    }
    if (typeof longitude !== 'number' || !Number.isFinite(longitude)) {
      return invalid('"longitude" must be a finite number');
    }
    if (
      !Array.isArray(stopIds) ||
      !stopIds.every(
        (stopId) =>
          typeof stopId === 'string' && stopId.trim().length > 0,
      )
    ) {
      return invalid('"stopIds" must be an array of nonempty strings');
    }

    return { id, name, latitude, longitude, stopIds };
  });
}
