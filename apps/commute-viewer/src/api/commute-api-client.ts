import type {
  CommuteApiErrorResponse,
  CommuteMode,
  GeographicBounds,
  Locality,
  ReachabilityFeatureCollection,
  ReachabilityResponse,
} from './types';

export const VIEWER_REACHABILITY_HORIZON_MINUTES = 240 as const;

export interface CommuteApiClientOptions {
  readonly baseUrl: string;
  readonly fetch?: typeof fetch;
}

export class CommuteApiClientError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'CommuteApiClientError';
  }
}

type UnknownRecord = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requireRecord = (value: unknown, label: string): UnknownRecord => {
  if (!isRecord(value)) {
    throw new CommuteApiClientError(`Invalid API response: ${label} must be an object.`);
  }
  return value;
};

const requireNonemptyString = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new CommuteApiClientError(
      `Invalid API response: ${label} must be a nonempty string.`,
    );
  }
  return value;
};

const requireFiniteNumber = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new CommuteApiClientError(
      `Invalid API response: ${label} must be a finite number.`,
    );
  }
  return value;
};

const requireNonnegativeInteger = (value: unknown, label: string): number => {
  const number = requireFiniteNumber(value, label);
  if (!Number.isInteger(number) || number < 0) {
    throw new CommuteApiClientError(
      `Invalid API response: ${label} must be a nonnegative integer.`,
    );
  }
  return number;
};

const requireCoordinate = (
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number => {
  const number = requireFiniteNumber(value, label);
  if (number < minimum || number > maximum) {
    throw new CommuteApiClientError(
      `Invalid API response: ${label} must be between ${minimum} and ${maximum}.`,
    );
  }
  return number;
};

function parseLocality(value: unknown, label: string): Locality {
  const locality = requireRecord(value, label);
  return {
    localityId: requireNonemptyString(locality.localityId, `${label}.localityId`),
    postalCode: requireNonemptyString(locality.postalCode, `${label}.postalCode`),
    city: requireNonemptyString(locality.city, `${label}.city`),
    latitude: requireCoordinate(locality.latitude, `${label}.latitude`, -90, 90),
    longitude: requireCoordinate(locality.longitude, `${label}.longitude`, -180, 180),
    ...parseStationName(locality, label),
  };
}

function parseStationName(
  value: UnknownRecord,
  label: string,
): Pick<Locality, 'publicTransportStationName'> {
  return value.publicTransportStationName === undefined
    ? {}
    : {
        publicTransportStationName: requireNonemptyString(
          value.publicTransportStationName,
          `${label}.publicTransportStationName`,
        ),
      };
}

export function parseLocalitiesResponse(value: unknown): readonly Locality[] {
  const response = requireRecord(value, 'localities response');
  if (!Array.isArray(response.localities)) {
    throw new CommuteApiClientError(
      'Invalid API response: localities must be an array.',
    );
  }

  const seenLocalityIds = new Set<string>();
  return response.localities.map((entry, index) => {
    const locality = parseLocality(entry, `localities[${index}]`);
    if (seenLocalityIds.has(locality.localityId)) {
      throw new CommuteApiClientError(
        `Invalid API response: duplicate localityId "${locality.localityId}".`,
      );
    }
    seenLocalityIds.add(locality.localityId);
    return locality;
  });
}

function parsePosition(value: unknown, label: string): [number, number] {
  if (!Array.isArray(value) || value.length < 2) {
    throw new CommuteApiClientError(
      `Invalid API response: ${label} must be a longitude/latitude position.`,
    );
  }
  return [
    requireCoordinate(value[0], `${label}[0]`, -180, 180),
    requireCoordinate(value[1], `${label}[1]`, -90, 90),
  ];
}

function validateFeature(value: unknown, index: number): void {
  const label = `geojson.features[${index}]`;
  const feature = requireRecord(value, label);
  const properties = requireRecord(feature.properties, `${label}.properties`);
  const geometry = requireRecord(feature.geometry, `${label}.geometry`);
  if (feature.type !== 'Feature' || geometry.type !== 'Polygon') {
    throw new CommuteApiClientError(
      `Invalid API response: ${label} must be a Polygon Feature.`,
    );
  }
  if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) {
    throw new CommuteApiClientError(
      `Invalid API response: ${label}.geometry.coordinates must contain a ring.`,
    );
  }

  const travelMinutes = requireNonnegativeInteger(
    properties.travelMinutes,
    `${label}.properties.travelMinutes`,
  );
  if (travelMinutes > VIEWER_REACHABILITY_HORIZON_MINUTES) {
    throw new CommuteApiClientError(
      `Invalid API response: ${label}.properties.travelMinutes exceeds the viewer horizon.`,
    );
  }

  geometry.coordinates.forEach((ring, ringIndex) => {
    if (!Array.isArray(ring) || ring.length < 4) {
      throw new CommuteApiClientError(
        `Invalid API response: ${label}.geometry.coordinates[${ringIndex}] must be a polygon ring.`,
      );
    }
    ring.forEach((position, positionIndex) =>
      parsePosition(
        position,
        `${label}.geometry.coordinates[${ringIndex}][${positionIndex}]`,
      ),
    );
  });

  const id = feature.id;
  if (id !== undefined && typeof id !== 'string') {
    throw new CommuteApiClientError(
      `Invalid API response: ${label}.id must be a string when present.`,
    );
  }

}

function parseBounds(value: unknown): GeographicBounds {
  const bounds = requireRecord(value, 'bounds');
  const parsed = {
    west: requireCoordinate(bounds.west, 'bounds.west', -180, 180),
    south: requireCoordinate(bounds.south, 'bounds.south', -90, 90),
    east: requireCoordinate(bounds.east, 'bounds.east', -180, 180),
    north: requireCoordinate(bounds.north, 'bounds.north', -90, 90),
  };
  if (parsed.west > parsed.east || parsed.south > parsed.north) {
    throw new CommuteApiClientError(
      'Invalid API response: bounds minimums must not exceed maximums.',
    );
  }
  return parsed;
}

