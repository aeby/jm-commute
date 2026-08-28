export function formatBytes(bytes: number): string {
  return `${new Intl.NumberFormat('en-US').format(bytes)} bytes`;
}

export function formatMilliseconds(milliseconds: number): string {
  return `${milliseconds.toFixed(2)} ms`;
}

export function formatRatio(compressedBytes: number, rawBytes: number): string {
  return `${((compressedBytes / rawBytes) * 100).toFixed(2)}% of raw`;
}

