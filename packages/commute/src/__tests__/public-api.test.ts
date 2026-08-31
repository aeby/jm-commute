import { describe, expect, it } from 'vitest';

import * as commute from '../index';

describe('@jm/commute public API', () => {
  it('exports only the operational matrix horizon at runtime', () => {
    expect(Object.keys(commute)).toEqual(['MAX_TRAVEL_MINUTES']);
  });
});
