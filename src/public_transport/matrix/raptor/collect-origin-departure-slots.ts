import {
  getDepartureTime,
  getPickupType,
} from '../../network/timetable/route-pattern-access';
import type { PublicTransportNetwork } from '../../network/timetable/types';
import { USE_QUERY_TRANSFER_TIME } from '../../network/transfer-encoding';
import type { ValidatedOriginDepartureInputs } from './validate-query';

const addBoardableDepartureSlots = (
  timetable: PublicTransportNetwork,
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

/** @internal Inputs must have been validated against this timetable. */
export const collectValidatedOriginDepartureSlots = (
  timetable: PublicTransportNetwork,
  inputs: ValidatedOriginDepartureInputs,
): Uint32Array => {
  const stopCount = timetable.sourceStopIds.length;
  const slots = new Set<number>([inputs.windowStartSeconds]);
  for (const originStopIndex of inputs.originStopIndexes) {
    addBoardableDepartureSlots(
      timetable,
      originStopIndex,
      0,
      inputs.windowStartSeconds,
      inputs.windowEndSeconds,
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
          ? inputs.minTransferTimeSeconds
          : encodedDuration,
        inputs.windowStartSeconds,
        inputs.windowEndSeconds,
        slots,
      );
    }
  }

  return Uint32Array.from(
    [...slots].toSorted((left, right) => right - left),
  );
};
