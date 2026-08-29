export interface FastestWindowQuery {
  readonly originStopIndexes: readonly number[];
  readonly windowStartSeconds: number;
  readonly windowEndSeconds: number;
  readonly maxTravelTimeSeconds: number;
  readonly maxTransfers: number;
  readonly minTransferTimeSeconds: number;
}

export interface FastestWindowResult {
  readonly durationSeconds: Uint32Array;
  readonly departureTimes: Uint32Array;
  readonly arrivalTimes: Uint32Array;
}

export interface InitialAccessStop {
  readonly stopIndex: number;
  readonly arrivalTimeSeconds: number;
}
