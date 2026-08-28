import { describe, expect, it } from 'vitest';

import { PROJECT_CONFIG } from '@core/config';
import type { RaptorTimetable } from '@core/transit/raptor/timetable/types';
import {
  encodeFloat32ArrayBase64,
  serializeRaptorTimetable,
} from '../browser-timetable';
import {
  COMMUTE_VIEWER_DATA_GLOBAL_KEY,
  loadCommuteViewerRuntimeData,
  loadGeneratedCommuteViewerData,
  type CommuteViewerData,
} from '../runtime-data';

const empty = (): Uint32Array => new Uint32Array();

function timetable(
  sourceStopIds: readonly string[] = ['stop-a', 'stop-b'],
): RaptorTimetable {
  return {
    sourceStopIds,
    patterns: [],
    patternOccurrencesByStop: sourceStopIds.map(empty),
    transfersByStop: sourceStopIds.map(empty),
    accessTransfersByStop: sourceStopIds.map(empty),
  };
}

function timetableWithRepeatedStop(
  patternOccurrencesByStop: readonly Uint32Array[] = [
    new Uint32Array([0, 0, 0, 2]),
    new Uint32Array([0, 1]),
  ],
): RaptorTimetable {
  return {
    sourceStopIds: ['stop-a', 'stop-b'],
    patterns: [
      {
        stops: new Uint32Array([0, 1, 0]),
        stopTimes: new Uint32Array([
          25_200,
          25_200,
          25_800,
          25_800,
          26_400,
          26_400,
        ]),
        pickupDropOffTypes: new Uint8Array([0, 0]),
        tripCount: 1,
      },
    ],
    patternOccurrencesByStop,
    transfersByStop: [empty(), empty()],
    accessTransfersByStop: [empty(), empty()],
  };
}

function viewerData(): CommuteViewerData {
  const scenario = PROJECT_CONFIG.transit.referenceScenario;
  return {
    schemaVersion: 2,
    feedVersion: 'test-feed-2026',
    serviceDate: scenario.serviceDate,
    routingWindowStart: scenario.morningWindow.start,
    routingWindowEnd: scenario.morningWindow.end,
    localities: [
      {
        localityId: '3011:bern',
        postalCode: '3011',
        city: 'Bern',
        longitude: 7.4474,
        latitude: 46.948,
      },
      {
        localityId: '8001:zurich',
        postalCode: '8001',
        city: 'Zürich',
        longitude: 8.5417,
        latitude: 47.3769,
      },
    ],
    localityRoutingEntries: [
      {
        localityId: '3011:bern',
        selectionMode: 'WITHIN_ACCESS_RADIUS',
        stopIndexes: [0],
      },
      {
        localityId: '8001:zurich',
        selectionMode: 'NEAREST_FALLBACK',
        stopIndexes: [1],
      },
    ],
    timetable: serializeRaptorTimetable(timetable()),
    stopCoordinatesBase64: encodeFloat32ArrayBase64(
      new Float32Array([7.45, 46.95, Number.NaN, Number.NaN]),
    ),
  };
}

