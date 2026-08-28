import { describe, expect, it } from 'vitest';

import { parseCommuteApiServerTiming } from '../api-harness.js';

describe('parseCommuteApiServerTiming', () => {
  it('parses every required API processing stage', () => {
    const headers = new Headers({
      'Server-Timing':
        'lookup;dur=0.31, join;dur=0.12, hex;dur=2.45, ' +
        'geojson;dur=1.72, serialization;dur=3.85, total;dur=8.49',
    });

    expect(parseCommuteApiServerTiming(headers)).toEqual({
      lookup: 0.31,
      join: 0.12,
      hex: 2.45,
      geojson: 1.72,
      serialization: 3.85,
      total: 8.49,
    });
  });

  it('rejects missing and invalid durations', () => {
    expect(() => parseCommuteApiServerTiming(new Headers())).toThrow(
      'missing Server-Timing',
    );
    expect(() =>
      parseCommuteApiServerTiming(
        new Headers({
          'Server-Timing':
            'lookup;dur=-1, join;dur=0, hex;dur=0, geojson;dur=0, ' +
            'serialization;dur=0, total;dur=0',
        }),
      ),
    ).toThrow('invalid duration');
    expect(() =>
      parseCommuteApiServerTiming(
        new Headers({
          'Server-Timing':
            'lookup;dur=0, join;dur=0, hex;dur=0, geojson;dur=0, ' +
            'serialization;dur=0',
        }),
      ),
    ).toThrow('missing required stage total');
  });
});
