import type { TransitPlace } from '../../prepare/places';
import {
  getDepartureTime,
  getDropOffType,
  getPickupType,
} from '../timetable/route-pattern-access';
import type { RaptorTimetable } from '../timetable/types';

export interface ActiveTransitPlace extends TransitPlace {
  readonly departureCount: number;
  readonly railDepartureCount: number;
}

/**
 * Counts concrete trips that can be boarded in the network's validated window
 * and allow alighting at another physical place. Each trip counts at most once
 * per physical place, even when it visits multiple platforms there.
 */
export function collectActiveTransitPlaces(
  places: readonly TransitPlace[],
  timetable: RaptorTimetable,
  railByRouteId: ReadonlyMap<string, boolean>,
  windowStartSeconds: number,
  windowEndSeconds: number,
): readonly ActiveTransitPlace[] {
  const placeIdBySourceStopId = new Map<string, string>();
  for (const place of places) {
    for (const sourceStopId of place.stopIds) {
      const existingPlaceId = placeIdBySourceStopId.get(sourceStopId);
      if (existingPlaceId !== undefined && existingPlaceId !== place.id) {
        throw new Error(
          `Transit stop "${sourceStopId}" belongs to both "${existingPlaceId}" and "${place.id}".`,
        );
      }
      placeIdBySourceStopId.set(sourceStopId, place.id);
    }
  }

  const placeIdByStopIndex = timetable.sourceStopIds.map((sourceStopId) =>
    placeIdBySourceStopId.get(sourceStopId),
  );
  const countsByPlaceId = new Map<
    string,
    { departureCount: number; railDepartureCount: number }
  >();

  for (const pattern of timetable.patterns) {
    const isRail = railByRouteId.get(pattern.routeId);
    if (isRail === undefined) {
      throw new Error(`Timetable route "${pattern.routeId}" is missing from routes.txt.`);
    }
    for (let tripIndex = 0; tripIndex < pattern.tripCount; tripIndex += 1) {
      const downstreamPlaceIds = new Set<string>();
      const countedPlaceIds = new Set<string>();

      for (
        let patternStopIndex = pattern.stops.length - 1;
        patternStopIndex >= 0;
        patternStopIndex -= 1
      ) {
        const stopIndex = pattern.stops[patternStopIndex];
        const placeId =
          stopIndex === undefined ? undefined : placeIdByStopIndex[stopIndex];

        if (
          placeId !== undefined &&
          !countedPlaceIds.has(placeId) &&
          getPickupType(pattern, patternStopIndex, tripIndex) !== 1
        ) {
          const departureTime = getDepartureTime(
            pattern,
            patternStopIndex,
            tripIndex,
          );
          if (
            departureTime >= windowStartSeconds &&
            departureTime < windowEndSeconds &&
            downstreamPlaceIds.size > 0 &&
            (downstreamPlaceIds.size > 1 || !downstreamPlaceIds.has(placeId))
          ) {
            const counts = countsByPlaceId.get(placeId) ?? {
              departureCount: 0,
              railDepartureCount: 0,
            };
            counts.departureCount += 1;
            counts.railDepartureCount += isRail ? 1 : 0;
            countsByPlaceId.set(placeId, counts);
            countedPlaceIds.add(placeId);
          }
        }

        if (
          placeId !== undefined &&
          getDropOffType(pattern, patternStopIndex, tripIndex) !== 1
        ) {
          downstreamPlaceIds.add(placeId);
        }
      }
    }
  }

  return places.flatMap((place) => {
    const counts = countsByPlaceId.get(place.id);
    return counts === undefined ? [] : [{ ...place, ...counts }];
  });
}
