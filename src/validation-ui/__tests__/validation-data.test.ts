import { describe, expect, it } from 'vitest';

import { runRaptorOneToAll } from '../../transit/raptor';
import {
  buildPatternAdjacency,
  encodePickupDropOffTypes,
  type RaptorRoutePattern,
  type RaptorTimetable,
} from '../../transit/raptor/timetable';
import {
  decodeUint8ArrayBase64,
  decodeUint32ArrayBase64,
  decodeValidationTimetable,
  deserializeValidationTimetable,
  encodeUint8ArrayBase64,
  encodeUint32ArrayBase64,
  reconstructValidationTimetable,
  serializeValidationTimetable,
} from '../validation-data';

function pattern(
  stops: readonly number[],
  trips: readonly (readonly number[])[],
): RaptorRoutePattern {
  const stopTimes = new Uint32Array(trips.length * stops.length * 2);
  trips.forEach((times, tripIndex) => {
    times.forEach((time, stopIndex) => {
      const offset = (tripIndex * stops.length + stopIndex) * 2;
      stopTimes[offset] = time;
      stopTimes[offset + 1] = time;
    });
  });
  return {
    stops: Uint32Array.from(stops),
    stopTimes,
    pickupDropOffTypes: encodePickupDropOffTypes(
      Array.from({ length: trips.length * stops.length }, () => ({
        pickupType: 0,
        dropOffType: 0,
      })),
    ),
    tripCount: trips.length,
  };
}

function timetable(): RaptorTimetable {
  const patterns = [
    pattern(
      [0, 1, 2],
      [
        [28_900, 29_000, 29_100],
        [29_500, 29_600, 29_700],
      ],
    ),
    pattern([2, 3], [[29_300, 29_500]]),
  ];
  return {
    sourceStopIds: ['a', 'b', 'c', 'd'],
    patterns,
    patternOccurrencesByStop: buildPatternAdjacency(patterns, 4),
    transfersByStop: [
      new Uint32Array(),
      new Uint32Array([2, 120]),
      new Uint32Array(),
      new Uint32Array([0, 300]),
    ],
  };
}

describe('validation timetable Base64 codec', () => {
  it('round-trips Uint8 values', () => {
    const values = new Uint8Array([0, 1, 127, 255]);
    expect(decodeUint8ArrayBase64(encodeUint8ArrayBase64(values))).toEqual(
      values,
    );
  });

  it('round-trips little-endian Uint32 values', () => {
    const values = new Uint32Array([0, 1, 0x1234_5678, 0xffff_ffff]);
    expect(decodeUint32ArrayBase64(encodeUint32ArrayBase64(values))).toEqual(
      values,
    );
  });

  it('round-trips empty arrays', () => {
    expect(decodeUint8ArrayBase64(encodeUint8ArrayBase64(new Uint8Array())))
      .toEqual(new Uint8Array());
    expect(decodeUint32ArrayBase64(encodeUint32ArrayBase64(new Uint32Array())))
      .toEqual(new Uint32Array());
  });
});

describe('validation timetable serialization', () => {
  it('flattens pattern, adjacency, and transfer arrays with offsets', () => {
    const decoded = decodeValidationTimetable(
      serializeValidationTimetable(timetable()),
    );

    expect(decoded.patternStopOffsets).toEqual(new Uint32Array([0, 3, 5]));
    expect(decoded.patternStops).toEqual(new Uint32Array([0, 1, 2, 2, 3]));
    expect(decoded.patternStopTimeOffsets).toEqual(
      new Uint32Array([0, 12, 16]),
    );
    expect(decoded.patternPickupDropOffOffsets).toEqual(
      new Uint32Array([0, 3, 4]),
    );
    expect(decoded.patternOccurrenceOffsets).toEqual(
      new Uint32Array([0, 2, 4, 8, 10]),
    );
    expect(decoded.transferOffsets).toEqual(
      new Uint32Array([0, 0, 2, 2, 4]),
    );
  });

  it('round-trips a complete timetable using shared subarray views', () => {
    const original = timetable();
    const reconstructed = deserializeValidationTimetable(
      serializeValidationTimetable(original),
    );

    expect(reconstructed.sourceStopIds).toEqual(original.sourceStopIds);
    expect(reconstructed.patterns).toEqual(original.patterns);
    expect(reconstructed.patternOccurrencesByStop).toEqual(
      original.patternOccurrencesByStop,
    );
    expect(reconstructed.transfersByStop).toEqual(original.transfersByStop);
    expect(reconstructed.patterns[0]?.stops.buffer).toBe(
      reconstructed.patterns[1]?.stops.buffer,
    );
    expect(reconstructed.patternOccurrencesByStop[0]?.buffer).toBe(
      reconstructed.patternOccurrencesByStop[3]?.buffer,
    );
  });

  it('reconstructs decoded arrays without an additional decoding pass', () => {
    const original = timetable();
    const decoded = decodeValidationTimetable(
      serializeValidationTimetable(original),
    );
    expect(reconstructValidationTimetable(decoded).patterns).toEqual(
      original.patterns,
    );
  });

  it('produces an identical RAPTOR result after deserialization', () => {
    const original = timetable();
    const reconstructed = deserializeValidationTimetable(
      serializeValidationTimetable(original),
    );
    const query = {
      originStopIndexes: [0],
      departureTimeSeconds: 28_800,
      maxTravelTimeSeconds: 3_600,
      maxTransfers: 1,
      minTransferTimeSeconds: 120,
    };

    expect(runRaptorOneToAll(reconstructed, query).arrivalTimes).toEqual(
      runRaptorOneToAll(original, query).arrivalTimes,
    );
  });
});
