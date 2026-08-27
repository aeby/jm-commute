const GTFS_TIME_PATTERN = /^(\d+):(\d{2}):(\d{2})$/;

export function parseGtfsTimeToSeconds(value: string): number {
  const match = GTFS_TIME_PATTERN.exec(value);

  if (!match) {
    throw new RangeError(
      `Invalid GTFS time "${value}"; expected nonnegative hours and two-digit minutes and seconds.`,
    );
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);

  if (!Number.isSafeInteger(hours)) {
    throw new RangeError(`Invalid GTFS time "${value}"; hours are too large.`);
  }

  if (minutes > 59 || seconds > 59) {
    throw new RangeError(
      `Invalid GTFS time "${value}"; minutes and seconds must be between 00 and 59.`,
    );
  }

  const totalSeconds = hours * 3_600 + minutes * 60 + seconds;

  if (!Number.isSafeInteger(totalSeconds)) {
    throw new RangeError(`Invalid GTFS time "${value}"; value is too large.`);
  }

  return totalSeconds;
}
