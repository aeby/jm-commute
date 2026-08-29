import type {
  RoutingFrequencyWindow,
  RoutingStopTime,
  RoutingTrip,
} from '../../prepare/routing';
import { encodePickupDropOffTypes } from './pickup-dropoff-codec';

const MAX_UINT32 = 0xffff_ffff;

export interface ExpandedConcreteTrip {
  readonly temporaryTripId: string;
  readonly routeId: string;
  readonly sourceStopIds: readonly string[];
  readonly stopTimes: Uint32Array;
  readonly pickupDropOffTypes: Uint8Array;
}

const validateUint32Time = (value: number, context: string): void => {
  if (!Number.isInteger(value) || value < 0 || value > MAX_UINT32) {
    throw new RangeError(`${context} must fit in an unsigned 32-bit integer`);
  }
};

const validatePickupDropOffType = (
  value: number,
  context: string,
): void => {
  if (!Number.isInteger(value) || value < 0 || value > 3) {
    throw new RangeError(`${context} must be an integer from 0 through 3`);
  }
};

const validateTrip = (trip: RoutingTrip): void => {
  if (typeof trip.tripId !== 'string' || trip.tripId.length === 0) {
    throw new Error('Routing trip IDs must be nonempty strings');
  }
  if (typeof trip.routeId !== 'string' || trip.routeId.length === 0) {
    throw new Error(`Trip ${trip.tripId} must have a nonempty route ID`);
  }
  if (trip.stopTimes.length < 2) {
    throw new Error(`Trip ${trip.tripId} must contain at least two stops`);
  }

  trip.stopTimes.forEach((stopTime, stopIndex) => {
    if (typeof stopTime.stopId !== 'string' || stopTime.stopId.length === 0) {
      throw new Error(
        `Trip ${trip.tripId} has an empty stop ID at index ${stopIndex}`,
      );
    }
    validateUint32Time(
      stopTime.arrivalTimeSeconds,
      `Trip ${trip.tripId} arrival at stop index ${stopIndex}`,
    );
    validateUint32Time(
      stopTime.departureTimeSeconds,
      `Trip ${trip.tripId} departure at stop index ${stopIndex}`,
    );
    validatePickupDropOffType(
      stopTime.pickupType,
      `Trip ${trip.tripId} pickup type at stop index ${stopIndex}`,
    );
    validatePickupDropOffType(
      stopTime.dropOffType,
      `Trip ${trip.tripId} drop-off type at stop index ${stopIndex}`,
    );
  });
};

const compareFrequencyWindows = (
  left: RoutingFrequencyWindow,
  right: RoutingFrequencyWindow,
): number =>
  left.startTimeSeconds - right.startTimeSeconds ||
  left.endTimeSeconds - right.endTimeSeconds ||
  left.headwaySeconds - right.headwaySeconds;

const validateFrequencyWindow = (
  window: RoutingFrequencyWindow,
  tripId: string,
): void => {
  validateUint32Time(
    window.startTimeSeconds,
    `Frequency start time for trip ${tripId}`,
  );
  validateUint32Time(
    window.endTimeSeconds,
    `Frequency end time for trip ${tripId}`,
  );
  if (window.startTimeSeconds >= window.endTimeSeconds) {
    throw new RangeError(
      `Frequency start time must precede end time for trip ${tripId}`,
    );
  }
  if (!Number.isInteger(window.headwaySeconds) || window.headwaySeconds <= 0) {
    throw new RangeError(
      `Frequency headway must be a positive integer for trip ${tripId}`,
    );
  }
};

const buildShiftedTimes = (
  tripId: string,
  stopTimes: readonly RoutingStopTime[],
  offsetSeconds: number,
): Uint32Array => {
  const shifted = new Uint32Array(stopTimes.length * 2);

  stopTimes.forEach((stopTime, stopIndex) => {
    const arrival = stopTime.arrivalTimeSeconds + offsetSeconds;
    const departure = stopTime.departureTimeSeconds + offsetSeconds;
    validateUint32Time(
      arrival,
      `Expanded trip ${tripId} arrival at stop index ${stopIndex}`,
    );
    validateUint32Time(
      departure,
      `Expanded trip ${tripId} departure at stop index ${stopIndex}`,
    );
    shifted[stopIndex * 2] = arrival;
    shifted[stopIndex * 2 + 1] = departure;
  });

  return shifted;
};

const isBoardableAtOrAfter = (
  stopTimes: readonly RoutingStopTime[],
  offsetSeconds: number,
  routingWindowStartSeconds: number,
): boolean =>
  stopTimes.some(
    (stopTime) =>
      stopTime.pickupType !== 1 &&
      stopTime.departureTimeSeconds + offsetSeconds >=
        routingWindowStartSeconds,
  );

/**
 * Emits concrete trips without retaining frequency templates, using one
 * deterministic headway approximation for every GTFS frequency window.
 */
export const expandRoutingTrip = (
  trip: RoutingTrip,
  routingWindowStartSeconds: number,
  emit: (trip: ExpandedConcreteTrip) => void,
): void => {
  validateTrip(trip);
  validateUint32Time(
    routingWindowStartSeconds,
    'Routing-window start time',
  );

  const sourceStopIds = trip.stopTimes.map((stopTime) => stopTime.stopId);
  const pickupDropOffTypes = encodePickupDropOffTypes(
    trip.stopTimes.map((stopTime) => ({
      pickupType: stopTime.pickupType,
      dropOffType: stopTime.dropOffType,
    })),
  );

  if (trip.frequencyWindows.length === 0) {
    emit({
      temporaryTripId: trip.tripId,
      routeId: trip.routeId,
      sourceStopIds,
      stopTimes: buildShiftedTimes(trip.tripId, trip.stopTimes, 0),
      pickupDropOffTypes,
    });
    return;
  }

  const firstDeparture = trip.stopTimes[0]?.departureTimeSeconds;
  if (firstDeparture === undefined) {
    throw new Error(`Frequency template ${trip.tripId} has no first stop`);
  }

  const windows = [...trip.frequencyWindows].toSorted(compareFrequencyWindows);
  let previousEnd: number | undefined;

  windows.forEach((window, windowIndex) => {
    validateFrequencyWindow(window, trip.tripId);
    if (previousEnd !== undefined && window.startTimeSeconds < previousEnd) {
      throw new Error(`Frequency windows overlap for trip ${trip.tripId}`);
    }
    previousEnd = window.endTimeSeconds;

    for (
      let departure = window.startTimeSeconds;
      departure < window.endTimeSeconds;
      departure += window.headwaySeconds
    ) {
      const offsetSeconds = departure - firstDeparture;
      const temporaryTripId = `${trip.tripId}\u0000frequency:${windowIndex}:${departure}`;

      if (
        !isBoardableAtOrAfter(
          trip.stopTimes,
          offsetSeconds,
          routingWindowStartSeconds,
        )
      ) {
        // Validate the shifted instance even though it will not be retained.
        buildShiftedTimes(temporaryTripId, trip.stopTimes, offsetSeconds);
        continue;
      }

      emit({
        temporaryTripId,
        routeId: trip.routeId,
        sourceStopIds,
        stopTimes: buildShiftedTimes(
          temporaryTripId,
          trip.stopTimes,
          offsetSeconds,
        ),
        pickupDropOffTypes,
      });
    }
  });
};
