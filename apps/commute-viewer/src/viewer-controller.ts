import type { CommuteMode, ReachabilityFeatureCollection, ReachabilityResponse } from './api/types';
import type { CommuteApiClient } from './api/commute-api-client';

export interface ViewerReachabilityOutcome {
  readonly response: ReachabilityResponse;
  readonly requestMilliseconds: number;
}

export interface ViewerReachabilityCoordinatorOptions {
  readonly now?: () => number;
}

const defaultNow = (): number => performance.now();

/**
 * Owns request cancellation and stale-result suppression without owning Vue
 * state. Components call `load` only when origin or mode changes.
 */
export class ViewerReachabilityCoordinator {
  private generation = 0;
  private activeRequest: AbortController | undefined;
  private readonly now: () => number;

  constructor(
    private readonly client: Pick<CommuteApiClient, 'loadReachability'>,
    options: ViewerReachabilityCoordinatorOptions = {},
  ) {
    this.now = options.now ?? defaultNow;
  }

  invalidate(): void {
    this.generation += 1;
    this.activeRequest?.abort();
    this.activeRequest = undefined;
  }

  async load(
    originLocalityId: string,
    mode: CommuteMode,
  ): Promise<ViewerReachabilityOutcome | undefined> {
    const requestGeneration = ++this.generation;
    this.activeRequest?.abort();
    const abortController = new AbortController();
    this.activeRequest = abortController;
    const startedAt = this.now();

    try {
      const response = await this.client.loadReachability(
        originLocalityId,
        mode,
        abortController.signal,
      );
      if (
        abortController.signal.aborted ||
        requestGeneration !== this.generation
      ) {
        return undefined;
      }
      return {
        response,
        requestMilliseconds: this.now() - startedAt,
      };
    } catch (error) {
      if (
        abortController.signal.aborted ||
        requestGeneration !== this.generation
      ) {
        return undefined;
      }
      throw error;
    } finally {
      if (this.activeRequest === abortController) {
        this.activeRequest = undefined;
      }
    }
  }
}

export function countVisibleHexagons(
  featureCollection: ReachabilityFeatureCollection,
  maximumMinutes: number,
): number {
  if (
    !Number.isFinite(maximumMinutes) ||
    !Number.isInteger(maximumMinutes) ||
    maximumMinutes < 0 ||
    maximumMinutes > 240
  ) {
    throw new RangeError('Visible commute minutes must be an integer between 0 and 240.');
  }

  let visibleCount = 0;
  for (const feature of featureCollection.features) {
    if (feature.properties.travelMinutes <= maximumMinutes) {
      visibleCount += 1;
    }
  }
  return visibleCount;
}
