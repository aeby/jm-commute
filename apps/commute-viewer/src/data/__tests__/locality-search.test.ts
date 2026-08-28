import { describe, expect, it } from 'vitest';

import {
  searchCommuteViewerLocalities,
  type ViewerLocality,
} from '../runtime-data';

const LOCALITIES: readonly ViewerLocality[] = [
  {
    localityId: '2000:neuchatel',
    postalCode: '2000',
    city: 'Neuchâtel',
    longitude: 6.93,
    latitude: 46.99,
  },
  {
    localityId: '3011:bern',
    postalCode: '3011',
    city: 'Bern',
    longitude: 7.45,
    latitude: 46.95,
  },
  {
    localityId: '8001:zurich',
    postalCode: '8001',
    city: 'Zürich',
    longitude: 8.54,
    latitude: 47.38,
  },
  {
    localityId: '8002:zurich',
    postalCode: '8002',
    city: 'Zürich',
    longitude: 8.53,
    latitude: 47.36,
  },
  {
    localityId: '8050:zurich',
    postalCode: '8050',
    city: 'Zürich',
    longitude: 8.55,
    latitude: 47.41,
  },
  {
    localityId: '8700:kusnacht zh',
    postalCode: '8700',
    city: 'Küsnacht ZH',
    longitude: 8.58,
    latitude: 47.32,
  },
];

const ids = (query: string, limit = 20): readonly string[] =>
  searchCommuteViewerLocalities(LOCALITIES, query, limit).map(
    ({ localityId }) => localityId,
  );

describe('searchCommuteViewerLocalities', () => {
  it('ranks exact ZIP and ZIP-and-city matches first', () => {
    expect(ids('8001')[0]).toBe('8001:zurich');
    expect(ids(' 8001 zurich ')).toEqual(['8001:zurich']);
    expect(ids('3011 Bern')).toEqual(['3011:bern']);
  });

  it('matches numeric ZIP prefixes deterministically', () => {
    expect(ids('80')).toEqual([
      '8001:zurich',
      '8002:zurich',
      '8050:zurich',
    ]);
  });

  it('matches exact, prefix, and contained city names', () => {
    expect(ids('Bern')).toEqual(['3011:bern']);
    expect(ids('Küs')).toEqual(['8700:kusnacht zh']);
    expect(ids('snacht')).toEqual(['8700:kusnacht zh']);
  });

  it('is case and accent insensitive', () => {
    expect(ids('ZURICH')).toEqual([
      '8001:zurich',
      '8002:zurich',
      '8050:zurich',
    ]);
    expect(ids('neuchatel')).toEqual(['2000:neuchatel']);
  });

  it('applies its positive result limit', () => {
    expect(ids('zurich', 2)).toEqual(['8001:zurich', '8002:zurich']);
    expect(() => ids('zurich', 0)).toThrow(/positive integer/i);
  });

  it('uses locality IDs for deterministic ties regardless of input order', () => {
    const reversed = searchCommuteViewerLocalities(
      LOCALITIES.toReversed(),
      'zurich',
      20,
    );
    expect(reversed.map(({ localityId }) => localityId)).toEqual(ids('zurich'));
  });

  it('returns no results for unknown or empty queries', () => {
    expect(ids('Nowhere')).toEqual([]);
    expect(ids('   ')).toEqual([]);
  });
});
