import { useState } from 'react';
import { Link } from 'react-router-dom';
import { addBad, checkInClean, cleanDays, cleanStreak, goodStreak, logId, milestone, setLog, slip, toggleGood, undoSlip } from '../lib/habits';
import { describe } from '../lib/recurrence';
import type { Habit, HabitLog } from '../lib/types';
import { addDays, diffDays, fmtDay, fmtPoints } from '../lib/util';
import { Bar, run } from '../ui';

/** One line under the habit name: how often, and the current streak. */
export function habitMeta(h: Habit, logs: Record<string, HabitLog>, today: string) {
  const rec = h.track_streak ? 'Daily · streak' : describe(h.recurrence);
  if (h.type === 'good') {
    const n = goodStreak(h, logs, today);
    return `${rec} · ${n ? `${n} in a row` : 'no streak'}`;
  }
  if (h.track_streak) return `${rec} · clean ${cleanStreak(h, logs, today)} days · best ${h.best_streak}`;
  return `${rec} · clean ${cleanDays(h, logs, today)} days`;
}

/** The action button(s) at the end of a habit row. */
export function HabitAction({ habit, logs, today }: { habit: Habit; logs: Record<string, HabitLog>; today: string }) {
  const log = logs[logId(habit.id, today)];
  const count = log?.count ?? 0;

  if (habit.type === 'good') {
    const done = count > 0;
    return (
      <button type="button" className={`btn sm${done ? ' soft' : ''}`} style={{ minWidth: 70 }} aria-pressed={done} onClick={() => run(toggleGood(habit, logs, today, today))}>
        {done ? 'Done' : 'Log'}
      </button>
    );
  }

  if (habit.track_streak) {
    if (log && count > 0) {
      return (
        <button type="button" className="btn sm" style={{ background: 'var(--red-bg)', color: 'var(--red-text)', borderColor: 'var(--red-bg)' }} onClick={() => run(undoSlip(habit, log, today))}>
          Slipped · undo
        </button>
      );
    }
    if (log) {
      return (
        <button type="button" className="btn sm soft" onClick={() => run(setLog(habit, log, today, null))}>
          Clean ✓
        </button>
      );
    }
    return (
      <button type="button" className="btn sm" onClick={() => run(checkInClean(habit, log, today))}>
        Check in
      </button>
    );
  }

  if (count > 0) {
    return (
      <div className="row" style={{ gap: 6 }}>
        <button type="button" className="btn sm icon" aria-label={`Take back one ${habit.name}`} onClick={() => run(addBad(habit, log, today, -1))}>
          −
        </button>
        <button type="button" className="btn sm" style={{ background: 'var(--red-bg)', color: 'var(--red-text)', borderColor: 'var(--red-bg)' }} onClick={() => run(addBad(habit, log, today, 1))}>
          ×{count} · +1
        </button>
      </div>
    );
  }
  return (
    <button type="button" className="btn sm" onClick={() => run(addBad(habit, log, today, 1))}>
      It happened
    </button>
  );
}

export function HabitRow({ habit, logs, today, onEdit, compact }: { habit: Habit; logs: Record<string, HabitLog>; today: string; onEdit?: (h: Habit) => void; compact?: boolean }) {
  const good = habit.type === 'good';
  return (
    <div className="item">
      <span className={`dot${good ? '' : ' red'}`} />
      <div className="grow col tight">
        {onEdit ? (
          <button type="button" className="link" style={{ color: 'var(--text)', fontSize: 15, textAlign: 'left' }} onClick={() => onEdit(habit)}>
            {habit.name}
          </button>
        ) : (
          <span style={{ fontSize: 15 }}>{habit.name}</span>
        )}
        {!compact && <span className="tiny dim">{habitMeta(habit, logs, today)}</span>}
      </div>
      <span className={`mono small ${good ? 'blue' : 'red'}`}>{fmtPoints(habit.points)}</span>
      <HabitAction habit={habit} logs={logs} today={today} />
    </div>
  );
}

