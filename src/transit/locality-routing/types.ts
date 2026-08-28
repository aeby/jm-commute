import type { LocalityId, ReachableLocality } from '../../localities';
import type { TransitCandidateSelectionMode } from '../candidates';

export interface LocalityRoutingEntry {
  readonly localityId: LocalityId;
  readonly postalCode: string;
  readonly city: string;
  readonly selectionMode: TransitCandidateSelectionMode;
  readonly stopIndexes: Uint32Array;
}

export interface LocalityRoutingIndex {
  readonly entries: readonly LocalityRoutingEntry[];
}

export interface ReachableLocalityDebug extends ReachableLocality {
  readonly departureTimeSeconds: number;
  readonly arrivalTimeSeconds: number;
}
