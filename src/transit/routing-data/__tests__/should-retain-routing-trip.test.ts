import { describe, expect, it } from 'vitest';

import { PROJECT_CONFIG } from '../../../config';
import { parseGtfsTimeToSeconds } from '../../service-profiles';
import { shouldRetainRoutingTrip } from '../should-retain-routing-trip';
import type {
  PickupDropOffType,
  RoutingFrequencyWindow,
  RoutingStopTime,
} from '../types';

const REFERENCE_DEPARTURE_SECONDS = parseGtfsTimeToSeconds(
  PROJECT_CONFIG.transit.referenceScenario.departureTime,
);

function stopTime(
  stopSequence: number,
  departureTime: string,
  pickupType: PickupDropOffType = 0,
): RoutingStopTime {
  const departureTimeSeconds = parseGtfsTimeToSeconds(departureTime);

  return {
    stopId: `stop-${stopSequence}`,
    stopSequence,
    arrivalTimeSeconds: departureTimeSeconds,
    departureTimeSeconds,
    pickupType,
    dropOffType: 0,
  };
}

function frequencyWindow(
  startTime: string,
  endTime: string,
): RoutingFrequencyWindow {
  return {
    startTimeSeconds: parseGtfsTimeToSeconds(startTime),
    endTimeSeconds: parseGtfsTimeToSeconds(endTime),
    headwaySeconds: 600,
    exactTimes: 0,
  };
}

describe('shouldRetainRoutingTrip', () => {
  it('retains a scheduled trip boardable after the reference departure', () => {
    expect(
      shouldRetainRoutingTrip(
        [stopTime(1, '08:01:00')],
        [],
        REFERENCE_DEPARTURE_SECONDS,
      ),
    ).toBe(true);
  });

  it('includes the exact reference departure boundary', () => {
    expect(
      shouldRetainRoutingTrip(
        [stopTime(1, '08:00:00')],
        [],
        REFERENCE_DEPARTURE_SECONDS,
      ),
    ).toBe(true);
  });

  it('retains a trip that begins before 08:00 but is boardable later', () => {
    const stopTimes = [
      stopTime(1, '07:50:00'),
      stopTime(2, '08:05:00'),
    ];
    const original = structuredClone(stopTimes);

    expect(
      shouldRetainRoutingTrip(
        stopTimes,
        [],
        REFERENCE_DEPARTURE_SECONDS,
      ),
    ).toBe(true);
    expect(stopTimes).toEqual(original);
  });

  it('excludes a scheduled trip entirely before 08:00', () => {
    expect(
      shouldRetainRoutingTrip(
        [stopTime(1, '07:30:00'), stopTime(2, '07:59:59')],
        [],
        REFERENCE_DEPARTURE_SECONDS,
      ),
    ).toBe(false);
  });

  it('excludes a trip with only prohibited pickups after 08:00', () => {
    expect(
      shouldRetainRoutingTrip(
        [stopTime(1, '08:00:00', 1), stopTime(2, '09:00:00', 1)],
        [],
        REFERENCE_DEPARTURE_SECONDS,
      ),
    ).toBe(false);
  });

  it.each([2, 3] as const)(
    'allows conditional pickup type %s to retain a scheduled trip',
    (pickupType) => {
      expect(
        shouldRetainRoutingTrip(
          [stopTime(1, '08:00:00', pickupType)],
          [],
          REFERENCE_DEPARTURE_SECONDS,
        ),
      ).toBe(true);
    },
  );

  it('retains a boardable frequency template with a window beyond 08:00', () => {
    expect(
      shouldRetainRoutingTrip(
        [stopTime(1, '06:00:00')],
        [frequencyWindow('07:00:00', '09:00:00')],
        REFERENCE_DEPARTURE_SECONDS,
      ),
    ).toBe(true);
  });

  it('excludes a frequency trip whose windows end at or before 08:00', () => {
    expect(
      shouldRetainRoutingTrip(
        [stopTime(1, '09:00:00')],
        [
          frequencyWindow('06:00:00', '07:00:00'),
          frequencyWindow('07:00:00', '08:00:00'),
        ],
        REFERENCE_DEPARTURE_SECONDS,
      ),
    ).toBe(false);
  });

  it('requires a frequency template to contain a permitted pickup', () => {
    expect(
      shouldRetainRoutingTrip(
        [stopTime(1, '09:00:00', 1)],
        [frequencyWindow('08:00:00', '09:00:00')],
        REFERENCE_DEPARTURE_SECONDS,
      ),
    ).toBe(false);
  });
});
