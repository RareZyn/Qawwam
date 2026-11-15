import { type FormEvent, useState, useSyncExternalStore } from 'react';
import { type ReminderInput, deleteReminder, markRead, saveReminder, snooze, toggleReminder } from '../lib/actions';
import { useBooks, useHabits, useItems, useNotifs, useReminders, useTodos } from '../lib/db';
import { describe } from '../lib/recurrence';
import type { Frequency, Reminder, ReminderModule } from '../lib/types';
import { DOW, DOW_LONG, fmtDay } from '../lib/util';
import { Chips, ConfirmButton, Field, Panel, Seg, Sheet, Toggle, run, toast, useToday } from '../ui';

const MODULE_LABEL: Record<ReminderModule, string> = { habit: 'Habit', money_group: 'Money', money_item: 'Money', todo: 'To-Do', book: 'Book', custom: 'Custom' };

// ---------------------------------------------------------------- browser notification permission

const permSubs = new Set<() => void>();
const permission = () => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
export function usePermission() {
  return useSyncExternalStore(
    (cb) => {
      permSubs.add(cb);
      return () => permSubs.delete(cb);
    },
    permission,
  );
}
export async function askPermission() {
  if (typeof Notification === 'undefined') return toast('This browser cannot show notifications. On iPhone, add Qawwam to the Home Screen first.', true);
  await Notification.requestPermission();
  permSubs.forEach((f) => f());
}

