import { describe, expect, it } from 'vitest';

import { PROJECT_CONFIG } from '../config';

describe('PROJECT_CONFIG', () => {
  it('contains the representative morning scenario and product defaults', () => {
    expect(PROJECT_CONFIG).toEqual({
      road: {
        osrm: {
          version: '26.8.0',
          image: 'ghcr.io/project-osrm/osrm-backend:26.8.0-debian',
          profile: 'car.lua',
          algorithm: 'ch',
          datasetBasename: 'switzerland.osrm',
          baseUrl: 'http://127.0.0.1:5000',
          requestTimeoutMilliseconds: 30_000,
        },
        network: {
          snapConcurrency: 16,
        },
        matrix: {
          blockSize: 50,
          requestConcurrency: 4,
          maxRequestAttempts: 3,
          retryDelaysMilliseconds: [100, 250],
          validationSampleSize: 100,
        },
      },
      publicTransport: {
        referenceScenario: {
          serviceDate: '2026-09-07',
          morningWindow: {
            start: '07:00:00',
            end: '12:00:00',
          },
        },
        localityAccess: {
          preferredRadiusMeters: 500,
          railDepartureBoostPercent: 25,
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
