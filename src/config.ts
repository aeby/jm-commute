export const PROJECT_CONFIG = {
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
} as const;
