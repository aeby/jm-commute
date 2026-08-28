/** GTFS pickup_type/drop_off_type value encoded in the runtime timetable. */
export type PickupDropOffType = 0 | 1 | 2 | 3;

export interface CalendarEntry {
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

export interface CalendarDateEntry {
  readonly serviceId: string;
  readonly date: string;
  readonly exceptionType: number;
}
