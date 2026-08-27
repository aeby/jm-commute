export { buildLocalityRoutingIndex } from './build-locality-routing-index';
export {
  createLocalityRoutingEntryMap,
  parseLocalityRoutingIndexJson,
} from './parse-locality-routing-index';
export {
  createReachableLocalityMap,
  resolveFastestReachableLocalities,
  resolveFastestReachableLocalitiesDebug,
} from './resolve-reachable-localities';

export type {
  LocalityRoutingEntry,
  LocalityRoutingIndex,
  LocalityRoutingSelectionMode,
  ReachableLocality,
  ReachableLocalityDebug,
} from './types';
