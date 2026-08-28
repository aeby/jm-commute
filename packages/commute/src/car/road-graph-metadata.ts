export interface CarRoadGraphMetadata {
  readonly sourcePbfSha256: string;
  readonly osrmVersion: string;
  readonly profile: 'car.lua';
  readonly algorithm: 'ch';
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const OSRM_VERSION_PATTERN = /^\d+\.\d+\.\d+$/u;

type InvalidMetadata = (path: string, detail: string) => never;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseCarRoadGraphMetadata(
  value: unknown,
  path: string,
  invalid: InvalidMetadata,
): CarRoadGraphMetadata {
  if (!isRecord(value)) {
    return invalid(path, 'expected an object');
  }
  const expectedKeys = [
    'sourcePbfSha256',
    'osrmVersion',
    'profile',
    'algorithm',
  ] as const;
  const actualKeys = Object.keys(value);
  const actual = new Set(actualKeys);
  const expected = new Set<string>(expectedKeys);
  const missing = expectedKeys.filter((key) => !actual.has(key));
  if (missing.length > 0) {
    return invalid(path, `missing field(s) ${missing.join(', ')}`);
  }
  const unexpected = actualKeys.filter((key) => !expected.has(key));
  if (unexpected.length > 0) {
    return invalid(path, `unexpected field(s) ${unexpected.join(', ')}`);
  }
  if (
    typeof value.sourcePbfSha256 !== 'string' ||
    !SHA256_PATTERN.test(value.sourcePbfSha256)
  ) {
    return invalid(
      `${path}.sourcePbfSha256`,
      'expected a lowercase SHA-256 digest',
    );
  }
  if (
    typeof value.osrmVersion !== 'string' ||
    !OSRM_VERSION_PATTERN.test(value.osrmVersion)
  ) {
    return invalid(
      `${path}.osrmVersion`,
      'expected a semantic version such as 26.8.0',
    );
  }
  if (value.profile !== 'car.lua') {
    return invalid(`${path}.profile`, 'expected "car.lua"');
  }
  if (value.algorithm !== 'ch') {
    return invalid(`${path}.algorithm`, 'expected "ch"');
  }
  return {
    sourcePbfSha256: value.sourcePbfSha256,
    osrmVersion: value.osrmVersion,
    profile: value.profile,
    algorithm: value.algorithm,
  };
}
