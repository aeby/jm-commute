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

export interface RaptorRoutingDiagnostics {
  readonly roundsExecuted: number;
  readonly patternsScanned: number;
  readonly patternScansPerRound: readonly number[];
  readonly stopsImproved: number;
  readonly transferEdgesExamined: number;
  readonly transferArrivalImprovements: number;
}

export type RaptorDiagnosticsCallback = (
  diagnostics: RaptorRoutingDiagnostics,
) => void;
