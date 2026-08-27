export { createLocalityId } from './locality-id';
export { LocalityResolver } from './locality-resolver';
export { normalizeCityName } from './normalize-city-name';
export { parseLocalitiesCsv } from './parse-localities-csv';

export {
  buildLocalityRoutingIndex,
  createLocalityRoutingEntryMap,
  createReachableLocalityMap,
  parseLocalityRoutingIndexJson,
  resolveFastestReachableLocalities,
  resolveFastestReachableLocalitiesDebug,
} from './routing';

export type { Locality, LocalityId, LocalityQuery } from './types';
export type {
  LocalityRoutingEntry,
  LocalityRoutingIndex,
  LocalityRoutingSelectionMode,
  ReachableLocality,
  ReachableLocalityDebug,
} from './routing';
