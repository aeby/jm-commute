import type {
  Coordinate,
  RoadDurationTable,
  RoadRouteEstimate,
  RoadRouter,
  SnappedRoadPoint,
} from './types';

const MAX_TABLE_COORDINATES = 100;

type ServiceName = 'nearest' | 'route' | 'table';
export type OsrmFetch = (input: URL, init?: RequestInit) => Promise<Response>;

export interface OsrmClientOptions {
  readonly baseUrl: string;
  readonly requestTimeoutMilliseconds: number;
  readonly fetch?: OsrmFetch;
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
    const details =
      isRecord(value) && typeof value.message === 'string'
        ? `: ${value.message}`
        : '';
    super(`OSRM ${service} returned HTTP ${response.status}${details}.`);
    this.name = 'OsrmHttpError';
    this.service = service;
    this.status = response.status;
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function malformed(service: ServiceName, detail: string): never {
  throw new Error(`Malformed OSRM ${service} response: ${detail}.`);
}

function nonnegativeNumber(
  value: unknown,
  service: ServiceName,
  field: string,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return malformed(service, `${field} must be a nonnegative finite number`);
  }
  return value;
}

function assertCoordinate(coordinate: Coordinate, description: string): void {
  if (typeof coordinate !== 'object' || coordinate === null) {
    throw new TypeError(`${description} must be a coordinate.`);
  }
  if (
    !Number.isFinite(coordinate.latitude) ||
    coordinate.latitude < -90 ||
    coordinate.latitude > 90
  ) {
    throw new RangeError(`${description} latitude must be between -90 and 90.`);
  }
  if (
    !Number.isFinite(coordinate.longitude) ||
    coordinate.longitude < -180 ||
    coordinate.longitude > 180
  ) {
    throw new RangeError(
      `${description} longitude must be between -180 and 180.`,
    );
  }
}

function coordinatePath(coordinate: Coordinate): string {
  return `${coordinate.longitude},${coordinate.latitude}`;
}

function parseBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value.endsWith('/') ? value : `${value}/`);
  } catch (error) {
    throw new Error(`Invalid OSRM base URL "${value}".`, { cause: error });
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('OSRM base URL must use HTTP or HTTPS.');
  }
  return url;
}

export class OsrmClient implements RoadRouter {
  private readonly baseUrl: URL;
  private readonly fetchImplementation: OsrmFetch;
  private readonly requestTimeoutMilliseconds: number;

  constructor(options: OsrmClientOptions) {
    this.baseUrl = parseBaseUrl(options.baseUrl);
    this.fetchImplementation = options.fetch ?? globalThis.fetch;
    this.requestTimeoutMilliseconds = options.requestTimeoutMilliseconds;
    if (
      !Number.isFinite(this.requestTimeoutMilliseconds) ||
      this.requestTimeoutMilliseconds <= 0
    ) {
      throw new RangeError('OSRM request timeout must be positive.');
    }
  }

  private async request(service: ServiceName, url: URL): Promise<unknown> {
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
      throw new OsrmTransportError(
        service,
        timedOut
          ? `timed out after ${this.requestTimeoutMilliseconds} milliseconds`
          : error instanceof Error
            ? error.message
            : String(error),
        error,
      );
    }

    let value: unknown;
    try {
      value = await response.json();
    } catch (error) {
      throw new OsrmTransportError(
        service,
        timedOut
          ? `timed out after ${this.requestTimeoutMilliseconds} milliseconds while reading the response`
          : 'response is not valid JSON',
        error,
      );
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      throw new OsrmHttpError(service, response, value);
    }
    return value;
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
    const value = await this.request('nearest', url);
    if (!isRecord(value) || value.code !== 'Ok') {
      return malformed('nearest', 'expected code "Ok"');
    }
    const waypoint = Array.isArray(value.waypoints)
      ? value.waypoints[0]
      : undefined;
    if (!isRecord(waypoint) || !Array.isArray(waypoint.location)) {
      return malformed('nearest', 'expected one waypoint with a location');
    }
    const longitude = waypoint.location[0];
    const latitude = waypoint.location[1];
    const snapped = { latitude, longitude } as Coordinate;
    assertCoordinate(snapped, 'Nearest waypoint');
    return {
      ...snapped,
      distanceMeters: nonnegativeNumber(
        waypoint.distance,
        'nearest',
        'waypoints[0].distance',
      ),
    };
  }

  async estimateRoute(
    from: Coordinate,
    to: Coordinate,
  ): Promise<RoadRouteEstimate | undefined> {
    assertCoordinate(from, 'Origin');
    assertCoordinate(to, 'Destination');
    const url = new URL(
      `route/v1/driving/${coordinatePath(from)};${coordinatePath(to)}.json`,
      this.baseUrl,
    );
    url.searchParams.set('overview', 'false');
    const value = await this.request('route', url);
    if (isRecord(value) && value.code === 'NoRoute') {
      return undefined;
    }
    if (!isRecord(value) || value.code !== 'Ok') {
      return malformed('route', 'expected code "Ok" or "NoRoute"');
    }
    const route = Array.isArray(value.routes) ? value.routes[0] : undefined;
    if (!isRecord(route)) {
      return malformed('route', 'expected one route');
    }
    return {
      durationSeconds: nonnegativeNumber(
        route.duration,
        'route',
        'routes[0].duration',
      ),
    };
  }

  async getDurationTable(
    sources: readonly Coordinate[],
    destinations: readonly Coordinate[],
  ): Promise<RoadDurationTable> {
    if (sources.length === 0 || destinations.length === 0) {
      throw new RangeError('OSRM table requires sources and destinations.');
    }
    if (sources.length + destinations.length > MAX_TABLE_COORDINATES) {
      throw new RangeError(
        `OSRM table supports at most ${MAX_TABLE_COORDINATES} coordinates.`,
      );
    }
    sources.forEach((coordinate, index) =>
      assertCoordinate(coordinate, `Source ${index}`),
    );
    destinations.forEach((coordinate, index) =>
      assertCoordinate(coordinate, `Destination ${index}`),
    );

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
    const value = await this.request('table', url);
    if (
      !isRecord(value) ||
      value.code !== 'Ok' ||
      !Array.isArray(value.durations)
    ) {
      return malformed('table', 'expected code "Ok" and a durations array');
    }
    if (value.durations.length !== sources.length) {
      return malformed('table', `expected ${sources.length} rows`);
    }

    return {
      durationsSeconds: value.durations.map((row, rowIndex) => {
        if (!Array.isArray(row) || row.length !== destinations.length) {
          return malformed(
            'table',
            `durations[${rowIndex}] must have ${destinations.length} columns`,
          );
        }
        return row.map((duration, columnIndex) =>
          duration === null
            ? undefined
            : nonnegativeNumber(
                duration,
                'table',
                `durations[${rowIndex}][${columnIndex}]`,
              ),
        );
      }),
    };
  }
}
