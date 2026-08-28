export { buildLocalityRoutingIndex } from './build-locality-routing-index';
export {
  createLocalityRoutingEntryMap,
  parseLocalityRoutingIndexJson,
} from './parse-locality-routing-index';
export {
  resolveFastestReachableLocalities,
  resolveFastestReachableLocalitiesDebug,
} from './resolve-fastest-reachable-localities';

export type {
  LocalityRoutingEntry,
  LocalityRoutingIndex,
  ReachableLocalityDebug,
} from './types';