describe('loadCommuteViewerRuntimeData', () => {
  it('validates and reconstructs the generated browser dataset', () => {
    const runtime = loadCommuteViewerRuntimeData(viewerData());

    expect(runtime.feedVersion).toBe('test-feed-2026');
    expect(runtime.localities.map(({ localityId }) => localityId)).toEqual([
      '3011:bern',
      '8001:zurich',
    ]);
    expect(runtime.localityRoutingIndex.entries).toEqual([
      {
        localityId: '3011:bern',
        postalCode: '3011',
        city: 'Bern',
        selectionMode: 'WITHIN_ACCESS_RADIUS',
        stopIndexes: new Uint32Array([0]),
      },
      {
        localityId: '8001:zurich',
        postalCode: '8001',
        city: 'Zürich',
        selectionMode: 'NEAREST_FALLBACK',
        stopIndexes: new Uint32Array([1]),
      },
    ]);
    expect(runtime.timetable.sourceStopIds).toEqual(['stop-a', 'stop-b']);
    expect(runtime.stopCoordinates[0]).toBeCloseTo(7.45);
    expect(runtime.stopCoordinates[1]).toBeCloseTo(46.95);
    expect(Number.isNaN(runtime.stopCoordinates[2])).toBe(true);
    expect(Number.isNaN(runtime.stopCoordinates[3])).toBe(true);
  });

  it('reads and clears a successfully validated generated global', () => {
    const globals = globalThis as typeof globalThis & Record<string, unknown>;
    const previousDescriptor = Object.getOwnPropertyDescriptor(
      globals,
      COMMUTE_VIEWER_DATA_GLOBAL_KEY,
    );
    try {
      globals[COMMUTE_VIEWER_DATA_GLOBAL_KEY] = viewerData();
      expect(loadGeneratedCommuteViewerData().feedVersion).toBe(
        'test-feed-2026',
      );
      expect(
        Object.hasOwn(globals, COMMUTE_VIEWER_DATA_GLOBAL_KEY),
      ).toBe(false);
      expect(loadGeneratedCommuteViewerData().feedVersion).toBe(
        'test-feed-2026',
      );
    } finally {
      if (previousDescriptor === undefined) {
        Reflect.deleteProperty(globals, COMMUTE_VIEWER_DATA_GLOBAL_KEY);
      } else {
        Object.defineProperty(
          globals,
          COMMUTE_VIEWER_DATA_GLOBAL_KEY,
          previousDescriptor,
        );
      }
    }
  });

  it('preserves an invalid generated global so loading can be retried', () => {
    const globals = globalThis as typeof globalThis & Record<string, unknown>;
    const previousDescriptor = Object.getOwnPropertyDescriptor(
      globals,
      COMMUTE_VIEWER_DATA_GLOBAL_KEY,
    );
    const invalid = { ...viewerData(), schemaVersion: 1 };
    try {
      globals[COMMUTE_VIEWER_DATA_GLOBAL_KEY] = invalid;
      expect(() => loadGeneratedCommuteViewerData()).toThrow(
        /unsupported schema version 1/i,
      );
      expect(globals[COMMUTE_VIEWER_DATA_GLOBAL_KEY]).toBe(invalid);
      expect(() => loadGeneratedCommuteViewerData()).toThrow(
        /unsupported schema version 1/i,
      );
    } finally {
      if (previousDescriptor === undefined) {
        Reflect.deleteProperty(globals, COMMUTE_VIEWER_DATA_GLOBAL_KEY);
      } else {
        Object.defineProperty(
          globals,
          COMMUTE_VIEWER_DATA_GLOBAL_KEY,
          previousDescriptor,
        );
      }
    }
  });

  it('rejects missing, non-object, and unsupported-schema globals clearly', () => {
    expect(() => loadCommuteViewerRuntimeData(undefined)).toThrow(
      /did not define __SWISS_COMMUTE_VIEWER_DATA__/i,
    );
    expect(() => loadCommuteViewerRuntimeData(null)).toThrow(
      /root must be an object/i,
    );
    expect(() =>
      loadCommuteViewerRuntimeData({ ...viewerData(), schemaVersion: 1 }),
    ).toThrow(/unsupported schema version 1/i);
  });

  it('rejects empty feed metadata and a stale service scenario', () => {
    expect(() =>
      loadCommuteViewerRuntimeData({ ...viewerData(), feedVersion: ' ' }),
    ).toThrow(/feedVersion must be nonempty/i);
    expect(() =>
      loadCommuteViewerRuntimeData({
        ...viewerData(),
        serviceDate: '2026-09-08',
      }),
    ).toThrow(/does not match PROJECT_CONFIG/i);
    expect(() =>
      loadCommuteViewerRuntimeData({
        ...viewerData(),
        routingWindowEnd: '10:00:00',
      }),
    ).toThrow(/does not match PROJECT_CONFIG/i);
  });

  it('validates locality identity, uniqueness, and WGS84 coordinates', () => {
    const data = viewerData();
    expect(() =>
      loadCommuteViewerRuntimeData({
        ...data,
        localities: [
          { ...data.localities[0], localityId: '3011:not-bern' },
          data.localities[1],
        ],
      }),
    ).toThrow(/localityId must be "3011:bern"/i);
    expect(() =>
      loadCommuteViewerRuntimeData({
        ...data,
        localities: [data.localities[0], data.localities[0]],
      }),
    ).toThrow(/duplicate locality/i);
    expect(() =>
      loadCommuteViewerRuntimeData({
        ...data,
        localities: [
          { ...data.localities[0], latitude: 91 },
          data.localities[1],
        ],
      }),
    ).toThrow(/latitude must be a finite number between -90 and 90/i);
  });

  it('requires one valid, unique routing entry for every locality', () => {
    const data = viewerData();
    expect(() =>
      loadCommuteViewerRuntimeData({
        ...data,
        localityRoutingEntries: [data.localityRoutingEntries[0]],
      }),
    ).toThrow(/exactly one entry for every locality/i);
    expect(() =>
      loadCommuteViewerRuntimeData({
        ...data,
        localityRoutingEntries: [
          data.localityRoutingEntries[0],
          data.localityRoutingEntries[0],
        ],
      }),
    ).toThrow(/duplicate locality routing entry/i);
    expect(() =>
      loadCommuteViewerRuntimeData({
        ...data,
        localityRoutingEntries: [
          data.localityRoutingEntries[0],
          { ...data.localityRoutingEntries[1], localityId: '9999:nowhere' },
        ],
      }),
    ).toThrow(/references unknown locality/i);
  });

  it('validates routing selection modes and dense stop indexes', () => {
    const data = viewerData();
    expect(() =>
      loadCommuteViewerRuntimeData({
        ...data,
        localityRoutingEntries: [
          {
            ...data.localityRoutingEntries[0],
            selectionMode: 'UNKNOWN',
          },
          data.localityRoutingEntries[1],
        ],
      }),
    ).toThrow(/unsupported selectionMode/i);
    expect(() =>
      loadCommuteViewerRuntimeData({
        ...data,
        localityRoutingEntries: [
          { ...data.localityRoutingEntries[0], stopIndexes: [1, 0] },
          data.localityRoutingEntries[1],
        ],
      }),
    ).toThrow(/sorted in ascending order/i);
    expect(() =>
      loadCommuteViewerRuntimeData({
        ...data,
        localityRoutingEntries: [
          { ...data.localityRoutingEntries[0], stopIndexes: [2] },
          data.localityRoutingEntries[1],
        ],
      }),
    ).toThrow(/unknown stop index 2/i);
  });

  it('validates serialized timetable fields and reconstruction invariants', () => {
    const data = viewerData();
    expect(() =>
      loadCommuteViewerRuntimeData({ ...data, timetable: null }),
    ).toThrow(/timetable must be an object/i);
    expect(() =>
      loadCommuteViewerRuntimeData({
        ...data,
        timetable: { ...data.timetable, stopTimesBase64: 123 },
      }),
    ).toThrow(/stopTimesBase64 must be a string/i);
    expect(() =>
      loadCommuteViewerRuntimeData({
        ...data,
        timetable: { ...data.timetable, patternStopOffsetsBase64: '' },
      }),
    ).toThrow(/timetable structure is incompatible/i);
    expect(() =>
      loadCommuteViewerRuntimeData({
        ...data,
        timetable: {
          ...data.timetable,
          sourceStopIds: ['duplicate', 'duplicate'],
        },
      }),
    ).toThrow(/duplicate timetable source stop ID/i);
  });

  it('rejects out-of-range timetable stop and transfer references', () => {
    const data = viewerData();
    const invalidPatternTimetable: RaptorTimetable = {
      sourceStopIds: ['stop-a', 'stop-b'],
      patterns: [
        {
          stops: new Uint32Array([2]),
          stopTimes: new Uint32Array([25_200, 25_200]),
          pickupDropOffTypes: new Uint8Array([0]),
          tripCount: 1,
        },
      ],
      patternOccurrencesByStop: [empty(), empty()],
      transfersByStop: [empty(), empty()],
      accessTransfersByStop: [empty(), empty()],
    };
    expect(() =>
      loadCommuteViewerRuntimeData({
        ...data,
        timetable: serializeRaptorTimetable(invalidPatternTimetable),
      }),
    ).toThrow(/pattern 0 references unknown stop index 2/i);

    expect(() =>
      loadCommuteViewerRuntimeData({
        ...data,
        timetable: serializeRaptorTimetable({
          ...timetable(),
          transfersByStop: [new Uint32Array([1]), empty()],
        }),
      }),
    ).toThrow(/must contain numeric stop\/duration pairs/i);
  });

  it('accepts complete adjacency including repeated stops in one pattern', () => {
    const data = viewerData();
    const runtime = loadCommuteViewerRuntimeData({
      ...data,
      timetable: serializeRaptorTimetable(timetableWithRepeatedStop()),
    });

    expect(runtime.timetable.patternOccurrencesByStop).toEqual([
      new Uint32Array([0, 0, 0, 2]),
      new Uint32Array([0, 1]),
    ]);
  });

  it.each([
    {
      name: 'missing',
      occurrences: [
        new Uint32Array([0, 0]),
        new Uint32Array([0, 1]),
      ],
      message: /expected 2 complete unique pairs, found 1/i,
    },
    {
      name: 'duplicate',
      occurrences: [
        new Uint32Array([0, 0, 0, 2, 0, 2]),
        new Uint32Array([0, 1]),
      ],
      message: /expected 2 complete unique pairs, found 3/i,
    },
    {
      name: 'misordered',
      occurrences: [
        new Uint32Array([0, 2, 0, 0]),
        new Uint32Array([0, 1]),
      ],
      message: /do not match deterministic pattern order at pair 0/i,
    },
  ])('rejects $name timetable pattern adjacency', ({ occurrences, message }) => {
    const data = viewerData();
    expect(() =>
      loadCommuteViewerRuntimeData({
        ...data,
        timetable: serializeRaptorTimetable(
          timetableWithRepeatedStop(occurrences),
        ),
      }),
    ).toThrow(message);
  });

  it('requires one valid longitude/latitude pair per active stop', () => {
    const data = viewerData();
    expect(() =>
      loadCommuteViewerRuntimeData({
        ...data,
        stopCoordinatesBase64: encodeFloat32ArrayBase64(
          new Float32Array([7.45, 46.95]),
        ),
      }),
    ).toThrow(/coordinate length 2 does not match 2 timetable stops/i);
    expect(() =>
      loadCommuteViewerRuntimeData({
        ...data,
        stopCoordinatesBase64: encodeFloat32ArrayBase64(
          new Float32Array([7.45, 46.95, Number.NaN, 47]),
        ),
      }),
    ).toThrow(/NaN\/NaN pair/i);
    expect(() =>
      loadCommuteViewerRuntimeData({
        ...data,
        stopCoordinatesBase64: encodeFloat32ArrayBase64(
          new Float32Array([7.45, 46.95, 181, 47]),
        ),
      }),
    ).toThrow(/outside WGS84 bounds/i);
    expect(() =>
      loadCommuteViewerRuntimeData({
        ...data,
        stopCoordinatesBase64: '*not-base64*',
      }),
    ).toThrow(/stopCoordinatesBase64 is malformed/i);
  });
});
