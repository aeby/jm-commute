import type { TransitPlace } from '../places';
import { buildStopToPlaceMap } from './build-stop-to-place-map';
import { parseGtfsTimeToSeconds } from './parse-gtfs-time';
import type { TransitPlaceServiceProfile } from './types';

interface ActiveTrip {
  readonly routeId: string;
  readonly isRail: boolean;
}

interface StopTimeEntry {
  readonly tripId: string;
  readonly departureTime: string;
  readonly stopId: string;
  readonly pickupType: string;
}

interface MutableProfile {
  departureCount: number;
  railDepartureCount: number;
  readonly routeIds: Set<string>;
  readonly railRouteIds: Set<string>;
}

interface TransitPlaceProfileAccumulator {
  addStopTime(entry: StopTimeEntry): boolean;
  buildProfiles(): readonly TransitPlaceServiceProfile[];
}

function compareByPlaceId(
  left: TransitPlaceServiceProfile,
  right: TransitPlaceServiceProfile,
): number {
  if (left.placeId < right.placeId) {
    return -1;
  }

  if (left.placeId > right.placeId) {
    return 1;
  }

  return 0;
}

function allowsNormalPickup(pickupType: string): boolean {
  switch (pickupType) {
    case '':
    case '0':
      return true;
    case '1':
    case '2':
    case '3':
      return false;
    default:
      throw new Error(
        `Invalid GTFS pickup_type "${pickupType}"; expected an empty value or 0 through 3.`,
      );
  }
}

export function createTransitPlaceProfileAccumulator(
  places: readonly TransitPlace[],
  activeTrips: ReadonlyMap<string, ActiveTrip>,
  windowStartSeconds: number,
  windowEndSeconds: number,
): TransitPlaceProfileAccumulator {
  if (
    !Number.isSafeInteger(windowStartSeconds) ||
    windowStartSeconds < 0 ||
    !Number.isSafeInteger(windowEndSeconds) ||
    windowEndSeconds <= windowStartSeconds
  ) {
    throw new RangeError(
      'Service-profile window must contain valid increasing second values.',
    );
  }

  const placeIdByStopId = buildStopToPlaceMap(places);
  const profileByPlaceId = new Map<string, MutableProfile>();

  for (const place of places) {
    profileByPlaceId.set(place.id, {
      departureCount: 0,
      railDepartureCount: 0,
      routeIds: new Set<string>(),
      railRouteIds: new Set<string>(),
    });
  }

  return {
    addStopTime(entry): boolean {
      const activeTrip = activeTrips.get(entry.tripId);

      if (activeTrip === undefined || entry.departureTime.trim().length === 0) {
        return false;
      }

      const departureSeconds = parseGtfsTimeToSeconds(entry.departureTime);

      if (
        departureSeconds < windowStartSeconds ||
        departureSeconds >= windowEndSeconds ||
        !allowsNormalPickup(entry.pickupType)
      ) {
        return false;
      }

      const placeId = placeIdByStopId.get(entry.stopId);

      if (placeId === undefined) {
        throw new Error(
          `Active trip "${entry.tripId}" references unknown GTFS stop ID "${entry.stopId}" during the service-profile window.`,
        );
      }

      const profile = profileByPlaceId.get(placeId);

      if (profile === undefined) {
        throw new Error(
          `Missing service-profile accumulator for transit place "${placeId}".`,
        );
      }

      profile.departureCount += 1;
      profile.routeIds.add(activeTrip.routeId);

      if (activeTrip.isRail) {
        profile.railDepartureCount += 1;
        profile.railRouteIds.add(activeTrip.routeId);
      }

      return true;
    },

    buildProfiles(): readonly TransitPlaceServiceProfile[] {
      const profiles = places.map((place) => {
        const profile = profileByPlaceId.get(place.id);

        if (profile === undefined) {
          throw new Error(
            `Missing service-profile accumulator for transit place "${place.id}".`,
          );
        }

        return Object.freeze({
          placeId: place.id,
          departureCount: profile.departureCount,
          routeCount: profile.routeIds.size,
          railDepartureCount: profile.railDepartureCount,
          railRouteCount: profile.railRouteIds.size,
        });
      });

      return Object.freeze(profiles.toSorted(compareByPlaceId));
    },
  };
}
