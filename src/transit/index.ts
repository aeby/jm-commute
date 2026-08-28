/**
 * Canonical consumer-facing transit entry.
 *
 * Construction is intentionally absent until a final transit runtime-data
 * format exists. Node/publication code may use the prepared-data bridge from
 * `transit-runtime.ts`; consumers only receive an opaque runtime handle.
 */
export {
  getReachableLocalitiesByTransit,
  type TransitRuntime,
} from './transit-runtime';
