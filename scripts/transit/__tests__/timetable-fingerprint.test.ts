import { describe, expect, it } from 'vitest';

import type { RaptorTimetable } from '@core/transit/raptor/timetable/types';

import { createRaptorTimetableFingerprint } from '../timetable-fingerprint';

function timetable(): RaptorTimetable {
  return {
    sourceStopIds: ['stop-a', 'stop-b'],
    patterns: [
      {
        stops: Uint32Array.of(0, 1),
        stopTimes: Uint32Array.of(10, 10, 20, 20),
        pickupDropOffTypes: Uint8Array.of(0),
        tripCount: 1,
      },
    ],
    patternOccurrencesByStop: [Uint32Array.of(0, 0), Uint32Array.of(0, 1)],
    transfersByStop: [Uint32Array.of(1, 60), new Uint32Array()],
    accessTransfersByStop: [Uint32Array.of(1, 60), new Uint32Array()],
  };
}

describe('createRaptorTimetableFingerprint', () => {
  it('is deterministic and changes with exact compiler state', () => {
    const first = timetable();
    const second = timetable();
    expect(createRaptorTimetableFingerprint(second)).toBe(
      createRaptorTimetableFingerprint(first),
    );

    second.patterns[0]?.stopTimes.set([21], 2);
    expect(createRaptorTimetableFingerprint(second)).not.toBe(
      createRaptorTimetableFingerprint(first),
    );
  });
});
