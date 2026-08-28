import type { TransitCandidateSelectionMode } from '../candidates';
import type {
  RuntimeLocalityRoutingEntry,
  RuntimeLocalityRoutingIndex,
} from './runtime-types';

/** Full generated entry, including preprocessing and diagnostic metadata. */
export interface LocalityRoutingEntry extends RuntimeLocalityRoutingEntry {
  readonly postalCode: string;
  readonly city: string;
  readonly selectionMode: TransitCandidateSelectionMode;
}

/** Full generated index consumed by preparation and diagnostic tooling. */
export interface LocalityRoutingIndex extends RuntimeLocalityRoutingIndex {
  readonly entries: readonly LocalityRoutingEntry[];
}
