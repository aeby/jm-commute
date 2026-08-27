import { USE_QUERY_TRANSFER_TIME } from '../transfers';
import { UNREACHED_TIME } from './state';

export interface TransferRelaxationState {
  readonly transfersByStop: readonly Uint32Array[];
  readonly vehicleImprovedStops: readonly number[];
  readonly currentRoundVehicleArrivalTimes: Uint32Array;
  readonly globalArrivalTimes: Uint32Array;
  readonly globalBoardingReadyTimes: Uint32Array;
  readonly currentRoundArrivalTimes: Uint32Array;
  readonly currentRoundTransferApplied: Uint8Array;
  readonly nextMarkedStops: number[];
  readonly nextMarkedMembership: Uint8Array;
  readonly minTransferTimeSeconds: number;
  readonly maxArrivalTime: number;
}

export interface TransferRelaxationCounts {
  readonly edgesExamined: number;
  readonly arrivalImprovements: number;
}

export const resolveSameStopTransferTime = (
  edges: Uint32Array,
  stopIndex: number,
  queryTransferTimeSeconds: number,
): number => {
  for (let index = 0; index < edges.length; index += 2) {
    const destination = edges[index];
    if (destination === stopIndex) {
      const encodedDuration = edges[index + 1];
      if (encodedDuration === undefined) {
        throw new Error('Transfer edge is missing its duration.');
      }
      return encodedDuration === USE_QUERY_TRANSFER_TIME
        ? queryTransferTimeSeconds
        : encodedDuration;
    }
    if (destination !== undefined && destination > stopIndex) {
      break;
    }
  }
  return queryTransferTimeSeconds;
};

const markForNextRound = (
  stopIndex: number,
  state: TransferRelaxationState,
): void => {
  if (state.nextMarkedMembership[stopIndex] === 0) {
    state.nextMarkedMembership[stopIndex] = 1;
    state.nextMarkedStops.push(stopIndex);
  }
};

/** Applies exactly one transfer edge from each vehicle-improved stop. */
export const relaxTransfers = (
  state: TransferRelaxationState,
): TransferRelaxationCounts => {
  let edgesExamined = 0;
  let arrivalImprovements = 0;

  for (const fromStopIndex of state.vehicleImprovedStops) {
    const vehicleArrival =
      state.currentRoundVehicleArrivalTimes[fromStopIndex] ?? UNREACHED_TIME;
    if (vehicleArrival === UNREACHED_TIME) {
      continue;
    }
    const edges = state.transfersByStop[fromStopIndex];
    if (edges === undefined) {
      throw new Error(`Missing transfer adjacency for stop ${fromStopIndex}.`);
    }

    for (let index = 0; index < edges.length; index += 2) {
      const toStopIndex = edges[index];
      const encodedDuration = edges[index + 1];
      if (toStopIndex === undefined || encodedDuration === undefined) {
        throw new Error('Transfer adjacency contains an incomplete pair.');
      }
      edgesExamined += 1;
      // A self edge controls same-stop boarding readiness in scanPattern.
      if (toStopIndex === fromStopIndex) {
        continue;
      }
      const duration =
        encodedDuration === USE_QUERY_TRANSFER_TIME
          ? state.minTransferTimeSeconds
          : encodedDuration;
      if (duration > state.maxArrivalTime - vehicleArrival) {
        continue;
      }
      const transferArrival = vehicleArrival + duration;

      if (
        transferArrival <
        (state.globalArrivalTimes[toStopIndex] ?? UNREACHED_TIME)
      ) {
        state.globalArrivalTimes[toStopIndex] = transferArrival;
        arrivalImprovements += 1;
      }
      if (
        transferArrival <
        (state.globalBoardingReadyTimes[toStopIndex] ?? UNREACHED_TIME)
      ) {
        state.globalBoardingReadyTimes[toStopIndex] = transferArrival;
        state.currentRoundArrivalTimes[toStopIndex] = transferArrival;
        state.currentRoundTransferApplied[toStopIndex] = 1;
        markForNextRound(toStopIndex, state);
      }
    }
  }

  return { edgesExamined, arrivalImprovements };
};
