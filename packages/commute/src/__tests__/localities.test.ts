import { describe, expect, it } from 'vitest';

import {
  createLocalityId,
  normalizeCityName,
  parseLocalitiesJson,
} from '../localities';
import { createCommuteRuntime } from '../runtime';

describe('locality data', () => {
  it('uses stable Swiss locality IDs', () => {
    expect(createLocalityId(' 8001 ', '  Zürich ')).toBe('8001:zurich');
    expect(normalizeCityName('Crans–Montana')).toBe('crans–montana');
  });

  it('loads the ordered locality array without a metadata wrapper', () => {
    expect(
      parseLocalitiesJson(
        JSON.stringify([
          {
            localityId: '8001:zurich',
            postalCode: '8001',
            city: 'Zürich',
            latitude: 47.37,
            longitude: 8.54,
          },
        ]),
      ),
    ).toHaveLength(1);
  });

  it('fails clearly for unreadable or incompatible data', () => {
    expect(() => parseLocalitiesJson('{')).toThrow('Unable to parse');
    expect(() => parseLocalitiesJson('{}')).toThrow('locality array');
  });

  it('loads station names from the locality array and exposes them through resolution', () => {
    const localities = parseLocalitiesJson(JSON.stringify([{
      localityId: '8001:zurich', postalCode: '8001', city: 'Zürich',
      latitude: 47.37, longitude: 8.54,
      publicTransportStationName: 'Zürich, Paradeplatz',
    }]));
    const runtime = createCommuteRuntime({
      localities,
      roadMatrix: Uint8Array.of(0),
      publicTransportMatrix: Uint8Array.of(0),
    });
    expect(runtime.resolve('8001:zurich')?.publicTransportStationName)
      .toBe('Zürich, Paradeplatz');
    expect(runtime.resolve({ postalCode: '8001', city: 'Zürich' })?.publicTransportStationName)
      .toBe('Zürich, Paradeplatz');
  });

  it.each(['', ' ', 123, null])('rejects an invalid station name: %j', (name) => {
    expect(() => parseLocalitiesJson(JSON.stringify([{
      localityId: '8001:zurich', postalCode: '8001', city: 'Zürich',
      latitude: 47.37, longitude: 8.54, publicTransportStationName: name,
    }]))).toThrow(/publicTransportStationName/u);
  });
});
