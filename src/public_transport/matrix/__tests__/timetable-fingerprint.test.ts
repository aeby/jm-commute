import { describe, expect, it } from 'vitest';

import type { LocalityRoutingStopIndex } from '../../network/localities/types';
import type { PublicTransportNetwork } from '../../network';

import {
  createLocalityRoutingIndexFingerprint,
  createRaptorTimetableFingerprint,
} from '../timetable-fingerprint';

function timetable(): PublicTransportNetwork {
  return {
    sourceStopIds: ['stop-a', 'stop-b'],
    routingWindowStartSeconds: 7 * 60 * 60,
    routingWindowEndSeconds: 9 * 60 * 60,
    patterns: [
      {
        routeId: 'test-route',
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
  it('is stable across bound-window metadata and changes with routing arrays', () => {
    const first = timetable();
    const second = timetable();
    expect(createRaptorTimetableFingerprint(second)).toBe(
      createRaptorTimetableFingerprint(first),
    );
    expect(
      createRaptorTimetableFingerprint({
        ...second,
        routingWindowStartSeconds: 6 * 60 * 60,
        routingWindowEndSeconds: 10 * 60 * 60,
      }),
    ).toBe(createRaptorTimetableFingerprint(first));

    second.patterns[0]?.stopTimes.set([21], 2);
    expect(createRaptorTimetableFingerprint(second)).not.toBe(
      createRaptorTimetableFingerprint(first),
    );
  });

  it('fingerprints locality ordering and exact dense stop membership', () => {
    const first: LocalityRoutingStopIndex = {
      entries: [
        { localityId: '1000:first', stopIndexes: Uint32Array.of(1, 3) },
        { localityId: '2000:second', stopIndexes: Uint32Array.of(2) },
      ],
    };
    const second: LocalityRoutingStopIndex = {
      entries: first.entries.map((entry) => ({
        localityId: entry.localityId,
        stopIndexes: entry.stopIndexes.slice(),
      })),
    };

    expect(createLocalityRoutingIndexFingerprint(second)).toBe(
      createLocalityRoutingIndexFingerprint(first),
    );
    second.entries[0]?.stopIndexes.set([4], 1);
    expect(createLocalityRoutingIndexFingerprint(second)).not.toBe(
      createLocalityRoutingIndexFingerprint(first),
    );
  });
});
