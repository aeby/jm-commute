import { describe, expect, it } from 'vitest';

import { PROJECT_CONFIG } from '../config';

describe('PROJECT_CONFIG', () => {
  it('contains the representative morning scenario and product defaults', () => {
    expect(PROJECT_CONFIG).toEqual({
      publicTransport: {
        referenceScenario: {
          serviceDate: '2026-09-07',
          morningWindow: {
            start: '07:00:00',
            end: '09:00:00',
          },
        },
        localityAccess: {
          maxAccessDistanceMeters: 700,
          fallbackCandidateCount: 10,
        },
        routing: {
          maxTransfers: 5,
          minTransferTimeSeconds: 120,
        },
      },
    });
  });

  it('uses a Monday for the configured service date', () => {
    const { serviceDate } = PROJECT_CONFIG.publicTransport.referenceScenario;

    expect(new Date(`${serviceDate}T00:00:00Z`).getUTCDay()).toBe(1);
  });
});
