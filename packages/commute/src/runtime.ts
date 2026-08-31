import {
  localityQueryKey,
  normalizeCityName,
  normalizePostalCode,
  type Locality,
  type LocalityId,
  type LocalityQuery,
  type ReachableLocality,
} from './localities.js';
import {
  matrixByteLength,
  matrixBytes,
  MAX_TRAVEL_MINUTES,
  UNAVAILABLE_TRAVEL_TIME,
} from './matrix.js';

export type CommuteMode = 'public_transport' | 'road';

export interface CommuteRuntimeData {
  readonly localities: readonly Locality[];
  readonly publicTransportMatrix: ArrayBuffer | Uint8Array;
  readonly roadMatrix: ArrayBuffer | Uint8Array;
}

export interface CommuteRuntime {
  readonly localities: readonly Locality[];

  resolve(query: LocalityId | LocalityQuery): Locality | undefined;

  travelTime(
    origin: Locality,
    destination: Locality,
    mode: CommuteMode,
  ): number | undefined;

  reachableLocalities(
    origin: Locality,
    maxTravelMinutes: number,
    mode: CommuteMode,
  ): readonly ReachableLocality[];
}

function compareReachable(
  left: ReachableLocality,
  right: ReachableLocality,
): number {
  const durationDifference = left.travelMinutes - right.travelMinutes;
  if (durationDifference !== 0) {
    return durationDifference;
  }
  return left.localityId < right.localityId
    ? -1
    : left.localityId > right.localityId
      ? 1
      : 0;
}

export function createCommuteRuntime(data: CommuteRuntimeData): CommuteRuntime {
  const localities = Object.freeze([...data.localities]);
  const expectedByteLength = matrixByteLength(localities.length);
  const publicTransportMatrix = matrixBytes(data.publicTransportMatrix);
  const roadMatrix = matrixBytes(data.roadMatrix);
  for (const [mode, matrix] of [
    ['public_transport', publicTransportMatrix],
    ['road', roadMatrix],
  ] as const) {
    if (matrix.byteLength !== expectedByteLength) {
      throw new Error(
        `${mode} matrix has ${matrix.byteLength} bytes; expected ${expectedByteLength} for ${localities.length} localities.`,
      );
    }
  }

  const localityIndexes = new Map<LocalityId, number>();
  const localitiesByQuery = new Map<string, Locality>();
  for (let index = 0; index < localities.length; index += 1) {
    const locality = localities[index] as Locality;
    if (localityIndexes.has(locality.localityId)) {
      throw new Error(`Duplicate locality ID "${locality.localityId}".`);
    }
    const queryKey = localityQueryKey(locality.postalCode, locality.city);
    if (localitiesByQuery.has(queryKey)) {
      throw new Error(
        `Duplicate locality resolver key for "${locality.postalCode} ${locality.city}".`,
      );
    }
    localityIndexes.set(locality.localityId, index);
    localitiesByQuery.set(queryKey, locality);
  }

  const resolve = (query: LocalityId | LocalityQuery): Locality | undefined => {
    if (typeof query === 'string') {
      return localities[localityIndexes.get(query) ?? -1];
    }
    if (
      query === null ||
      typeof query !== 'object' ||
      typeof query.postalCode !== 'string' ||
      typeof query.city !== 'string'
    ) {
      return undefined;
    }
    const postalCode = normalizePostalCode(query.postalCode);
    const city = normalizeCityName(query.city);
    if (postalCode === undefined || city.length === 0) {
      return undefined;
    }
    return localitiesByQuery.get(`${postalCode}\u0000${city}`);
  };

  const localityIndex = (locality: Locality): number => {
    const index = localityIndexes.get(locality.localityId);
    if (index === undefined) {
      throw new Error(`Unknown locality "${locality.localityId}".`);
    }
    return index;
  };

  const selectMatrix = (mode: CommuteMode): Uint8Array => {
    if (mode === 'public_transport') {
      return publicTransportMatrix;
    }
    if (mode === 'road') {
      return roadMatrix;
    }
    throw new Error(`Unknown commute mode "${String(mode)}".`);
  };

  return Object.freeze({
    localities,
    resolve,
    travelTime: (
      origin: Locality,
      destination: Locality,
      mode: CommuteMode,
    ) => {
      const value =
        selectMatrix(mode)[
          localityIndex(origin) * localities.length + localityIndex(destination)
        ] as number;
      return value === UNAVAILABLE_TRAVEL_TIME ? undefined : value;
    },
    reachableLocalities: (
      origin: Locality,
      maxTravelMinutes: number,
      mode: CommuteMode,
    ) => {
      if (
        !Number.isSafeInteger(maxTravelMinutes) ||
        maxTravelMinutes < 0 ||
        maxTravelMinutes > MAX_TRAVEL_MINUTES
      ) {
        throw new Error(
          `Maximum travel minutes must be an integer from 0 through ${MAX_TRAVEL_MINUTES}.`,
        );
      }
      const matrix = selectMatrix(mode);
      const rowOffset = localityIndex(origin) * localities.length;
      const reachable: ReachableLocality[] = [];
      for (let index = 0; index < localities.length; index += 1) {
        const travelMinutes = matrix[rowOffset + index] as number;
        if (
          travelMinutes !== UNAVAILABLE_TRAVEL_TIME &&
          travelMinutes <= maxTravelMinutes
        ) {
          reachable.push({
            localityId: (localities[index] as Locality).localityId,
            travelMinutes,
          });
        }
      }
      return reachable.toSorted(compareReachable);
    },
  });
}
