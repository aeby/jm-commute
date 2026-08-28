import type {
  CarRouteEstimate,
  Coordinate,
  SnappedRoadPoint,
} from './types';

export const DEFAULT_OSRM_BASE_URL = 'http://127.0.0.1:5000';

export type OsrmFetch = (
  input: URL,
  init?: RequestInit,
) => Promise<Response>;

export interface OsrmClientOptions {
  readonly baseUrl?: string;
  readonly fetch?: OsrmFetch;
}

type ServiceName = 'nearest' | 'route';

interface ResponsePayload {
  readonly response: Response;
  readonly value: unknown;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeErrorPayload(value: unknown): string {
  if (!isRecord(value)) {
    return '';
  }

  const details = [value.code, value.message].filter(
    (part): part is string => typeof part === 'string' && part.length > 0,
  );
  return details.length === 0 ? '' : ` (${details.join(': ')})`;
}

function describeHttpStatus(response: Response): string {
  return response.statusText.length === 0
    ? String(response.status)
    : `${response.status} ${response.statusText}`;
}

function malformed(service: ServiceName, detail: string): never {
  throw new Error(`Malformed OSRM ${service} response: ${detail}.`);
}

function parseNonnegativeNumber(
  value: unknown,
  field: string,
  service: ServiceName,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return malformed(service, `"${field}" must be a nonnegative finite number`);
  }
  return value;
}

function assertCoordinate(
  coordinate: Coordinate,
  description: string,
): void {
  if (coordinate === null || typeof coordinate !== 'object') {
    throw new TypeError(`${description} must be a coordinate object.`);
  }

  const { latitude, longitude } = coordinate;
  if (typeof latitude !== 'number' || !Number.isFinite(latitude)) {
    throw new TypeError(`${description} latitude must be a finite number.`);
  }
  if (latitude < -90 || latitude > 90) {
    throw new RangeError(`${description} latitude must be between -90 and 90.`);
  }
  if (typeof longitude !== 'number' || !Number.isFinite(longitude)) {
    throw new TypeError(`${description} longitude must be a finite number.`);
  }
  if (longitude < -180 || longitude > 180) {
    throw new RangeError(
      `${description} longitude must be between -180 and 180.`,
    );
  }
}

function coordinatePath(coordinate: Coordinate): string {
  return `${coordinate.longitude},${coordinate.latitude}`;
}

function normalizeBaseUrl(baseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  } catch (error) {
    throw new Error(`Invalid OSRM base URL "${baseUrl}".`, { cause: error });
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('OSRM base URL must use HTTP or HTTPS.');
  }
  return url;
}

export class OsrmClient {
  private readonly baseUrl: URL;
  private readonly fetchImplementation: OsrmFetch;

  constructor(options: OsrmClientOptions = {}) {
    this.baseUrl = normalizeBaseUrl(
      options.baseUrl ?? DEFAULT_OSRM_BASE_URL,
    );
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
  }

  private async request(
    service: ServiceName,
    url: URL,
  ): Promise<ResponsePayload> {
    let response: Response;
    try {
      response = await this.fetchImplementation(url, {
        headers: { accept: 'application/json' },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`OSRM ${service} request failed: ${message}`, {
        cause: error,
      });
    }

    const body = await response.text();
    let value: unknown;
    try {
      value = JSON.parse(body);
    } catch (error) {
      if (!response.ok) {
        throw new Error(
          `OSRM ${service} request failed with HTTP ${describeHttpStatus(response)}; response was not valid JSON.`,
          { cause: error },
        );
      }
      throw new Error(
        `Malformed OSRM ${service} response: response body is not valid JSON.`,
        { cause: error },
      );
    }

    return { response, value };
  }

  async findNearestRoadPoint(
    coordinate: Coordinate,
  ): Promise<SnappedRoadPoint> {
    assertCoordinate(coordinate, 'Coordinate');
    const url = new URL(
      `nearest/v1/driving/${coordinatePath(coordinate)}.json`,
      this.baseUrl,
    );
    url.searchParams.set('number', '1');

    const { response, value } = await this.request('nearest', url);
    if (!response.ok) {
      throw new Error(
        `OSRM nearest request failed with HTTP ${describeHttpStatus(response)}${describeErrorPayload(value)}.`,
      );
    }
    if (!isRecord(value) || value.code !== 'Ok') {
      return malformed('nearest', 'expected code "Ok"');
    }

    const waypoint = Array.isArray(value.waypoints)
      ? value.waypoints[0]
      : undefined;
    if (!isRecord(waypoint)) {
      return malformed('nearest', 'expected one waypoint');
    }

    const location = waypoint.location;
    if (!Array.isArray(location) || location.length < 2) {
      return malformed(
        'nearest',
        'waypoint "location" must contain longitude and latitude',
      );
    }
    const longitude = location[0];
    const latitude = location[1];
    if (
      typeof latitude !== 'number' ||
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90 ||
      typeof longitude !== 'number' ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180
    ) {
      return malformed(
        'nearest',
        'waypoint "location" must contain valid WGS84 coordinates',
      );
    }

    const name = waypoint.name;
    if (name !== undefined && typeof name !== 'string') {
      return malformed('nearest', 'waypoint "name" must be a string');
    }

    return {
      latitude,
      longitude,
      distanceMeters: parseNonnegativeNumber(
        waypoint.distance,
        'waypoints[0].distance',
        'nearest',
      ),
      ...(name === undefined || name.length === 0 ? {} : { name }),
    };
  }

  async estimateCarRoute(
    from: Coordinate,
    to: Coordinate,
  ): Promise<CarRouteEstimate | undefined> {
    assertCoordinate(from, 'Origin');
    assertCoordinate(to, 'Destination');
    const coordinates = `${coordinatePath(from)};${coordinatePath(to)}`;
    const url = new URL(
      `route/v1/driving/${coordinates}.json`,
      this.baseUrl,
    );
    url.searchParams.set('overview', 'false');

    const { response, value } = await this.request('route', url);
    if (isRecord(value) && value.code === 'NoRoute') {
      return undefined;
    }
    if (!response.ok) {
      throw new Error(
        `OSRM route request failed with HTTP ${describeHttpStatus(response)}${describeErrorPayload(value)}.`,
      );
    }
    if (!isRecord(value) || value.code !== 'Ok') {
      return malformed('route', 'expected code "Ok" or "NoRoute"');
    }

    const route = Array.isArray(value.routes) ? value.routes[0] : undefined;
    if (!isRecord(route)) {
      return malformed('route', 'expected one route');
    }

    return {
      durationSeconds: parseNonnegativeNumber(
        route.duration,
        'routes[0].duration',
        'route',
      ),
      distanceMeters: parseNonnegativeNumber(
        route.distance,
        'routes[0].distance',
        'route',
      ),
    };
  }
}
