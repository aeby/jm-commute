import { getGtfsWeekdayIndex, validateGtfsDate } from './gtfs-date';

interface CalendarEntry {
  readonly serviceId: string;
  readonly monday: number;
  readonly tuesday: number;
  readonly wednesday: number;
  readonly thursday: number;
  readonly friday: number;
  readonly saturday: number;
  readonly sunday: number;
  readonly startDate: string;
  readonly endDate: string;
}

interface CalendarDateEntry {
  readonly serviceId: string;
  readonly date: string;
  readonly exceptionType: number;
}

const WEEKDAY_FIELDS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

function validateServiceId(serviceId: string, source: string): void {
  if (typeof serviceId !== 'string' || serviceId.trim().length === 0) {
    throw new Error(`${source} service_id must be a nonempty string.`);
  }
}

function validateCalendarEntry(entry: CalendarEntry): void {
  validateServiceId(entry.serviceId, 'calendar.txt');

  for (const weekday of WEEKDAY_FIELDS) {
    const flag = entry[weekday];

    if (flag !== 0 && flag !== 1) {
      throw new Error(
        `calendar.txt service "${entry.serviceId}" has invalid ${weekday} flag ${String(flag)}; expected 0 or 1.`,
      );
    }
  }

  validateGtfsDate(entry.startDate, 'calendar.txt start_date');
  validateGtfsDate(entry.endDate, 'calendar.txt end_date');

  if (entry.startDate > entry.endDate) {
    throw new RangeError(
      `calendar.txt service "${entry.serviceId}" has start_date after end_date.`,
    );
  }
}

function validateCalendarDateEntry(entry: CalendarDateEntry): void {
  validateServiceId(entry.serviceId, 'calendar_dates.txt');
  validateGtfsDate(entry.date, 'calendar_dates.txt date');

  if (entry.exceptionType !== 1 && entry.exceptionType !== 2) {
    throw new Error(
      `calendar_dates.txt service "${entry.serviceId}" has invalid exception_type ${String(entry.exceptionType)}; expected 1 or 2.`,
    );
  }
}

export function resolveActiveServiceIds(
  calendarEntries: readonly CalendarEntry[],
  calendarDateEntries: readonly CalendarDateEntry[],
  serviceDate: string,
): ReadonlySet<string> {
  validateGtfsDate(serviceDate, 'Service date');

  const weekday = WEEKDAY_FIELDS[getGtfsWeekdayIndex(serviceDate)];
  const activeServiceIds = new Set<string>();
  const calendarServiceIds = new Set<string>();

  for (const entry of calendarEntries) {
    validateCalendarEntry(entry);

    if (calendarServiceIds.has(entry.serviceId)) {
      throw new Error(
        `calendar.txt contains duplicate service_id "${entry.serviceId}".`,
      );
    }

    calendarServiceIds.add(entry.serviceId);

    if (
      entry.startDate <= serviceDate &&
      serviceDate <= entry.endDate &&
      entry[weekday] === 1
    ) {
      activeServiceIds.add(entry.serviceId);
    }
  }

  const exceptionKeys = new Set<string>();

  for (const entry of calendarDateEntries) {
    validateCalendarDateEntry(entry);

    const key = `${entry.serviceId}\u0000${entry.date}`;

    if (exceptionKeys.has(key)) {
      throw new Error(
        `calendar_dates.txt contains duplicate exception for service_id "${entry.serviceId}" on ${entry.date}.`,
      );
    }

    exceptionKeys.add(key);

    if (entry.date !== serviceDate) {
      continue;
    }

    if (entry.exceptionType === 1) {
      activeServiceIds.add(entry.serviceId);
    } else {
      activeServiceIds.delete(entry.serviceId);
    }
  }

  return activeServiceIds;
}
