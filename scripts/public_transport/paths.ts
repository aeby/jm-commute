import { resolve } from 'node:path';

export const PROJECT_ROOT = resolve(import.meta.dirname, '..', '..');

export const RAW_GTFS_DIRECTORY = resolve(PROJECT_ROOT, 'data/raw/gtfs');
export const RAW_TRANSFERS_PATH = resolve(
  RAW_GTFS_DIRECTORY,
  'transfers.txt',
);
export const RAW_LOCALITIES_PATH = resolve(
  PROJECT_ROOT,
  'data/raw/AMTOVZ_CSV_WGS84.csv',
);

export const PREPARED_DATA_DIRECTORY = resolve(
  PROJECT_ROOT,
  'data/processed/public_transport',
);
export const PREPARED_STOPS_PATH = resolve(
  PREPARED_DATA_DIRECTORY,
  'stops.json',
);
export const PREPARED_ROUTING_DIRECTORY = resolve(
  PREPARED_DATA_DIRECTORY,
  'fixed-day-routing',
);
export const MATRIX_WORK_DIRECTORY = resolve(
  PREPARED_DATA_DIRECTORY,
  'matrix-build',
);

export const RUNTIME_DATA_DIRECTORY = resolve(
  PROJECT_ROOT,
  'data/runtime/public_transport',
);
