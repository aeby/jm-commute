import { describe, expect, it } from 'vitest';

import { PROJECT_CONFIG } from '../config';

describe('PROJECT_CONFIG', () => {
  it('contains the representative morning scenario and product defaults', () => {
    expect(PROJECT_CONFIG).toEqual({
      transit: {
        referenceScenario: {
          serviceDate: '2026-09-07',
          morningWindow: {
            start: '07:00:00',
            end: '09:00:00',
          },
        },
        candidateSelection: {
          maxAccessDistanceMeters: 700,
          fallbackCandidateCount: 10,
        },
        routing: {
          maxTransfers: 5,
          minTransferTimeSeconds: 120,
          transfers: {
            deriveSiblingTransfers: true,
            virtualTransfers: {
              enabled: false,
              maxDistanceMeters: 500,
              walkingSpeedKmh: 4,
              detourFactor: 1.3,
              changePenaltySeconds: 180,
            },
          },
        },
      },
    });
  });

  it('uses a Monday for the configured service date', () => {
    const { serviceDate } = PROJECT_CONFIG.transit.referenceScenario;

    expect(new Date(`${serviceDate}T00:00:00Z`).getUTCDay()).toBe(1);
  });
});
