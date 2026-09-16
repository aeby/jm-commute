import type { Locality } from '@jobmate/commute';
import type { ParsedGtfsTransfer } from '../prepare/gtfs/types';
import { buildTransitPlaces } from '../prepare/places';
import type { RoutingTrip } from '../prepare/routing';
import type { TransitStop } from '../prepare/stops';
import { buildLocalityRoutingIndex } from './localities';
import { collectActiveTransitPlaces } from './localities/collect-active-transit-places';
import type { LocalitySelectionOptions } from './localities/build-locality-routing-index';
import type { LocalityRoutingStopIndex } from './localities/types';
import { buildRaptorTimetable } from './timetable/build-raptor-timetable';
import { buildSourceStopIndex } from './timetable/dense-stop-ids';
import type { PublicTransportNetwork } from './timetable/types';
import { buildTransferGraph } from './transfers/build-transfer-graph';

export interface BuildNetworkOptions {
  readonly trips: Iterable<RoutingTrip> | AsyncIterable<RoutingTrip>;
  readonly transferRules:
    | Iterable<ParsedGtfsTransfer>
    | AsyncIterable<ParsedGtfsTransfer>;
  readonly activeServiceIds: ReadonlySet<string>;
  readonly railByRouteId: ReadonlyMap<string, boolean>;
  readonly stops: readonly TransitStop[];
  readonly localities: readonly Locality[];
  readonly localitySelection: LocalitySelectionOptions;
  readonly routingWindowStartSeconds: number;
  readonly routingWindowEndSeconds: number;
}

export interface BuildNetworkResult {
  readonly network: PublicTransportNetwork;
  readonly localities: LocalityRoutingStopIndex;
}

const MAX_UINT32 = 0xffff_ffff;

function validateRoutingWindow(startSeconds: number, endSeconds: number): void {
  if (
    !Number.isInteger(startSeconds) ||
    startSeconds < 0 ||
    startSeconds > MAX_UINT32 ||
    !Number.isInteger(endSeconds) ||
    endSeconds <= startSeconds ||
    endSeconds > MAX_UINT32
  ) {
    throw new RangeError(
      'Network routing window must contain increasing unsigned 32-bit second values.',
    );
  }
}

/** Builds the complete in-memory routing network from prepared data. */
export async function buildNetwork(
  options: BuildNetworkOptions,
): Promise<BuildNetworkResult> {
  validateRoutingWindow(
    options.routingWindowStartSeconds,
    options.routingWindowEndSeconds,
  );
  const timetable = await buildRaptorTimetable(
    options.trips,
    options.routingWindowStartSeconds,
  );
  const stopIndexBySourceId = buildSourceStopIndex(
    timetable.sourceStopIds,
  );
  const transferGraph = await buildTransferGraph({
    transferRules: options.transferRules,
    activeServiceIds: options.activeServiceIds,
    transitStops: options.stops,
    denseStopLookup: stopIndexBySourceId,
  });
  const activePlaces = collectActiveTransitPlaces(
    buildTransitPlaces(options.stops),
    timetable,
    options.railByRouteId,
    options.routingWindowStartSeconds,
    options.routingWindowEndSeconds,
  );
  const localities = buildLocalityRoutingIndex(
    options.localities,
    activePlaces,
    stopIndexBySourceId,
    options.localitySelection,
  );

  return {
    network: {
      ...timetable,
      ...transferGraph,
      routingWindowStartSeconds: options.routingWindowStartSeconds,
      routingWindowEndSeconds: options.routingWindowEndSeconds,
    },
    localities,
  };
}
