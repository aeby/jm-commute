export const PROJECT_CONFIG = {
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
} as const;
