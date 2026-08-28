import { describe, expect, it } from 'vitest';

import { PROJECT_CONFIG } from '@core/config';
import {
  parseGtfsTimeToSeconds,
  type PickupDropOffType,
} from '../../gtfs';
import {
  shouldRetainRoutingTrip,
  type RoutingFrequencyWindow,
  type RoutingStopTime,
} from '..';

const ROUTING_WINDOW_START_SECONDS = parseGtfsTimeToSeconds(
  PROJECT_CONFIG.transit.referenceScenario.morningWindow.start,
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
  it('retains a scheduled trip boardable after the routing-window start', () => {
    expect(
      shouldRetainRoutingTrip(
        [stopTime(1, '07:01:00')],
        [],
        ROUTING_WINDOW_START_SECONDS,
      ),
    ).toBe(true);
  });

  it('includes the exact routing-window start boundary', () => {
    expect(
      shouldRetainRoutingTrip(
        [stopTime(1, '07:00:00')],
        [],
        ROUTING_WINDOW_START_SECONDS,
      ),
    ).toBe(true);
  });

  it('retains a trip that begins before 07:00 but is boardable later', () => {
    const stopTimes = [
      stopTime(1, '06:50:00'),
      stopTime(2, '07:05:00'),
    ];
    const original = structuredClone(stopTimes);

    expect(
      shouldRetainRoutingTrip(
        stopTimes,
        [],
        ROUTING_WINDOW_START_SECONDS,
      ),
    ).toBe(true);
    expect(stopTimes).toEqual(original);
  });

  it('excludes a scheduled trip entirely before 07:00', () => {
    expect(
      shouldRetainRoutingTrip(
        [stopTime(1, '06:30:00'), stopTime(2, '06:59:59')],
        [],
        ROUTING_WINDOW_START_SECONDS,
      ),
    ).toBe(false);
  });

  it('excludes a trip with only prohibited pickups after 07:00', () => {
    expect(
      shouldRetainRoutingTrip(
        [stopTime(1, '08:00:00', 1), stopTime(2, '09:00:00', 1)],
        [],
        ROUTING_WINDOW_START_SECONDS,
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
          ROUTING_WINDOW_START_SECONDS,
        ),
      ).toBe(true);
    },
  );

  it('retains a boardable frequency template with a window beyond 07:00', () => {
    expect(
      shouldRetainRoutingTrip(
        [stopTime(1, '06:00:00')],
        [frequencyWindow('07:00:00', '09:00:00')],
        ROUTING_WINDOW_START_SECONDS,
      ),
    ).toBe(true);
  });

  it('excludes a frequency trip whose windows end at or before 07:00', () => {
    expect(
      shouldRetainRoutingTrip(
        [stopTime(1, '09:00:00')],
        [
          frequencyWindow('05:00:00', '06:00:00'),
          frequencyWindow('06:00:00', '07:00:00'),
        ],
        ROUTING_WINDOW_START_SECONDS,
      ),
    ).toBe(false);
  });

  it('requires a frequency template to contain a permitted pickup', () => {
    expect(
      shouldRetainRoutingTrip(
        [stopTime(1, '09:00:00', 1)],
        [frequencyWindow('08:00:00', '09:00:00')],
        ROUTING_WINDOW_START_SECONDS,
      ),
    ).toBe(false);
  });
});
