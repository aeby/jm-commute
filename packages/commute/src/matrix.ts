export const MAX_TRAVEL_MINUTES = 240;
export const UNAVAILABLE_TRAVEL_TIME = 0xff;
export const MATRIX_BYTES_PER_CELL = Uint8Array.BYTES_PER_ELEMENT;

export function matrixByteLength(localityCount: number): number {
  if (!Number.isSafeInteger(localityCount) || localityCount <= 0) {
    throw new Error('Locality count must be a positive safe integer.');
  }
  const length = localityCount * localityCount;
  if (!Number.isSafeInteger(length)) {
    throw new Error('Travel-time matrix is too large.');
  }
  return length;
}

export function matrixBytes(
  value: ArrayBuffer | Uint8Array,
): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  throw new TypeError('Travel-time matrix must be an ArrayBuffer or Uint8Array.');
}
