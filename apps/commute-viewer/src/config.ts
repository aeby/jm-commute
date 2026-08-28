export const VIEWER_CONFIG = {
  map: {
    styleUrl: 'https://tiles.openfreemap.org/styles/positron',
  },
  commute: {
    minimumMinutes: 15,
    maximumMinutes: 120,
    defaultMinutes: 60,
    stepMinutes: 5,
  },
  visualization: {
    hexCellDiameterMeters: 2_000,
    hexRenderScale: 0.88,
  },
  autocomplete: {
    resultLimit: 20,
  },
} as const;
