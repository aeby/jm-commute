import { resolve } from 'node:path';

export const PROJECT_ROOT = resolve(import.meta.dirname, '..', '..');

export const RAW_OSM_PBF_PATH = resolve(
  PROJECT_ROOT,
  'data/raw/osm/switzerland-latest.osm.pbf',
);
export const RAW_LOCALITIES_PATH = resolve(
  PROJECT_ROOT,
  'data/raw/AMTOVZ_CSV_WGS84.csv',
);

export const PREPARED_DATA_DIRECTORY = resolve(
  PROJECT_ROOT,
  'data/processed/road',
);
export const PREPARED_NETWORK_DIRECTORY = resolve(
  PREPARED_DATA_DIRECTORY,
  'network',
);
export const MATRIX_WORK_DIRECTORY = resolve(
  PREPARED_DATA_DIRECTORY,
  'matrix-build',
);

export const RUNTIME_DATA_DIRECTORY = resolve(
  PROJECT_ROOT,
  'data/runtime/car',
);
