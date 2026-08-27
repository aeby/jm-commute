export function isRailRouteType(routeType: number): boolean {
  return (
    routeType === 2 ||
    (Number.isInteger(routeType) && routeType >= 100 && routeType <= 199)
  );
}
