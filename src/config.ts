export const PROJECT_CONFIG = {
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
} as const;
