import { deleteDoc, increment, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { db, udoc } from './db';
import { isDue } from './recurrence';
import type { Habit, HabitLog } from './types';
import { addDays, daysInMonth, diffDays, monthKey, newId, weekKey, weekStart } from './util';

export const MILESTONES = [7, 14, 30, 60, 90, 180, 365];
export const logId = (habitId: string, date: string) => `${habitId}_${date}`;
export type LogMap = Record<string, Pick<HabitLog, 'count'> | undefined>;

/** The day, week and month score documents a date belongs to. */
export function periods(date: string) {
  const ws = weekStart(date);
  const m = monthKey(date);
  return [
    { id: `day_${date}`, period_type: 'day' as const, period_key: date, period_start: date, period_end: date },
    { id: `week_${weekKey(date)}`, period_type: 'week' as const, period_key: weekKey(date), period_start: ws, period_end: addDays(ws, 6) },
    { id: `month_${m}`, period_type: 'month' as const, period_key: m, period_start: `${m}-01`, period_end: `${m}-${daysInMonth(m)}` },
  ];
}

type Batch = ReturnType<typeof writeBatch>;

/** Add a score change to the day, week and month totals. Uses increments so it also works offline. */
function bump(b: Batch, date: string, score: number, good: number, bad: number) {
  for (const { id, ...rest } of periods(date)) {
    b.set(
      udoc('habit_score_summaries', id),
      { ...rest, score: increment(score), good_count: increment(good), bad_count: increment(bad), updated_at: serverTimestamp() },
      { merge: true },
    );
  }
}

/**
 * Set how many times a habit happened on a day (null removes the log) and keep the score totals in step,
 * all in one atomic write.
 */
export function setLog(habit: Habit, prev: HabitLog | undefined, date: string, count: number | null, extra?: (b: Batch) => void) {
  const b = writeBatch(db);
  const ref = udoc('habit_logs', logId(habit.id, date));
  const next = count ?? 0;
  const score = habit.points * next;
  if (count === null) b.delete(ref);
  else {
    b.set(ref, {
      habit_id: habit.id,
      log_date: date,
      count: next,
      points: habit.points,
      score,
      updated_at: serverTimestamp(),
    });
  }
  const dScore = score - (prev?.score ?? 0);
  const dCount = next - (prev?.count ?? 0);
  if (dScore || dCount) bump(b, date, dScore, habit.type === 'good' ? dCount : 0, habit.type === 'bad' ? dCount : 0);
  extra?.(b);
  return b.commit();
}

/** Good habit: mark done, or undo. Raises the stored best streak when the new streak beats it. */
export function toggleGood(habit: Habit, logs: Record<string, HabitLog>, date: string, today: string) {
  const prev = logs[logId(habit.id, date)];
  if (prev && prev.count > 0) return setLog(habit, prev, date, null);
  const streak = goodStreak(habit, { ...logs, [logId(habit.id, date)]: { count: 1 } }, today);
  return setLog(habit, prev, date, 1, (b) => {
    if (streak > (habit.best_streak ?? 0)) b.update(udoc('habits', habit.id), { best_streak: streak });
  });
}

/** Bad habit: it happened once more (+1), or take one back (−1). */
export function addBad(habit: Habit, prev: HabitLog | undefined, date: string, delta: 1 | -1) {
  const n = (prev?.count ?? 0) + delta;
  return setLog(habit, prev, date, n <= 0 ? null : n);
}

/** Streak habit: confirm today was clean. */
export function checkInClean(habit: Habit, prev: HabitLog | undefined, date: string) {
  if (prev) return Promise.resolve();
  return setLog(habit, prev, date, 0);
}

/** Streak habit: a slip. Logs the penalty, remembers the best streak and restarts the count from tomorrow. */
export function slip(habit: Habit, prev: HabitLog | undefined, date: string, currentStreak: number) {
  return setLog(habit, prev, date, 1, (b) =>
    b.update(udoc('habits', habit.id), {
      prev_streak_start: habit.streak_start ?? habit.start_date,
      streak_start: addDays(date, 1),
      best_streak: Math.max(habit.best_streak ?? 0, currentStreak),
      updated_at: serverTimestamp(),
    }),
  );
}

export function undoSlip(habit: Habit, prev: HabitLog | undefined, date: string) {
  return setLog(habit, prev, date, null, (b) =>
    b.update(udoc('habits', habit.id), {
      streak_start: habit.prev_streak_start ?? habit.start_date,
      updated_at: serverTimestamp(),
    }),
  );
}

/** Clean days in a row for a streak habit: every day since the streak started, plus today once checked in. */
export function cleanStreak(habit: Habit, logs: LogMap, today: string): number {
  const todayLog = logs[logId(habit.id, today)];
  if (todayLog && todayLog.count > 0) return 0;
  const n = Math.max(0, diffDays(habit.streak_start ?? habit.start_date, today));
  return todayLog ? n + 1 : n;
}

/** Next milestone after the current streak, and how far along the way to it. */
export function milestone(streak: number) {
  const next = MILESTONES.find((m) => m > streak) ?? MILESTONES[MILESTONES.length - 1];
  const prev = [...MILESTONES].reverse().find((m) => m <= streak) ?? 0;
  const pct = next > prev ? Math.min(100, Math.round(((streak - prev) / (next - prev)) * 100)) : 100;
  return { next, left: Math.max(0, next - streak), pct };
}

/** Due days done in a row for a good habit. A due day today that is not done yet does not break the streak. */
export function goodStreak(habit: Habit, logs: LogMap, today: string, window = 120): number {
  let n = 0;
  for (let i = 0; i <= window; i++) {
    const d = addDays(today, -i);
    if (d < habit.start_date) break;
    if (!isDue(habit.recurrence, d)) continue;
    const log = logs[logId(habit.id, d)];
    if (log && log.count > 0) n++;
    else if (i > 0) break;
  }
  return n;
}

/** Days since a (non-streak) bad habit last happened, within the loaded window. */
export function cleanDays(habit: Habit, logs: LogMap, today: string, window = 120): number {
  for (let i = 0; i <= window; i++) {
    const d = addDays(today, -i);
    if (d < habit.start_date) return i;
    const log = logs[logId(habit.id, d)];
    if (log && log.count > 0) return i;
  }
  return window;
}

export const dueToday = (habit: Habit, today: string) =>
  habit.status === 'active' && isDue(habit.recurrence, today, habit.start_date);

export type HabitInput = Pick<Habit, 'name' | 'type' | 'points' | 'note' | 'recurrence' | 'track_streak' | 'show_on_home'>;

export function saveHabit(input: HabitInput, existing?: Habit, today?: string) {
  const points = input.type === 'good' ? Math.abs(input.points) : -Math.abs(input.points);
  if (existing) {
    return updateDoc(udoc('habits', existing.id), { ...input, points, updated_at: serverTimestamp() }).then(() => existing.id);
  }
  const id = newId();
  const start = today ?? '';
  return setDoc(udoc('habits', id), {
    ...input,
    points,
    start_date: start,
    status: 'active',
    streak_start: input.track_streak ? start : null,
    prev_streak_start: null,
    best_streak: 0,
    sort_order: Date.now(),
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  }).then(() => id);
}

export const setHabitStatus = (id: string, status: Habit['status']) =>
  updateDoc(udoc('habits', id), { status, updated_at: serverTimestamp() });

/** Deleting a habit keeps its past logs, so earlier scores stay as they were. */
export const deleteHabit = (id: string) => deleteDoc(udoc('habits', id));
