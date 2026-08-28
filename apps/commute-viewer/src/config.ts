export const VIEWER_CONFIG = {
  api: {
    baseUrl: 'http://127.0.0.1:3001',
  },
  map: {
    styleUrl: 'https://tiles.openfreemap.org/styles/positron',
  },
  commute: {
    minimumMinutes: 15,
    maximumMinutes: 240,
    defaultMinutes: 60,
    stepMinutes: 5,
  },
  autocomplete: {
    resultLimit: 20,
  },
} as const;
