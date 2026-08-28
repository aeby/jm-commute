import { describe, expect, it } from 'vitest';

import { runRaptorFastestWindow } from '@core/transit/raptor/routing/run-raptor-fastest-window';
import { buildPatternAdjacency } from '@core/transit/raptor/timetable/build-pattern-adjacency';
import { encodePickupDropOffTypes } from '@core/transit/raptor/timetable/pickup-dropoff-codec';
import type {
  RaptorRoutePattern,
  RaptorTimetable,
} from '@core/transit/raptor/timetable/types';
import {
  decodeFloat32ArrayBase64,
  decodeRaptorTimetable,
  decodeUint8ArrayBase64,
  decodeUint32ArrayBase64,
  deserializeRaptorTimetable,
  encodeFloat32ArrayBase64,
  encodeUint8ArrayBase64,
  encodeUint32ArrayBase64,
  reconstructRaptorTimetable,
  serializeRaptorTimetable,
} from '../browser-timetable';

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
    accessTransfersByStop: [
      new Uint32Array([1, 120]),
      new Uint32Array(),
      new Uint32Array(),
      new Uint32Array(),
    ],
  };
}

describe('RAPTOR browser timetable Base64 codec', () => {
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

  it('round-trips little-endian Float32 values including NaN', () => {
    const values = new Float32Array([0, -0, 1.25, -73.5, Number.NaN]);
    const decoded = decodeFloat32ArrayBase64(
      encodeFloat32ArrayBase64(values),
    );

    expect(decoded).toEqual(values);
    expect(Number.isNaN(decoded[4])).toBe(true);
  });

  it('round-trips empty arrays', () => {
    expect(decodeUint8ArrayBase64(encodeUint8ArrayBase64(new Uint8Array())))
      .toEqual(new Uint8Array());
    expect(decodeUint32ArrayBase64(encodeUint32ArrayBase64(new Uint32Array())))
      .toEqual(new Uint32Array());
    expect(
      decodeFloat32ArrayBase64(
        encodeFloat32ArrayBase64(new Float32Array()),
      ),
    ).toEqual(new Float32Array());
  });
});

describe('RAPTOR browser timetable serialization', () => {
  it('flattens pattern, adjacency, and transfer arrays with offsets', () => {
    const decoded = decodeRaptorTimetable(
      serializeRaptorTimetable(timetable()),
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
    expect(decoded.accessTransferOffsets).toEqual(
      new Uint32Array([0, 2, 2, 2, 2]),
    );
  });

  it('round-trips a complete timetable using shared subarray views', () => {
    const original = timetable();
    const reconstructed = deserializeRaptorTimetable(
      serializeRaptorTimetable(original),
    );

    expect(reconstructed.sourceStopIds).toEqual(original.sourceStopIds);
    expect(reconstructed.patterns).toEqual(original.patterns);
    expect(reconstructed.patternOccurrencesByStop).toEqual(
      original.patternOccurrencesByStop,
    );
    expect(reconstructed.transfersByStop).toEqual(original.transfersByStop);
    expect(reconstructed.accessTransfersByStop).toEqual(
      original.accessTransfersByStop,
    );
    expect(reconstructed.patterns[0]?.stops.buffer).toBe(
      reconstructed.patterns[1]?.stops.buffer,
    );
    expect(reconstructed.patternOccurrencesByStop[0]?.buffer).toBe(
      reconstructed.patternOccurrencesByStop[3]?.buffer,
    );
  });

  it('reconstructs decoded arrays without an additional decoding pass', () => {
    const original = timetable();
    const decoded = decodeRaptorTimetable(
      serializeRaptorTimetable(original),
    );
    expect(reconstructRaptorTimetable(decoded).patterns).toEqual(
      original.patterns,
    );
  });

  it('produces an identical fastest-window result after deserialization', () => {
    const original = timetable();
    const reconstructed = deserializeRaptorTimetable(
      serializeRaptorTimetable(original),
    );
    const query = {
      originStopIndexes: [0],
      windowStartSeconds: 28_800,
      windowEndSeconds: 32_400,
      maxTravelTimeSeconds: 3_600,
      maxTransfers: 1,
      minTransferTimeSeconds: 120,
    };

    expect(runRaptorFastestWindow(reconstructed, query)).toEqual(
      runRaptorFastestWindow(original, query),
    );
  });
});
