import type { ReachableLocality } from '../localities';
import type {
  LocalityRoutingEntry,
  LocalityRoutingIndex,
  ReachableLocalityDebug,
} from '../transit/locality-routing';
import type { FastestWindowResult } from '../transit/raptor';
import type { ValidationHubCandidate } from './validation-data';

export interface ValidationRoutingEngine {
  readonly run: (
    originStopIndexes: Uint32Array,
    maxTravelTimeMinutes: number,
  ) => FastestWindowResult;
  readonly resolve: (
    result: FastestWindowResult,
  ) => readonly ReachableLocalityDebug[];
}

export interface OriginSelectionView {
  readonly entry: LocalityRoutingEntry;
  readonly hubs: readonly ValidationHubCandidate[];
  readonly isFallback: boolean;
}

export interface ReachabilityBucket {
  readonly minutes: number;
  readonly localityCount: number;
}

export interface ValidationCalculation {
  readonly maxTravelTimeMinutes: number;
  readonly routingResult: FastestWindowResult;
  readonly reachableLocalities: readonly ReachableLocality[];
  readonly reachableLocalitiesDebug: readonly ReachableLocalityDebug[];
  readonly buckets: readonly ReachabilityBucket[];
}

export type DestinationTravelStatus =
  | { readonly kind: 'NO_DESTINATION' }
  | { readonly kind: 'NOT_CALCULATED' }
  | {
      readonly kind: 'REACHABLE';
      readonly localityId: string;
      readonly travelMinutes: number;
      readonly departureTimeSeconds: number;
      readonly arrivalTimeSeconds: number;
    }
  | {
      readonly kind: 'NOT_REACHABLE_WITHIN_LIMIT';
      readonly localityId: string;
      readonly maxTravelTimeMinutes: number;
    };

export function createReachabilityBuckets(
  reachable: readonly ReachableLocality[],
  maxTravelTimeMinutes: number,
): readonly ReachabilityBucket[] {
  if (!Number.isInteger(maxTravelTimeMinutes) || maxTravelTimeMinutes <= 0) {
    throw new RangeError('Maximum travel time must be a positive integer.');
  }
  const limits = new Set(
    [15, 30, 45, maxTravelTimeMinutes].filter(
      (minutes) => minutes <= maxTravelTimeMinutes,
    ),
  );
  return [...limits]
    .toSorted((left, right) => left - right)
    .map((minutes) => ({
      minutes,
      localityCount: reachable.filter(
        ({ travelMinutes }) => travelMinutes <= minutes,
      ).length,
    }));
}

export class ValidationViewModel {
  private readonly entryByLocalityId: ReadonlyMap<
    string,
    LocalityRoutingEntry
  >;
  private originLocalityId: string | undefined;
  private destinationLocalityId: string | undefined;
  private calculation: ValidationCalculation | undefined;

  constructor(
    index: LocalityRoutingIndex,
    private readonly hubsByLocality: Readonly<
      Record<string, readonly ValidationHubCandidate[]>
    >,
    private readonly routingEngine: ValidationRoutingEngine,
  ) {
    const entries = new Map<string, LocalityRoutingEntry>();
    for (const entry of index.entries) {
      if (entries.has(entry.localityId)) {
        throw new Error(`Duplicate locality entry "${entry.localityId}".`);
      }
      entries.set(entry.localityId, entry);
    }
    this.entryByLocalityId = entries;
  }

  selectOrigin(localityId: string): OriginSelectionView {
    const entry = this.requireEntry(localityId);
    if (this.originLocalityId !== localityId) {
      this.calculation = undefined;
    }
    this.originLocalityId = localityId;
    return {
      entry,
      hubs: this.hubsByLocality[localityId] ?? [],
      isFallback: entry.selectionMode === 'NEAREST_FALLBACK',
    };
  }

  clearOrigin(): void {
    this.originLocalityId = undefined;
    this.calculation = undefined;
  }

  selectDestination(localityId: string | undefined): DestinationTravelStatus {
    if (localityId !== undefined) {
      this.requireEntry(localityId);
    }
    this.destinationLocalityId = localityId;
    return this.getDestinationStatus();
  }

  calculate(maxTravelTimeMinutes: number): ValidationCalculation {
    if (!Number.isInteger(maxTravelTimeMinutes) || maxTravelTimeMinutes <= 0) {
      throw new RangeError('Maximum travel time must be a positive integer.');
    }
    if (this.originLocalityId === undefined) {
      throw new Error('Select an origin locality before calculating.');
    }
    const entry = this.requireEntry(this.originLocalityId);
    if (entry.stopIndexes.length === 0) {
      throw new Error(
        `Origin locality "${entry.localityId}" has no active routing stops.`,
      );
    }

    const routingResult = this.routingEngine.run(
      entry.stopIndexes,
      maxTravelTimeMinutes,
    );
    const reachableLocalitiesDebug =
      this.routingEngine.resolve(routingResult);
    const reachableLocalities = reachableLocalitiesDebug.map(
      ({ localityId, travelMinutes }) => ({ localityId, travelMinutes }),
    );
    this.calculation = {
      maxTravelTimeMinutes,
      routingResult,
      reachableLocalities,
      reachableLocalitiesDebug,
      buckets: createReachabilityBuckets(
        reachableLocalities,
        maxTravelTimeMinutes,
      ),
    };
    return this.calculation;
  }

  invalidateCalculation(): void {
    this.calculation = undefined;
  }

  getCalculation(): ValidationCalculation | undefined {
    return this.calculation;
  }

  getDestinationStatus(): DestinationTravelStatus {
    if (this.destinationLocalityId === undefined) {
      return { kind: 'NO_DESTINATION' };
    }
    if (this.calculation === undefined) {
      return { kind: 'NOT_CALCULATED' };
    }
    const debugResult = this.calculation.reachableLocalitiesDebug.find(
      ({ localityId }) => localityId === this.destinationLocalityId,
    );
    return debugResult === undefined
      ? {
          kind: 'NOT_REACHABLE_WITHIN_LIMIT',
          localityId: this.destinationLocalityId,
          maxTravelTimeMinutes: this.calculation.maxTravelTimeMinutes,
        }
      : {
          kind: 'REACHABLE',
          localityId: this.destinationLocalityId,
          travelMinutes: debugResult.travelMinutes,
          departureTimeSeconds: debugResult.departureTimeSeconds,
          arrivalTimeSeconds: debugResult.arrivalTimeSeconds,
        };
  }

  private requireEntry(localityId: string): LocalityRoutingEntry {
    const entry = this.entryByLocalityId.get(localityId);
    if (entry === undefined) {
      throw new Error(`Unknown locality "${localityId}".`);
    }
    return entry;
  }
}
