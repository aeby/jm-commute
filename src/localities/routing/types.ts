import type { LocalityId } from '../types';

export type LocalityRoutingSelectionMode =
  | 'WITHIN_ACCESS_RADIUS'
  | 'NEAREST_FALLBACK';

export interface LocalityRoutingEntry {
  readonly localityId: LocalityId;
  readonly postalCode: string;
  readonly city: string;
  readonly selectionMode: LocalityRoutingSelectionMode;
  readonly stopIndexes: Uint32Array;
}

export interface LocalityRoutingIndex {
  readonly entries: readonly LocalityRoutingEntry[];
}

export interface ReachableLocality {
  readonly localityId: LocalityId;
  readonly travelMinutes: number;
}

export interface ReachableLocalityDebug extends ReachableLocality {
  readonly departureTimeSeconds: number;
  readonly arrivalTimeSeconds: number;
}
