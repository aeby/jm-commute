import type {
  ExactTimes,
  PickupDropOffType,
  RoutingFrequencyWindow,
  RoutingStopTime,
  RoutingTrip,
} from './types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const invalid = (source: string, message: string): never => {
  throw new Error(`Invalid routing trip in ${source}: ${message}.`);
};

const parsePickupDropOffType = (
  value: unknown,
  source: string,
  field: string,
): PickupDropOffType => {
  if (value !== 0 && value !== 1 && value !== 2 && value !== 3) {
    return invalid(source, `${field} must be 0, 1, 2, or 3`);
  }
  return value;
};

const parseStopTimes = (
  value: unknown,
  source: string,
): readonly RoutingStopTime[] => {
  if (!Array.isArray(value) || value.length < 2) {
    return invalid(source, 'stopTimes must contain at least two entries');
  }

  let previousSequence = -1;
  let previousDeparture = -1;
  return value.map((entry, index): RoutingStopTime => {
    if (!isRecord(entry)) {
      return invalid(source, `stopTimes[${index}] must be an object`);
    }
    const {
      stopId,
      stopSequence,
      arrivalTimeSeconds,
      departureTimeSeconds,
      pickupType,
      dropOffType,
    } = entry;
    if (typeof stopId !== 'string' || stopId.trim().length === 0) {
      return invalid(source, `stopTimes[${index}].stopId must be nonempty`);
    }
    if (!Number.isSafeInteger(stopSequence) || (stopSequence as number) < 0) {
      return invalid(
        source,
        `stopTimes[${index}].stopSequence must be a nonnegative integer`,
      );
    }
    if ((stopSequence as number) <= previousSequence) {
      return invalid(source, 'stop sequences must be strictly increasing');
    }
    if (
      !Number.isSafeInteger(arrivalTimeSeconds) ||
      (arrivalTimeSeconds as number) < 0 ||
      !Number.isSafeInteger(departureTimeSeconds) ||
      (departureTimeSeconds as number) < 0
    ) {
      return invalid(source, `stopTimes[${index}] times must be nonnegative integers`);
    }
    if ((arrivalTimeSeconds as number) > (departureTimeSeconds as number)) {
      return invalid(source, `stopTimes[${index}] arrives after departure`);
    }
    if (previousDeparture > (arrivalTimeSeconds as number)) {
      return invalid(source, 'stop times move backwards');
    }

    previousSequence = stopSequence as number;
    previousDeparture = departureTimeSeconds as number;
    return {
      stopId,
      stopSequence: stopSequence as number,
      arrivalTimeSeconds: arrivalTimeSeconds as number,
      departureTimeSeconds: departureTimeSeconds as number,
      pickupType: parsePickupDropOffType(
        pickupType,
        source,
        `stopTimes[${index}].pickupType`,
      ),
      dropOffType: parsePickupDropOffType(
        dropOffType,
        source,
        `stopTimes[${index}].dropOffType`,
      ),
    };
  });
};

const parseFrequencyWindows = (
  value: unknown,
  source: string,
): readonly RoutingFrequencyWindow[] => {
  if (!Array.isArray(value)) {
    return invalid(source, 'frequencyWindows must be an array');
  }

  let previousEnd = -1;
  return value.map((entry, index): RoutingFrequencyWindow => {
    if (!isRecord(entry)) {
      return invalid(source, `frequencyWindows[${index}] must be an object`);
    }
    const { startTimeSeconds, endTimeSeconds, headwaySeconds, exactTimes } =
      entry;
    if (
      !Number.isSafeInteger(startTimeSeconds) ||
      (startTimeSeconds as number) < 0 ||
      !Number.isSafeInteger(endTimeSeconds) ||
      (endTimeSeconds as number) < 0 ||
      (startTimeSeconds as number) >= (endTimeSeconds as number)
    ) {
      return invalid(
        source,
        `frequencyWindows[${index}] must have increasing nonnegative integer times`,
      );
    }
    if ((startTimeSeconds as number) < previousEnd) {
      return invalid(source, 'frequency windows must not overlap');
    }
    if (!Number.isSafeInteger(headwaySeconds) || (headwaySeconds as number) <= 0) {
      return invalid(
        source,
        `frequencyWindows[${index}].headwaySeconds must be a positive integer`,
      );
    }
    if (exactTimes !== 0 && exactTimes !== 1) {
      return invalid(
        source,
        `frequencyWindows[${index}].exactTimes must be 0 or 1`,
      );
    }

    previousEnd = endTimeSeconds as number;
    return {
      startTimeSeconds: startTimeSeconds as number,
      endTimeSeconds: endTimeSeconds as number,
      headwaySeconds: headwaySeconds as number,
      exactTimes: exactTimes as ExactTimes,
    };
  });
};

export function parseRoutingTrip(value: unknown, source: string): RoutingTrip {
  if (!isRecord(value)) {
    return invalid(source, 'expected an object');
  }
  const { tripId, routeId, routeType, stopTimes, frequencyWindows } = value;
  if (typeof tripId !== 'string' || tripId.trim().length === 0) {
    return invalid(source, 'tripId must be a nonempty string');
  }
  if (typeof routeId !== 'string' || routeId.trim().length === 0) {
    return invalid(source, 'routeId must be a nonempty string');
  }
  if (!Number.isSafeInteger(routeType) || (routeType as number) < 0) {
    return invalid(source, 'routeType must be a nonnegative integer');
  }
  return {
    tripId,
    routeId,
    routeType: routeType as number,
    stopTimes: parseStopTimes(stopTimes, source),
    frequencyWindows: parseFrequencyWindows(frequencyWindows, source),
  };
}
