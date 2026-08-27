import type {
  RoutingFrequencyWindow,
  RoutingStopTime,
} from './types';

export function shouldRetainRoutingTrip(
  stopTimes: readonly RoutingStopTime[],
  frequencyWindows: readonly RoutingFrequencyWindow[],
  referenceDepartureTimeSeconds: number,
): boolean {
  if (
    !Number.isSafeInteger(referenceDepartureTimeSeconds) ||
    referenceDepartureTimeSeconds < 0
  ) {
    throw new RangeError(
      'Reference departure time must be a nonnegative integer number of seconds.',
    );
  }

  if (frequencyWindows.length > 0) {
    return (
      frequencyWindows.some(
        ({ endTimeSeconds }) =>
          endTimeSeconds > referenceDepartureTimeSeconds,
      ) && stopTimes.some(({ pickupType }) => pickupType !== 1)
    );
  }

  return stopTimes.some(
    ({ departureTimeSeconds, pickupType }) =>
      departureTimeSeconds >= referenceDepartureTimeSeconds &&
      pickupType !== 1,
  );
}
