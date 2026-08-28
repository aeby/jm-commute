import { describe, expect, it, vi } from 'vitest';

import {
  OsrmClient,
  OsrmHttpError,
  OsrmTransportError,
  type OsrmFetch,
} from '../osrm-client';

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

  it('builds a duration-only Table request with longitude/latitude coordinates and explicit indexes', async () => {
    const { client, fetch } = mockFetch(
      jsonResponse({
        code: 'Ok',
        durations: [
          [100, 200, 300],
          [400, 500, 600],
        ],
      }),
    );

    await client.getCarDurationTable(
      [
        { latitude: 47.37, longitude: 8.54 },
        { latitude: 46.95, longitude: 7.44 },
      ],
      [
        { latitude: 47.04, longitude: 9.06 },
        { latitude: 46.02, longitude: 7.75 },
        { latitude: 46.29, longitude: 7.88 },
      ],
    );

    const url = fetch.mock.calls[0]?.[0];
    expect(url?.pathname).toBe(
      '/table/v1/driving/8.54,47.37;7.44,46.95;9.06,47.04;7.75,46.02;7.88,46.29.json',
    );
    expect(Object.fromEntries(url?.searchParams ?? [])).toEqual({
      sources: '0;1',
      destinations: '2;3;4',
      annotations: 'duration',
    });
  });

  it('parses a complete 50 by 50 duration table', async () => {
    const coordinates = Array.from({ length: 50 }, (_, index) => ({
      latitude: 46 + index / 1_000,
      longitude: 7 + index / 1_000,
    }));
    const durations = Array.from({ length: 50 }, (_row, rowIndex) =>
      Array.from(
        { length: 50 },
        (_column, columnIndex) => rowIndex * 50 + columnIndex,
      ),
    );
    const { client } = mockFetch(
      jsonResponse({ code: 'Ok', durations }),
    );

    const result = await client.getCarDurationTable(
      coordinates,
      coordinates,
    );

    expect(result.durationsSeconds).toHaveLength(50);
    expect(result.durationsSeconds[0]).toHaveLength(50);
    expect(result.durationsSeconds[0]?.[0]).toBe(0);
    expect(result.durationsSeconds[49]?.[49]).toBe(2_499);
  });

  it('parses partial blocks and maps null durations to undefined', async () => {
    const { client } = mockFetch(
      jsonResponse({
        code: 'Ok',
        durations: [
          [60, null, 60.1],
          [0, 120, null],
        ],
      }),
    );

    await expect(
      client.getCarDurationTable(
        [
          { latitude: 47, longitude: 8 },
          { latitude: 46, longitude: 7 },
        ],
        [
          { latitude: 45, longitude: 6 },
          { latitude: 44, longitude: 5 },
          { latitude: 43, longitude: 4 },
        ],
      ),
    ).resolves.toEqual({
      durationsSeconds: [
        [60, undefined, 60.1],
        [0, 120, undefined],
      ],
    });
  });

  it('rejects a Table response with the wrong row count', async () => {
    const { client } = mockFetch(
      jsonResponse({ code: 'Ok', durations: [[10]] }),
    );

    await expect(
      client.getCarDurationTable(
        [
          { latitude: 47, longitude: 8 },
          { latitude: 46, longitude: 7 },
        ],
        [{ latitude: 45, longitude: 6 }],
      ),
    ).rejects.toThrow(
      'Malformed OSRM table response: expected 2 duration rows, received 1.',
    );
  });

  it('rejects a Table response with the wrong column count', async () => {
    const { client } = mockFetch(
      jsonResponse({ code: 'Ok', durations: [[10]] }),
    );

    await expect(
      client.getCarDurationTable(
        [{ latitude: 47, longitude: 8 }],
        [
          { latitude: 46, longitude: 7 },
          { latitude: 45, longitude: 6 },
        ],
      ),
    ).rejects.toThrow(
      'Malformed OSRM table response: expected 2 columns in durations[0], received 1.',
    );
  });

  it('rejects a negative Table duration', async () => {
    const { client } = mockFetch(
      jsonResponse({ code: 'Ok', durations: [[-0.1]] }),
    );

    await expect(
      client.getCarDurationTable(
        [{ latitude: 47, longitude: 8 }],
        [{ latitude: 46, longitude: 7 }],
      ),
    ).rejects.toThrow(
      'Malformed OSRM table response: "durations[0][0]" must be a nonnegative finite number.',
    );
  });

  it('rejects Table blocks that exceed the default OSRM location limit', async () => {
    const { client, fetch } = mockFetch(
      jsonResponse({ code: 'Ok', durations: [] }),
    );
    const sources = Array.from({ length: 51 }, () => ({
      latitude: 47,
      longitude: 8,
    }));
    const destinations = Array.from({ length: 50 }, () => ({
      latitude: 46,
      longitude: 7,
    }));

    await expect(
      client.getCarDurationTable(sources, destinations),
    ).rejects.toThrow(
      'OSRM table supports at most 100 combined source and destination coordinates.',
    );
    expect(fetch).not.toHaveBeenCalled();
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

    const request = client.findNearestRoadPoint({ latitude: 47, longitude: 8 });
    await expect(request).rejects.toThrow(
      'OSRM nearest request failed with HTTP 503 (Error: Unavailable)',
    );
    await expect(request).rejects.toBeInstanceOf(OsrmHttpError);
    await expect(request).rejects.toMatchObject({ status: 503 });
  });

  it('classifies response-body socket failures as transport errors', async () => {
    const response = jsonResponse({ code: 'Ok', durations: [[0]] });
    vi.spyOn(response, 'text').mockRejectedValue(new Error('socket reset'));
    const { client } = mockFetch(response);

    const request = client.getCarDurationTable(
      [{ latitude: 47, longitude: 8 }],
      [{ latitude: 47, longitude: 8 }],
    );
    await expect(request).rejects.toBeInstanceOf(OsrmTransportError);
    await expect(request).rejects.toThrow('unable to read response body');
  });

  it('aborts a request that exceeds its configured timeout', async () => {
    const fetch = vi.fn<OsrmFetch>((_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      }),
    );
    const client = new OsrmClient({
      fetch,
      requestTimeoutMilliseconds: 5,
    });

    await expect(
      client.findNearestRoadPoint({ latitude: 47, longitude: 8 }),
    ).rejects.toThrow('timed out after 5 milliseconds');
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