export function PermissionNote() {
  const p = usePermission();
  if (p === 'granted') {
    return (
      <div className="note">
        <span className="dot" />
        <span className="grow">Notifications are allowed on this device. They show while Qawwam is open or running in the background.</span>
      </div>
    );
  }
  return (
    <div className="alert">
      <span className="grow">
        {p === 'denied'
          ? 'Notifications are blocked for this site. Allow them in your browser settings.'
          : p === 'unsupported'
            ? 'This browser cannot show notifications. On iPhone, add Qawwam to the Home Screen first.'
            : 'Allow notifications so reminders can pop up.'}
      </span>
      {p === 'default' && (
        <button type="button" className="btn sm primary" onClick={() => run(askPermission())}>
          Allow
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- form

type F = Frequency | 'days';

function ReminderForm({ formId, reminder, onDone }: { formId: string; reminder?: Reminder; onDone: () => void }) {
  const today = useToday();
  const habits = useHabits();
  const items = useItems();
  const todos = useTodos();
  const books = useBooks();
  const r = reminder?.recurrence;
  const [title, setTitle] = useState(reminder?.title ?? '');
  const [body, setBody] = useState(reminder?.body ?? '');
  const [module, setModule] = useState<ReminderModule>(reminder?.module ?? 'custom');
  const [ref, setRef] = useState(reminder?.ref_id ?? '');
  const [freq, setFreq] = useState<F>(r ? (r.frequency === 'weekly' && (r.days_of_week?.length ?? 0) > 1 ? 'days' : r.frequency) : 'daily');
  const [days, setDays] = useState<number[]>(r?.days_of_week ?? [1]);
  const [dom, setDom] = useState(r?.day_of_month ?? 1);
  const [date, setDate] = useState(r?.date ?? today);
  const [time, setTime] = useState(r?.time ?? '09:00');
  const [before, setBefore] = useState(reminder?.remind_days_before ?? 0);

  const refs: [string, string][] =
    module === 'habit'
      ? (habits ?? []).filter((h) => h.status === 'active').map((h) => [h.id, h.name])
      : module === 'money_item'
        ? (items ?? []).filter((i) => i.status === 'active' && i.group_id !== 'spent_cash').map((i) => [i.id, i.name])
        : module === 'todo'
          ? (todos ?? []).filter((t) => t.status === 'open').map((t) => [t.id, t.title])
          : module === 'book'
            ? (books ?? []).map((b) => [b.id, b.title])
            : module === 'money_group'
              ? [['savings_investment', 'Savings & Investment'], ['subscription_fixed', 'Subscription & Fixed']]
              : [];

  async function save(e: FormEvent) {
    e.preventDefault();
    const name = title.trim() || refs.find(([id]) => id === ref)?.[1] || '';
    if (!name) return toast('Give the reminder a title', true);
    if ((freq === 'days' || freq === 'weekly') && !days.length) return toast('Pick at least one day', true);
    const input: ReminderInput = {
      module,
      ref_id: module === 'custom' ? null : ref || null,
      title: name,
      body: body.trim() || null,
      recurrence:
        freq === 'once'
          ? { frequency: 'once', interval: 1, date, time }
          : freq === 'daily'
            ? { frequency: 'daily', interval: 1, time }
            : freq === 'monthly'
              ? { frequency: 'monthly', interval: 1, day_of_month: dom, time }
              : { frequency: 'weekly', interval: 1, days_of_week: freq === 'weekly' ? days.slice(0, 1) : days, time },
      remind_days_before: before,
    };
    await saveReminder(input, reminder);
    onDone();
  }

  return (
    <form id={formId} className="col loose" onSubmit={(e) => run(save(e))}>
      <Field label="Title">
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Pay Canva" />
      </Field>
      <div className="two">
        <Field label="Module">
          <select
            className="input"
            value={module}
            onChange={(e) => {
              setModule(e.target.value as ReminderModule);
              setRef('');
            }}
          >
            <option value="custom">Custom</option>
            <option value="habit">Habit</option>
            <option value="money_item">Money item</option>
            <option value="money_group">Money group</option>
            <option value="todo">To-Do</option>
            <option value="book">Book</option>
          </select>
        </Field>
        <Field label="Linked to">
          <select className="input" value={ref} disabled={module === 'custom'} onChange={(e) => setRef(e.target.value)}>
            <option value="">{module === 'custom' ? 'Nothing' : 'Choose…'}</option>
            {refs.map(([id, n]) => (
              <option key={id} value={id}>
                {n}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="col tight">
        <span className="small muted">Repeats</span>
        <Chips options={[['once', 'Once'], ['daily', 'Daily'], ['days', 'Certain days'], ['weekly', 'Weekly'], ['monthly', 'Monthly']]} value={freq} onChange={setFreq} label="Repeats" />
      </div>
      {(freq === 'days' || freq === 'weekly') && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 6 }}>
          {DOW.map((d, i) => {
            const on = days.includes(i);
            return (
              <button key={d} type="button" aria-label={DOW_LONG[i]} aria-pressed={on} className={`chip sq${on ? ' on' : ''}`} onClick={() => setDays(freq === 'weekly' ? [i] : on ? days.filter((x) => x !== i) : [...days, i].sort())}>
                {d[0]}
              </button>
            );
          })}
        </div>
      )}
      <div className="two">
        {freq === 'once' && (
          <Field label="Date">
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value || today)} />
          </Field>
        )}
        {freq === 'monthly' && (
          <Field label="Day of month">
            <input className="input num" type="number" min={1} max={31} value={dom} onChange={(e) => setDom(Math.max(1, Math.min(31, Number(e.target.value) || 1)))} />
          </Field>
        )}
        <Field label="Time">
          <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value || '09:00')} />
        </Field>
        {freq !== 'daily' && (
          <Field label="Send">
            <select className="input" value={before} onChange={(e) => setBefore(Number(e.target.value))}>
              {[0, 1, 2, 3, 7].map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? 'On the day' : `${n} day${n > 1 ? 's' : ''} before`}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
      <Field label="Message (optional)">
        <input className="input" value={body} onChange={(e) => setBody(e.target.value)} />
      </Field>
      {reminder && !reminder.is_system && <ConfirmButton label="Delete reminder" confirm="Tap again to delete" onConfirm={() => run(deleteReminder(reminder.id).then(onDone), 'Reminder deleted')} />}
    </form>
  );
}

const fmtWhen = (r: Reminder) => {
  const bits = [describe(r.recurrence), r.recurrence.time ?? '09:00'];
  if (r.remind_days_before) bits.push(`${r.remind_days_before} day${r.remind_days_before > 1 ? 's' : ''} before`);
  if (r.is_system) bits.push('default');
  return bits.join(' · ');
};

const fmtTime = (ms: number, today: string) => {
  const d = new Date(ms);
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const hm = d.toLocaleTimeString('en-MY', { hour: 'numeric', minute: '2-digit' });
  return day === today ? hm : `${fmtDay(day)}, ${hm}`;
};

export default function Reminders() {
  const today = useToday();
  const reminders = useReminders();
  const notifs = useNotifs();
  const unread = (notifs ?? []).filter((n) => !n.read_at);
  const [tab, setTab] = useState<'list' | 'recent'>('list');
  const [adding, setAdding] = useState(false);
  const [addKey, setAddKey] = useState(0);
  const [editing, setEditing] = useState<Reminder | null>(null);
  const list = (reminders ?? []).slice().sort((a, b) => Number(b.is_system) - Number(a.is_system) || (a.next_fire_at ?? Infinity) - (b.next_fire_at ?? Infinity));

  return (
    <div className="page">
      <header className="head">
        <h1>Reminders</h1>
        <button type="button" className="btn primary only-mobile" onClick={() => setAdding(true)}>
          + New
        </button>
      </header>
      <PermissionNote />

      <div className="split">
        <div className="wide col">
          <Seg options={[['list', 'Scheduled'], ['recent', `Recent${unread.length ? ` · ${unread.length} new` : ''}`]]} value={tab} onChange={setTab} label="Show" />
          {tab === 'list' ? (
            !reminders ? (
              <p className="dim small">Loading…</p>
            ) : (
              list.map((r) => (
                <div key={r.id} className="item">
                  <span className="tag">{MODULE_LABEL[r.module]}</span>
                  <button type="button" className="grow col tight link" style={{ color: 'var(--text)', textAlign: 'left', fontSize: 15 }} onClick={() => setEditing(r)}>
                    <span>{r.title}</span>
                    <span className="tiny dim">
                      {fmtWhen(r)}
                      {r.is_enabled && r.next_fire_at ? ` · next ${fmtTime(r.next_fire_at, today)}` : ''}
                    </span>
                  </button>
                  <Toggle checked={r.is_enabled} onChange={() => run(toggleReminder(r))} label={`${r.title} on or off`} />
                </div>
              ))
            )
          ) : !notifs?.length ? (
            <p className="dim small">Nothing yet. Reminders that go off show up here.</p>
          ) : (
            notifs.map((n) => (
              <div key={n.id} className={`card${n.read_at ? '' : ' blue-line'}`} style={{ gap: 6, padding: 14 }}>
                <div className="row between base">
                  <strong className="small">{n.title}</strong>
                  <span className="tiny dim">{fmtTime(n.sent_at, today)}</span>
                </div>
                {n.body && <span className="small muted">{n.body}</span>}
                {!n.read_at && (
                  <div className="row">
                    <button type="button" className="btn sm" onClick={() => run(snooze(n.id, n.reminder_id), 'Snoozed for 1 hour')}>
                      Snooze 1h
                    </button>
                    <button type="button" className="btn sm" onClick={() => run(markRead(n.id))}>
                      Dismiss
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
        <div className="side">
          <Panel open={adding} onClose={() => setAdding(false)} title="New reminder" formId="reminder-form">
            <ReminderForm
              key={addKey}
              formId="reminder-form"
              onDone={() => {
                setAdding(false);
                setAddKey((k) => k + 1);
              }}
            />
          </Panel>
        </div>
      </div>

      <Sheet open={!!editing} onClose={() => setEditing(null)} title="Edit reminder" formId="reminder-form-edit">
        {editing && <ReminderForm key={editing.id} formId="reminder-form-edit" reminder={editing} onDone={() => setEditing(null)} />}
      </Sheet>
    </div>
  );
}
