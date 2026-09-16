import { describe, expect, it } from 'vitest';

import { OsrmClient, OsrmHttpError } from '..';

function client(
  payload: unknown,
  capture?: (url: URL) => void,
  status = 200,
): OsrmClient {
  return new OsrmClient({
    baseUrl: 'http://127.0.0.1:5000',
    requestTimeoutMilliseconds: 1_000,
    fetch: async (url) => {
      capture?.(url);
      return new Response(JSON.stringify(payload), { status });
    },
  });
}

describe('OsrmClient', () => {
  it('parses nearest, route, and directional table responses', async () => {
    const nearest = await client({
      code: 'Ok',
      waypoints: [{ location: [8.54, 47.37], distance: 4.5 }],
    }).findNearestRoadPoint({ latitude: 47.371, longitude: 8.541 });
    expect(nearest).toEqual({
      latitude: 47.37,
      longitude: 8.54,
      distanceMeters: 4.5,
    });

    await expect(
      client({ code: 'Ok', routes: [{ duration: 61.2 }] }).estimateRoute(
        nearest,
        { latitude: 46.95, longitude: 7.44 },
      ),
    ).resolves.toEqual({ durationSeconds: 61.2 });

    let requestedUrl: URL | undefined;
    const table = await client(
      { code: 'Ok', durations: [[0, null], [12, 0]] },
      (url) => (requestedUrl = url),
    ).getDurationTable([nearest, nearest], [nearest, nearest]);
    expect(table.durationsSeconds).toEqual([
      [0, undefined],
      [12, 0],
    ]);
    expect(requestedUrl?.searchParams.get('sources')).toBe('0;1');
    expect(requestedUrl?.searchParams.get('destinations')).toBe('2;3');
  });

  it('preserves retry-relevant HTTP status information', async () => {
    await expect(
      client({ code: 'Error', message: 'busy' }, undefined, 503)
        .findNearestRoadPoint({ latitude: 47, longitude: 8 }),
    ).rejects.toBeInstanceOf(OsrmHttpError);
  });
});
