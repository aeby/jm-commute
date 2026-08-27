import { describe, expect, it } from 'vitest';

import { parseTransitPlacesJson } from '../parse-transit-places-json';

describe('parseTransitPlacesJson', () => {
  it('parses the generated transit-place shape', () => {
    expect(
      parseTransitPlacesJson(
        JSON.stringify([
          {
            id: 'place-a',
            name: 'Place A',
            latitude: 47,
            longitude: 8,
            stopIds: ['stop-a'],
          },
        ]),
        'test transit places',
      ),
    ).toEqual([
      {
        id: 'place-a',
        name: 'Place A',
        latitude: 47,
        longitude: 8,
        stopIds: ['stop-a'],
      },
    ]);
  });

  it('reports malformed JSON and invalid roots with the source name', () => {
    expect(() => parseTransitPlacesJson('{', 'test input')).toThrow(
      /test input.*JSON/i,
    );
    expect(() => parseTransitPlacesJson('{}', 'test input')).toThrow(
      /test input.*array/i,
    );
  });

  it('rejects empty routing stop IDs', () => {
    expect(() =>
      parseTransitPlacesJson(
        JSON.stringify([
          {
            id: 'place-a',
            name: 'Place A',
            latitude: 47,
            longitude: 8,
            stopIds: [' '],
          },
        ]),
        'test input',
      ),
    ).toThrow(/stopIds.*nonempty strings/i);
  });
});
