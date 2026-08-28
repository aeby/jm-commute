import type { LocalityId, ReachableLocality } from '../localities';
import {
  createTravelTimeIndex,
  getReachableLocalities,
  getTravelMinutes,
  type TravelTimeIndex,
} from '../travel-time-matrix';
import {
  getTravelTimeIndexDiagnostics,
  type TravelTimeIndexDiagnostics,
} from '../travel-time-matrix/travel-time-index';
import { parseCarTravelTimeManifest } from './travel-time-manifest';

const carTravelTimeIndexBrand: unique symbol = Symbol('CarTravelTimeIndex');

/** Opaque car-mode handle around the canonical dense matrix index. */
export interface CarTravelTimeIndex {
  readonly [carTravelTimeIndexBrand]: true;
}

const sharedIndexByCarIndex = new WeakMap<CarTravelTimeIndex, TravelTimeIndex>();

function requireSharedIndex(index: CarTravelTimeIndex): TravelTimeIndex {
  const sharedIndex = sharedIndexByCarIndex.get(index);
  if (sharedIndex === undefined) {
    throw new TypeError('Invalid car travel-time index.');
  }
  return sharedIndex;
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
  const sharedIndex = createTravelTimeIndex(
    validatedManifest.matrix,
    matrixBytes,
  );
  const carIndex = Object.freeze({
    [carTravelTimeIndexBrand]: true as const,
  });
  sharedIndexByCarIndex.set(carIndex, sharedIndex);
  return carIndex;
}

/** @internal Runtime benchmark diagnostics without exposing the shared index. */
export function getCarTravelTimeIndexDiagnostics(
  index: CarTravelTimeIndex,
): TravelTimeIndexDiagnostics {
  return getTravelTimeIndexDiagnostics(requireSharedIndex(index));
}

export function getCarTravelMinutes(
  index: CarTravelTimeIndex,
  fromLocalityId: LocalityId,
  toLocalityId: LocalityId,
): number | undefined {
  return getTravelMinutes(
    requireSharedIndex(index),
    fromLocalityId,
    toLocalityId,
  );
}

export function getReachableLocalitiesByCar(
  index: CarTravelTimeIndex,
  originLocalityId: LocalityId,
  maxTravelMinutes: number,
): readonly ReachableLocality[] {
  return getReachableLocalities(
    requireSharedIndex(index),
    originLocalityId,
    maxTravelMinutes,
  );
}
