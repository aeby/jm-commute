import type { TransitStop } from '../stops';
import type { TransitPlace } from './types';

function compareById(left: TransitPlace, right: TransitPlace): number {
  if (left.id < right.id) {
    return -1;
  }

  if (left.id > right.id) {
    return 1;
  }

  return 0;
}

export function buildTransitPlaces(
  stops: readonly TransitStop[],
): readonly TransitPlace[] {
  const childStopIdsByStationId = new Map<string, string[]>();

  for (const stop of stops) {
    if (
      stop.kind !== 'STOP_OR_PLATFORM' ||
      stop.parentStationId === undefined
    ) {
      continue;
    }

    const childStopIds =
      childStopIdsByStationId.get(stop.parentStationId) ?? [];
    childStopIds.push(stop.id);
    childStopIdsByStationId.set(stop.parentStationId, childStopIds);
  }

  const places: TransitPlace[] = [];

  for (const stop of stops) {
    if (stop.kind === 'STATION') {
      const childStopIds = childStopIdsByStationId.get(stop.id);

      if (childStopIds === undefined || childStopIds.length === 0) {
        continue;
      }

      places.push({
        id: stop.id,
        name: stop.name,
        latitude: stop.latitude,
        longitude: stop.longitude,
        stopIds: childStopIds.toSorted(),
      });
      continue;
    }

    if (stop.parentStationId === undefined) {
      places.push({
        id: stop.id,
        name: stop.name,
        latitude: stop.latitude,
        longitude: stop.longitude,
        stopIds: [stop.id],
      });
    }
  }

  return places.toSorted(compareById);
}
