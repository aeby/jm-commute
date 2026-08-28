const WEB_MERCATOR_RADIUS_METERS = 6_378_137;
const MAX_WEB_MERCATOR_LATITUDE = 85.051_128_779_806_6;
const DEGREES_TO_RADIANS = Math.PI / 180;
const RADIANS_TO_DEGREES = 180 / Math.PI;
const SQRT_THREE = Math.sqrt(3);

export interface MercatorMeters {
  readonly x: number;
  readonly y: number;
}

export interface LonLat {
  readonly longitude: number;
  readonly latitude: number;
}

export type LonLatPosition = [longitude: number, latitude: number];

export interface HexCell {
  readonly id: string;
  readonly q: number;
  readonly r: number;
}

const requireFinite = (value: number, name: string): void => {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be finite.`);
  }
};

const requireCellDiameter = (cellDiameterMeters: number): number => {
  requireFinite(cellDiameterMeters, 'Hex cell diameter');
  if (cellDiameterMeters <= 0) {
    throw new RangeError('Hex cell diameter must be greater than zero.');
  }
  return cellDiameterMeters;
};

const normalizeInteger = (value: number): number =>
  Object.is(value, -0) ? 0 : value;

/** Project WGS84 longitude/latitude into spherical Web Mercator metres. */
export function lonLatToMercatorMeters(
  longitude: number,
  latitude: number,
): MercatorMeters {
  requireFinite(longitude, 'Longitude');
  requireFinite(latitude, 'Latitude');
  if (longitude < -180 || longitude > 180) {
    throw new RangeError('Longitude must be between -180 and 180 degrees.');
  }
  if (latitude < -90 || latitude > 90) {
    throw new RangeError('Latitude must be between -90 and 90 degrees.');
  }

  const projectedLatitude = Math.max(
    -MAX_WEB_MERCATOR_LATITUDE,
    Math.min(MAX_WEB_MERCATOR_LATITUDE, latitude),
  );
  const latitudeRadians = projectedLatitude * DEGREES_TO_RADIANS;

  return {
    x: WEB_MERCATOR_RADIUS_METERS * longitude * DEGREES_TO_RADIANS,
    y:
      WEB_MERCATOR_RADIUS_METERS *
      Math.log(Math.tan(Math.PI / 4 + latitudeRadians / 2)),
  };
}

/** Convert spherical Web Mercator metres back to WGS84 longitude/latitude. */
export function mercatorMetersToLonLat(x: number, y: number): LonLat {
  requireFinite(x, 'Web Mercator x');
  requireFinite(y, 'Web Mercator y');

  return {
    longitude: x * RADIANS_TO_DEGREES / WEB_MERCATOR_RADIUS_METERS,
    latitude:
      (2 * Math.atan(Math.exp(y / WEB_MERCATOR_RADIUS_METERS)) -
        Math.PI / 2) *
      RADIANS_TO_DEGREES,
  };
}

export function hexCellId(q: number, r: number): string {
  if (!Number.isInteger(q) || !Number.isInteger(r)) {
    throw new RangeError('Hex axial coordinates must be integers.');
  }
  return `${normalizeInteger(q)},${normalizeInteger(r)}`;
}

/**
 * Locate a point in a pointy-top axial grid using deterministic cube rounding.
 *
 * `cellDiameterMeters` is the opposite-corner diameter: twice the hexagon's
 * circumradius. A 1,000 m cell is therefore 1,000 m from its northern to its
 * southern corner in Web Mercator space.
 */
export function pointToHexCell(
  x: number,
  y: number,
  cellDiameterMeters: number,
): HexCell {
  requireFinite(x, 'Web Mercator x');
  requireFinite(y, 'Web Mercator y');
  const radius = requireCellDiameter(cellDiameterMeters) / 2;

  const fractionalQ = (SQRT_THREE / 3 * x - y / 3) / radius;
  const fractionalR = (2 / 3 * y) / radius;
  const fractionalCubeX = fractionalQ;
  const fractionalCubeZ = fractionalR;
  const fractionalCubeY = -fractionalCubeX - fractionalCubeZ;

  let cubeX = Math.round(fractionalCubeX);
  let cubeY = Math.round(fractionalCubeY);
  let cubeZ = Math.round(fractionalCubeZ);

  const xDifference = Math.abs(cubeX - fractionalCubeX);
  const yDifference = Math.abs(cubeY - fractionalCubeY);
  const zDifference = Math.abs(cubeZ - fractionalCubeZ);

  // Strict comparisons deliberately provide a stable branch order for ties.
  if (xDifference > yDifference && xDifference > zDifference) {
    cubeX = -cubeY - cubeZ;
  } else if (yDifference > zDifference) {
    cubeY = -cubeX - cubeZ;
  } else {
    cubeZ = -cubeX - cubeY;
  }

  const q = normalizeInteger(cubeX);
  const r = normalizeInteger(cubeZ);
  return { id: hexCellId(q, r), q, r };
}

/** Return the six unclosed WGS84 vertices of a pointy-top hexagon. */
export function hexCellPolygon(
  cell: Pick<HexCell, 'q' | 'r'>,
  cellDiameterMeters: number,
): readonly LonLatPosition[] {
  if (!Number.isInteger(cell.q) || !Number.isInteger(cell.r)) {
    throw new RangeError('Hex axial coordinates must be integers.');
  }
  const radius = requireCellDiameter(cellDiameterMeters) / 2;
  const centerX = radius * SQRT_THREE * (cell.q + cell.r / 2);
  const centerY = radius * 3 / 2 * cell.r;

  return Array.from({ length: 6 }, (_, vertexIndex): LonLatPosition => {
    const angleRadians = (60 * vertexIndex - 30) * DEGREES_TO_RADIANS;
    const vertex = mercatorMetersToLonLat(
      centerX + radius * Math.cos(angleRadians),
      centerY + radius * Math.sin(angleRadians),
    );
    return [vertex.longitude, vertex.latitude];
  });
}

/**
 * Shrink rendered geometry around its Web Mercator centre to create a gap.
 * Logical cell assignment, axial coordinates, and cell IDs remain unchanged.
 */
export function shrinkHexPolygon(
  polygon: readonly LonLatPosition[],
  renderScale: number,
): readonly LonLatPosition[] {
  if (polygon.length !== 6) {
    throw new RangeError('A hex polygon must have exactly six vertices.');
  }
  requireFinite(renderScale, 'Hex render scale');
  if (renderScale <= 0 || renderScale > 1) {
    throw new RangeError(
      'Hex render scale must be greater than zero and at most one.',
    );
  }

  const projectedVertices = polygon.map(([longitude, latitude]) =>
    lonLatToMercatorMeters(longitude, latitude),
  );
  if (renderScale === 1) {
    return polygon.map(([longitude, latitude]) => [longitude, latitude]);
  }
  const center = projectedVertices.reduce(
    (sum, vertex) => ({ x: sum.x + vertex.x, y: sum.y + vertex.y }),
    { x: 0, y: 0 },
  );
  const centerX = center.x / projectedVertices.length;
  const centerY = center.y / projectedVertices.length;

  return projectedVertices.map((vertex): LonLatPosition => {
    const renderedVertex = mercatorMetersToLonLat(
      centerX + (vertex.x - centerX) * renderScale,
      centerY + (vertex.y - centerY) * renderScale,
    );
    return [renderedVertex.longitude, renderedVertex.latitude];
  });
}
