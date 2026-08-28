import type { RaptorTimetable } from '../timetable';
import { buildSiblingTransfers } from './build-sibling-transfers';
import {
  generateStraightLineTransfers,
  validateStraightLineTransferOptions,
} from './generate-straight-line-transfers';
import { TransferEdgeRegistry } from './merge-transfer-edges';
import {
  USE_QUERY_TRANSFER_TIME,
  type ActiveTransferStop,
  type BuildTransferGraphOptions,
  type ParsedGtfsTransfer,
  type TransferGraphBuildResult,
} from './types';

const hasTripConstraint = (rule: ParsedGtfsTransfer): boolean =>
  rule.fromTripId !== undefined || rule.toTripId !== undefined;

const hasRouteConstraint = (rule: ParsedGtfsTransfer): boolean =>
  rule.fromRouteId !== undefined || rule.toRouteId !== undefined;

const buildActiveTransferStops = (
  options: BuildTransferGraphOptions,
): readonly ActiveTransferStop[] => {
  const stopById = new Map<string, (typeof options.transitStops)[number]>();
  for (const stop of options.transitStops) {
    if (stopById.has(stop.id)) {
      throw new Error(`Transit stops contain duplicate ID "${stop.id}".`);
    }
    stopById.set(stop.id, stop);
  }

  const activeStops: ActiveTransferStop[] = [];
  for (const [sourceStopId, stopIndex] of options.denseStopLookup) {
    const stop = stopById.get(sourceStopId);
    if (stop === undefined) {
      continue;
    }
    activeStops.push({
      stopIndex,
      latitude: stop.latitude,
      longitude: stop.longitude,
    });
  }
  return activeStops.toSorted(
    (left, right) => left.stopIndex - right.stopIndex,
  );
};

export const buildTransferGraph = async (
  options: BuildTransferGraphOptions,
): Promise<TransferGraphBuildResult> => {
  validateStraightLineTransferOptions(options.virtualTransfers);
  const registry = new TransferEdgeRegistry(options.denseStopLookup.size);
  let gtfsRows = 0;
  let timedTransfersApproximated = 0;
  let duplicateExplicitEdgesMerged = 0;
  let inactiveStopRowsSkipped = 0;
  let inactiveServiceRowsSkipped = 0;
  let unsupportedTripSpecificRows = 0;
  let unsupportedRouteSpecificRows = 0;
  let unsupportedInSeatRows = 0;
  let unsupportedOtherConstrainedRows = 0;

  for await (const rule of options.transferRules) {
    gtfsRows += 1;
    if (
      rule.serviceId !== undefined &&
      !options.activeServiceIds.has(rule.serviceId)
    ) {
      inactiveServiceRowsSkipped += 1;
      continue;
    }
    if (rule.transferType === 4 || rule.transferType === 5) {
      unsupportedInSeatRows += 1;
      continue;
    }
    if (rule.transferType === 1 && hasTripConstraint(rule)) {
      unsupportedTripSpecificRows += 1;
      continue;
    }
    if (hasRouteConstraint(rule)) {
      unsupportedRouteSpecificRows += 1;
      continue;
    }
    if (hasTripConstraint(rule)) {
      unsupportedOtherConstrainedRows += 1;
      continue;
    }
    if (rule.fromStopId === undefined || rule.toStopId === undefined) {
      unsupportedOtherConstrainedRows += 1;
      continue;
    }
    if (
      rule.transferType === 2 &&
      rule.minimumTransferTimeSeconds === undefined
    ) {
      throw new Error(
        `Generic type-2 transfer ${rule.fromStopId} → ${rule.toStopId} requires min_transfer_time.`,
      );
    }

    const fromStopIndex = options.denseStopLookup.get(rule.fromStopId);
    const toStopIndex = options.denseStopLookup.get(rule.toStopId);
    if (fromStopIndex === undefined || toStopIndex === undefined) {
      inactiveStopRowsSkipped += 1;
      continue;
    }

    if (rule.transferType === 3) {
      registry.addExplicitForbidden(fromStopIndex, toStopIndex);
      continue;
    }
    if (rule.transferType === 1) {
      timedTransfersApproximated += 1;
    }
    const duration =
      rule.minimumTransferTimeSeconds ?? USE_QUERY_TRANSFER_TIME;
    if (
      registry.addExplicitEdge(
        fromStopIndex,
        toStopIndex,
        duration,
        rule.transferType,
      ) ===
      'MERGED'
    ) {
      duplicateExplicitEdgesMerged += 1;
    }
  }

  const gtfsSupportedEdges = registry.explicitEdgeCount;
  const gtfsForbiddenPairs = registry.forbiddenPairCount;
  const siblingEdgesGenerated = options.deriveSiblingTransfers
    ? buildSiblingTransfers(
        options.transitStops,
        options.denseStopLookup,
        registry,
      )
    : 0;
  const activeStops = buildActiveTransferStops(options);
  const virtualEdgesGenerated = options.virtualTransfers.enabled
    ? generateStraightLineTransfers(
        activeStops,
        registry,
        options.virtualTransfers,
      )
    : 0;
  const transfersByStop = registry.toTransfersByStop();
  const accessTransfersByStop = registry.toAccessTransfersByStop();

  return {
    transfersByStop,
    accessTransfersByStop,
    statistics: {
      gtfsRows,
      gtfsSupportedEdges,
      gtfsForbiddenPairs,
      timedTransfersApproximated,
      duplicateExplicitEdgesMerged,
      siblingEdgesGenerated,
      virtualEdgesGenerated,
      inactiveStopRowsSkipped,
      inactiveServiceRowsSkipped,
      unsupportedTripSpecificRows,
      unsupportedRouteSpecificRows,
      unsupportedInSeatRows,
      unsupportedOtherConstrainedRows,
      finalTransferEdges: registry.edgeCount,
      finalAccessTransferEdges: registry.accessEdgeCount,
    },
    ...(options.includeDiagnostics
      ? { edgeDiagnostics: registry.toEdgeDiagnostics() }
      : {}),
  };
};

export const attachTransferGraph = (
  timetable: RaptorTimetable,
  transferGraph: Pick<
    TransferGraphBuildResult,
    'transfersByStop' | 'accessTransfersByStop'
  >,
): RaptorTimetable => {
  const validateAdjacency = (
    label: string,
    adjacency: readonly Uint32Array[],
  ): void => {
    if (adjacency.length !== timetable.sourceStopIds.length) {
      throw new Error(
        `${label} adjacency length must match the timetable stop count.`,
      );
    }
    adjacency.forEach((edges, fromStopIndex) => {
      if (!(edges instanceof Uint32Array) || edges.length % 2 !== 0) {
        throw new Error(
          `${label} adjacency for stop ${fromStopIndex} must contain Uint32 pairs.`,
        );
      }
      for (let index = 0; index < edges.length; index += 2) {
        const destination = edges[index];
        if (
          destination === undefined ||
          destination >= timetable.sourceStopIds.length
        ) {
          throw new Error(
            `${label} adjacency for stop ${fromStopIndex} references an invalid destination.`,
          );
        }
      }
    });
  };
  validateAdjacency('Transfer', transferGraph.transfersByStop);
  validateAdjacency(
    'Initial-access transfer',
    transferGraph.accessTransfersByStop,
  );
  return {
    sourceStopIds: timetable.sourceStopIds,
    patterns: timetable.patterns,
    patternOccurrencesByStop: timetable.patternOccurrencesByStop,
    transfersByStop: transferGraph.transfersByStop,
    accessTransfersByStop: transferGraph.accessTransfersByStop,
  };
};
