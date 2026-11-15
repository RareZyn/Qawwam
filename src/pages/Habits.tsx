import { type FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { deleteReminder, saveReminder } from '../lib/actions';
import { useHabits, useLogs, useReminders, useSummaries } from '../lib/db';
import { type HabitInput, deleteHabit, dueToday, saveHabit, setHabitStatus } from '../lib/habits';
import type { Habit, Recurrence } from '../lib/types';
import { DOW, DOW_LONG, byId, fmtPoints } from '../lib/util';
import { Chips, ConfirmButton, Field, Panel, Seg, Toggle, run, useToday } from '../ui';
import { HabitRow } from './habitParts';

type Freq = 'daily' | 'days' | 'weekly' | 'monthly';

function freqOf(r: Recurrence): Freq {
  if (r.frequency === 'monthly') return 'monthly';
  if (r.frequency === 'weekly') return (r.days_of_week?.length ?? 0) === 1 ? 'weekly' : 'days';
  return 'daily';
}

function HabitForm({ habit, onDone }: { habit?: Habit; onDone: () => void }) {
  const today = useToday();
  const reminders = useReminders();
  const reminder = habit ? reminders?.find((r) => r.id === `habit_${habit.id}`) : undefined;
  const [name, setName] = useState(habit?.name ?? '');
  const [type, setType] = useState<'good' | 'bad'>(habit?.type ?? 'good');
  const [points, setPoints] = useState(Math.abs(habit?.points ?? 5));
  const [freq, setFreq] = useState<Freq>(habit ? freqOf(habit.recurrence) : 'daily');
  const [days, setDays] = useState<number[]>(habit?.recurrence.days_of_week ?? [1, 3, 5]);
  const [dom, setDom] = useState(habit?.recurrence.day_of_month ?? 1);
  const [streak, setStreak] = useState(habit?.track_streak ?? false);
  const [onHome, setOnHome] = useState(habit?.show_on_home ?? false);
  // null = not touched: show the saved reminder time, which may arrive after the form opens.
  const [timeEdit, setTime] = useState<string | null>(null);
  const time = timeEdit ?? reminder?.recurrence.time ?? '';
  const [note, setNote] = useState(habit?.note ?? '');

  const recurrence: Recurrence = streak
    ? { frequency: 'daily', interval: 1 }
    : freq === 'daily'
      ? { frequency: 'daily', interval: 1 }
      : freq === 'monthly'
        ? { frequency: 'monthly', interval: 1, day_of_month: dom }
        : { frequency: 'weekly', interval: 1, days_of_week: freq === 'weekly' ? days.slice(0, 1) : days };
  const valid = name.trim().length > 0 && points > 0 && (freq !== 'days' || days.length > 0 || streak);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    const input: HabitInput = {
      name: name.trim(),
      type,
      points,
      note: note.trim() || null,
      recurrence,
      track_streak: type === 'bad' && streak,
      show_on_home: type === 'bad' && streak && onHome,
    };
    const id = await saveHabit(input, habit, today);
    if (time) {
      await saveReminder(
        { module: 'habit', ref_id: id, title: input.name, body: type === 'good' ? 'Time to log it.' : 'Stay on track today.', recurrence: { ...recurrence, time }, remind_days_before: 0 },
        reminder,
        `habit_${id}`,
      );
    } else if (reminder) await deleteReminder(reminder.id);
    onDone();
  }

  return (
    <form id="habit-form" className="col loose" onSubmit={(e) => run(save(e))}>
      <Field label="Habit name">
        <input className="input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Walk 8,000 steps" />
      </Field>
      <div className="col tight">
        <span className="small muted">Type</span>
        <div className="two">
          <button type="button" className={`btn lg${type === 'good' ? ' primary' : ''}`} aria-pressed={type === 'good'} onClick={() => setType('good')}>
            Good · adds points
          </button>
          <button type="button" className={`btn lg${type === 'bad' ? ' danger solid' : ''}`} aria-pressed={type === 'bad'} onClick={() => setType('bad')}>
            Bad · removes points
          </button>
        </div>
      </div>
      <div className="col tight">
        <span className="small muted">{type === 'bad' && streak ? 'Points lost per slip' : 'Points per time'}</span>
        <div className="stepper">
          <button type="button" className="sq" aria-label="Fewer points" onClick={() => setPoints((p) => Math.max(1, p - 1))}>
            −
          </button>
          <div className={`val ${type === 'good' ? 'blue' : 'red'}`} aria-live="polite">
            {fmtPoints(type === 'good' ? points : -points)}
          </div>
          <button type="button" className="sq" aria-label="More points" onClick={() => setPoints((p) => Math.min(100, p + 1))}>
            +
          </button>
        </div>
      </div>
      {type === 'bad' && (
        <div className="col tight">
          <div className="row between">
            <span className="grow">Track as a streak (days clean in a row)</span>
            <Toggle checked={streak} onChange={setStreak} label="Track as a streak" />
          </div>
          {streak && (
            <div className="row between">
              <span className="grow">Show the streak card on Home</span>
              <Toggle checked={onHome} onChange={setOnHome} label="Show on Home" />
            </div>
          )}
        </div>
      )}
      {!streak && (
        <div className="col">
          <span className="small muted">Repeats</span>
          <Chips options={[['daily', 'Daily'], ['days', 'Certain days'], ['weekly', 'Weekly'], ['monthly', 'Monthly']]} value={freq} onChange={setFreq} label="Repeats" />
          {(freq === 'days' || freq === 'weekly') && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 6 }}>
              {DOW.map((d, i) => {
                const on = days.includes(i);
                return (
                  <button
                    key={d}
                    type="button"
                    aria-label={DOW_LONG[i]}
                    aria-pressed={on}
                    className={`chip sq${on ? ' on' : ''}`}
                    onClick={() => setDays(freq === 'weekly' ? [i] : on ? days.filter((x) => x !== i) : [...days, i].sort())}
                  >
                    {d[0]}
                  </button>
                );
              })}
            </div>
          )}
          {freq === 'monthly' && (
            <Field label="Day of month">
              <input className="input num" type="number" min={1} max={31} value={dom} onChange={(e) => setDom(Math.max(1, Math.min(31, Number(e.target.value) || 1)))} />
            </Field>
          )}
        </div>
      )}
      <Field label="Reminder time (leave empty for none)">
        <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
      </Field>
      <Field label="Note (optional)">
        <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this habit matters" />
      </Field>
      {habit && (
        <div className="row wrap">
          {habit.status === 'active' ? (
            <button type="button" className="btn sm" onClick={() => run(setHabitStatus(habit.id, 'paused').then(onDone), 'Habit paused')}>
              Pause
            </button>
          ) : (
            <button type="button" className="btn sm" onClick={() => run(setHabitStatus(habit.id, 'active').then(onDone), 'Habit active again')}>
              Make active
            </button>
          )}
          {habit.status !== 'archived' && (
            <button type="button" className="btn sm" onClick={() => run(setHabitStatus(habit.id, 'archived').then(onDone), 'Habit archived')}>
              Archive
            </button>
          )}
          <ConfirmButton label="Delete" confirm="Delete for good?" onConfirm={() => run(deleteHabit(habit.id).then(onDone), 'Habit deleted. Past scores are kept.')} />
        </div>
      )}
    </form>
  );
}

