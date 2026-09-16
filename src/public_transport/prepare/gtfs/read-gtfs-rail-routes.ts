import {
  processGtfsCsvRows,
  readCsvColumn,
  readNonemptyCsvId,
} from './read-csv-rows';

// Standard rail plus passenger railway services in the extended GTFS codes.
// Vehicle transport and replacement services do not receive the rail bonus.
// https://developers.google.com/transit/gtfs/reference/extended-route-types
const RAIL_ROUTE_TYPES = new Set([
  2, 100, 101, 102, 103, 105, 106, 107, 108, 109, 111, 113, 114, 116, 117,
]);

/** Classifies every route, retaining non-rail routes to detect missing IDs. */
export async function readGtfsRailRoutes(
  path: string,
): Promise<ReadonlyMap<string, boolean>> {
  const railByRouteId = new Map<string, boolean>();
  await processGtfsCsvRows(path, ['route_id', 'route_type'], (row, columns) => {
    const routeId = readNonemptyCsvId(row, columns, 'route_id');
    const routeType = readCsvColumn(row, columns, 'route_type');
    if (!/^\d+$/.test(routeType) || !Number.isSafeInteger(Number(routeType))) {
      throw new Error(`Route "${routeId}" has invalid route_type "${routeType}".`);
    }
    if (railByRouteId.has(routeId)) {
      throw new Error(`Duplicate route_id "${routeId}".`);
    }
    railByRouteId.set(routeId, RAIL_ROUTE_TYPES.has(Number(routeType)));
  });
  return railByRouteId;
}
