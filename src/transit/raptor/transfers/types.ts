import type { TransitStop } from '../../stops';

export type GtfsTransferType = 0 | 1 | 2 | 3 | 4 | 5;

export interface ParsedGtfsTransfer {
  readonly fromStopId?: string;
  readonly toStopId?: string;
  readonly fromRouteId?: string;
  readonly toRouteId?: string;
  readonly fromTripId?: string;
  readonly toTripId?: string;
  readonly transferType: GtfsTransferType;
  readonly minimumTransferTimeSeconds?: number;
  readonly serviceId?: string;
}

export interface StraightLineTransferOptions {
  readonly maxDistanceMeters: number;
  readonly walkingSpeedKmh: number;
  readonly detourFactor: number;
  readonly changePenaltySeconds: number;
}

export interface VirtualTransferOptions extends StraightLineTransferOptions {
  readonly enabled: boolean;
}

export interface ActiveTransferStop {
  readonly stopIndex: number;
  readonly latitude?: number;
  readonly longitude?: number;
}

export interface TransferGraphStatistics {
  readonly gtfsRows: number;
  readonly gtfsSupportedEdges: number;
  readonly gtfsForbiddenPairs: number;
  readonly timedTransfersApproximated: number;
  readonly duplicateExplicitEdgesMerged: number;
  readonly siblingEdgesGenerated: number;
  readonly virtualEdgesGenerated: number;
  readonly inactiveStopRowsSkipped: number;
  readonly inactiveServiceRowsSkipped: number;
  readonly unsupportedTripSpecificRows: number;
  readonly unsupportedRouteSpecificRows: number;
  readonly unsupportedInSeatRows: number;
  readonly unsupportedOtherConstrainedRows: number;
  readonly finalTransferEdges: number;
  readonly finalAccessTransferEdges: number;
}

export interface TransferGraphBuildResult {
  readonly transfersByStop: readonly Uint32Array[];
  readonly accessTransfersByStop: readonly Uint32Array[];
  readonly statistics: TransferGraphStatistics;
  readonly edgeDiagnostics?: readonly TransferEdge[];
}

export interface BuildTransferGraphOptions {
  readonly transferRules:
    | Iterable<ParsedGtfsTransfer>
    | AsyncIterable<ParsedGtfsTransfer>;
  readonly activeServiceIds: ReadonlySet<string>;
  readonly transitStops: readonly TransitStop[];
  readonly denseStopLookup: ReadonlyMap<string, number>;
  readonly deriveSiblingTransfers: boolean;
  readonly virtualTransfers: VirtualTransferOptions;
  readonly includeDiagnostics?: boolean;
}

export type TransferEdgeSource = 'EXPLICIT' | 'SIBLING' | 'VIRTUAL';
export type TransferAccessEligibility =
  | 'ACCESS_ELIGIBLE'
  | 'TRANSFER_ONLY';
export type TransferEdgeDiagnosticSource =
  | 'GTFS_TYPE_0'
  | 'GTFS_TYPE_1'
  | 'GTFS_TYPE_2'
  | 'GENERATED_SIBLING'
  | 'GENERATED_VIRTUAL';

export interface TransferEdge {
  readonly fromStopIndex: number;
  readonly toStopIndex: number;
  readonly minimumTransferTimeSeconds: number;
  readonly source: TransferEdgeSource;
  readonly accessEligibility: TransferAccessEligibility;
  readonly diagnosticSource: TransferEdgeDiagnosticSource;
}