export default function Habits() {
  const today = useToday();
  const habits = useHabits();
  const logList = useLogs();
  const summaries = useSummaries();
  const logs = byId(logList);
  const [tab, setTab] = useState<'today' | 'all' | 'archived'>('today');
  const [editing, setEditing] = useState<Habit | undefined>();
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);

  const list = (habits ?? [])
    .filter((h) => (tab === 'archived' ? h.status === 'archived' : tab === 'all' ? h.status !== 'archived' : h.track_streak ? h.status === 'active' : dueToday(h, today)))
    .sort((a, b) => a.sort_order - b.sort_order);
  const good = list.filter((h) => h.type === 'good');
  const bad = list.filter((h) => h.type === 'bad');
  const todayScore = summaries?.find((s) => s.id === `day_${today}`)?.score ?? 0;

  const edit = (h?: Habit) => {
    setEditing(h);
    setFormKey((k) => k + 1);
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    setEditing(undefined);
    setFormKey((k) => k + 1);
  };

  return (
    <div className="page">
      <header className="head">
        <div className="col tight">
          <h1>Habits</h1>
          <span className="small muted only-desktop">
            Today's score <strong className="blue">{fmtPoints(todayScore)}</strong> · {(habits ?? []).filter((h) => h.status === 'active').length} active habits
          </span>
        </div>
        <div className="row">
          <Link to="/habits/dashboard" className="btn">
            Dashboard
          </Link>
          <button type="button" className="btn primary icon only-mobile" aria-label="Add habit" onClick={() => edit()}>
            +
          </button>
        </div>
      </header>

      <div className="split">
        <div className="wide col loose">
          <Seg options={[['today', 'Today'], ['all', 'All'], ['archived', 'Archived']]} value={tab} onChange={setTab} label="Which habits" />
          <div className="item only-mobile" style={{ justifyContent: 'space-between' }}>
            <span className="small muted">Today's score</span>
            <span className="big md blue">{fmtPoints(todayScore)}</span>
          </div>
          {!habits ? (
            <p className="dim small">Loading…</p>
          ) : !list.length ? (
            <p className="dim small">{tab === 'archived' ? 'No archived habits.' : 'No habits here yet. Add one to start scoring.'}</p>
          ) : (
            <>
              {good.length > 0 && (
                <section className="col" aria-label="Good habits">
                  <h2 className="eyebrow blue">Good habits</h2>
                  {good.map((h) => (
                    <HabitRow key={h.id} habit={h} logs={logs} today={today} onEdit={edit} />
                  ))}
                </section>
              )}
              {bad.length > 0 && (
                <section className="col" aria-label="Bad habits">
                  <h2 className="eyebrow red">Bad habits</h2>
                  {bad.map((h) => (
                    <HabitRow key={h.id} habit={h} logs={logs} today={today} onEdit={edit} />
                  ))}
                </section>
              )}
            </>
          )}
          <p className="tiny dim center">Tap a habit's name to edit, pause, archive or delete it.</p>
        </div>

        <div className="side">
          <Panel open={open} onClose={close} title={editing ? 'Edit habit' : 'Add habit'} formId="habit-form">
            <HabitForm key={formKey} habit={editing} onDone={close} />
          </Panel>
        </div>
      </div>
    </div>
  );
}
