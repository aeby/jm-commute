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
  readonly reachedStops: number[];
  readonly reachedMembership: Uint8Array;
  readonly globalBoardingReadyTimes: Uint32Array;
  readonly bestVehicleArrivalTimes: Uint32Array;
  readonly previousRoundArrivalTimes: Uint32Array;
  readonly previousRoundTransferApplied: Uint8Array;
  readonly currentRoundArrivalTimes: Uint32Array;
  readonly currentRoundTransferApplied: Uint8Array;
  readonly currentRoundVehicleArrivalTimes: Uint32Array;
  readonly vehicleImprovedStops: number[];
  readonly vehicleImprovedMembership: Uint8Array;
  readonly transfersByStop: readonly Uint32Array[];
  readonly nextMarkedStops: number[];
  readonly nextMarkedMembership: Uint8Array;
  readonly roundNumber: number;
  readonly minTransferTimeSeconds: number;
  readonly maxArrivalTime: number;
  readonly sharedRound?: SharedRoundArrivalState;
}

export interface SharedRoundArrivalState {
  /** Best vehicle arrival, used to prune equivalent outgoing transfers. */
  readonly vehicleArrivalTimes: Uint32Array;
  readonly changedVehicleStops: number[];
  /** Best time at which another vehicle may be boarded without more delay. */
  readonly boardingReadyTimes: Uint32Array;
  readonly changedBoardingReadyStops: number[];
  crossRunPrunes: number;
}

const improveSharedTime = (
  times: Uint32Array,
  changedStops: number[],
  stopIndex: number,
  timeSeconds: number,
  sharedRound: SharedRoundArrivalState,
): boolean => {
  if (timeSeconds >= (times[stopIndex] ?? UNREACHED_TIME)) {
    sharedRound.crossRunPrunes += 1;
    return false;
  }
  times[stopIndex] = timeSeconds;
  changedStops.push(stopIndex);
  return true;
};

/**
 * Range runs are processed latest-to-earliest. Vehicle arrivals are tracked
 * separately because they may take one outgoing transfer edge, whereas an
 * arrival produced by a transfer may not chain another edge in the round.
 */
export const improveSharedVehicleArrival = (
  sharedRound: SharedRoundArrivalState | undefined,
  stopIndex: number,
  arrivalTimeSeconds: number,
): boolean =>
  sharedRound === undefined ||
  improveSharedTime(
    sharedRound.vehicleArrivalTimes,
    sharedRound.changedVehicleStops,
    stopIndex,
    arrivalTimeSeconds,
    sharedRound,
  );

/**
 * Boarding-ready labels normalize the distinction between a vehicle arrival
 * that still needs a same-stop transfer allowance and a transfer arrival that
 * has already paid its complete duration.
 */
export const improveSharedBoardingReadyTime = (
  sharedRound: SharedRoundArrivalState | undefined,
  stopIndex: number,
  boardingReadyTimeSeconds: number,
): boolean =>
  sharedRound === undefined ||
  improveSharedTime(
    sharedRound.boardingReadyTimes,
    sharedRound.changedBoardingReadyStops,
    stopIndex,
    boardingReadyTimeSeconds,
    sharedRound,
  );
