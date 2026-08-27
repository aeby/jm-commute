import type { TransitStop } from '../../stops';

export const USE_QUERY_TRANSFER_TIME = 0xffff_ffff;

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
  readonly sourceStopId: string;
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
}

export interface TransferGraphBuildResult {
  readonly transfersByStop: readonly Uint32Array[];
  readonly statistics: TransferGraphStatistics;
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
}

export type TransferEdgeSource = 'EXPLICIT' | 'SIBLING' | 'VIRTUAL';

export interface TransferEdge {
  readonly fromStopIndex: number;
  readonly toStopIndex: number;
  readonly minimumTransferTimeSeconds: number;
  readonly source: TransferEdgeSource;
}
