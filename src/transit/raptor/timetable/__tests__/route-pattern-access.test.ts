import { describe, expect, it } from 'vitest';

import { encodePickupDropOffTypes } from '../pickup-dropoff-codec';
import {
  findEarliestTripAtOrAfter,
  getArrivalTime,
  getDepartureTime,
  getDropOffType,
  getPickupType,
} from '../route-pattern-access';
import type { RaptorRoutePattern } from '../types';

const pattern: RaptorRoutePattern = {
  stops: new Uint32Array([4, 9]),
  stopTimes: new Uint32Array([
    100, 110, 200, 210,
    120, 130, 220, 230,
    120, 130, 240, 250,
  ]),
  pickupDropOffTypes: encodePickupDropOffTypes([
    { pickupType: 0, dropOffType: 1 },
    { pickupType: 2, dropOffType: 3 },
    { pickupType: 1, dropOffType: 0 },
    { pickupType: 3, dropOffType: 2 },
    { pickupType: 2, dropOffType: 2 },
    { pickupType: 0, dropOffType: 3 },
  ]),
  tripCount: 3,
};

describe('route-pattern accessors', () => {
  it('reads first-trip/first-stop and first-trip/last-stop times', () => {
    expect(getArrivalTime(pattern, 0, 0)).toBe(100);
    expect(getDepartureTime(pattern, 0, 0)).toBe(110);
    expect(getArrivalTime(pattern, 1, 0)).toBe(200);
    expect(getDepartureTime(pattern, 1, 0)).toBe(210);
  });

  it('reads last-trip/first-stop and last-trip/last-stop times', () => {
    expect(getArrivalTime(pattern, 0, 2)).toBe(120);
    expect(getDepartureTime(pattern, 0, 2)).toBe(130);
    expect(getArrivalTime(pattern, 1, 2)).toBe(240);
    expect(getDepartureTime(pattern, 1, 2)).toBe(250);
  });

  it('reads pickup and drop-off types in O(1) packed positions', () => {
    expect(getPickupType(pattern, 0, 0)).toBe(0);
    expect(getDropOffType(pattern, 0, 0)).toBe(1);
    expect(getPickupType(pattern, 1, 1)).toBe(3);
    expect(getDropOffType(pattern, 1, 1)).toBe(2);
    expect(getPickupType(pattern, 1, 2)).toBe(0);
    expect(getDropOffType(pattern, 1, 2)).toBe(3);
  });

  it('fails clearly for invalid stop and trip indexes', () => {
    expect(() => getArrivalTime(pattern, -1, 0)).toThrow(/stop index/i);
    expect(() => getDepartureTime(pattern, 2, 0)).toThrow(/stop index/i);
    expect(() => getPickupType(pattern, 0, -1)).toThrow(/trip index/i);
    expect(() => getDropOffType(pattern, 0, 3)).toThrow(/trip index/i);
  });
});

describe('findEarliestTripAtOrAfter', () => {
  it('returns trip zero when the requested time is before the first trip', () => {
    expect(findEarliestTripAtOrAfter(pattern, 0, 0)).toBe(0);
  });

  it('returns the first exact departure match', () => {
    expect(findEarliestTripAtOrAfter(pattern, 0, 130)).toBe(1);
  });

  it('returns the later trip when the requested time falls between trips', () => {
    expect(findEarliestTripAtOrAfter(pattern, 0, 111)).toBe(1);
  });

  it('returns undefined after the final trip', () => {
    expect(findEarliestTripAtOrAfter(pattern, 0, 131)).toBeUndefined();
  });

  it('respects the exclusive beforeTripIndex upper bound', () => {
    expect(findEarliestTripAtOrAfter(pattern, 0, 130, 1)).toBeUndefined();
    expect(findEarliestTripAtOrAfter(pattern, 0, 110, 1)).toBe(0);
    expect(findEarliestTripAtOrAfter(pattern, 0, 0, 0)).toBeUndefined();
  });

  it('works at downstream stops', () => {
    expect(findEarliestTripAtOrAfter(pattern, 1, 231)).toBe(2);
  });

  it('returns the earliest trip among equal departures', () => {
    expect(findEarliestTripAtOrAfter(pattern, 0, 130)).toBe(1);
  });
});
