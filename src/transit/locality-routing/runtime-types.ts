import type { LocalityId } from '../../localities';

/** Minimal locality-to-stop mapping consumed by the transit runtime. */
export interface RuntimeLocalityRoutingEntry {
  readonly localityId: LocalityId;
  readonly stopIndexes: Uint32Array;
}

/** Runtime locality ordering and dense-stop mappings, without build metadata. */
export interface RuntimeLocalityRoutingIndex {
  readonly entries: readonly RuntimeLocalityRoutingEntry[];
}
