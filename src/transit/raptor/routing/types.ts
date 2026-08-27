export interface RaptorQuery {
  readonly originStopIndexes: readonly number[];
  readonly departureTimeSeconds: number;
  readonly maxTravelTimeSeconds: number;
  readonly maxTransfers: number;
  readonly minTransferTimeSeconds: number;
}

export interface RaptorResult {
  readonly departureTimeSeconds: number;
  readonly arrivalTimes: Uint32Array;
}

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

export interface FastestWindowRoutingDiagnostics {
  readonly departureSlotCount: number;
  readonly rangeRuns: number;
  readonly runsWithoutDurationImprovements: number;
  readonly patternsScanned: number;
  readonly crossRunPrunes: number;
  readonly originalSeedStops: number;
  readonly maximumAdditionalInitialAccessStops: number;
  readonly initialAccessEdgesExamined: number;
}

export type FastestWindowDiagnosticsCallback = (
  diagnostics: FastestWindowRoutingDiagnostics,
) => void;

export interface InitialAccessStop {
  readonly stopIndex: number;
  readonly arrivalTimeSeconds: number;
}

export interface InitialAccessResult {
  readonly stops: readonly InitialAccessStop[];
  readonly originalStopCount: number;
  readonly additionalStopCount: number;
  readonly edgesExamined: number;
  readonly arrivalImprovements: number;
}

export interface RaptorRoutingDiagnostics {
  readonly roundsExecuted: number;
  readonly patternsScanned: number;
  readonly patternScansPerRound: readonly number[];
  readonly stopsImproved: number;
  readonly transferEdgesExamined: number;
  readonly transferArrivalImprovements: number;
  readonly originalSeedStops: number;
  readonly additionalInitialAccessStops: number;
  readonly initialAccessEdgesExamined: number;
  readonly initialAccessArrivalImprovements: number;
}

export type RaptorDiagnosticsCallback = (
  diagnostics: RaptorRoutingDiagnostics,
) => void;
