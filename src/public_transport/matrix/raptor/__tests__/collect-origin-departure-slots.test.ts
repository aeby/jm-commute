import { describe, expect, it } from 'vitest';

import type { PublicTransportNetwork } from '../../../network';
import { USE_QUERY_TRANSFER_TIME } from '../../../network/transfer-encoding';
import {
  collectOriginDepartureSlots,
  testPattern,
  testTimetable,
} from './test-timetable';

const WINDOW_START = 7 * 60 * 60;
const WINDOW_END = 9 * 60 * 60;

const withAccessTransfers = (
  timetable: PublicTransportNetwork,
  accessTransfersByStop: readonly Uint32Array[],
): PublicTransportNetwork => ({ ...timetable, accessTransfersByStop });

describe('collectOriginDepartureSlots', () => {
  it('includes direct departures at 07:00 and 08:59:59 but excludes 09:00', () => {
    const timetable = testTimetable(2, [
      testPattern(
        [0, 1],
        [
          [
            { arrival: WINDOW_START, departure: WINDOW_START },
            { arrival: WINDOW_START + 60, departure: WINDOW_START + 60 },
          ],
          [
            { arrival: WINDOW_END - 1, departure: WINDOW_END - 1 },
            { arrival: WINDOW_END + 59, departure: WINDOW_END + 59 },
          ],
          [
            { arrival: WINDOW_END, departure: WINDOW_END },
            { arrival: WINDOW_END + 60, departure: WINDOW_END + 60 },
          ],
        ],
      ),
    ]);

    expect(
      Array.from(
        collectOriginDepartureSlots(
          timetable,
          [0],
          WINDOW_START,
          WINDOW_END,
          120,
        ),
      ),
    ).toEqual([WINDOW_END - 1, WINDOW_START]);
  });

  it('does not create a slot for a prohibited pickup', () => {
    const timetable = testTimetable(2, [
      testPattern([0, 1], [
        [
          {
            arrival: 8 * 60 * 60,
            departure: 8 * 60 * 60,
            pickupType: 1,
          },
          { arrival: 8 * 60 * 60 + 600, departure: 8 * 60 * 60 + 600 },
        ],
      ]),
    ]);

    expect(
      Array.from(
        collectOriginDepartureSlots(
          timetable,
          [0],
          WINDOW_START,
          WINDOW_END,
          120,
        ),
      ),
    ).toEqual([WINDOW_START]);
  });

  it('derives a Bern-style access-adjusted 07:56 slot from an 08:02 train', () => {
    const trainDeparture = 8 * 60 * 60 + 2 * 60;
    const base = testTimetable(3, [
      testPattern([1, 2], [
        [
          { arrival: trainDeparture, departure: trainDeparture },
          { arrival: trainDeparture + 3_000, departure: trainDeparture + 3_000 },
        ],
      ]),
    ]);
    const timetable = withAccessTransfers(base, [
      new Uint32Array([1, 6 * 60]),
      new Uint32Array(),
      new Uint32Array(),
    ]);

    expect(
      Array.from(
        collectOriginDepartureSlots(
          timetable,
          [0],
          WINDOW_START,
          WINDOW_END,
          120,
        ),
      ),
    ).toEqual([7 * 60 * 60 + 56 * 60, WINDOW_START]);
  });

  it('resolves fallback access durations and excludes adjusted times before the window', () => {
    const base = testTimetable(3, [
      testPattern([1, 2], [
        [
          { arrival: WINDOW_START + 60, departure: WINDOW_START + 60 },
          { arrival: WINDOW_START + 600, departure: WINDOW_START + 600 },
        ],
      ]),
    ]);
    const timetable = withAccessTransfers(base, [
      new Uint32Array([1, USE_QUERY_TRANSFER_TIME]),
      new Uint32Array(),
      new Uint32Array(),
    ]);

    expect(
      Array.from(
        collectOriginDepartureSlots(
          timetable,
          [0],
          WINDOW_START,
          WINDOW_END,
          120,
        ),
      ),
    ).toEqual([WINDOW_START]);
  });

  it('deduplicates slots from several origins and returns them latest-first', () => {
    const departure = 8 * 60 * 60;
    const timetable = testTimetable(3, [
      testPattern([0, 2], [
        [
          { arrival: departure, departure },
          { arrival: departure + 600, departure: departure + 600 },
        ],
      ]),
      testPattern([1, 2], [
        [
          { arrival: departure, departure },
          { arrival: departure + 600, departure: departure + 600 },
        ],
      ]),
    ]);

    expect(
      Array.from(
        collectOriginDepartureSlots(
          timetable,
          [1, 0, 1],
          WINDOW_START,
          WINDOW_END,
          120,
        ),
      ),
    ).toEqual([departure, WINDOW_START]);
  });
});
