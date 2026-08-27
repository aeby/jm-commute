import { UNREACHED_TIME } from './state';
import type { RaptorResult } from './types';

const validateStopIndex = (
  result: RaptorResult,
  stopIndex: number,
): void => {
  if (
    !Number.isInteger(stopIndex) ||
    stopIndex < 0 ||
    stopIndex >= result.arrivalTimes.length
  ) {
    throw new RangeError(`Invalid RAPTOR result stop index ${stopIndex}`);
  }
};

export const arrivalAt = (
  result: RaptorResult,
  stopIndex: number,
): number | undefined => {
  validateStopIndex(result, stopIndex);
  const arrivalTime = result.arrivalTimes[stopIndex];
  return arrivalTime === UNREACHED_TIME ? undefined : arrivalTime;
};

export const travelTimeTo = (
  result: RaptorResult,
  stopIndex: number,
): number | undefined => {
  const arrivalTime = arrivalAt(result, stopIndex);
  return arrivalTime === undefined
    ? undefined
    : arrivalTime - result.departureTimeSeconds;
};
