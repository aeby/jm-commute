import { resolve } from 'node:path';

export const PROJECT_ROOT = resolve(import.meta.dirname, '..', '..');

export const COMMUTE_PACKAGE_DIRECTORY = resolve(
  PROJECT_ROOT,
  'packages/commute',
);

export const COMMUTE_PACKAGE_DATA_DIRECTORY = resolve(
  COMMUTE_PACKAGE_DIRECTORY,
  'data',
);

export const ROOT_RUNTIME_DATA_DIRECTORY = resolve(
  PROJECT_ROOT,
  'data/runtime',
);

export const OFFICIAL_LOCALITIES_CSV_PATH = resolve(
  PROJECT_ROOT,
  'data/raw/AMTOVZ_CSV_WGS84.csv',
);
