import type {
  CarDurationTable,
  CarRouteEstimate,
  Coordinate,
  SnappedRoadPoint,
} from './types';

export const DEFAULT_OSRM_BASE_URL = 'http://127.0.0.1:5000';
export const DEFAULT_OSRM_REQUEST_TIMEOUT_MILLISECONDS = 30_000;

export type OsrmFetch = (
  input: URL,
  init?: RequestInit,
) => Promise<Response>;

export interface OsrmClientOptions {
  readonly baseUrl?: string;
  readonly fetch?: OsrmFetch;
  readonly requestTimeoutMilliseconds?: number;
}

type ServiceName = 'nearest' | 'route' | 'table';

const MAX_TABLE_COORDINATES = 100;

interface ResponsePayload {
  readonly response: Response;
  readonly value: unknown;
}

export class OsrmTransportError extends Error {
  readonly service: ServiceName;

  constructor(service: ServiceName, detail: string, cause: unknown) {
    super(`OSRM ${service} request failed: ${detail}`, { cause });
    this.name = 'OsrmTransportError';
    this.service = service;
  }
}

export class OsrmHttpError extends Error {
  readonly service: ServiceName;
  readonly status: number;

  constructor(service: ServiceName, response: Response, value: unknown) {
    super(
      `OSRM ${service} request failed with HTTP ${describeHttpStatus(response)}${describeErrorPayload(value)}.`,
    );
    this.name = 'OsrmHttpError';
    this.service = service;
    this.status = response.status;
  }
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
  private readonly requestTimeoutMilliseconds: number;

  constructor(options: OsrmClientOptions = {}) {
    this.baseUrl = normalizeBaseUrl(
      options.baseUrl ?? DEFAULT_OSRM_BASE_URL,
    );
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
    this.requestTimeoutMilliseconds =
      options.requestTimeoutMilliseconds ??
      DEFAULT_OSRM_REQUEST_TIMEOUT_MILLISECONDS;
    if (
      !Number.isFinite(this.requestTimeoutMilliseconds) ||
      this.requestTimeoutMilliseconds <= 0
    ) {
      throw new RangeError(
        'OSRM request timeout must be a positive finite number of milliseconds.',
      );
    }
  }

  private async request(
    service: ServiceName,
    url: URL,
  ): Promise<ResponsePayload> {
    const abortController = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      abortController.abort();
    }, this.requestTimeoutMilliseconds);
    let response: Response;
    try {
      response = await this.fetchImplementation(url, {
        headers: { accept: 'application/json' },
        signal: abortController.signal,
      });
    } catch (error) {
      clearTimeout(timeout);
      const detail = timedOut
        ? `timed out after ${this.requestTimeoutMilliseconds} milliseconds`
        : error instanceof Error
          ? error.message
          : String(error);
      throw new OsrmTransportError(service, detail, error);
    }

    let body: string;
    try {
      body = await response.text();
    } catch (error) {
      const detail = timedOut
        ? `timed out after ${this.requestTimeoutMilliseconds} milliseconds while reading the response`
        : `unable to read response body: ${error instanceof Error ? error.message : String(error)}`;
      throw new OsrmTransportError(service, detail, error);
    } finally {
      clearTimeout(timeout);
    }
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
      throw new OsrmHttpError('nearest', response, value);
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
      throw new OsrmHttpError('route', response, value);
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

  async getCarDurationTable(
    sources: readonly Coordinate[],
    destinations: readonly Coordinate[],
  ): Promise<CarDurationTable> {
    if (sources.length === 0) {
      throw new RangeError('OSRM table requires at least one source.');
    }
    if (destinations.length === 0) {
      throw new RangeError('OSRM table requires at least one destination.');
    }
    if (sources.length + destinations.length > MAX_TABLE_COORDINATES) {
      throw new RangeError(
        `OSRM table supports at most ${MAX_TABLE_COORDINATES} combined source and destination coordinates.`,
      );
    }

    sources.forEach((coordinate, index) => {
      assertCoordinate(coordinate, `Source ${index}`);
    });
    destinations.forEach((coordinate, index) => {
      assertCoordinate(coordinate, `Destination ${index}`);
    });

    const coordinates = [...sources, ...destinations];
    const url = new URL(
      `table/v1/driving/${coordinates.map(coordinatePath).join(';')}.json`,
      this.baseUrl,
    );
    url.searchParams.set(
      'sources',
      sources.map((_, index) => index).join(';'),
    );
    url.searchParams.set(
      'destinations',
      destinations
        .map((_, index) => sources.length + index)
        .join(';'),
    );
    url.searchParams.set('annotations', 'duration');

    const { response, value } = await this.request('table', url);
    if (!response.ok) {
      throw new OsrmHttpError('table', response, value);
    }
    if (!isRecord(value) || value.code !== 'Ok') {
      return malformed('table', 'expected code "Ok"');
    }
    if (!Array.isArray(value.durations)) {
      return malformed('table', '"durations" must be an array');
    }
    if (value.durations.length !== sources.length) {
      return malformed(
        'table',
        `expected ${sources.length} duration rows, received ${value.durations.length}`,
      );
    }

    const durationsSeconds = value.durations.map((row, rowIndex) => {
      if (!Array.isArray(row)) {
        return malformed('table', `durations[${rowIndex}] must be an array`);
      }
      if (row.length !== destinations.length) {
        return malformed(
          'table',
          `expected ${destinations.length} columns in durations[${rowIndex}], received ${row.length}`,
        );
      }

      return row.map((duration, columnIndex) => {
        if (duration === null) {
          return undefined;
        }
        return parseNonnegativeNumber(
          duration,
          `durations[${rowIndex}][${columnIndex}]`,
          'table',
        );
      });
    });

    return { durationsSeconds };
  }
}
