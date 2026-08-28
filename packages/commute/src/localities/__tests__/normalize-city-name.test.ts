import { describe, expect, it } from 'vitest';

import { normalizeCityName } from '../normalize-city-name.js';

describe('normalizeCityName', () => {
  it.each([
    [' Zürich ', 'zurich'],
    ['Neuchâtel', 'neuchatel'],
    ['Zu\u0308rich', 'zurich'],
    ['  La   Chaux\tde-Fonds  ', 'la chaux de-fonds'],
  ])('normalizes %j to %j', (city, expected) => {
    expect(normalizeCityName(city)).toBe(expected);
  });
});
