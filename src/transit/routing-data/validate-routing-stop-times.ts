import {
  parseGtfsTimeToSeconds,
  type PickupDropOffType,
} from '../gtfs';
import type { RoutingStopTime } from './types';

export interface RoutingStopTimeInput {
  readonly stopId: string;
  readonly stopSequence: string;
  readonly arrivalTime: string;
  readonly departureTime: string;
  readonly pickupType: string;
  readonly dropOffType: string;
}

function parseStopSequence(value: string, tripId: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(
      `Trip "${tripId}" stop_sequence must be a nonnegative integer; received "${value}".`,
    );
  }

  const stopSequence = Number(value);

  if (!Number.isSafeInteger(stopSequence)) {
    throw new Error(
      `Trip "${tripId}" stop_sequence is too large: "${value}".`,
    );
  }

  return stopSequence;
}

function parsePickupDropOffType(
  value: string,
  field: 'pickup_type' | 'drop_off_type',
  tripId: string,
): PickupDropOffType {
  if (value === '' || value === '0') {
    return 0;
  }

  if (value === '1') {
    return 1;
  }

  if (value === '2') {
    return 2;
  }

  if (value === '3') {
    return 3;
  }

  throw new Error(
    `Trip "${tripId}" has invalid ${field} "${value}"; expected an empty value or 0 through 3.`,
  );
}

export function validateRoutingStopTimes(
  tripId: string,
  entries: readonly RoutingStopTimeInput[],
  knownStopIds: ReadonlySet<string>,
): readonly RoutingStopTime[] {
  if (entries.length < 2) {
    throw new Error(
      `Trip "${tripId}" must contain at least two stop-time records.`,
    );
  }

  const seenSequences = new Set<number>();
  let previousInputSequence: number | undefined;
  const stopTimes = entries.map((entry) => {
    if (entry.stopId.trim().length === 0) {
      throw new Error(`Trip "${tripId}" contains an empty stop_id.`);
    }

    if (!knownStopIds.has(entry.stopId)) {
      throw new Error(
        `Trip "${tripId}" references unknown stop_id "${entry.stopId}".`,
      );
    }

    const stopSequence = parseStopSequence(entry.stopSequence, tripId);

    if (seenSequences.has(stopSequence)) {
      throw new Error(
        `Trip "${tripId}" contains duplicate stop_sequence ${stopSequence}.`,
      );
    }

    if (
      previousInputSequence !== undefined &&
      stopSequence < previousInputSequence
    ) {
      throw new Error(
        `Trip "${tripId}" stop_sequence values decrease from ${previousInputSequence} to ${stopSequence}.`,
      );
    }

    seenSequences.add(stopSequence);
    previousInputSequence = stopSequence;

    if (
      entry.arrivalTime.trim().length === 0 ||
      entry.departureTime.trim().length === 0
    ) {
      throw new Error(
        `Trip "${tripId}" contains a blank arrival_time or departure_time.`,
      );
    }

    const arrivalTimeSeconds = parseGtfsTimeToSeconds(entry.arrivalTime);
    const departureTimeSeconds = parseGtfsTimeToSeconds(entry.departureTime);

    if (arrivalTimeSeconds > departureTimeSeconds) {
      throw new Error(
        `Trip "${tripId}" has arrival after departure at stop_sequence ${stopSequence}.`,
      );
    }

    return Object.freeze({
      stopId: entry.stopId,
      stopSequence,
      arrivalTimeSeconds,
      departureTimeSeconds,
      pickupType: parsePickupDropOffType(
        entry.pickupType,
        'pickup_type',
        tripId,
      ),
      dropOffType: parsePickupDropOffType(
        entry.dropOffType,
        'drop_off_type',
        tripId,
      ),
    });
  });
  const sortedStopTimes = stopTimes.toSorted(
    (left, right) => left.stopSequence - right.stopSequence,
  );

  for (let index = 1; index < sortedStopTimes.length; index += 1) {
    const previous = sortedStopTimes[index - 1];
    const current = sortedStopTimes[index];

    if (
      previous !== undefined &&
      current !== undefined &&
      previous.departureTimeSeconds > current.arrivalTimeSeconds
    ) {
      throw new Error(
        `Trip "${tripId}" times move backwards between stop_sequence ${previous.stopSequence} and ${current.stopSequence}.`,
      );
    }
  }

  return Object.freeze(sortedStopTimes);
}
