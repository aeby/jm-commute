import { describe, expect, it } from 'vitest';

import type { Locality } from '../localities';
import { createCommuteRuntime } from '../runtime';

const localities: readonly Locality[] = [
  {
    localityId: '1000:alpha',
    postalCode: '1000',
    city: 'Alpha',
    latitude: 46,
    longitude: 7,
  },
  {
    localityId: '2000:beta',
    postalCode: '2000',
    city: 'Béta',
    latitude: 47,
    longitude: 8,
  },
  {
    localityId: '3000:gamma',
    postalCode: '3000',
    city: 'Gamma',
    latitude: 48,
    longitude: 9,
  },
];

function runtime() {
  return createCommuteRuntime({
    localities,
    publicTransportMatrix: Uint8Array.of(
      0, 20, 255,
      18, 0, 12,
      255, 14, 0,
    ),
    roadMatrix: Uint8Array.of(
      0, 10, 30,
      9, 0, 15,
      28, 16, 0,
    ),
  });
}

describe('commute runtime', () => {
  it('resolves locality IDs and normalized postal-code/city queries', () => {
    const commute = runtime();
    expect(commute.resolve('1000:alpha')).toBe(localities[0]);
    expect(commute.resolve({ postalCode: ' 2000 ', city: ' beta ' })).toBe(
      localities[1],
    );
    expect(commute.resolve('9999:unknown')).toBeUndefined();
  });

  it('looks up both finished matrices directly', () => {
    const commute = runtime();
    expect(commute.travelTime(localities[0]!, localities[1]!, 'road')).toBe(10);
    expect(
      commute.travelTime(
        localities[0]!,
        localities[1]!,
        'public_transport',
      ),
    ).toBe(20);
    expect(
      commute.travelTime(
        localities[0]!,
        localities[2]!,
        'public_transport',
      ),
    ).toBeUndefined();
  });

  it('retains the one-to-many scan used by the viewer', () => {
    expect(runtime().reachableLocalities(localities[0]!, 20, 'road')).toEqual([
      { localityId: '1000:alpha', travelMinutes: 0 },
      { localityId: '2000:beta', travelMinutes: 10 },
    ]);
  });

  it('rejects obviously incompatible matrix lengths', () => {
    expect(() =>
      createCommuteRuntime({
        localities,
        publicTransportMatrix: new Uint8Array(8),
        roadMatrix: new Uint8Array(9),
      }),
    ).toThrow('expected 9');
  });
});
