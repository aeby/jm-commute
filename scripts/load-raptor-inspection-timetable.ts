import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import { PROJECT_CONFIG } from '../src/config';
import { loadFixedDateActiveServices } from '../src/transit/gtfs/load-fixed-date-feed';
import {
  buildRaptorTimetable,
  buildSourceStopIndex,
  type RaptorTimetable,
} from '../src/transit/raptor/timetable';
import { readRoutingTripsNdjson } from '../src/transit/raptor/timetable/node';
import {
  attachTransferGraph,
  buildTransferGraph,
  type TransferGraphBuildResult,
  type VirtualTransferOptions,
} from '../src/transit/raptor/transfers';
import { readGtfsTransfers } from '../src/transit/raptor/transfers/node';
import { loadTransitStopsInput } from './transit-inspection-inputs';

const PROJECT_ROOT = resolve(import.meta.dirname, '..');
const ROUTING_TRIPS_PATH = resolve(
  PROJECT_ROOT,
  'data/processed/fixed-day-routing/trips.ndjson',
);
const GTFS_DIRECTORY = resolve(PROJECT_ROOT, 'data/raw/gtfs');
const GTFS_TRANSFERS_PATH = resolve(GTFS_DIRECTORY, 'transfers.txt');

export interface LoadedInspectionRaptorTimetable {
  readonly timetable: RaptorTimetable;
  readonly stopIndexBySourceId: ReadonlyMap<string, number>;
  readonly transferGraph: TransferGraphBuildResult;
  readonly virtualTransfers: VirtualTransferOptions;
  readonly timetableBuildMilliseconds: number;
  readonly transferBuildMilliseconds: number;
  readonly transferMemoryBefore: NodeJS.MemoryUsage;
  readonly transferMemoryAfter: NodeJS.MemoryUsage;
}

export interface LoadRaptorInspectionTimetableOptions {
  readonly virtualTransfersEnabled?: boolean;
  readonly includeTransferDiagnostics?: boolean;
}

export async function loadRaptorInspectionTimetable(
  options: LoadRaptorInspectionTimetableOptions = {},
): Promise<LoadedInspectionRaptorTimetable> {
  const timetableBuildStart = performance.now();
  const baseTimetable = await buildRaptorTimetable(
    readRoutingTripsNdjson(ROUTING_TRIPS_PATH),
  );
  const timetableBuildMilliseconds = performance.now() - timetableBuildStart;
  const stopIndexBySourceId = buildSourceStopIndex(
    baseTimetable.sourceStopIds,
  );
  const transitStops = await loadTransitStopsInput();
  const serviceDate =
    PROJECT_CONFIG.transit.referenceScenario.serviceDate.replaceAll('-', '');
  const { activeServiceIds } = await loadFixedDateActiveServices(
    GTFS_DIRECTORY,
    serviceDate,
  );
  const configuredTransfers = PROJECT_CONFIG.transit.routing.transfers;
  const virtualTransfers: VirtualTransferOptions = {
    ...configuredTransfers.virtualTransfers,
    enabled:
      options.virtualTransfersEnabled ??
      configuredTransfers.virtualTransfers.enabled,
  };
  const transferMemoryBefore = process.memoryUsage();
  const transferBuildStart = performance.now();
  const transferGraph = await buildTransferGraph({
    transferRules: readGtfsTransfers(GTFS_TRANSFERS_PATH),
    activeServiceIds,
    transitStops,
    denseStopLookup: stopIndexBySourceId,
    deriveSiblingTransfers: configuredTransfers.deriveSiblingTransfers,
    virtualTransfers,
    includeDiagnostics: options.includeTransferDiagnostics,
  });
  const transferBuildMilliseconds = performance.now() - transferBuildStart;
  const transferMemoryAfter = process.memoryUsage();

  return {
    timetable: attachTransferGraph(baseTimetable, transferGraph),
    stopIndexBySourceId,
    transferGraph,
    virtualTransfers,
    timetableBuildMilliseconds,
    transferBuildMilliseconds,
    transferMemoryBefore,
    transferMemoryAfter,
  };
}
