import type { TransitStop } from '../../prepare/stops';
import type { ParsedGtfsTransfer } from '../../prepare/gtfs/types';

export interface TransferGraphBuildResult {
  readonly transfersByStop: readonly Uint32Array[];
  readonly accessTransfersByStop: readonly Uint32Array[];
}

export interface BuildTransferGraphOptions {
  readonly transferRules:
    | Iterable<ParsedGtfsTransfer>
    | AsyncIterable<ParsedGtfsTransfer>;
  readonly activeServiceIds: ReadonlySet<string>;
  readonly transitStops: readonly TransitStop[];
  readonly denseStopLookup: ReadonlyMap<string, number>;
}

export interface TransferEdge {
  readonly fromStopIndex: number;
  readonly toStopIndex: number;
  readonly minimumTransferTimeSeconds: number;
  readonly accessEligible: boolean;
}