/** The Home card for a bad habit tracked as a streak (e.g. "Clean streak"). */
export function StreakCard({ habit, logs, today, habitsHref = '/habits' }: { habit: Habit; logs: Record<string, HabitLog>; today: string; habitsHref?: string }) {
  const [confirm, setConfirm] = useState(false);
  const todayLog = logs[logId(habit.id, today)];
  const slipped = !!todayLog && todayLog.count > 0;
  const checked = !!todayLog && todayLog.count === 0;
  const streak = cleanStreak(habit, logs, today);
  const best = Math.max(habit.best_streak ?? 0, streak);
  const m = milestone(streak);
  const since = habit.streak_start ?? habit.start_date;

  // Last 28 days, oldest first: red for a slip, blue for a clean day, grey before tracking began, dashed for today.
  const cells = Array.from({ length: 28 }, (_, i) => {
    const d = addDays(today, i - 27);
    const log = logs[logId(habit.id, d)];
    if (log && log.count > 0) return 'slip';
    if (d === today) return log ? '' : 'open';
    return d < habit.start_date ? 'none' : '';
  });

  return (
    <section className="card" aria-label={habit.name}>
      <div className="row between top">
        <div className="col tight">
          <span className="eyebrow blue">{habit.name}</span>
          <span className="tiny red">
            Bad habit · {fmtPoints(habit.points)} per slip
          </span>
        </div>
        <Link to={habitsHref} className="small">
          In Habits
        </Link>
      </div>
      <div className="row between" style={{ alignItems: 'flex-end' }}>
        <div className="col tight">
          <span className="big xl">
            {streak}
            <span style={{ fontSize: 16, fontWeight: 500, color: 'var(--muted)' }}> {streak === 1 ? 'day' : 'days'}</span>
          </span>
          <span className="tiny dim">{slipped ? 'Reset today' : diffDays(since, today) >= 0 ? `Clean since ${fmtDay(since)}` : 'Day 1 starts tomorrow'}</span>
        </div>
        <div className="col tight right">
          <span className="tiny dim">Best</span>
          <span className="mono">{best} days</span>
        </div>
      </div>
      <div className="col tight">
        <Bar pct={m.pct} />
        <span className="tiny muted">
          {m.left} {m.left === 1 ? 'day' : 'days'} to the {m.next}-day milestone
        </span>
      </div>
      <div className="strip" role="img" aria-label="Last 28 days. Blue is a clean day, red is a slip, the outlined square is today.">
        {cells.map((c, i) => (
          <i key={i} className={c} />
        ))}
      </div>
      {slipped ? (
        <div className="note">
          <span className="grow">Logged. Day 1 starts tomorrow. Your best of {best} days is still there to beat.</span>
          <button type="button" className="btn sm" style={{ borderColor: 'var(--blue-line)', color: 'var(--blue)' }} onClick={() => run(undoSlip(habit, todayLog, today))}>
            Undo
          </button>
        </div>
      ) : confirm ? (
        <div className="alert" style={{ flexDirection: 'column' }}>
          <span style={{ fontSize: 14 }}>
            Reset your streak to 0 and log {fmtPoints(habit.points)} points? Your best of {best} days stays.
          </span>
          <div className="two" style={{ width: '100%' }}>
            <button
              type="button"
              className="btn danger solid"
              onClick={() => {
                setConfirm(false);
                run(slip(habit, todayLog, today, streak));
              }}
            >
              Reset streak
            </button>
            <button type="button" className="btn" onClick={() => setConfirm(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8 }}>
          <button
            type="button"
            className={`btn${checked ? ' soft' : ' primary'}`}
            onClick={() => run(checked ? setLog(habit, todayLog, today, null) : checkInClean(habit, todayLog, today))}
          >
            {checked ? 'Clean today, checked in' : 'Check in: clean today'}
          </button>
          <button type="button" className="btn danger" onClick={() => setConfirm(true)}>
            I slipped
          </button>
        </div>
      )}
    </section>
  );
}
