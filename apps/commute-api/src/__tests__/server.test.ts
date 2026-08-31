import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';

import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import type { Locality, ReachableLocality } from '@jm/commute';

import type { CommuteApiRuntime } from '../api-types.js';
import {
  DEFAULT_COMMUTE_API_CONFIG,
  type CommuteApiConfig,
} from '../config.js';
import {
  createCommuteApiRequestHandler,
  type CommuteApiLogger,
} from '../server.js';

const LOCALITIES: readonly Locality[] = Object.freeze([
  Object.freeze({
    localityId: '8001:zurich',
    postalCode: '8001',
    city: 'Zürich',
    latitude: 47.372_309,
    longitude: 8.542_467,
  }),
  Object.freeze({
    localityId: '3011:bern',
    postalCode: '3011',
    city: 'Bern',
    latitude: 46.948,
    longitude: 7.4474,
  }),
  Object.freeze({
    localityId: '3072:ostermundigen',
    postalCode: '3072',
    city: 'Ostermundigen',
    // Deliberately identical to Bern: these two samples aggregate to one cell.
    latitude: 46.948,
    longitude: 7.4474,
  }),
]);

const ROAD_REACHABLE: readonly ReachableLocality[] = [
  { localityId: '8001:zurich', travelMinutes: 0 },
  { localityId: '3011:bern', travelMinutes: 38 },
  { localityId: '3072:ostermundigen', travelMinutes: 31 },
];
const PUBLIC_TRANSPORT_REACHABLE: readonly ReachableLocality[] = [
  { localityId: '8001:zurich', travelMinutes: 0 },
  { localityId: '3011:bern', travelMinutes: 45 },
];

const byId = new Map(LOCALITIES.map((locality) => [locality.localityId, locality]));
const reachableLocalities = vi.fn<
  (
    origin: Locality,
    maxTravelMinutes: number,
    mode: 'public_transport' | 'road',
  ) =>
    readonly ReachableLocality[]
>((_origin, _maximum, mode) =>
  mode === 'road' ? ROAD_REACHABLE : PUBLIC_TRANSPORT_REACHABLE,
);

const runtime: CommuteApiRuntime = {
  localities: LOCALITIES,
  resolve: (query) =>
    typeof query === 'string' ? byId.get(query) : undefined,
  reachableLocalities,
};

const config: CommuteApiConfig = {
  ...DEFAULT_COMMUTE_API_CONFIG,
  host: '127.0.0.1',
  port: 0,
  corsAllowedOrigins: [
    'http://127.0.0.1:5173',
    'http://localhost:5173',
  ],
};

const logger: CommuteApiLogger = {
  info: vi.fn<(message: string) => void>(),
  error: vi.fn<(message: string, error?: unknown) => void>(),
};
const handler = createCommuteApiRequestHandler({ runtime, config, logger });
const baseUrl = 'http://commute-api.test';

interface TestRequestInit {
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

class TestHeaders {
  constructor(private readonly values: ReadonlyMap<string, string>) {}

