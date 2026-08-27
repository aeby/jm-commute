import {
  getDepartureTime,
  getPickupType,
  type RaptorTimetable,
} from '../timetable';
import { USE_QUERY_TRANSFER_TIME } from '../transfers';

const addBoardableDepartureSlots = (
  timetable: RaptorTimetable,
  stopIndex: number,
  accessDurationSeconds: number,
  windowStartSeconds: number,
  windowEndSeconds: number,
  slots: Set<number>,
): void => {
  const occurrences = timetable.patternOccurrencesByStop[stopIndex];
  if (occurrences === undefined || occurrences.length % 2 !== 0) {
    throw new Error(
      `Pattern occurrences for origin stop ${stopIndex} must contain pairs.`,
    );
  }

  for (
    let occurrenceIndex = 0;
    occurrenceIndex < occurrences.length;
    occurrenceIndex += 2
  ) {
    const patternId = occurrences[occurrenceIndex];
    const patternStopIndex = occurrences[occurrenceIndex + 1];
    const pattern =
      patternId === undefined ? undefined : timetable.patterns[patternId];
    if (pattern === undefined || patternStopIndex === undefined) {
      throw new Error(
        `Origin stop ${stopIndex} references an unavailable route pattern.`,
      );
    }

    for (let tripIndex = 0; tripIndex < pattern.tripCount; tripIndex += 1) {
      if (getPickupType(pattern, patternStopIndex, tripIndex) === 1) {
        continue;
      }
      const vehicleDeparture = getDepartureTime(
        pattern,
        patternStopIndex,
        tripIndex,
      );
      if (vehicleDeparture < accessDurationSeconds) {
        continue;
      }
      const originDeparture = vehicleDeparture - accessDurationSeconds;
      if (
        originDeparture >= windowStartSeconds &&
        originDeparture < windowEndSeconds
      ) {
        slots.add(originDeparture);
      }
    }
  }
};

export const collectOriginDepartureSlots = (
  timetable: RaptorTimetable,
  originStopIndexes: readonly number[],
  windowStartSeconds: number,
  windowEndSeconds: number,
  minTransferTimeSeconds: number,
): Uint32Array => {
  if (originStopIndexes.length === 0) {
    throw new RangeError('Origin departure slots require at least one stop.');
  }
  if (
    !Number.isSafeInteger(windowStartSeconds) ||
    windowStartSeconds < 0 ||
    !Number.isSafeInteger(windowEndSeconds) ||
    windowEndSeconds <= windowStartSeconds ||
    windowEndSeconds >= USE_QUERY_TRANSFER_TIME
  ) {
    throw new RangeError(
      'Origin departure window must contain increasing Uint32 second values.',
    );
  }
  if (
    !Number.isSafeInteger(minTransferTimeSeconds) ||
    minTransferTimeSeconds < 0
  ) {
    throw new RangeError(
      'minTransferTimeSeconds must be a nonnegative integer.',
    );
  }

  const stopCount = timetable.sourceStopIds.length;
  const originMembership = new Uint8Array(stopCount);
  const origins: number[] = [];
  for (const originStopIndex of originStopIndexes) {
    if (
      !Number.isInteger(originStopIndex) ||
      originStopIndex < 0 ||
      originStopIndex >= stopCount
    ) {
      throw new RangeError(`Invalid origin stop index ${originStopIndex}.`);
    }
    if (originMembership[originStopIndex] === 0) {
      originMembership[originStopIndex] = 1;
      origins.push(originStopIndex);
    }
  }

  const slots = new Set<number>([windowStartSeconds]);
  for (const originStopIndex of origins) {
    addBoardableDepartureSlots(
      timetable,
      originStopIndex,
      0,
      windowStartSeconds,
      windowEndSeconds,
      slots,
    );

    const accessEdges = timetable.accessTransfersByStop[originStopIndex];
    if (accessEdges === undefined || accessEdges.length % 2 !== 0) {
      throw new Error(
        `Initial-access adjacency for stop ${originStopIndex} must contain pairs.`,
      );
    }
    for (let edgeIndex = 0; edgeIndex < accessEdges.length; edgeIndex += 2) {
      const accessStopIndex = accessEdges[edgeIndex];
      const encodedDuration = accessEdges[edgeIndex + 1];
      if (
        accessStopIndex === undefined ||
        encodedDuration === undefined ||
        accessStopIndex >= stopCount
      ) {
        throw new Error('Initial-access adjacency contains an invalid pair.');
      }
      if (accessStopIndex === originStopIndex) {
        continue;
      }
      addBoardableDepartureSlots(
        timetable,
        accessStopIndex,
        encodedDuration === USE_QUERY_TRANSFER_TIME
          ? minTransferTimeSeconds
          : encodedDuration,
        windowStartSeconds,
        windowEndSeconds,
        slots,
      );
    }
  }

  return Uint32Array.from(
    [...slots].toSorted((left, right) => right - left),
  );
};
