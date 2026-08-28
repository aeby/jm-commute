import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { LocalityResolver } from '..';
import { parseLocalitiesCsv } from '../node';

const fixtureCsv = readFileSync(
  new URL('./fixtures/localities.csv', import.meta.url),
  'utf8',
);

const resolver = new LocalityResolver(parseLocalitiesCsv(fixtureCsv));

describe('LocalityResolver', () => {
  it('resolves an exact ZIP-code-and-city pair', () => {
    expect(
      resolver.resolve({ postalCode: '8001', city: 'Zürich' }),
    ).toEqual({
      postalCode: '8001',
      city: 'Zürich',
      latitude: 47.3723085057712,
      longitude: 8.542467084010747,
    });
  });

  it.each([
    [' 8001 ', '  ZURICH  ', 'Zürich'],
    ['2000', 'NEUCHATEL', 'Neuchâtel'],
  ])(
    'ignores ZIP whitespace, city case, accents, and city whitespace',
    (postalCode, city, officialCity) => {
      expect(resolver.resolve({ postalCode, city })?.city).toBe(officialCity);
    },
  );

  it('distinguishes the same city under different ZIP codes', () => {
    expect(
      resolver.resolve({ postalCode: '8002', city: 'Zürich' })?.longitude,
    ).toBe(8.529880800337645);
  });

  it.each([
    ['8001', 'Bern'],
    ['3004', 'Zürich'],
  ])('does not match only one half of the locality key', (postalCode, city) => {
    expect(resolver.resolve({ postalCode, city })).toBeUndefined();
  });

  it.each(['800', '80010', '80 01', 'ABCD', ''])(
    'rejects malformed postal code %j',
    (postalCode) => {
      expect(
        resolver.resolve({ postalCode, city: 'Zürich' }),
      ).toBeUndefined();
    },
  );

  it('rejects a missing city', () => {
    expect(
      resolver.resolve({ postalCode: '8001', city: '   ' }),
    ).toBeUndefined();
  });

  it('returns undefined for an unknown locality', () => {
    expect(
      resolver.resolve({ postalCode: '9999', city: 'Nowhere' }),
    ).toBeUndefined();
  });
});
