import type { LocalityId } from '../../localities';
import type { TransitCandidateSelectionMode } from '../candidates';

/** Locality-to-stop fields needed while compiling reachability rows. */
export interface LocalityRoutingStopEntry {
  readonly localityId: LocalityId;
  readonly stopIndexes: Uint32Array;
}

export interface LocalityRoutingStopIndex {
  readonly entries: readonly LocalityRoutingStopEntry[];
}

/** Full generated entry, including preprocessing and diagnostic metadata. */
export interface LocalityRoutingEntry extends LocalityRoutingStopEntry {
  readonly postalCode: string;
  readonly city: string;
  readonly selectionMode: TransitCandidateSelectionMode;
}

/** Full generated index consumed by preparation and diagnostic tooling. */
export interface LocalityRoutingIndex extends LocalityRoutingStopIndex {
  readonly entries: readonly LocalityRoutingEntry[];
}
