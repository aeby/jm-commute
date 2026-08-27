import { describe, expect, it } from 'vitest';

import type { ValidationLocality } from '../validation-data';
import { searchValidationLocalities } from '../autocomplete';

const LOCALITIES: readonly ValidationLocality[] = [
  { localityId: '2000:neuchatel', postalCode: '2000', city: 'Neuchâtel' },
  { localityId: '3011:bern', postalCode: '3011', city: 'Bern' },
  { localityId: '8001:zurich', postalCode: '8001', city: 'Zürich' },
  { localityId: '8002:zurich', postalCode: '8002', city: 'Zürich' },
  { localityId: '8050:zurich', postalCode: '8050', city: 'Zürich' },
  { localityId: '8700:kusnacht zh', postalCode: '8700', city: 'Küsnacht ZH' },
];

const ids = (query: string, limit = 20): readonly string[] =>
  searchValidationLocalities(LOCALITIES, query, limit).map(
    ({ localityId }) => localityId,
  );

describe('searchValidationLocalities', () => {
  it('ranks an exact ZIP first', () => {
    expect(ids('8001')[0]).toBe('8001:zurich');
  });

  it('matches ZIP prefixes', () => {
    expect(ids('80')).toEqual([
      '8001:zurich',
      '8002:zurich',
      '8050:zurich',
    ]);
  });

  it('matches exact and prefix city names', () => {
    expect(ids('Bern')).toEqual(['3011:bern']);
    expect(ids('Küs')).toEqual(['8700:kusnacht zh']);
  });

  it('is case and accent insensitive', () => {
    expect(ids('ZURICH')).toEqual([
      '8001:zurich',
      '8002:zurich',
      '8050:zurich',
    ]);
    expect(ids('neuchatel')).toEqual(['2000:neuchatel']);
  });

  it('matches an exact ZIP-and-city query', () => {
    expect(ids(' 8001 zurich ')).toEqual(['8001:zurich']);
  });

  it('applies the configured result limit', () => {
    expect(ids('zurich', 2)).toEqual(['8001:zurich', '8002:zurich']);
  });

  it('uses locality IDs for deterministic ties regardless of input order', () => {
    const reversed = searchValidationLocalities(
      LOCALITIES.toReversed(),
      'zurich',
      20,
    );
    expect(reversed.map(({ localityId }) => localityId)).toEqual(ids('zurich'));
  });

  it('returns no results for an unknown or empty query', () => {
    expect(ids('Nowhere')).toEqual([]);
    expect(ids('   ')).toEqual([]);
  });
});
