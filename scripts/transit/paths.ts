import { resolve } from 'node:path';

export const PROJECT_ROOT = resolve(import.meta.dirname, '..', '..');

export const RAW_GTFS_DIRECTORY = resolve(PROJECT_ROOT, 'data/raw/gtfs');
export const RAW_LOCALITIES_PATH = resolve(
  PROJECT_ROOT,
  'data/raw/AMTOVZ_CSV_WGS84.csv',
);

export const PROCESSED_TRANSIT_DIRECTORY = resolve(
  PROJECT_ROOT,
  'data/processed/transit',
);
export const TRANSIT_STOPS_PATH = resolve(
  PROCESSED_TRANSIT_DIRECTORY,
  'stops.json',
);
export const TRANSIT_PLACES_PATH = resolve(
  PROCESSED_TRANSIT_DIRECTORY,
  'places.json',
);
export const TRANSIT_PLACE_SERVICE_PROFILES_PATH = resolve(
  PROCESSED_TRANSIT_DIRECTORY,
  'place-service-profiles.json',
);
export const FIXED_DAY_ROUTING_DIRECTORY = resolve(
  PROCESSED_TRANSIT_DIRECTORY,
  'fixed-day-routing',
);
export const LOCALITY_ROUTING_INDEX_PATH = resolve(
  PROCESSED_TRANSIT_DIRECTORY,
  'locality-routing-index.json',
);
export const TRANSIT_MATRIX_WORK_DIRECTORY = resolve(
  PROCESSED_TRANSIT_DIRECTORY,
  'matrix-build',
);

export const TRANSIT_RUNTIME_DIRECTORY = resolve(
  PROJECT_ROOT,
  'data/runtime/transit',
);