export function parseReachabilityResponse(
  value: unknown,
  expectedOriginLocalityId?: string,
  expectedMode?: CommuteMode,
): ReachabilityResponse {
  const response = requireRecord(value, 'reachability response');
  const origin = requireRecord(response.origin, 'origin');
  const originLocalityId = requireNonemptyString(
    origin.localityId,
    'origin.localityId',
  );
  if (
    response.mode !== 'road' &&
    response.mode !== 'public_transport'
  ) {
    throw new CommuteApiClientError(
      'Invalid API response: mode must be either "road" or "public_transport".',
    );
  }
  const maxTravelMinutes = requireNonnegativeInteger(
    response.maxTravelMinutes,
    'maxTravelMinutes',
  );
  if (maxTravelMinutes !== VIEWER_REACHABILITY_HORIZON_MINUTES) {
    throw new CommuteApiClientError(
      `Invalid API response: maxTravelMinutes must be ${VIEWER_REACHABILITY_HORIZON_MINUTES}.`,
    );
  }
  if (
    expectedOriginLocalityId !== undefined &&
    originLocalityId !== expectedOriginLocalityId
  ) {
    throw new CommuteApiClientError(
      `Invalid API response: expected origin "${expectedOriginLocalityId}" but received "${originLocalityId}".`,
    );
  }
  if (expectedMode !== undefined && response.mode !== expectedMode) {
    throw new CommuteApiClientError(
      `Invalid API response: expected mode "${expectedMode}" but received "${response.mode}".`,
    );
  }

  const geojsonRecord = requireRecord(response.geojson, 'geojson');
  if (
    geojsonRecord.type !== 'FeatureCollection' ||
    !Array.isArray(geojsonRecord.features)
  ) {
    throw new CommuteApiClientError(
      'Invalid API response: geojson must be a FeatureCollection.',
    );
  }
  geojsonRecord.features.forEach(validateFeature);
  // Keep the exact object produced by response.json(). MapLibre receives the
  // server's GeoJSON directly; validation must not become a browser codec.
  const geojson = response.geojson as unknown as ReachabilityFeatureCollection;
  const hexagonCount = requireNonnegativeInteger(
    response.hexagonCount,
    'hexagonCount',
  );
  if (hexagonCount !== geojson.features.length) {
    throw new CommuteApiClientError(
      'Invalid API response: hexagonCount does not match GeoJSON features.',
    );
  }

  return {
    origin: {
      localityId: originLocalityId,
      latitude: requireCoordinate(origin.latitude, 'origin.latitude', -90, 90),
      longitude: requireCoordinate(origin.longitude, 'origin.longitude', -180, 180),
      ...parseStationName(origin, 'origin'),
    },
    mode: response.mode,
    maxTravelMinutes,
    reachableLocalityCount: requireNonnegativeInteger(
      response.reachableLocalityCount,
      'reachableLocalityCount',
    ),
    hexagonCount,
    geojson,
    bounds: parseBounds(response.bounds),
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (cause) {
    throw new CommuteApiClientError(
      'The commute API returned invalid JSON.',
      response.status,
      undefined,
      { cause },
    );
  }
}

function parseErrorResponse(value: unknown): CommuteApiErrorResponse | undefined {
  if (!isRecord(value) || !isRecord(value.error)) {
    return undefined;
  }
  if (
    typeof value.error.code !== 'string' ||
    typeof value.error.message !== 'string'
  ) {
    return undefined;
  }
  return {
    error: {
      code: value.error.code,
      message: value.error.message,
    },
  };
}

async function requireSuccessfulJson(response: Response): Promise<unknown> {
  const value = await readJson(response);
  if (response.ok) {
    return value;
  }
  const error = parseErrorResponse(value);
  throw new CommuteApiClientError(
    error?.error.message ?? `The commute API request failed with HTTP ${response.status}.`,
    response.status,
    error?.error.code,
  );
}

export class CommuteApiClient {
  private readonly baseUrl: string;
  private readonly fetchImplementation: typeof fetch;
  private localitiesPromise: Promise<readonly Locality[]> | undefined;

  constructor(options: CommuteApiClientOptions) {
    const baseUrl = options.baseUrl.trim().replace(/\/+$/u, '');
    if (baseUrl.length === 0) {
      throw new TypeError('Commute API base URL must be nonempty.');
    }
    this.baseUrl = baseUrl;
    this.fetchImplementation = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  loadLocalities(): Promise<readonly Locality[]> {
    if (this.localitiesPromise !== undefined) {
      return this.localitiesPromise;
    }

    const request = this.fetchImplementation(`${this.baseUrl}/api/localities`, {
      headers: { Accept: 'application/json' },
    })
      .then(requireSuccessfulJson)
      .then(parseLocalitiesResponse);
    this.localitiesPromise = request;
    void request.catch(() => {
      if (this.localitiesPromise === request) {
        this.localitiesPromise = undefined;
      }
    });
    return request;
  }

  async loadReachability(
    originLocalityId: string,
    mode: CommuteMode,
    signal?: AbortSignal,
  ): Promise<ReachabilityResponse> {
    const response = await this.fetchImplementation(
      `${this.baseUrl}/api/reachability`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          originLocalityId,
          mode,
          maxTravelMinutes: VIEWER_REACHABILITY_HORIZON_MINUTES,
        }),
        signal,
      },
    );
    return parseReachabilityResponse(
      await requireSuccessfulJson(response),
      originLocalityId,
      mode,
    );
  }
}
