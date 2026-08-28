import type {
  LocalityId,
  ReachableLocality,
} from '../localities/index.js';
import {
  createTravelTimeIndex,
  getReachableLocalities,
  getTravelMinutes,
  type TravelTimeIndex,
} from '../travel-time-matrix/index.js';
import { parseTransitTravelTimeManifest } from './travel-time-manifest.js';

const transitTravelTimeIndexBrand: unique symbol = Symbol(
  'TransitTravelTimeIndex',
);

/** Transit-branded view of the canonical dense matrix index. */
export interface TransitTravelTimeIndex extends TravelTimeIndex {
  readonly [transitTravelTimeIndexBrand]: true;
}

/** Creates a transit facade over the shared transport-independent index. */
export function createTransitTravelTimeIndex(
  manifest: unknown,
  matrixBytes: ArrayBuffer | Uint8Array,
): TransitTravelTimeIndex {
  const validatedManifest = parseTransitTravelTimeManifest(
    manifest,
    'transit travel-time index manifest',
  );
  return createTravelTimeIndex(
    validatedManifest.matrix,
    matrixBytes,
  ) as TransitTravelTimeIndex;
}

export function getTransitTravelMinutes(
  index: TransitTravelTimeIndex,
  fromLocalityId: LocalityId,
  toLocalityId: LocalityId,
): number | undefined {
  return getTravelMinutes(index, fromLocalityId, toLocalityId);
}

export function getReachableLocalitiesByTransit(
  index: TransitTravelTimeIndex,
  originLocalityId: LocalityId,
  maxTravelMinutes: number,
): readonly ReachableLocality[] {
  return getReachableLocalities(index, originLocalityId, maxTravelMinutes);
}
