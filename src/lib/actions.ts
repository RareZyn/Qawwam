import { deleteDoc, getDocs, increment, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';
import { db, ucol, udoc } from './db';
import { nextFire } from './recurrence';
import type { Book, Recurrence, Reminder, ReminderModule, Settings, TodoGroup, TodoItem } from './types';
import { newId } from './util';
import { periods } from './habits';

type Op = (b: ReturnType<typeof writeBatch>) => void;

/** Firestore allows 500 writes per batch; send long lists in chunks. */
export async function commitInChunks(ops: Op[], size = 400) {
  for (let i = 0; i < ops.length; i += size) {
    const b = writeBatch(db);
    ops.slice(i, i + size).forEach((op) => op(b));
    await b.commit();
  }
}

// ---------------------------------------------------------------- to-do

export interface TodoInput {
  title: string;
  note: string | null;
  due_date: string | null;
  is_urgent: boolean;
  group_id: string;
}

export function saveTodo(input: TodoInput, existing?: TodoItem) {
  if (existing) return updateDoc(udoc('todo_items', existing.id), { ...input, updated_at: serverTimestamp() }).then(() => existing.id);
  const id = newId();
  return setDoc(udoc('todo_items', id), {
    ...input,
    status: 'open',
    completed_ms: null,
    created_ms: Date.now(),
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  }).then(() => id);
}

export const toggleTodo = (t: TodoItem) =>
  updateDoc(udoc('todo_items', t.id), {
    status: t.status === 'open' ? 'done' : 'open',
    completed_ms: t.status === 'open' ? Date.now() : null,
    updated_at: serverTimestamp(),
  });

export const deleteTodo = (id: string) => deleteDoc(udoc('todo_items', id));

export function saveTodoGroup(name: string, existing?: TodoGroup) {
  if (existing) return updateDoc(udoc('todo_groups', existing.id), { name }).then(() => existing.id);
  const id = newId();
  return setDoc(udoc('todo_groups', id), { name, sort_order: Date.now(), created_at: serverTimestamp() }).then(() => id);
}

/** Deleting a group also deletes the tasks inside it. */
export function deleteTodoGroup(id: string, todos: TodoItem[]) {
  return commitInChunks([
    (b) => b.delete(udoc('todo_groups', id)),
    ...todos.filter((t) => t.group_id === id).map<Op>((t) => (b) => b.delete(udoc('todo_items', t.id))),
  ]);
}

// ---------------------------------------------------------------- books

export interface BookInput {
  title: string;
  author: string | null;
  total_pages: number | null;
  show_on_home: boolean;
  status?: Book['status'];
}

export function saveBook(input: BookInput, books: Book[], today: string, existing?: Book) {
  const id = existing?.id ?? newId();
  const b = writeBatch(db);
  // Only one book sits in the Home widget.
  if (input.show_on_home) {
    for (const other of books) if (other.id !== id && other.show_on_home) b.update(udoc('books', other.id), { show_on_home: false });
  }
  if (existing) b.update(udoc('books', id), { ...input, updated_at: serverTimestamp() });
  else {
    b.set(udoc('books', id), {
      ...input,
      status: input.status ?? 'reading',
      current_page: 0,
      started_at: today,
      finished_at: null,
      created_ms: Date.now(),
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    });
  }
  return b.commit().then(() => id);
}

/** Move the bookmark. Each change is added to that day's reading log; reaching the last page finishes the book. */
export function setPage(book: Book, page: number, today: string) {
  const max = book.total_pages ?? Number.MAX_SAFE_INTEGER;
  const next = Math.max(0, Math.min(max, Math.round(page)));
  const delta = next - book.current_page;
  if (!delta) return Promise.resolve();
  const done = book.total_pages !== null && next >= book.total_pages;
  const b = writeBatch(db);
  b.update(udoc('books', book.id), {
    current_page: next,
    status: done ? 'finished' : book.status === 'finished' ? 'reading' : book.status,
    finished_at: done ? today : null,
    updated_at: serverTimestamp(),
  });
  b.set(
    udoc('reading_logs', `${book.id}_${today}`),
    { book_id: book.id, log_date: today, page: next, pages_read: increment(delta), updated_at: serverTimestamp() },
    { merge: true },
  );
  return b.commit();
}

export const deleteBook = (id: string) => deleteDoc(udoc('books', id));

// ---------------------------------------------------------------- reminders

export interface ReminderInput {
  module: ReminderModule;
  ref_id: string | null;
  title: string;
  body: string | null;
  recurrence: Recurrence;
  remind_days_before: number;
}

export function saveReminder(input: ReminderInput, existing?: Reminder, id: string = existing?.id ?? newId(), now = Date.now()) {
  return setDoc(
    udoc('reminders', id),
    {
      ...input,
      is_enabled: existing?.is_enabled ?? true,
      is_system: existing?.is_system ?? false,
      next_fire_at: nextFire(input.recurrence, now, input.remind_days_before),
      last_fired_at: existing?.last_fired_at ?? null,
      updated_at: serverTimestamp(),
    },
    { merge: true },
  ).then(() => id);
}

export const toggleReminder = (r: Reminder, now = Date.now()) =>
  updateDoc(udoc('reminders', r.id), {
    is_enabled: !r.is_enabled,
    next_fire_at: r.is_enabled ? r.next_fire_at : nextFire(r.recurrence, now, r.remind_days_before),
  });

export const deleteReminder = (id: string) => deleteDoc(udoc('reminders', id));

/** Which switch in Settings controls a reminder's module. Custom reminders are always on. */
export const moduleKey = (m: ReminderModule) => (m === 'money_group' || m === 'money_item' ? 'money' : m);

export function dueReminders(reminders: Reminder[], now: number, enabled: Record<string, boolean>) {
  return reminders.filter((r) => r.is_enabled && r.next_fire_at !== null && r.next_fire_at <= now && enabled[moduleKey(r.module)] !== false);
}

/**
 * Fire one reminder: add it to the notification list (unless the thing is already done) and schedule the next time.
 * The notification ID is built from the reminder and its fire time, so two open tabs cannot create it twice.
 */
export function fireReminder(r: Reminder, now: number, skipped: boolean) {
  const b = writeBatch(db);
  if (!skipped) {
    b.set(udoc('notifications', `${r.id}_${r.next_fire_at}`), {
      reminder_id: r.id,
      module: r.module,
      title: r.title,
      body: r.body,
      sent_at: now,
      read_at: null,
    });
  }
  b.update(udoc('reminders', r.id), { last_fired_at: now, next_fire_at: nextFire(r.recurrence, now, r.remind_days_before) });
  return b.commit();
}

/** Give an enabled reminder its first fire time when it has none yet. */
export function primeReminder(r: Reminder, now: number) {
  const next = nextFire(r.recurrence, now, r.remind_days_before);
  if (next === null) return Promise.resolve();
  return updateDoc(udoc('reminders', r.id), { next_fire_at: next });
}

export const markRead = (id: string) => updateDoc(udoc('notifications', id), { read_at: Date.now() });

/** Snooze: dismiss this notification and fire the same reminder again in an hour. */
export function snooze(notifId: string, reminderId: string, now = Date.now()) {
  const b = writeBatch(db);
  b.update(udoc('notifications', notifId), { read_at: now });
  b.update(udoc('reminders', reminderId), { next_fire_at: now + 3600_000, is_enabled: true });
  return b.commit();
}

// ---------------------------------------------------------------- settings and data

export const updateSettings = (patch: Partial<Settings>) => setDoc(udoc('settings', 'main'), { ...patch, updated_at: serverTimestamp() }, { merge: true });

export const COLLECTIONS = [
  'settings', 'habits', 'habit_logs', 'habit_score_summaries', 'wallets', 'wallet_snapshots', 'money_items', 'item_payments',
  'transactions', 'password_categories', 'password_entries', 'todo_groups', 'todo_items', 'books', 'reading_logs',
  'reminders', 'notifications',
];

/** Everything the user owns, as plain data, for the JSON export. Passwords stay encrypted. */
export async function exportAll() {
  const out: Record<string, unknown[]> = {};
  for (const name of COLLECTIONS) {
    const snap = await getDocs(ucol(name));
    out[name] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  return out;
}

/** Recalculate every day, week and month score from the habit logs. */
export async function rebuildSummaries() {
  const [logs, old] = await Promise.all([getDocs(ucol('habit_logs')), getDocs(ucol('habit_score_summaries'))]);
  const totals = new Map<string, { meta: Omit<ReturnType<typeof periods>[number], 'id'>; score: number; good: number; bad: number }>();
  for (const d of logs.docs) {
    const l = d.data() as { log_date: string; score: number; count: number; points: number };
    for (const { id, ...meta } of periods(l.log_date)) {
      const t = totals.get(id) ?? { meta, score: 0, good: 0, bad: 0 };
      t.score += l.score;
      if (l.points > 0) t.good += l.count;
      else t.bad += l.count;
      totals.set(id, t);
    }
  }
  const ops: Op[] = [];
  for (const d of old.docs) if (!totals.has(d.id)) ops.push((b) => b.delete(d.ref));
  for (const [id, t] of totals) {
    ops.push((b) => b.set(udoc('habit_score_summaries', id), { ...t.meta, score: t.score, good_count: t.good, bad_count: t.bad, updated_at: serverTimestamp() }));
  }
  await commitInChunks(ops);
  return totals.size;
}

const SAMPLE_COLLECTIONS = ['habits', 'habit_logs', 'habit_score_summaries', 'todo_groups', 'todo_items', 'books', 'reading_logs', 'reminders', 'password_entries'];

/** Delete the example data that was added on first login. Money data from the spreadsheet is real and is kept. */
export async function removeSampleData() {
  const ops: Op[] = [];
  for (const name of SAMPLE_COLLECTIONS) {
    const snap = await getDocs(query(ucol(name), where('sample', '==', true)));
    snap.docs.forEach((d) => ops.push((b) => b.delete(d.ref)));
  }
  await commitInChunks(ops);
  await rebuildSummaries();
  await updateSettings({ sample_removed_ms: Date.now() });
  return ops.length;
}
