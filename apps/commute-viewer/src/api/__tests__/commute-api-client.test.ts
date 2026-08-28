import { describe, expect, it, vi } from 'vitest';

import {
  CommuteApiClient,
  CommuteApiClientError,
  parseLocalitiesResponse,
  parseReachabilityResponse,
  VIEWER_REACHABILITY_HORIZON_MINUTES,
} from '../commute-api-client';

const locality = {
  localityId: '8001:zurich',
  postalCode: '8001',
  city: 'Zürich',
  latitude: 47.372,
  longitude: 8.542,
} as const;

const reachabilityResponse = () => ({
  origin: {
    localityId: locality.localityId,
    latitude: locality.latitude,
    longitude: locality.longitude,
  },
  mode: 'transit',
  maxTravelMinutes: 240,
  reachableLocalityCount: 2,
  hexagonCount: 1,
  geojson: {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: '20:30',
        properties: { travelMinutes: 62 },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [8.5, 47.3],
              [8.6, 47.3],
              [8.6, 47.4],
              [8.5, 47.3],
            ],
          ],
        },
      },
    ],
  },
  bounds: { west: 8.5, south: 47.3, east: 8.6, north: 47.4 },
});

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('CommuteApiClient', () => {
  it('loads and caches the canonical locality catalog once', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      jsonResponse({ localities: [locality] }),
    );
    const client = new CommuteApiClient({
      baseUrl: 'http://127.0.0.1:3001/',
      fetch: fetchImplementation,
    });

    const first = await client.loadLocalities();
    const second = await client.loadLocalities();

    expect(first).toBe(second);
    expect(first).toEqual([locality]);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(fetchImplementation).toHaveBeenCalledWith(
      'http://127.0.0.1:3001/api/localities',
      { headers: { Accept: 'application/json' } },
    );
  });

  it('allows a locality load to be retried after a recoverable failure', async () => {
    const fetchImplementation = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ error: { code: 'UNAVAILABLE', message: 'Try again.' } }, 503),
      )
      .mockResolvedValueOnce(jsonResponse({ localities: [locality] }));
    const client = new CommuteApiClient({
      baseUrl: 'http://localhost:3001',
      fetch: fetchImplementation,
    });

    await expect(client.loadLocalities()).rejects.toMatchObject({
      status: 503,
      code: 'UNAVAILABLE',
      message: 'Try again.',
    });
    await expect(client.loadLocalities()).resolves.toEqual([locality]);
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it('always requests the full 240-minute horizon', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      jsonResponse(reachabilityResponse()),
    );
    const client = new CommuteApiClient({
      baseUrl: 'http://127.0.0.1:3001',
      fetch: fetchImplementation,
    });
    const abortController = new AbortController();

    const result = await client.loadReachability(
      locality.localityId,
      'transit',
      abortController.signal,
    );

    expect(result.maxTravelMinutes).toBe(VIEWER_REACHABILITY_HORIZON_MINUTES);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImplementation.mock.calls[0] ?? [];
    expect(url).toBe('http://127.0.0.1:3001/api/reachability');
    expect(init).toMatchObject({
      method: 'POST',
      signal: abortController.signal,
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      originLocalityId: locality.localityId,
      mode: 'transit',
      maxTravelMinutes: 240,
    });
  });

  it('surfaces structured API errors without hiding status or code', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      jsonResponse(
        {
          error: {
            code: 'UNKNOWN_ORIGIN_LOCALITY_ID',
            message: 'Unknown locality.',
          },
        },
        400,
      ),
    );
    const client = new CommuteApiClient({
      baseUrl: 'http://localhost:3001',
      fetch: fetchImplementation,
    });

    await expect(
      client.loadReachability('0000:unknown', 'car'),
    ).rejects.toEqual(
      expect.objectContaining<Partial<CommuteApiClientError>>({
        status: 400,
        code: 'UNKNOWN_ORIGIN_LOCALITY_ID',
        message: 'Unknown locality.',
      }),
    );
  });
});

describe('commute API response validation', () => {
  it('rejects duplicate localities and unusable coordinates', () => {
    expect(() => parseLocalitiesResponse({ localities: [locality, locality] }))
      .toThrow(/duplicate localityId/u);
    expect(() =>
      parseLocalitiesResponse({
        localities: [{ ...locality, longitude: Number.NaN }],
      }),
    ).toThrow(/longitude must be a finite number/u);
  });

  it('validates the requested origin, mode, horizon, counts and polygons', () => {
    const wireResponse = reachabilityResponse();
    const parsed = parseReachabilityResponse(
      wireResponse,
      locality.localityId,
      'transit',
    );
    expect(parsed).toMatchObject({
      mode: 'transit',
      maxTravelMinutes: 240,
      hexagonCount: 1,
    });
    expect(parsed.geojson).toBe(wireResponse.geojson);
    expect(parsed.geojson.features[0]).toBe(wireResponse.geojson.features[0]);
    expect(() =>
      parseReachabilityResponse(
        { ...reachabilityResponse(), maxTravelMinutes: 120 },
        locality.localityId,
        'transit',
      ),
    ).toThrow(/must be 240/u);
    expect(() =>
      parseReachabilityResponse(
        { ...reachabilityResponse(), hexagonCount: 2 },
        locality.localityId,
        'transit',
      ),
    ).toThrow(/does not match GeoJSON/u);
  });
});
