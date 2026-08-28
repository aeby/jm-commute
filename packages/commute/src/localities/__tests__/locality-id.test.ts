import { describe, expect, it } from 'vitest';

import { createLocalityId } from '../locality-id.js';

describe('createLocalityId', () => {
  it('creates a deterministic transport-independent ZIP-and-city ID', () => {
    expect(createLocalityId('8001', 'Zürich')).toBe('8001:zurich');
    expect(createLocalityId('8001', 'Zürich')).toBe('8001:zurich');
  });

  it.each([
    ['8001', 'Zurich'],
    ['8001', 'ZÜRICH'],
    [' 8001 ', '  Zürich  '],
  ])('normalizes accents, case, and whitespace', (postalCode, city) => {
    expect(createLocalityId(postalCode, city)).toBe('8001:zurich');
  });

  it('keeps different ZIP codes distinct', () => {
    expect(createLocalityId('8001', 'Zürich')).not.toBe(
      createLocalityId('8002', 'Zürich'),
    );
  });

  it('keeps different cities under the same ZIP distinct', () => {
    expect(createLocalityId('1000', 'Lausanne')).not.toBe(
      createLocalityId('1000', 'Lausanne 25'),
    );
  });

  it.each(['800', '80010', '80 01', 'ABCD', ''])(
    'fails clearly for malformed postal code %j',
    (postalCode) => {
      expect(() => createLocalityId(postalCode, 'Zürich')).toThrow(
        /four digits/i,
      );
    },
  );
});
