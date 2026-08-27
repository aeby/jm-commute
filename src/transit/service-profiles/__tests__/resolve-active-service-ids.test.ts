import { describe, expect, it } from 'vitest';

import { PROJECT_CONFIG } from '../../../config';
import { resolveActiveServiceIds } from '../resolve-active-service-ids';

const SERVICE_DATE =
  PROJECT_CONFIG.transit.referenceScenario.serviceDate.replaceAll('-', '');

function createCalendarEntry(
  overrides: Readonly<Record<string, string | number>> = {},
) {
  return {
    serviceId: 'weekday-service',
    monday: 1,
    tuesday: 0,
    wednesday: 0,
    thursday: 0,
    friday: 0,
    saturday: 0,
    sunday: 0,
    startDate: '20260101',
    endDate: '20261231',
    ...overrides,
  };
}

describe('resolveActiveServiceIds', () => {
  it('activates a normal Monday calendar service', () => {
    expect(
      resolveActiveServiceIds(
        [createCalendarEntry()],
        [],
        SERVICE_DATE,
      ).has('weekday-service'),
    ).toBe(true);
  });

  it('does not activate a service outside its date range', () => {
    expect(
      resolveActiveServiceIds(
        [createCalendarEntry({ endDate: '20260906' })],
        [],
        SERVICE_DATE,
      ),
    ).toEqual(new Set());
  });

  it('adds a service through a date-specific exception', () => {
    expect(
      resolveActiveServiceIds(
        [],
        [
          {
            serviceId: 'added-service',
            date: SERVICE_DATE,
            exceptionType: 1,
          },
        ],
        SERVICE_DATE,
      ).has('added-service'),
    ).toBe(true);
  });

  it('removes a weekly service through a date-specific exception', () => {
    expect(
      resolveActiveServiceIds(
        [createCalendarEntry()],
        [
          {
            serviceId: 'weekday-service',
            date: SERVICE_DATE,
            exceptionType: 2,
          },
        ],
        SERVICE_DATE,
      ).has('weekday-service'),
    ).toBe(false);
  });

  it('lets exceptions override weekly-calendar results', () => {
    const activeServices = resolveActiveServiceIds(
      [
        createCalendarEntry(),
        createCalendarEntry({
          serviceId: 'monday-disabled',
          monday: 0,
        }),
      ],
      [
        {
          serviceId: 'weekday-service',
          date: SERVICE_DATE,
          exceptionType: 2,
        },
        {
          serviceId: 'monday-disabled',
          date: SERVICE_DATE,
          exceptionType: 1,
        },
      ],
      SERVICE_DATE,
    );

    expect([...activeServices]).toEqual(['monday-disabled']);
  });

  it.each(['2026-01-02', '20260230', 'not-a-date'])(
    'rejects invalid service date %j',
    (serviceDate) => {
      expect(() => resolveActiveServiceIds([], [], serviceDate)).toThrow(
        /valid YYYYMMDD date/i,
      );
    },
  );

  it('rejects invalid weekday flags', () => {
    expect(() =>
      resolveActiveServiceIds(
        [createCalendarEntry({ monday: 2 })],
        [],
        SERVICE_DATE,
      ),
    ).toThrow(/invalid monday flag.*expected 0 or 1/i);
  });

  it('rejects invalid exception types', () => {
    expect(() =>
      resolveActiveServiceIds(
        [],
        [
          {
            serviceId: 'service',
            date: SERVICE_DATE,
            exceptionType: 3,
          },
        ],
        SERVICE_DATE,
      ),
    ).toThrow(/invalid exception_type.*expected 1 or 2/i);
  });

  it('rejects duplicate service/date exceptions', () => {
    expect(() =>
      resolveActiveServiceIds(
        [],
        [
          {
            serviceId: 'service',
            date: SERVICE_DATE,
            exceptionType: 1,
          },
          {
            serviceId: 'service',
            date: SERVICE_DATE,
            exceptionType: 2,
          },
        ],
        SERVICE_DATE,
      ),
    ).toThrow(/duplicate exception.*service/i);
  });

  it('rejects empty service IDs', () => {
    expect(() =>
      resolveActiveServiceIds(
        [createCalendarEntry({ serviceId: ' ' })],
        [],
        SERVICE_DATE,
      ),
    ).toThrow(/service_id.*nonempty string/i);
  });
});
