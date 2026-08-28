import { describe, expect, it } from 'vitest';

import type { Locality } from '../api/types';
import {
  formatLocality,
  normalizeLocalitySearchText,
  searchLocalities,
} from '../locality-search';

const LOCALITIES: readonly Locality[] = [
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
    city: 'Küsnacht   ZH',
    longitude: 8.58,
    latitude: 47.32,
  },
];

const ids = (query: string, limit = 20): readonly string[] =>
  searchLocalities(LOCALITIES, query, limit).map(({ localityId }) => localityId);

describe('searchLocalities', () => {
  it('supports ZIP, ZIP and city, and city queries', () => {
    expect(ids('8001')).toEqual(['8001:zurich']);
    expect(ids('  8001   Zürich  ')).toEqual(['8001:zurich']);
    expect(ids('Bern')).toEqual(['3011:bern']);
  });

  it('is case, accent, and whitespace insensitive', () => {
    expect(ids('ZURICH')).toEqual([
      '8001:zurich',
      '8002:zurich',
      '8050:zurich',
    ]);
    expect(ids('neuchatel')).toEqual(['2000:neuchatel']);
    expect(ids('kusnacht zh')).toEqual(['8700:kusnacht zh']);
    expect(normalizeLocalitySearchText('  Küsnacht   ZH ')).toBe('kusnacht zh');
  });

  it('matches ZIP prefixes and contained names deterministically', () => {
    expect(ids('80')).toEqual([
      '8001:zurich',
      '8002:zurich',
      '8050:zurich',
    ]);
    expect(ids('snacht')).toEqual(['8700:kusnacht zh']);
    expect(
      searchLocalities(LOCALITIES.toReversed(), 'zurich').map(
        ({ localityId }) => localityId,
      ),
    ).toEqual(ids('zurich'));
  });

  it('limits results and returns no result for blank or unknown input', () => {
    expect(ids('zurich', 2)).toEqual(['8001:zurich', '8002:zurich']);
    expect(ids('')).toEqual([]);
    expect(ids('nowhere')).toEqual([]);
    expect(() => ids('zurich', 0)).toThrow(/positive integer/u);
  });

  it('formats the canonical suggestion label', () => {
    expect(formatLocality(LOCALITIES[2]!)).toBe('8001 Zürich');
  });
});
