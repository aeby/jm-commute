import type {
  RoutingFrequencyWindow,
  RoutingStopTime,
} from './types';

export function shouldRetainRoutingTrip(
  stopTimes: readonly RoutingStopTime[],
  frequencyWindows: readonly RoutingFrequencyWindow[],
  routingWindowStartSeconds: number,
): boolean {
  if (
    !Number.isSafeInteger(routingWindowStartSeconds) ||
    routingWindowStartSeconds < 0
  ) {
    throw new RangeError(
      'Routing-window start must be a nonnegative integer number of seconds.',
    );
  }

  if (frequencyWindows.length > 0) {
    return (
      frequencyWindows.some(
        ({ endTimeSeconds }) =>
          endTimeSeconds > routingWindowStartSeconds,
      ) && stopTimes.some(({ pickupType }) => pickupType !== 1)
    );
  }

  return stopTimes.some(
    ({ departureTimeSeconds, pickupType }) =>
      departureTimeSeconds >= routingWindowStartSeconds &&
      pickupType !== 1,
  );
}
