import type { TransitStop } from '../../prepare/stops';
import { USE_QUERY_TRANSFER_TIME } from '../transfer-encoding';
import { TransferEdgeRegistry } from './merge-transfer-edges';

export const buildSiblingTransfers = (
  transitStops: readonly TransitStop[],
  denseStopLookup: ReadonlyMap<string, number>,
  registry: TransferEdgeRegistry,
): void => {
  const stationIds = new Set<string>();
  for (const stop of transitStops) {
    if (stop.kind === 'STATION') {
      stationIds.add(stop.id);
    }
  }
  const childrenByParentId = new Map<string, number[]>();

  for (const stop of transitStops) {
    if (
      stop.kind !== 'STOP_OR_PLATFORM' ||
      stop.parentStationId === undefined ||
      !stationIds.has(stop.parentStationId)
    ) {
      continue;
    }
    const stopIndex = denseStopLookup.get(stop.id);
    if (stopIndex === undefined) {
      continue;
    }
    const children = childrenByParentId.get(stop.parentStationId) ?? [];
    children.push(stopIndex);
    childrenByParentId.set(stop.parentStationId, children);
  }

  for (const children of childrenByParentId.values()) {
    const uniqueChildren = [...new Set(children)].toSorted(
      (left, right) => left - right,
    );
    if (uniqueChildren.length < 2) {
      continue;
    }
    for (const fromStopIndex of uniqueChildren) {
      for (const toStopIndex of uniqueChildren) {
        if (fromStopIndex === toStopIndex) {
          continue;
        }
        registry.addGeneratedEdge(
          fromStopIndex,
          toStopIndex,
          USE_QUERY_TRANSFER_TIME,
        );
      }
    }
  }
};
