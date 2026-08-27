import { describe, expect, it } from 'vitest';

import { parseGtfsFrequencies } from '../parse-gtfs-frequencies';

const HEADER =
  'trip_id,start_time,end_time,headway_secs,exact_times';
const KNOWN_TRIP_IDS = new Set(['trip-a', 'trip-b']);

function frequenciesCsv(...rows: readonly string[]): string {
  return `${[HEADER, ...rows].join('\n')}\n`;
}

describe('parseGtfsFrequencies', () => {
  it('normalizes an empty exact_times value to zero', () => {
    const windows = parseGtfsFrequencies(
      frequenciesCsv('trip-a,08:00:00,09:00:00,600,'),
      KNOWN_TRIP_IDS,
    );

    expect(windows.get('trip-a')?.[0]?.exactTimes).toBe(0);
  });

  it('retains exact_times zero', () => {
    const windows = parseGtfsFrequencies(
      frequenciesCsv('trip-a,08:00:00,09:00:00,600,0'),
      KNOWN_TRIP_IDS,
    );

    expect(windows.get('trip-a')?.[0]?.exactTimes).toBe(0);
  });

  it('retains exact_times one', () => {
    const windows = parseGtfsFrequencies(
      frequenciesCsv('trip-a,08:00:00,09:00:00,600,1'),
      KNOWN_TRIP_IDS,
    );

    expect(windows.get('trip-a')?.[0]?.exactTimes).toBe(1);
  });

  it.each(['-1', '2', 'invalid'])(
    'rejects invalid exact_times %s',
    (exactTimes) => {
      expect(() =>
        parseGtfsFrequencies(
          frequenciesCsv(
            `trip-a,08:00:00,09:00:00,600,${exactTimes}`,
          ),
          KNOWN_TRIP_IDS,
        ),
      ).toThrow(/exact_times.*empty value, 0, or 1/i);
    },
  );

  it('accepts a positive integer headway', () => {
    const windows = parseGtfsFrequencies(
      frequenciesCsv('trip-a,08:00:00,09:00:00,37,0'),
      KNOWN_TRIP_IDS,
    );

    expect(windows.get('trip-a')?.[0]?.headwaySeconds).toBe(37);
  });

  it.each(['0', '-1', '1.5'])(
    'rejects nonpositive or noninteger headway %s',
    (headwaySeconds) => {
      expect(() =>
        parseGtfsFrequencies(
          frequenciesCsv(
            `trip-a,08:00:00,09:00:00,${headwaySeconds},0`,
          ),
          KNOWN_TRIP_IDS,
        ),
      ).toThrow(/headway_secs.*positive integer/i);
    },
  );

  it('accepts a start time before its end time', () => {
    const windows = parseGtfsFrequencies(
      frequenciesCsv('trip-a,07:59:59,08:00:00,600,0'),
      KNOWN_TRIP_IDS,
    );

    expect(windows.get('trip-a')).toHaveLength(1);
  });

  it.each([
    ['08:00:00', '08:00:00'],
    ['08:00:01', '08:00:00'],
  ])('rejects window %s–%s without increasing times', (start, end) => {
    expect(() =>
      parseGtfsFrequencies(
        frequenciesCsv(`trip-a,${start},${end},600,0`),
        KNOWN_TRIP_IDS,
      ),
    ).toThrow(/start_time before end_time/i);
  });

  it('accepts frequency times beyond 24 hours', () => {
    const windows = parseGtfsFrequencies(
      frequenciesCsv('trip-a,24:15:00,25:03:30,600,1'),
      KNOWN_TRIP_IDS,
    );

    expect(windows.get('trip-a')).toEqual([
      {
        startTimeSeconds: 87_300,
        endTimeSeconds: 90_210,
        headwaySeconds: 600,
        exactTimes: 1,
      },
    ]);
  });

  it('rejects overlapping windows for the same trip', () => {
    expect(() =>
      parseGtfsFrequencies(
        frequenciesCsv(
          'trip-a,09:00:00,11:00:00,600,0',
          'trip-a,08:00:00,10:00:00,600,0',
        ),
        KNOWN_TRIP_IDS,
      ),
    ).toThrow(/windows overlap.*trip-a/i);
  });

  it('accepts adjacent windows and sorts them by start time', () => {
    const windows = parseGtfsFrequencies(
      frequenciesCsv(
        'trip-a,09:00:00,10:00:00,300,1',
        'trip-a,08:00:00,09:00:00,600,0',
      ),
      KNOWN_TRIP_IDS,
    );

    expect(
      windows.get('trip-a')?.map(({ startTimeSeconds }) => startTimeSeconds),
    ).toEqual([28_800, 32_400]);
  });

  it('rejects a row referencing an unknown trip', () => {
    expect(() =>
      parseGtfsFrequencies(
        frequenciesCsv('unknown,08:00:00,09:00:00,600,0'),
        KNOWN_TRIP_IDS,
      ),
    ).toThrow(/unknown trip_id.*unknown/i);
  });

  it('preserves frequency definitions without expanding departures', () => {
    const windows = parseGtfsFrequencies(
      frequenciesCsv('trip-a,08:00:00,18:00:00,60,1'),
      KNOWN_TRIP_IDS,
    );

    expect(windows.get('trip-a')).toHaveLength(1);
  });
});
