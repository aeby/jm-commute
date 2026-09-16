import type { PublicTransportNetwork } from '../../network';
import { UNREACHED_TIME } from './state';
import type { FastestWindowQuery } from './types';

export interface ValidatedOriginDepartureInputs {
  readonly originStopIndexes: readonly number[];
  readonly windowStartSeconds: number;
  readonly windowEndSeconds: number;
  readonly minTransferTimeSeconds: number;
}

export interface ValidatedFastestWindowQuery
  extends ValidatedOriginDepartureInputs {
  readonly maxTravelTimeSeconds: number;
  readonly maxTransfers: number;
}

export interface ValidatedRaptorRunQuery {
  readonly originStopIndexes: readonly number[];
  readonly departureTimeSeconds: number;
  readonly maxArrivalTime: number;
  readonly maxTransfers: number;
  readonly minTransferTimeSeconds: number;
}

const validateNonnegativeInteger = (
  value: number,
  fieldName: string,
): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${fieldName} must be a nonnegative integer.`);
  }
};

const validateTimetableStopAdjacency = (
  timetable: PublicTransportNetwork,
): void => {
  const stopCount = timetable.sourceStopIds.length;
  if (timetable.patternOccurrencesByStop.length !== stopCount) {
    throw new Error(
      'Timetable source stops and pattern adjacency have different lengths.',
    );
  }
  if (timetable.transfersByStop.length !== stopCount) {
    throw new Error(
      'Timetable source stops and transfer adjacency have different lengths.',
    );
  }
  if (timetable.accessTransfersByStop.length !== stopCount) {
    throw new Error(
      'Timetable source stops and initial-access adjacency have different lengths.',
    );
  }
};

const normalizeOriginStopIndexes = (
  timetable: PublicTransportNetwork,
  originStopIndexes: readonly number[],
): readonly number[] => {
  if (!Array.isArray(originStopIndexes)) {
    throw new TypeError('originStopIndexes must be an array.');
  }
  if (originStopIndexes.length === 0) {
    throw new RangeError('originStopIndexes must contain at least one stop.');
  }

  const stopCount = timetable.sourceStopIds.length;
  const uniqueOrigins = new Set<number>();
  for (const originStopIndex of originStopIndexes) {
    if (
      !Number.isInteger(originStopIndex) ||
      originStopIndex < 0 ||
      originStopIndex >= stopCount
    ) {
      throw new RangeError(`Invalid origin stop index ${originStopIndex}.`);
    }
    uniqueOrigins.add(originStopIndex);
  }
  return [...uniqueOrigins];
};

const validateTransferOptions = (
  maxTransfers: number,
  minTransferTimeSeconds: number,
): void => {
  validateNonnegativeInteger(maxTransfers, 'maxTransfers');
  if (maxTransfers >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError('maxTransfers is too large.');
  }
  validateNonnegativeInteger(
    minTransferTimeSeconds,
    'minTransferTimeSeconds',
  );
};

const validatePositiveTravelTime = (maxTravelTimeSeconds: number): void => {
  if (
    !Number.isSafeInteger(maxTravelTimeSeconds) ||
    maxTravelTimeSeconds <= 0
  ) {
    throw new RangeError('maxTravelTimeSeconds must be a positive integer.');
  }
};

export const validateOriginDepartureInputs = (
  timetable: PublicTransportNetwork,
  originStopIndexes: readonly number[],
  windowStartSeconds: number,
  windowEndSeconds: number,
  minTransferTimeSeconds: number,
): ValidatedOriginDepartureInputs => {
  validateTimetableStopAdjacency(timetable);
  if (
    !Number.isSafeInteger(windowStartSeconds) ||
    windowStartSeconds < 0 ||
    !Number.isSafeInteger(windowEndSeconds) ||
    windowEndSeconds <= windowStartSeconds ||
    windowEndSeconds >= UNREACHED_TIME
  ) {
    throw new RangeError(
      'Origin departure window must contain increasing Uint32 second values.',
    );
  }
  validateNonnegativeInteger(
    minTransferTimeSeconds,
    'minTransferTimeSeconds',
  );
  return {
    originStopIndexes: normalizeOriginStopIndexes(
      timetable,
      originStopIndexes,
    ),
    windowStartSeconds,
    windowEndSeconds,
    minTransferTimeSeconds,
  };
};

export const validateFastestWindowQuery = (
  timetable: PublicTransportNetwork,
  query: FastestWindowQuery,
): ValidatedFastestWindowQuery => {
  if (query === null || typeof query !== 'object') {
    throw new TypeError('Fastest-window query must be an object.');
  }
  const originInputs = validateOriginDepartureInputs(
    timetable,
    query.originStopIndexes,
    query.windowStartSeconds,
    query.windowEndSeconds,
    query.minTransferTimeSeconds,
  );
  validatePositiveTravelTime(query.maxTravelTimeSeconds);
  validateTransferOptions(
    query.maxTransfers,
    query.minTransferTimeSeconds,
  );
  if (
    query.windowEndSeconds - 1 + query.maxTravelTimeSeconds >=
    UNREACHED_TIME
  ) {
    throw new RangeError(
      'Morning-window end plus maxTravelTimeSeconds exceeds the supported time range.',
    );
  }
  return {
    ...originInputs,
    maxTravelTimeSeconds: query.maxTravelTimeSeconds,
    maxTransfers: query.maxTransfers,
  };
};

export const createValidatedRaptorRunQuery = (
  query: ValidatedFastestWindowQuery,
  departureTimeSeconds: number,
): ValidatedRaptorRunQuery => ({
  originStopIndexes: query.originStopIndexes,
  departureTimeSeconds,
  maxArrivalTime: departureTimeSeconds + query.maxTravelTimeSeconds,
  maxTransfers: query.maxTransfers,
  minTransferTimeSeconds: query.minTransferTimeSeconds,
});
