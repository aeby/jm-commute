export { buildLocalityRoutingIndex } from './build-locality-routing-index';
export {
  createLocalityRoutingEntryMap,
  parseLocalityRoutingIndexJson,
} from './parse-locality-routing-index';
export {
  createReachableLocalityMap,
  resolveReachableLocalities,
} from './resolve-reachable-localities';

export type {
  LocalityRoutingEntry,
  LocalityRoutingIndex,
  LocalityRoutingSelectionMode,
  ReachableLocality,
} from './types';
