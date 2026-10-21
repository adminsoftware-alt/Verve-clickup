import { describe, expect, it } from 'vitest';

import { periodFor } from './TrackTime';

describe('periodFor', () => {
  const now = new Date(2026, 9, 15, 17, 12, 30);
  const today = '2026-10-15';

  it('ends a duration typed for today at now, never later', () => {
    expect(periodFor(today, '17:00', 90 * 60, now)).toEqual({ from: '15:42', to: '17:12' });
  });

  it('stops at midnight when the duration is longer than the day so far', () => {
    expect(periodFor(today, '17:00', 20 * 3600, now)).toEqual({ from: '00:00', to: '17:12' });
  });

  it('runs on from the chosen start on an earlier day', () => {
    expect(periodFor('2026-10-14', '09:00', 90 * 60, now)).toEqual({ from: '09:00', to: '10:30' });
  });
});
