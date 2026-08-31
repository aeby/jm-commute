import { describe, expect, it } from 'vitest';

import {
  createLocalityId,
  normalizeCityName,
  parseLocalitiesJson,
} from '../localities';

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
});
