/**
 * Browser-safe entry point for the future generated car-routing runtime.
 *
 * OSRM and filesystem-backed preparation APIs intentionally live under the
 * explicit `car/preprocessing` boundary and are not exported here.
 */
export type { CarRouteEstimate, Coordinate } from './preprocessing/types';