  get(name: string): string | null {
    return this.values.get(name.toLowerCase()) ?? null;
  }
}

interface TestResponse {
  readonly status: number;
  readonly headers: TestHeaders;
  json(): Promise<any>;
  text(): Promise<string>;
}

async function requestApi(
  input: string,
  init: TestRequestInit = {},
): Promise<TestResponse> {
  const url = new URL(input, baseUrl);
  const requestHeaders: IncomingHttpHeaders = {};
  for (const [name, value] of Object.entries(init.headers ?? {})) {
    requestHeaders[name.toLowerCase()] = value;
  }
  if (init.body !== undefined && requestHeaders['content-length'] === undefined) {
    requestHeaders['content-length'] = String(Buffer.byteLength(init.body));
  }
  const request = Object.assign(
    Readable.from(init.body === undefined ? [] : [Buffer.from(init.body)]),
    {
      method: init.method ?? 'GET',
      url: `${url.pathname}${url.search}`,
      headers: requestHeaders,
    },
  ) as IncomingMessage;

  const responseHeaders = new Map<string, string>();
  let status = 200;
  let responseBody = '';
  let headersSent = false;
  const response = {
    get headersSent() {
      return headersSent;
    },
    setHeader(name: string, value: number | string | readonly string[]) {
      responseHeaders.set(name.toLowerCase(), String(value));
      return response;
    },
    writeHead(
      statusCode: number,
      headers?: Readonly<Record<string, number | string | readonly string[]>>,
    ) {
      status = statusCode;
      headersSent = true;
      for (const [name, value] of Object.entries(headers ?? {})) {
        responseHeaders.set(name.toLowerCase(), String(value));
      }
      return response;
    },
    end(chunk?: string | Buffer) {
      if (chunk !== undefined) {
        responseBody += chunk.toString();
      }
      return response;
    },
    destroy() {
      return response;
    },
  } as unknown as ServerResponse;

  await handler(request, response);
  return {
    status,
    headers: new TestHeaders(responseHeaders),
    json: async () => JSON.parse(responseBody),
    text: async () => responseBody,
  };
}

const fetch = requestApi;

async function postReachability(
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
): Promise<TestResponse> {
  return fetch(`${baseUrl}/api/reachability`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('commute API server', () => {
  it('reports health without exposing runtime provenance', async () => {
    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ok',
      localityCount: 3,
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('serves the canonical locality order with a reusable ETag', async () => {
    const first = await fetch(`${baseUrl}/api/localities`);
    const etag = first.headers.get('etag');

    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ localities: LOCALITIES });
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/u);
    expect(first.headers.get('cache-control')).toContain('max-age=86400');

    const cached = await fetch(`${baseUrl}/api/localities`, {
      headers: { 'If-None-Match': etag ?? '' },
    });
    expect(cached.status).toBe(304);
    expect(await cached.text()).toBe('');
    expect(cached.headers.get('etag')).toBe(etag);
  });

  it('dispatches road reachability and returns deterministic polygon GeoJSON', async () => {
    const request = {
      originLocalityId: '8001:zurich',
      mode: 'road',
      maxTravelMinutes: 120,
    };
    const first = await postReachability(request);
    const second = await postReachability(request);
    const firstBody = await first.json();
    const secondBody = await second.json();

    expect(first.status).toBe(200);
    expect(firstBody).toEqual(secondBody);
    expect(firstBody).toMatchObject({
      origin: {
        localityId: '8001:zurich',
        latitude: 47.372_309,
        longitude: 8.542_467,
      },
      mode: 'road',
      maxTravelMinutes: 120,
      reachableLocalityCount: 3,
      hexagonCount: 2,
      geojson: { type: 'FeatureCollection' },
    });
    expect(firstBody.geojson.features).toHaveLength(2);
    expect(
      firstBody.geojson.features.map(
        (feature: { properties: { travelMinutes: number } }) =>
          feature.properties.travelMinutes,
      ),
    ).toContain(31);
    for (const feature of firstBody.geojson.features) {
      const ring = feature.geometry.coordinates[0];
      expect(ring).toHaveLength(7);
      expect(ring[0]).toEqual(ring[6]);
    }
    expect(firstBody.bounds.west).toBeLessThan(firstBody.bounds.east);
    expect(first.headers.get('server-timing')).toContain('lookup;dur=');
    expect(first.headers.get('server-timing')).toContain('total;dur=');
    expect(reachableLocalities).toHaveBeenCalledWith(
      LOCALITIES[0],
      120,
      'road',
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining(
        'origin=8001:zurich mode=road maxMinutes=120 reachable=3 hexes=2',
      ),
    );
  });

  it('dispatches public-transport reachability', async () => {
    const response = await postReachability({
      originLocalityId: '8001:zurich',
      mode: 'public_transport',
      maxTravelMinutes: 60,
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.mode).toBe('public_transport');
    expect(body.reachableLocalityCount).toBe(2);
    expect(reachableLocalities).toHaveBeenCalledWith(
      LOCALITIES[0],
      60,
      'public_transport',
    );
  });

  it.each([
    [
      'unknown origin',
      {
        originLocalityId: '9999:unknown',
        mode: 'road',
        maxTravelMinutes: 30,
      },
      'UNKNOWN_ORIGIN_LOCALITY_ID',
    ],
    [
      'unsupported mode',
      {
        originLocalityId: '8001:zurich',
        mode: 'bicycle',
        maxTravelMinutes: 30,
      },
      'INVALID_MODE',
    ],
    [
      'fractional maximum',
      {
        originLocalityId: '8001:zurich',
        mode: 'road',
        maxTravelMinutes: 30.5,
      },
      'INVALID_MAX_TRAVEL_MINUTES',
    ],
    [
      'negative maximum',
      {
        originLocalityId: '8001:zurich',
        mode: 'road',
        maxTravelMinutes: -1,
      },
      'INVALID_MAX_TRAVEL_MINUTES',
    ],
    [
      'maximum above the matrix horizon',
      {
        originLocalityId: '8001:zurich',
        mode: 'road',
        maxTravelMinutes: 241,
      },
      'INVALID_MAX_TRAVEL_MINUTES',
    ],
  ])('rejects an %s', async (_label, request, errorCode) => {
    const response = await postReachability(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe(errorCode);
  });

  it('rejects unexpected fields and malformed or incorrectly typed bodies', async () => {
    const unexpected = await postReachability({
      originLocalityId: '8001:zurich',
      mode: 'road',
      maxTravelMinutes: 30,
      hexCellDiameterMeters: 500,
    });
    expect(unexpected.status).toBe(400);
    expect((await unexpected.json()).error.code).toBe('INVALID_REQUEST');

    const malformed = await fetch(`${baseUrl}/api/reachability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    });
    expect(malformed.status).toBe(400);
    expect((await malformed.json()).error.code).toBe('INVALID_JSON');

    const wrongType = await fetch(`${baseUrl}/api/reachability`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: '{}',
    });
    expect(wrongType.status).toBe(415);
    expect((await wrongType.json()).error.code).toBe(
      'UNSUPPORTED_MEDIA_TYPE',
    );
  });

  it('enforces the request-size and method limits', async () => {
    const oversized = await fetch(`${baseUrl}/api/reachability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filler: 'x'.repeat(17_000) }),
    });
    expect(oversized.status).toBe(413);
    expect((await oversized.json()).error.code).toBe(
      'REQUEST_BODY_TOO_LARGE',
    );

    const wrongMethod = await fetch(`${baseUrl}/api/reachability`);
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get('allow')).toBe('POST, OPTIONS');
  });

  it('allows only the configured development CORS origin', async () => {
    const allowed = await fetch(`${baseUrl}/api/localities`, {
      headers: { Origin: 'http://127.0.0.1:5173' },
    });
    expect(allowed.headers.get('access-control-allow-origin')).toBe(
      'http://127.0.0.1:5173',
    );

    const notAllowed = await fetch(`${baseUrl}/api/localities`, {
      headers: { Origin: 'https://example.test' },
    });
    expect(notAllowed.headers.get('access-control-allow-origin')).toBeNull();

    const allowedPreflight = await fetch(`${baseUrl}/api/reachability`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://127.0.0.1:5173' },
    });
    expect(allowedPreflight.status).toBe(204);
    expect(allowedPreflight.headers.get('access-control-allow-methods')).toBe(
      'POST, OPTIONS',
    );

    const blockedPreflight = await fetch(`${baseUrl}/api/reachability`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://example.test' },
    });
    expect(blockedPreflight.status).toBe(403);
    expect((await blockedPreflight.json()).error.code).toBe(
      'CORS_ORIGIN_NOT_ALLOWED',
    );
  });

  it('returns a structured 404 without reflecting an unknown path', async () => {
    const response = await fetch(`${baseUrl}/not-an-endpoint`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Endpoint not found.' },
    });
  });
});
