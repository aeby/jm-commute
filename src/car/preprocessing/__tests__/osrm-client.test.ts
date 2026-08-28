import { describe, expect, it, vi } from 'vitest';

import { OsrmClient, type OsrmFetch } from '../osrm-client';

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mockFetch(response: Response): {
  readonly client: OsrmClient;
  readonly fetch: ReturnType<typeof vi.fn<OsrmFetch>>;
} {
  const fetch = vi.fn<OsrmFetch>().mockResolvedValue(response);
  return { client: new OsrmClient({ fetch }), fetch };
}

describe('OsrmClient', () => {
  it('sends longitude before latitude to nearest and route services', async () => {
    const fetch = vi
      .fn<OsrmFetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          code: 'Ok',
          waypoints: [
            { location: [8.55, 47.38], distance: 12.5, name: 'Road' },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: 'Ok',
          routes: [{ duration: 4_700.5, distance: 124_300.25 }],
        }),
      );
    const client = new OsrmClient({ fetch });

    await client.findNearestRoadPoint({ latitude: 47.37, longitude: 8.54 });
    await client.estimateCarRoute(
      { latitude: 47.37, longitude: 8.54 },
      { latitude: 46.95, longitude: 7.44 },
    );

    expect(String(fetch.mock.calls[0]?.[0])).toContain(
      '/nearest/v1/driving/8.54,47.37.json?number=1',
    );
    expect(String(fetch.mock.calls[1]?.[0])).toContain(
      '/route/v1/driving/8.54,47.37;7.44,46.95.json?overview=false',
    );
  });

  it('parses a nearest-road response', async () => {
    const { client } = mockFetch(
      jsonResponse({
        code: 'Ok',
        waypoints: [
          {
            location: [8.54275, 47.3721],
            distance: 24.75,
            name: 'Limmatquai',
          },
        ],
      }),
    );

    await expect(
      client.findNearestRoadPoint({ latitude: 47.3723, longitude: 8.5425 }),
    ).resolves.toEqual({
      latitude: 47.3721,
      longitude: 8.54275,
      distanceMeters: 24.75,
      name: 'Limmatquai',
    });
  });

  it('parses route duration and distance without rounding', async () => {
    const { client } = mockFetch(
      jsonResponse({
        code: 'Ok',
        routes: [{ duration: 4_700.5, distance: 124_300.25 }],
      }),
    );

    await expect(
      client.estimateCarRoute(
        { latitude: 47.37, longitude: 8.54 },
        { latitude: 46.95, longitude: 7.44 },
      ),
    ).resolves.toEqual({
      durationSeconds: 4_700.5,
      distanceMeters: 124_300.25,
    });
  });

  it('turns an OSRM NoRoute response into undefined, including HTTP 400', async () => {
    const { client } = mockFetch(
      jsonResponse({ code: 'NoRoute', message: 'Impossible route' }, 400),
    );

    await expect(
      client.estimateCarRoute(
        { latitude: 47, longitude: 8 },
        { latitude: 46, longitude: 7 },
      ),
    ).resolves.toBeUndefined();
  });

  it.each([
    ['nearest', { code: 'Ok', waypoints: [] }],
    ['route', { code: 'Ok', routes: [{ duration: 'fast', distance: 10 }] }],
  ] as const)('fails clearly for a malformed %s response', async (service, body) => {
    const { client } = mockFetch(jsonResponse(body));
    const promise =
      service === 'nearest'
        ? client.findNearestRoadPoint({ latitude: 47, longitude: 8 })
        : client.estimateCarRoute(
            { latitude: 47, longitude: 8 },
            { latitude: 46, longitude: 7 },
          );

    await expect(promise).rejects.toThrow(
      `Malformed OSRM ${service} response`,
    );
  });

  it('fails clearly for HTTP errors', async () => {
    const { client } = mockFetch(
      jsonResponse({ code: 'Error', message: 'Unavailable' }, 503),
    );

    await expect(
      client.findNearestRoadPoint({ latitude: 47, longitude: 8 }),
    ).rejects.toThrow('OSRM nearest request failed with HTTP 503 (Error: Unavailable)');
  });

  it.each([
    [{ latitude: Number.NaN, longitude: 8 }, 'latitude must be a finite number'],
    [{ latitude: 47, longitude: Number.POSITIVE_INFINITY }, 'longitude must be a finite number'],
  ])('rejects nonfinite coordinates', async (coordinate, message) => {
    const { client, fetch } = mockFetch(jsonResponse({ code: 'Ok' }));

    await expect(client.findNearestRoadPoint(coordinate)).rejects.toThrow(message);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([-90.01, 90.01])('rejects invalid latitude %s', async (latitude) => {
    const { client, fetch } = mockFetch(jsonResponse({ code: 'Ok' }));

    await expect(
      client.findNearestRoadPoint({ latitude, longitude: 8 }),
    ).rejects.toThrow('latitude must be between -90 and 90');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([-180.01, 180.01])(
    'rejects invalid longitude %s',
    async (longitude) => {
      const { client, fetch } = mockFetch(jsonResponse({ code: 'Ok' }));

      await expect(
        client.findNearestRoadPoint({ latitude: 47, longitude }),
      ).rejects.toThrow('longitude must be between -180 and 180');
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});
