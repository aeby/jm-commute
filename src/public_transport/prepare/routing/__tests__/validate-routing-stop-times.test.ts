import { describe, expect, it } from 'vitest';

import { validateRoutingStopTimes } from '../validate-routing-stop-times';
import type { RoutingStopTimeInput } from '../validate-routing-stop-times';

const KNOWN_STOP_IDS = new Set(['stop-1', 'stop-2', 'stop-3']);

function entry(
  stopId: string,
  stopSequence: string,
  arrivalTime: string,
  departureTime = arrivalTime,
  pickupType = '0',
  dropOffType = '0',
): RoutingStopTimeInput {
  return {
    stopId,
    stopSequence,
    arrivalTime,
    departureTime,
    pickupType,
    dropOffType,
  };
}

describe('validateRoutingStopTimes', () => {
  it('keeps stop IDs as strings and sorts sequences numerically', () => {
    const stopTimes = validateRoutingStopTimes(
      'trip',
      [
        entry('stop-1', '2', '08:00:00'),
        entry('stop-2', '10', '08:10:00'),
      ],
      KNOWN_STOP_IDS,
    );

    expect(stopTimes.map(({ stopId }) => stopId)).toEqual([
      'stop-1',
      'stop-2',
    ]);
    expect(stopTimes.every((stopTime) => !('stopSequence' in stopTime))).toBe(
      true,
    );
  });

  it('accepts nonconsecutive increasing sequences', () => {
    expect(
      validateRoutingStopTimes(
        'trip',
        [
          entry('stop-1', '1', '08:00:00'),
          entry('stop-2', '100', '08:10:00'),
        ],
        KNOWN_STOP_IDS,
      ).map(({ stopId }) => stopId),
    ).toEqual(['stop-1', 'stop-2']);
  });

  it('rejects duplicate stop sequences', () => {
    expect(() =>
      validateRoutingStopTimes(
        'trip',
        [
          entry('stop-1', '1', '08:00:00'),
          entry('stop-2', '1', '08:10:00'),
        ],
        KNOWN_STOP_IDS,
      ),
    ).toThrow(/duplicate stop_sequence 1/i);
  });

  it('rejects decreasing stop sequences', () => {
    expect(() =>
      validateRoutingStopTimes(
        'trip',
        [
          entry('stop-1', '2', '08:00:00'),
          entry('stop-2', '1', '08:10:00'),
        ],
        KNOWN_STOP_IDS,
      ),
    ).toThrow(/stop_sequence values decrease/i);
  });

  it('rejects arrival after departure at one stop', () => {
    expect(() =>
      validateRoutingStopTimes(
        'trip',
        [
          entry('stop-1', '1', '08:01:00', '08:00:00'),
          entry('stop-2', '2', '08:10:00'),
        ],
        KNOWN_STOP_IDS,
      ),
    ).toThrow(/arrival after departure/i);
  });

  it('rejects times moving backwards through a trip', () => {
    expect(() =>
      validateRoutingStopTimes(
        'trip',
        [
          entry('stop-1', '1', '08:00:00', '08:10:00'),
          entry('stop-2', '2', '08:09:00'),
        ],
        KNOWN_STOP_IDS,
      ),
    ).toThrow(/times move backwards/i);
  });

  it('preserves GTFS times beyond 24 hours as seconds', () => {
    const stopTimes = validateRoutingStopTimes(
      'trip',
      [
        entry('stop-1', '1', '24:15:00'),
        entry('stop-2', '2', '25:03:30'),
      ],
      KNOWN_STOP_IDS,
    );

    expect(stopTimes[0]?.arrivalTimeSeconds).toBe(87_300);
    expect(stopTimes[1]?.departureTimeSeconds).toBe(90_210);
  });

  it('rejects an unknown stop ID', () => {
    expect(() =>
      validateRoutingStopTimes(
        'trip',
        [
          entry('stop-1', '1', '08:00:00'),
          entry('unknown', '2', '08:10:00'),
        ],
        KNOWN_STOP_IDS,
      ),
    ).toThrow(/unknown stop_id.*unknown/i);
  });

  it('rejects trips with fewer than two stop-time records', () => {
    expect(() =>
      validateRoutingStopTimes(
        'trip',
        [entry('stop-1', '1', '08:00:00')],
        KNOWN_STOP_IDS,
      ),
    ).toThrow(/at least two stop-time records/i);
  });

  it.each([
    ['arrival_time', '', '08:00:00'],
    ['departure_time', '08:00:00', ''],
  ])('rejects a blank %s', (_field, arrivalTime, departureTime) => {
    expect(() =>
      validateRoutingStopTimes(
        'trip',
        [
          entry('stop-1', '1', arrivalTime, departureTime),
          entry('stop-2', '2', '08:10:00'),
        ],
        KNOWN_STOP_IDS,
      ),
    ).toThrow(/blank arrival_time or departure_time/i);
  });

  it.each([
    ['pickup_type', '4', '0'],
    ['drop_off_type', '0', '4'],
  ])('rejects an unknown %s', (_field, pickupType, dropOffType) => {
    expect(() =>
      validateRoutingStopTimes(
        'trip',
        [
          entry(
            'stop-1',
            '1',
            '08:00:00',
            '08:00:00',
            pickupType,
            dropOffType,
          ),
          entry('stop-2', '2', '08:10:00'),
        ],
        KNOWN_STOP_IDS,
      ),
    ).toThrow(/invalid (pickup_type|drop_off_type)/i);
  });

  it('normalizes empty pickup and drop-off values to zero', () => {
    const [first] = validateRoutingStopTimes(
      'trip',
      [
        entry('stop-1', '1', '08:00:00', '08:00:00', '', ''),
        entry('stop-2', '2', '08:10:00'),
      ],
      KNOWN_STOP_IDS,
    );

    expect(first).toMatchObject({ pickupType: 0, dropOffType: 0 });
  });

  it('preserves pickup and drop-off types two and three', () => {
    const [first, second] = validateRoutingStopTimes(
      'trip',
      [
        entry('stop-1', '1', '08:00:00', '08:00:00', '2', '3'),
        entry('stop-2', '2', '08:10:00', '08:10:00', '3', '2'),
      ],
      KNOWN_STOP_IDS,
    );

    expect(first).toMatchObject({ pickupType: 2, dropOffType: 3 });
    expect(second).toMatchObject({ pickupType: 3, dropOffType: 2 });
  });
});
