import { describe, expect, it } from 'vitest';

import { parseGtfsTimeToSeconds } from '../parse-gtfs-time';

describe('parseGtfsTimeToSeconds', () => {
  it('parses a service time before 24:00', () => {
    expect(parseGtfsTimeToSeconds('08:15:30')).toBe(
      8 * 3_600 + 15 * 60 + 30,
    );
  });

  it.each([
    ['24:15:00', 24 * 3_600 + 15 * 60],
    ['25:03:30', 25 * 3_600 + 3 * 60 + 30],
  ])('parses extended GTFS time %s', (value, expectedSeconds) => {
    expect(parseGtfsTimeToSeconds(value)).toBe(expectedSeconds);
  });

  it.each([
    '',
    '08:00',
    '08:00:00:00',
    '-01:00:00',
    '08:60:00',
    '08:00:60',
    'eight',
  ])('rejects malformed GTFS time %j', (value) => {
    expect(() => parseGtfsTimeToSeconds(value)).toThrow(/invalid GTFS time/i);
  });
});
