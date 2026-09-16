import type { LocalityId } from '@jobmate/commute';

/** Locality-to-network-stop fields consumed by matrix compilation. */
export interface LocalityRoutingStopEntry {
  readonly localityId: LocalityId;
  readonly stopIndexes: Uint32Array;
  /** Name of the selected physical station, included in the commute package. */
  readonly stationName?: string;
}

export interface LocalityRoutingStopIndex {
  readonly entries: readonly LocalityRoutingStopEntry[];
}
