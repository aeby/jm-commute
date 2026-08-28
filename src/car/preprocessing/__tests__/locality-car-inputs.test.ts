import { describe, expect, it } from 'vitest';

import { createLocalityId, type Locality } from '@jm/commute';
import { buildCarLocalityInputs } from '../locality-car-inputs';

const ZURICH: Locality = {
  localityId: '8001:zurich',
  postalCode: '8001',
  city: 'Zürich',
  latitude: 47.3723,
  longitude: 8.5425,
};

describe('buildCarLocalityInputs', () => {
  it('reuses the transport-independent locality ID and coordinates', () => {
    expect(buildCarLocalityInputs([ZURICH])).toEqual([
      {
        localityId: createLocalityId('8001', 'Zürich'),
        postalCode: '8001',
        city: 'Zürich',
        latitude: 47.3723,
        longitude: 8.5425,
      },
    ]);
    expect(createLocalityId('8001', 'Zürich')).toBe('8001:zurich');
  });

  it('uses deterministic existing locality ordering', () => {
    const localities: readonly Locality[] = [
      ZURICH,
      {
        localityId: '1008:prilly',
        postalCode: '1008',
        city: 'Prilly',
        latitude: 46.536,
        longitude: 6.605,
      },
      {
        localityId: '3011:bern',
        postalCode: '3011',
        city: 'Bern',
        latitude: 46.948,
        longitude: 7.447,
      },
      {
        localityId: '1008:jouxtens-mezery',
        postalCode: '1008',
        city: 'Jouxtens-Mézery',
        latitude: 46.55,
        longitude: 6.6,
      },
    ];

    const forward = buildCarLocalityInputs(localities);
    const reversed = buildCarLocalityInputs(localities.toReversed());

    expect(reversed).toEqual(forward);
    expect(forward.map(({ localityId }) => localityId)).toEqual([
      '1008:jouxtens-mezery',
      '1008:prilly',
      '3011:bern',
      '8001:zurich',
    ]);
    expect(localities[0]).toBe(ZURICH);
  });
});
