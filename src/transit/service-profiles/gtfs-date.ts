const GTFS_DATE_PATTERN = /^(\d{4})(\d{2})(\d{2})$/;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const WEEKDAY_OFFSETS = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];

interface GtfsDateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function parseGtfsDateParts(value: string, label: string): GtfsDateParts {
  const match = GTFS_DATE_PATTERN.exec(value);

  if (!match) {
    throw new RangeError(`${label} must be a valid YYYYMMDD date: "${value}".`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const maximumDay =
    month === 2 && isLeapYear(year)
      ? 29
      : (DAYS_IN_MONTH[month - 1] ?? 0);

  if (year === 0 || month < 1 || month > 12 || day < 1 || day > maximumDay) {
    throw new RangeError(`${label} must be a valid YYYYMMDD date: "${value}".`);
  }

  return { year, month, day };
}

export function validateGtfsDate(
  value: string,
  label = 'GTFS date',
): void {
  parseGtfsDateParts(value, label);
}

export function getGtfsWeekdayIndex(value: string): number {
  const { year, month, day } = parseGtfsDateParts(value, 'GTFS date');
  const adjustedYear = month < 3 ? year - 1 : year;

  return (
    adjustedYear +
    Math.floor(adjustedYear / 4) -
    Math.floor(adjustedYear / 100) +
    Math.floor(adjustedYear / 400) +
    (WEEKDAY_OFFSETS[month - 1] ?? 0) +
    day
  ) % 7;
}
