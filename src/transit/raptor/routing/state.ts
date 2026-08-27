export const UNREACHED_TIME = 0xffff_ffff;

export const createUnreachedArrivalTimes = (
  stopCount: number,
): Uint32Array => {
  if (!Number.isInteger(stopCount) || stopCount < 0) {
    throw new RangeError('stopCount must be a nonnegative integer');
  }
  return new Uint32Array(stopCount).fill(UNREACHED_TIME);
};

export interface PatternScanState {
  readonly globalArrivalTimes: Uint32Array;
  readonly previousRoundArrivalTimes: Uint32Array;
  readonly currentRoundArrivalTimes: Uint32Array;
  readonly nextMarkedStops: number[];
  readonly nextMarkedMembership: Uint8Array;
  readonly roundNumber: number;
  readonly minTransferTimeSeconds: number;
  readonly maxArrivalTime: number;
}
