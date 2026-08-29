import { USE_QUERY_TRANSFER_TIME } from '../transfer-encoding';
import type { ParsedGtfsTransfer } from '../../prepare/gtfs/types';
import { buildSiblingTransfers } from './build-sibling-transfers';
import { TransferEdgeRegistry } from './merge-transfer-edges';
import type {
  BuildTransferGraphOptions,
  TransferGraphBuildResult,
} from './types';

const hasTripConstraint = (rule: ParsedGtfsTransfer): boolean =>
  rule.fromTripId !== undefined || rule.toTripId !== undefined;

const hasRouteConstraint = (rule: ParsedGtfsTransfer): boolean =>
  rule.fromRouteId !== undefined || rule.toRouteId !== undefined;

/**
 * Builds the transfer adjacency used by the routing network.
 *
 * The router supports generic GTFS transfer types 0–3. Trip-specific,
 * route-specific, and in-seat rules remain outside the supported model and
 * are ignored, matching the existing production behavior.
 */
export async function buildTransferGraph(
  options: BuildTransferGraphOptions,
): Promise<TransferGraphBuildResult> {
  const registry = new TransferEdgeRegistry(options.denseStopLookup.size);

  for await (const rule of options.transferRules) {
    if (
      rule.serviceId !== undefined &&
      !options.activeServiceIds.has(rule.serviceId)
    ) {
      continue;
    }
    if (rule.transferType === 4 || rule.transferType === 5) {
      continue;
    }
    if (rule.transferType === 1 && hasTripConstraint(rule)) {
      continue;
    }
    if (hasRouteConstraint(rule) || hasTripConstraint(rule)) {
      continue;
    }
    if (rule.fromStopId === undefined || rule.toStopId === undefined) {
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
      continue;
    }

    if (rule.transferType === 3) {
      registry.addExplicitForbidden(fromStopIndex, toStopIndex);
      continue;
    }
    registry.addExplicitEdge(
      fromStopIndex,
      toStopIndex,
      rule.minimumTransferTimeSeconds ?? USE_QUERY_TRANSFER_TIME,
      rule.transferType,
    );
  }

  buildSiblingTransfers(
    options.transitStops,
    options.denseStopLookup,
    registry,
  );

  return {
    transfersByStop: registry.toTransfersByStop(),
    accessTransfersByStop: registry.toAccessTransfersByStop(),
  };
}
