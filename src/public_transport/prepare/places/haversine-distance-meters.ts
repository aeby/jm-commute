const MEAN_EARTH_RADIUS_METERS = 6_371_008.8;

interface Coordinates {
  readonly latitude: number;
  readonly longitude: number;
}

function validateCoordinates(
  coordinates: Coordinates,
  label: string,
): void {
  if (coordinates === null || typeof coordinates !== 'object') {
    throw new RangeError(`${label} coordinates must be an object.`);
  }

  if (!Number.isFinite(coordinates.latitude)) {
    throw new RangeError(`${label} latitude must be a finite number.`);
  }

  if (coordinates.latitude < -90 || coordinates.latitude > 90) {
    throw new RangeError(`${label} latitude must be between -90 and 90.`);
  }

  if (!Number.isFinite(coordinates.longitude)) {
    throw new RangeError(`${label} longitude must be a finite number.`);
  }

  if (coordinates.longitude < -180 || coordinates.longitude > 180) {
    throw new RangeError(
      `${label} longitude must be between -180 and 180.`,
    );
  }
}

function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function haversineDistanceMeters(
  from: {
    readonly latitude: number;
    readonly longitude: number;
  },
  to: {
    readonly latitude: number;
    readonly longitude: number;
  },
): number {
  validateCoordinates(from, 'Origin');
  validateCoordinates(to, 'Destination');

  if (
    from.latitude === to.latitude &&
    from.longitude === to.longitude
  ) {
    return 0;
  }

  const fromLatitude = degreesToRadians(from.latitude);
  const toLatitude = degreesToRadians(to.latitude);
  const latitudeDelta = toLatitude - fromLatitude;
  const longitudeDelta = degreesToRadians(
    to.longitude - from.longitude,
  );
  const latitudeHaversine = Math.sin(latitudeDelta / 2) ** 2;
  const longitudeHaversine = Math.sin(longitudeDelta / 2) ** 2;
  const haversine =
    latitudeHaversine +
    Math.cos(fromLatitude) *
      Math.cos(toLatitude) *
      longitudeHaversine;
  const boundedHaversine = Math.min(1, Math.max(0, haversine));
  const centralAngle =
    2 *
    Math.atan2(
      Math.sqrt(boundedHaversine),
      Math.sqrt(1 - boundedHaversine),
    );

  return MEAN_EARTH_RADIUS_METERS * centralAngle;
}
