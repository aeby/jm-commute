import { PROJECT_CONFIG } from '@core/config';
import { parseGtfsTimeToSeconds } from '@core/transit/gtfs';
import { runRaptorFastestWindow } from '@core/transit/raptor/routing/run-raptor-fastest-window';
import type {
  FastestWindowQuery,
  FastestWindowResult,
} from '@core/transit/raptor/routing/types';
import type { RaptorTimetable } from '@core/transit/raptor/timetable/types';
import type { LocalityRoutingEntry } from '@core/transit/locality-routing';

import { VIEWER_CONFIG } from './config';
import type { ViewerRuntimeData } from './data/runtime-data';
import {
  buildReachabilityHexes,
  extractReachableStopSamples,
  reachabilityHexesToFeatureCollection,
  type ReachabilityHex,
  type ReachabilityHexFeatureCollection,
  type ReachableStopSample,
} from './map/reachability-hexes';

export type FastestWindowRunner = (
  timetable: RaptorTimetable,
  query: FastestWindowQuery,
) => FastestWindowResult | Promise<FastestWindowResult>;

export interface ViewerRoutingEngine {
  readonly run: (
    originStopIndexes: readonly number[],
  ) => FastestWindowResult | Promise<FastestWindowResult>;
}

export interface BrowserViewerRoutingDependencies {
  readonly runFastestWindow?: FastestWindowRunner;
}

type ViewerRoutingRuntime = Pick<
  ViewerRuntimeData,
  'timetable' | 'routingWindowStart' | 'routingWindowEnd'
>;

/**
 * Bind the canonical Range-RAPTOR implementation to the generated viewer
 * timetable. Every origin uses the viewer's complete supported duration so
 * later slider interaction can remain a presentation-only operation.
 */
export function createBrowserViewerRoutingEngine(
  runtime: ViewerRoutingRuntime,
  dependencies: BrowserViewerRoutingDependencies = {},
): ViewerRoutingEngine {
  const windowStartSeconds = parseGtfsTimeToSeconds(
    runtime.routingWindowStart,
  );
  const windowEndSeconds = parseGtfsTimeToSeconds(runtime.routingWindowEnd);
  const runFastestWindow =
    dependencies.runFastestWindow ?? runRaptorFastestWindow;

  return {
    run: (originStopIndexes) =>
      runFastestWindow(runtime.timetable, {
        originStopIndexes: [...originStopIndexes],
        windowStartSeconds,
        windowEndSeconds,
        maxTravelTimeSeconds:
          VIEWER_CONFIG.commute.maximumMinutes * 60,
        maxTransfers: PROJECT_CONFIG.transit.routing.maxTransfers,
        minTransferTimeSeconds:
          PROJECT_CONFIG.transit.routing.minTransferTimeSeconds,
      }),
  };
}

export interface ViewerRoutingTimings {
  readonly raptorMilliseconds: number;
  readonly stopSamplingMilliseconds: number;
  readonly hexAggregationMilliseconds: number;
  readonly geoJsonMilliseconds: number;
}

export interface ViewerRoutingOutcome {
  readonly originLocalityId: string;
  readonly routingResult: FastestWindowResult;
  readonly reachableStopSamples: readonly ReachableStopSample[];
  readonly hexes: readonly ReachabilityHex[];
  readonly featureCollection: ReachabilityHexFeatureCollection;
  readonly timings: ViewerRoutingTimings;
}

export interface ViewerOriginRoutingCoordinatorOptions {
  readonly yieldBeforeRouting?: () => void | Promise<void>;
  readonly now?: () => number;
}

const defaultNow = (): number => performance.now();

const yieldForBrowserPaint = (): Promise<void> =>
  new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    } else {
      setTimeout(resolve, 0);
    }
  });

type ViewerOriginRoutingEntry = Pick<
  LocalityRoutingEntry,
  'localityId' | 'stopIndexes'
>;

