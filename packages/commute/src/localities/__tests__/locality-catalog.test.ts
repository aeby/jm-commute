import { describe, expect, it } from 'vitest';

import {
  createLocalityCatalog,
  parseLocalityCatalogFile,
  parseLocalityCatalogFileJson,
  serializeOrderedLocalityIds,
  type LocalityCatalogFile,
} from '../locality-catalog.js';

const ORDERED_LOCALITY_SHA256 = 'a'.repeat(64);

function catalogFile(): LocalityCatalogFile {
  return {
    schemaVersion: 1,
    localityCount: 3,
    orderedLocalitySha256: ORDERED_LOCALITY_SHA256,
    localities: [
      {
        localityId: '8001:zurich',
        postalCode: '8001',
        city: 'Zürich',
        latitude: 47.3723085057712,
        longitude: 8.542467084010747,
      },
      {
        localityId: '3011:bern',
        postalCode: '3011',
        city: 'Bern',
        latitude: 46.9482713,
        longitude: 7.4514512,
      },
      {
        localityId: '2000:neuchatel',
        postalCode: '2000',
        city: 'Neuchâtel',
        latitude: 46.9899874,
        longitude: 6.9292732,
      },
    ],
  };
}

describe('locality catalog file', () => {
  it('strictly parses its exact schema and JSON representation', () => {
    const value = catalogFile();

    expect(parseLocalityCatalogFile(value)).toEqual(value);
    expect(parseLocalityCatalogFileJson(JSON.stringify(value))).toEqual(value);
    expect(serializeOrderedLocalityIds(value.localities)).toBe(
      '["8001:zurich","3011:bern","2000:neuchatel"]',
    );
  });

  it.each([
    ['schema version', { ...catalogFile(), schemaVersion: 2 }],
    [
      'missing field',
      {
        schemaVersion: 1,
        localityCount: 3,
        orderedLocalitySha256: ORDERED_LOCALITY_SHA256,
      },
    ],
    ['extra field', { ...catalogFile(), source: 'swisstopo' }],
    ['zero count', { ...catalogFile(), localityCount: 0 }],
    ['wrong count', { ...catalogFile(), localityCount: 2 }],
    [
      'digest syntax',
      { ...catalogFile(), orderedLocalitySha256: 'not-a-digest' },
    ],
  ])('rejects invalid %s', (_label, value) => {
    expect(() => parseLocalityCatalogFile(value)).toThrow(
      'Invalid locality catalog',
    );
  });

  it('rejects duplicate canonical locality IDs', () => {
    const value = catalogFile();
    const duplicate = value.localities[0];

    expect(() =>
      parseLocalityCatalogFile({
        ...value,
        localities: [value.localities[0], duplicate, value.localities[2]],
      }),
    ).toThrow('duplicate locality ID "8001:zurich"');
  });

  it('rejects an ID that does not match the locality postal code and city', () => {
    const value = catalogFile();

    expect(() =>
      parseLocalityCatalogFile({
        ...value,
        localities: [
          { ...value.localities[0], localityId: '8001:bern' },
          ...value.localities.slice(1),
        ],
      }),
    ).toThrow('expected canonical ID "8001:zurich"');
  });

  it('rejects duplicate normalized postal-code/city resolver keys', () => {
    const value = catalogFile();
    const normalizedDuplicate = {
      ...value.localities[0],
      city: 'ZURICH',
    };

    expect(() =>
      parseLocalityCatalogFile({
        ...value,
        localities: [
          value.localities[0],
          normalizedDuplicate,
          value.localities[2],
        ],
      }),
    ).toThrow(/duplicate (?:locality ID|normalized postal-code\/city resolver key)/);
  });

  it.each([
    ['latitude', Number.NaN],
    ['latitude', 91],
    ['longitude', Number.POSITIVE_INFINITY],
    ['longitude', -181],
  ] as const)('rejects invalid %s coordinate %s', (field, coordinate) => {
    const value = catalogFile();

    expect(() =>
      parseLocalityCatalogFile({
        ...value,
        localities: [
          { ...value.localities[0], [field]: coordinate },
          ...value.localities.slice(1),
        ],
      }),
    ).toThrow(`localities[0].${field}`);
  });
});

describe('createLocalityCatalog', () => {
  it('preserves canonical order and provides ID and normalized query lookup', () => {
    const catalog = createLocalityCatalog(catalogFile());

    expect(catalog.all().map(({ localityId }) => localityId)).toEqual([
      '8001:zurich',
      '3011:bern',
      '2000:neuchatel',
    ]);
    expect(catalog.get('3011:bern')?.city).toBe('Bern');
    expect(catalog.get('9999:missing')).toBeUndefined();
    expect(
      catalog.resolve({ postalCode: ' 2000 ', city: '  NEUCHATEL ' }),
    ).toBe(catalog.get('2000:neuchatel'));
  });

  it('exposes a frozen catalog, ordered array, and locality records', () => {
    const catalog = createLocalityCatalog(catalogFile());
    const all = catalog.all();

    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(all)).toBe(true);
    expect(all.every(Object.isFrozen)).toBe(true);
    expect(catalog.all()).toBe(all);
    expect(catalog.get('8001:zurich')).toBe(all[0]);
  });
});
