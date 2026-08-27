import type { ExpandedConcreteTrip } from './expand-frequency-trips';

export interface GroupedConcreteTrip {
  readonly temporaryTripId: string;
  readonly stopTimes: Uint32Array;
  readonly pickupDropOffTypes: Uint8Array;
}

export interface BaseRoutePatternGroup {
  readonly routeId: string;
  readonly sourceStopIds: readonly string[];
  readonly trips: GroupedConcreteTrip[];
}

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const compareStopSequences = (
  left: readonly string[],
  right: readonly string[],
): number => {
  const commonLength = Math.min(left.length, right.length);
  for (let index = 0; index < commonLength; index += 1) {
    const comparison = compareStrings(left[index] ?? '', right[index] ?? '');
    if (comparison !== 0) {
      return comparison;
    }
  }
  return left.length - right.length;
};

const compareGroupedTrips = (
  left: GroupedConcreteTrip,
  right: GroupedConcreteTrip,
): number =>
  (left.stopTimes[1] ?? 0) - (right.stopTimes[1] ?? 0) ||
  compareStrings(left.temporaryTripId, right.temporaryTripId);

export class BaseRoutePatternGrouper {
  private readonly groupsByRoute = new Map<
    string,
    Map<string, BaseRoutePatternGroup>
  >();

  add(trip: ExpandedConcreteTrip): void {
    let routeGroups = this.groupsByRoute.get(trip.routeId);
    if (routeGroups === undefined) {
      routeGroups = new Map<string, BaseRoutePatternGroup>();
      this.groupsByRoute.set(trip.routeId, routeGroups);
    }

    const stopSequenceKey = JSON.stringify(trip.sourceStopIds);
    let group = routeGroups.get(stopSequenceKey);
    if (group === undefined) {
      group = {
        routeId: trip.routeId,
        sourceStopIds: trip.sourceStopIds,
        trips: [],
      };
      routeGroups.set(stopSequenceKey, group);
    }

    group.trips.push({
      temporaryTripId: trip.temporaryTripId,
      stopTimes: trip.stopTimes,
      pickupDropOffTypes: trip.pickupDropOffTypes,
    });
  }

  finish(): BaseRoutePatternGroup[] {
    const groups: BaseRoutePatternGroup[] = [];
    for (const routeGroups of this.groupsByRoute.values()) {
      for (const group of routeGroups.values()) {
        group.trips.sort(compareGroupedTrips);
        groups.push(group);
      }
    }

    groups.sort(
      (left, right) =>
        compareStrings(left.routeId, right.routeId) ||
        compareStopSequences(left.sourceStopIds, right.sourceStopIds),
    );
    return groups;
  }

  clear(): void {
    this.groupsByRoute.clear();
  }
}

export const groupRoutePatternTrips = (
  trips: Iterable<ExpandedConcreteTrip>,
): readonly BaseRoutePatternGroup[] => {
  const grouper = new BaseRoutePatternGrouper();
  for (const trip of trips) {
    grouper.add(trip);
  }
  return grouper.finish();
};