/**
 * Coordinates asynchronous origin calculations without owning application
 * state. A superseded success or failure resolves to `undefined`, allowing the
 * latest App-owned request to be the only one rendered.
 */
export class ViewerOriginRoutingCoordinator {
  private generation = 0;
  private readonly yieldBeforeRouting: () => void | Promise<void>;
  private readonly now: () => number;

  constructor(
    private readonly engine: ViewerRoutingEngine,
    private readonly stopCoordinates: Float32Array,
    options: ViewerOriginRoutingCoordinatorOptions = {},
  ) {
    this.yieldBeforeRouting =
      options.yieldBeforeRouting ?? yieldForBrowserPaint;
    this.now = options.now ?? defaultNow;
  }

  invalidate(): void {
    this.generation += 1;
  }

  async calculateOrigin(
    origin: ViewerOriginRoutingEntry,
  ): Promise<ViewerRoutingOutcome | undefined> {
    const requestGeneration = ++this.generation;
    if (origin.stopIndexes.length === 0) {
      throw new Error(
        `Origin locality "${origin.localityId}" has no active routing stops.`,
      );
    }

    await this.yieldBeforeRouting();
    if (requestGeneration !== this.generation) {
      return undefined;
    }

    const routingStart = this.now();
    let routingResult: FastestWindowResult;
    try {
      routingResult = await this.engine.run([...origin.stopIndexes]);
    } catch (error) {
      if (requestGeneration !== this.generation) {
        return undefined;
      }
      throw error;
    }
    const raptorMilliseconds = this.now() - routingStart;
    if (requestGeneration !== this.generation) {
      return undefined;
    }

    const stopSamplingStart = this.now();
    const reachableStopSamples = extractReachableStopSamples(
      routingResult.durationSeconds,
      this.stopCoordinates,
    );
    const stopSamplingMilliseconds = this.now() - stopSamplingStart;

    const hexAggregationStart = this.now();
    const hexes = buildReachabilityHexes(
      reachableStopSamples,
      VIEWER_CONFIG.visualization.hexCellDiameterMeters,
    );
    const hexAggregationMilliseconds = this.now() - hexAggregationStart;

    const geoJsonStart = this.now();
    const featureCollection = reachabilityHexesToFeatureCollection(
      hexes,
      VIEWER_CONFIG.visualization.hexRenderScale,
    );
    const geoJsonMilliseconds = this.now() - geoJsonStart;

    if (requestGeneration !== this.generation) {
      return undefined;
    }
    return {
      originLocalityId: origin.localityId,
      routingResult,
      reachableStopSamples,
      hexes,
      featureCollection,
      timings: {
        raptorMilliseconds,
        stopSamplingMilliseconds,
        hexAggregationMilliseconds,
        geoJsonMilliseconds,
      },
    };
  }
}

const requireSelectedMinutes = (selectedMinutes: number): void => {
  if (!Number.isFinite(selectedMinutes) || selectedMinutes < 0) {
    throw new RangeError(
      'Selected commute minutes must be nonnegative and finite.',
    );
  }
};

export function getVisibleReachabilityHexes(
  hexes: readonly ReachabilityHex[],
  selectedMinutes: number,
): readonly ReachabilityHex[] {
  requireSelectedMinutes(selectedMinutes);
  return hexes.filter(
    ({ travelMinutes }) => travelMinutes <= selectedMinutes,
  );
}

export function countVisibleReachableStops(
  samples: readonly ReachableStopSample[],
  selectedMinutes: number,
): number {
  requireSelectedMinutes(selectedMinutes);
  let count = 0;
  for (const sample of samples) {
    if (sample.travelMinutes <= selectedMinutes) {
      count += 1;
    }
  }
  return count;
}

export function countVisibleReachabilityHexes(
  hexes: readonly ReachabilityHex[],
  selectedMinutes: number,
): number {
  requireSelectedMinutes(selectedMinutes);
  let count = 0;
  for (const hex of hexes) {
    if (hex.travelMinutes <= selectedMinutes) {
      count += 1;
    }
  }
  return count;
}
