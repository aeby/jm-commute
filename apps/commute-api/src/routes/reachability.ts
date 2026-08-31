import { performance } from 'node:perf_hooks';

import { MAX_TRAVEL_MINUTES } from '@jobmate/commute';

import type {
  CommuteApiRuntime,
  ReachabilityRequest,
  ReachabilityResponse,
} from '../api-types.js';
import type { CommuteApiConfig } from '../config.js';
import { calculateGeoJsonBounds } from '../visualization/geojson.js';
import {
  buildReachabilityHexes,
  reachabilityHexesToFeatureCollection,
  type ReachabilityCoordinateSample,
} from '../visualization/reachability-hexes.js';

export class ReachabilityRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ReachabilityRequestError';
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseReachabilityRequest(
  value: unknown,
  runtime: Pick<CommuteApiRuntime, 'resolve'>,
): ReachabilityRequest {
  if (!isRecord(value)) {
    throw new ReachabilityRequestError(
      'INVALID_REQUEST',
      'Request body must be a JSON object.',
    );
  }

  const expectedKeys = new Set([
    'originLocalityId',
    'mode',
    'maxTravelMinutes',
  ]);
  const unexpectedKeys = Object.keys(value).filter(
    (key) => !expectedKeys.has(key),
  );
  if (unexpectedKeys.length > 0) {
    throw new ReachabilityRequestError(
      'INVALID_REQUEST',
      `Request body contains unexpected field(s): ${unexpectedKeys.join(', ')}.`,
    );
  }
  if (
    typeof value.originLocalityId !== 'string' ||
    value.originLocalityId.length === 0 ||
    value.originLocalityId.trim() !== value.originLocalityId
  ) {
    throw new ReachabilityRequestError(
      'INVALID_ORIGIN_LOCALITY_ID',
      'originLocalityId must be a nonempty canonical locality ID.',
    );
  }
  if (runtime.resolve(value.originLocalityId) === undefined) {
    throw new ReachabilityRequestError(
      'UNKNOWN_ORIGIN_LOCALITY_ID',
      `Unknown originLocalityId "${value.originLocalityId}".`,
    );
  }
  if (value.mode !== 'road' && value.mode !== 'public_transport') {
    throw new ReachabilityRequestError(
      'INVALID_MODE',
      'mode must be either "road" or "public_transport".',
    );
  }
  if (
    typeof value.maxTravelMinutes !== 'number' ||
    !Number.isFinite(value.maxTravelMinutes) ||
    !Number.isInteger(value.maxTravelMinutes) ||
    value.maxTravelMinutes < 0 ||
    value.maxTravelMinutes > MAX_TRAVEL_MINUTES
  ) {
    throw new ReachabilityRequestError(
      'INVALID_MAX_TRAVEL_MINUTES',
      `maxTravelMinutes must be an integer between 0 and ${MAX_TRAVEL_MINUTES}.`,
    );
  }

  return {
    originLocalityId: value.originLocalityId,
    mode: value.mode,
    maxTravelMinutes: value.maxTravelMinutes,
  };
}

export interface ReachabilityBuildTimings {
  readonly lookupMs: number;
  readonly coordinateJoinMs: number;
  readonly hexAggregationMs: number;
  readonly geoJsonConstructionMs: number;
}

export interface ReachabilityBuildResult {
  readonly response: ReachabilityResponse;
  readonly timings: ReachabilityBuildTimings;
}

export function buildReachabilityResponse(
  runtime: CommuteApiRuntime,
  request: ReachabilityRequest,
  visualizationConfig: CommuteApiConfig['visualization'],
): ReachabilityBuildResult {
  const origin = runtime.resolve(request.originLocalityId);
  if (origin === undefined) {
    throw new ReachabilityRequestError(
      'UNKNOWN_ORIGIN_LOCALITY_ID',
      `Unknown originLocalityId "${request.originLocalityId}".`,
    );
  }

  const lookupStartedAt = performance.now();
  const reachable = runtime.reachableLocalities(
    origin,
    request.maxTravelMinutes,
    request.mode,
  );
  const lookupFinishedAt = performance.now();

  const samples: ReachabilityCoordinateSample[] = reachable.map((result) => {
    const locality = runtime.resolve(result.localityId);
    if (locality === undefined) {
      throw new Error(
        `Commute runtime returned unknown localityId "${result.localityId}".`,
      );
    }
    return {
      longitude: locality.longitude,
      latitude: locality.latitude,
      travelMinutes: result.travelMinutes,
    };
  });
  const joinFinishedAt = performance.now();

  const hexes = buildReachabilityHexes(
    samples,
    visualizationConfig.hexCellDiameterMeters,
  );
  const aggregationFinishedAt = performance.now();
  const geojson = reachabilityHexesToFeatureCollection(
    hexes,
    visualizationConfig.hexRenderScale,
  );
  const bounds = calculateGeoJsonBounds(
    { longitude: origin.longitude, latitude: origin.latitude },
    geojson,
  );
  const geoJsonFinishedAt = performance.now();

  return {
    response: {
      origin: {
        localityId: origin.localityId,
        latitude: origin.latitude,
        longitude: origin.longitude,
      },
      mode: request.mode,
      maxTravelMinutes: request.maxTravelMinutes,
      reachableLocalityCount: reachable.length,
      hexagonCount: hexes.length,
      geojson,
      bounds,
    },
    timings: {
      lookupMs: lookupFinishedAt - lookupStartedAt,
      coordinateJoinMs: joinFinishedAt - lookupFinishedAt,
      hexAggregationMs: aggregationFinishedAt - joinFinishedAt,
      geoJsonConstructionMs: geoJsonFinishedAt - aggregationFinishedAt,
    },
  };
}
