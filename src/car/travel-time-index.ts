import type { LocalityId, ReachableLocality } from '../localities';
import {
  createTravelTimeIndex,
  getReachableLocalities,
  getTravelMinutes,
  type TravelTimeIndex,
} from '../travel-time-matrix';
import { parseCarTravelTimeManifest } from './travel-time-manifest';

const carTravelTimeIndexBrand: unique symbol = Symbol('CarTravelTimeIndex');

/** Car-branded view of the canonical dense matrix index. */
export interface CarTravelTimeIndex extends TravelTimeIndex {
  readonly [carTravelTimeIndexBrand]: true;
}

/** Creates a car façade over the shared transport-independent matrix index. */
export function createCarTravelTimeIndex(
  manifest: unknown,
  matrixBytes: ArrayBuffer | Uint8Array,
): CarTravelTimeIndex {
  const validatedManifest = parseCarTravelTimeManifest(
    manifest,
    'car travel-time index manifest',
  );
  return createTravelTimeIndex(
    validatedManifest.matrix,
    matrixBytes,
  ) as CarTravelTimeIndex;
}

export function getCarTravelMinutes(
  index: CarTravelTimeIndex,
  fromLocalityId: LocalityId,
  toLocalityId: LocalityId,
): number | undefined {
  return getTravelMinutes(index, fromLocalityId, toLocalityId);
}

export function getReachableLocalitiesByCar(
  index: CarTravelTimeIndex,
  originLocalityId: LocalityId,
  maxTravelMinutes: number,
): readonly ReachableLocality[] {
  return getReachableLocalities(index, originLocalityId, maxTravelMinutes);
}
