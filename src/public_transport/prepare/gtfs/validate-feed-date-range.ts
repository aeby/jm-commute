import { validateGtfsDate } from './gtfs-date';

export function validateFeedDateRange(
  feedStartDate: string,
  feedEndDate: string,
  serviceDate: string,
): void {
  validateGtfsDate(feedStartDate, 'feed_start_date');
  validateGtfsDate(feedEndDate, 'feed_end_date');
  validateGtfsDate(serviceDate, 'Configured service date');

  if (feedStartDate > feedEndDate) {
    throw new RangeError(
      `GTFS feed validity range is reversed: ${feedStartDate}–${feedEndDate}.`,
    );
  }

  if (serviceDate < feedStartDate || serviceDate > feedEndDate) {
    throw new RangeError(
      `Configured service date ${serviceDate} is outside the GTFS feed validity range ${feedStartDate}–${feedEndDate}.`,
    );
  }
}
