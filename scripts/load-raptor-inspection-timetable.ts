import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import { PROJECT_CONFIG } from '@core/config';
import { loadFixedDateActiveServices } from '@core/transit/gtfs/node';
import {
  validateFixedDayRoutingManifestScenario,
  type FixedDayRoutingManifest,
} from '@core/transit/routing-data';
import { loadFixedDayRoutingDataset } from '@core/transit/routing-data/node';
import { buildRaptorTimetable } from '@core/transit/raptor/timetable/build-raptor-timetable';
import { buildSourceStopIndex } from '@core/transit/raptor/timetable/dense-stop-ids';
import type { RaptorTimetable } from '@core/transit/raptor/timetable/types';
import {
  attachTransferGraph,
  buildTransferGraph,
} from '@core/transit/raptor/transfers/build-transfer-graph';
import { readGtfsTransfers } from '@core/transit/raptor/transfers/node';
import type {
  TransferGraphBuildResult,
  VirtualTransferOptions,
} from '@core/transit/raptor/transfers/types';
import type { TransitStop } from '@core/transit/stops';
import { loadTransitStopsInput } from './transit-inspection-inputs';

const PROJECT_ROOT = resolve(import.meta.dirname, '..');
const ROUTING_DIRECTORY = resolve(
  PROJECT_ROOT,
  'data/processed/fixed-day-routing',
);
const GTFS_DIRECTORY = resolve(PROJECT_ROOT, 'data/raw/gtfs');
const GTFS_TRANSFERS_PATH = resolve(GTFS_DIRECTORY, 'transfers.txt');

export interface LoadedInspectionRaptorTimetable {
  readonly manifest: FixedDayRoutingManifest;
  readonly timetable: RaptorTimetable;
  readonly stopIndexBySourceId: ReadonlyMap<string, number>;
  readonly transitStops: readonly TransitStop[];
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

export function assertMatchingGtfsFeedVersion(
  manifestFeedVersion: string | undefined,
  rawGtfsFeedVersion: string | undefined,
): void {
  if (manifestFeedVersion !== rawGtfsFeedVersion) {
    throw new Error(
      `Raw GTFS feed version ${JSON.stringify(rawGtfsFeedVersion ?? 'not supplied')} does not match fixed-day routing manifest source feed version ${JSON.stringify(manifestFeedVersion ?? 'not supplied')}. Rebuild the fixed-day routing data from the current raw GTFS feed.`,
    );
  }
}

export async function loadRaptorInspectionTimetable(
  options: LoadRaptorInspectionTimetableOptions = {},
): Promise<LoadedInspectionRaptorTimetable> {
  const routingDataset = await loadFixedDayRoutingDataset(ROUTING_DIRECTORY);
  const reference = PROJECT_CONFIG.transit.referenceScenario;
  validateFixedDayRoutingManifestScenario(routingDataset.manifest, {
    serviceDate: reference.serviceDate,
    routingWindowStart: reference.morningWindow.start,
    routingWindowEnd: reference.morningWindow.end,
  });
  const timetableBuildStart = performance.now();
  const baseTimetable = await buildRaptorTimetable(routingDataset.trips);
  const timetableBuildMilliseconds = performance.now() - timetableBuildStart;
  const stopIndexBySourceId = buildSourceStopIndex(
    baseTimetable.sourceStopIds,
  );
  const transitStops = await loadTransitStopsInput();
  const serviceDate =
    PROJECT_CONFIG.transit.referenceScenario.serviceDate.replaceAll('-', '');
  const { activeServiceIds, feedInfo } = await loadFixedDateActiveServices(
    GTFS_DIRECTORY,
    serviceDate,
  );
  assertMatchingGtfsFeedVersion(
    routingDataset.manifest.sourceFeedVersion,
    feedInfo.version,
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
    manifest: routingDataset.manifest,
    timetable: attachTransferGraph(baseTimetable, transferGraph),
    stopIndexBySourceId,
    transitStops,
    transferGraph,
    virtualTransfers,
    timetableBuildMilliseconds,
    transferBuildMilliseconds,
    transferMemoryBefore,
    transferMemoryAfter,
  };
}
