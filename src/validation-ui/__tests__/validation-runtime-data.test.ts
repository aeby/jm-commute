import { describe, expect, it } from 'vitest';

import { PROJECT_CONFIG } from '../../config';
import { serializeValidationTimetable } from '../validation-data';
import {
  createValidationLocalityRoutingIndex,
  validateValidationData,
} from '../validation-runtime-data';

const validationData = () => {
  const scenario = PROJECT_CONFIG.transit.referenceScenario;
  return {
    schemaVersion: 1 as const,
    feedVersion: 'test-feed',
    serviceDate: scenario.serviceDate,
    routingWindowStart: scenario.morningWindow.start,
    routingWindowEnd: scenario.morningWindow.end,
    localities: [
      { localityId: '8001:zurich', postalCode: '8001', city: 'Zürich' },
    ],
    localityRoutingEntries: [
      {
        localityId: '8001:zurich',
        selectionMode: 'WITHIN_ACCESS_RADIUS' as const,
        stopIndexes: [4, 7],
      },
    ],
    hubCandidatesByLocality: {},
    timetable: serializeValidationTimetable({
      sourceStopIds: [],
      patterns: [],
      patternOccurrencesByStop: [],
      transfersByStop: [],
      accessTransfersByStop: [],
    }),
  };
};

describe('validateValidationData', () => {
  it('accepts data matching the central reference scenario', () => {
    const data = validationData();
    expect(validateValidationData(data)).toBe(data);
  });

  it('rejects missing, stale, and unidentified generated data', () => {
    expect(() => validateValidationData(undefined)).toThrow(
      /expected global dataset/i,
    );
    expect(() =>
      validateValidationData({
        ...validationData(),
        routingWindowEnd: '10:00:00',
      }),
    ).toThrow(/does not match PROJECT_CONFIG/i);
    expect(() =>
      validateValidationData({ ...validationData(), feedVersion: '' }),
    ).toThrow(/feed version/i);
  });
});

describe('createValidationLocalityRoutingIndex', () => {
  it('reconstructs typed stop indexes with locality metadata', () => {
    expect(createValidationLocalityRoutingIndex(validationData())).toEqual({
      entries: [
        {
          localityId: '8001:zurich',
          postalCode: '8001',
          city: 'Zürich',
          selectionMode: 'WITHIN_ACCESS_RADIUS',
          stopIndexes: new Uint32Array([4, 7]),
        },
      ],
    });
  });

  it('rejects routing entries without locality metadata', () => {
    expect(() =>
      createValidationLocalityRoutingIndex({
        ...validationData(),
        localities: [],
      }),
    ).toThrow(/no locality metadata/i);
  });
});
