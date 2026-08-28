import {
  getCarTravelMinutes,
  getReachableLocalitiesByCar,
  type CarTravelTimeIndex,
} from '../car/index.js';
import type {
  LocalityCatalog,
  LocalityId,
  ReachableLocality,
} from '../localities/index.js';
import {
  getReachableLocalitiesByTransit,
  getTransitTravelMinutes,
  type TransitTravelTimeIndex,
} from '../transit/index.js';

export interface CommuteModeRuntime {
  getTravelMinutes(
    fromLocalityId: LocalityId,
    toLocalityId: LocalityId,
  ): number | undefined;

  getReachableLocalities(
    originLocalityId: LocalityId,
    maxTravelMinutes: number,
  ): readonly ReachableLocality[];
}

export interface CommuteRuntime {
  readonly localities: LocalityCatalog;
  readonly car: CommuteModeRuntime;
  readonly transit: CommuteModeRuntime;
}

function assertMatchingLocalityOrder(
  catalog: LocalityCatalog,
  carLocalityIds: readonly LocalityId[],
  transitLocalityIds: readonly LocalityId[],
): void {
  const catalogLocalities = catalog.all();
  if (catalogLocalities.length !== carLocalityIds.length) {
    throw new Error(
      'Locality catalog and car runtime dataset have different locality ' +
        `counts: ${catalogLocalities.length} and ${carLocalityIds.length}.`,
    );
  }
  if (carLocalityIds.length !== transitLocalityIds.length) {
    throw new Error(
      'Car and transit runtime datasets have different locality counts: ' +
        `${carLocalityIds.length} and ${transitLocalityIds.length}.`,
    );
  }
  for (let index = 0; index < carLocalityIds.length; index += 1) {
    const catalogLocalityId = catalogLocalities[index]?.localityId;
    const carLocalityId = carLocalityIds[index];
    const transitLocalityId = transitLocalityIds[index];
    if (catalogLocalityId !== carLocalityId) {
      throw new Error(
        'Locality catalog and car runtime locality ordering differs at index ' +
          `${index}: "${catalogLocalityId}" and "${carLocalityId}".`,
      );
    }
    if (carLocalityId !== transitLocalityId) {
      throw new Error(
        'Car and transit runtime locality ordering differs at index ' +
          `${index}: "${carLocalityId}" and "${transitLocalityId}".`,
      );
    }
  }
}

export function createCommuteRuntime(
  localities: LocalityCatalog,
  carIndex: CarTravelTimeIndex,
  transitIndex: TransitTravelTimeIndex,
  carLocalityIds: readonly LocalityId[],
  transitLocalityIds: readonly LocalityId[],
): CommuteRuntime {
  assertMatchingLocalityOrder(
    localities,
    carLocalityIds,
    transitLocalityIds,
  );

  const car: CommuteModeRuntime = Object.freeze({
    getTravelMinutes: (
      fromLocalityId: LocalityId,
      toLocalityId: LocalityId,
    ) => getCarTravelMinutes(carIndex, fromLocalityId, toLocalityId),
    getReachableLocalities: (
      originLocalityId: LocalityId,
      maxTravelMinutes: number,
    ) =>
      getReachableLocalitiesByCar(
        carIndex,
        originLocalityId,
        maxTravelMinutes,
      ),
  });
  const transit: CommuteModeRuntime = Object.freeze({
    getTravelMinutes: (
      fromLocalityId: LocalityId,
      toLocalityId: LocalityId,
    ) => getTransitTravelMinutes(transitIndex, fromLocalityId, toLocalityId),
    getReachableLocalities: (
      originLocalityId: LocalityId,
      maxTravelMinutes: number,
    ) =>
      getReachableLocalitiesByTransit(
        transitIndex,
        originLocalityId,
        maxTravelMinutes,
      ),
  });

  return Object.freeze({ localities, car, transit });
}
