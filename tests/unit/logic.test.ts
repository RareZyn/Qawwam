import { describe, expect, it } from 'vitest';
import { cleanDays, cleanStreak, goodStreak, logId, milestone, periods } from '../../src/lib/habits';
import { describe as describeRec, isDue, nextFire } from '../../src/lib/recurrence';
import type { Habit } from '../../src/lib/types';
import { addDays, addMonths, diffDays, fmtRM, toSen, weekKey, weekStart } from '../../src/lib/util';

const habit = (over: Partial<Habit> = {}): Habit => ({
  id: 'h',
  name: 'Test',
  type: 'good',
  points: 5,
  note: null,
  recurrence: { frequency: 'daily', interval: 1 },
  start_date: '2026-01-01',
  status: 'active',
  track_streak: false,
  show_on_home: false,
  streak_start: null,
  prev_streak_start: null,
  best_streak: 0,
  sort_order: 0,
  ...over,
});

describe('dates and money', () => {
  it('adds days across month and year ends', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(diffDays('2026-10-22', '2026-11-14')).toBe(23);
    expect(addMonths('2026-11', 2)).toBe('2027-01');
  });
  it('builds ISO weeks starting on Monday', () => {
    expect(weekStart('2026-11-14')).toBe('2026-11-09');
    expect(weekKey('2026-11-14')).toBe('2026-W46');
    expect(weekKey('2027-01-01')).toBe('2026-W53');
  });
  it('stores money as whole sen', () => {
    expect(toSen('87.42')).toBe(8742);
    expect(toSen('1,200')).toBe(120000);
    expect(toSen('0.1')).toBe(10);
    expect(toSen('abc')).toBe(0);
    expect(fmtRM(168742)).toBe('RM 1,687.42');
    expect(fmtRM(-1290)).toBe('−RM 12.90');
  });
});

describe('recurrence', () => {
  it('knows which days are due', () => {
    const mwf = { frequency: 'weekly' as const, interval: 1, days_of_week: [1, 3, 5] };
    expect(isDue(mwf, '2026-11-16')).toBe(true); // Monday
    expect(isDue(mwf, '2026-11-17')).toBe(false);
    const on31 = { frequency: 'monthly' as const, interval: 1, day_of_month: 31 };
    expect(isDue(on31, '2026-11-30')).toBe(true); // clamps to the last day
    expect(isDue({ frequency: 'daily', interval: 1 }, '2026-01-01', '2026-02-01')).toBe(false);
    expect(describeRec(mwf)).toBe('Mon, Wed, Fri');
  });
  it('schedules the next reminder, including days-before', () => {
    const from = new Date(2026, 10, 14, 10, 0).getTime();
    const rec = { frequency: 'monthly' as const, interval: 1, day_of_month: 25, time: '09:00' };
    expect(nextFire(rec, from)).toBe(new Date(2026, 10, 25, 9, 0).getTime());
    expect(nextFire(rec, from, 3)).toBe(new Date(2026, 10, 22, 9, 0).getTime());
    expect(nextFire({ frequency: 'once', interval: 1, date: '2026-11-01', time: '09:00' }, from)).toBeNull();
    expect(nextFire({ frequency: 'daily', interval: 1, time: '09:00' }, from)).toBe(new Date(2026, 10, 15, 9, 0).getTime());
  });
});

describe('habit maths', () => {
  const today = '2026-11-14';
  it('counts a clean streak from its start and adds today once checked in', () => {
    const h = habit({ type: 'bad', points: -10, track_streak: true, streak_start: '2026-10-22' });
    expect(cleanStreak(h, {}, today)).toBe(23);
    expect(cleanStreak(h, { [logId('h', today)]: { count: 0 } }, today)).toBe(24);
    expect(cleanStreak(h, { [logId('h', today)]: { count: 1 } }, today)).toBe(0);
  });
  it('tracks milestones', () => {
    expect(milestone(23)).toEqual({ next: 30, left: 7, pct: 56 });
    expect(milestone(0)).toEqual({ next: 7, left: 7, pct: 0 });
  });
  it('does not break a good streak for today before it is logged', () => {
    const h = habit();
    const logs = { [logId('h', addDays(today, -1))]: { count: 1 }, [logId('h', addDays(today, -2))]: { count: 1 } };
    expect(goodStreak(h, logs, today)).toBe(2);
    expect(goodStreak(h, { ...logs, [logId('h', today)]: { count: 1 } }, today)).toBe(3);
  });
  it('skips days a weekly habit is not due', () => {
    const h = habit({ recurrence: { frequency: 'weekly', interval: 1, days_of_week: [1, 3, 5] } });
    const logs = { [logId('h', '2026-11-13')]: { count: 1 }, [logId('h', '2026-11-11')]: { count: 1 }, [logId('h', '2026-11-09')]: { count: 1 } };
    expect(goodStreak(h, logs, today)).toBe(3);
  });
  it('counts days since a bad habit last happened', () => {
    const h = habit({ type: 'bad', points: -5 });
    expect(cleanDays(h, { [logId('h', '2026-11-12')]: { count: 1 } }, today)).toBe(2);
  });
  it('maps a date to its day, week and month totals', () => {
    expect(periods('2026-11-14').map((p) => p.id)).toEqual(['day_2026-11-14', 'week_2026-W46', 'month_2026-11']);
  });
});
