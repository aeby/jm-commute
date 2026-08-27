import type { TransitPlace } from '../places';

export function buildStopToPlaceMap(
  places: readonly TransitPlace[],
): ReadonlyMap<string, string> {
  const placeIds = new Set<string>();
  const placeIdByStopId = new Map<string, string>();

  for (const place of places) {
    if (typeof place.id !== 'string' || place.id.trim().length === 0) {
      throw new Error('Every transit place must have a nonempty string ID.');
    }

    if (placeIds.has(place.id)) {
      throw new Error(`Duplicate transit-place ID "${place.id}".`);
    }

    placeIds.add(place.id);

    if (!Array.isArray(place.stopIds) || place.stopIds.length === 0) {
      throw new Error(
        `Transit place "${place.id}" must contain at least one stop ID.`,
      );
    }

    for (const stopId of place.stopIds) {
      if (typeof stopId !== 'string' || stopId.trim().length === 0) {
        throw new Error(
          `Transit place "${place.id}" contains an invalid empty stop ID.`,
        );
      }

      const existingPlaceId = placeIdByStopId.get(stopId);

      if (existingPlaceId !== undefined) {
        throw new Error(
          `GTFS stop ID "${stopId}" is assigned to both transit place "${existingPlaceId}" and "${place.id}".`,
        );
      }

      placeIdByStopId.set(stopId, place.id);
    }
  }

  return placeIdByStopId;
}
