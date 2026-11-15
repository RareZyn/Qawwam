/**
 * Runs the app's own data code against the Firestore + Auth emulators:
 * first-login seed, money transactions, habit scores, books, to-dos, reminders, examples clean-up.
 */
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { getCountFromServer, getDoc, getDocs, query, where } from 'firebase/firestore';
import { beforeAll, describe, expect, it } from 'vitest';
import { exportAll, fireReminder, rebuildSummaries, removeSampleData, saveTodo, setPage, toggleTodo } from '../../src/lib/actions';
import { setUid, ucol, udoc } from '../../src/lib/db';
import { auth } from '../../src/lib/firebase';
import { checkInClean, cleanStreak, logId, saveHabit, setLog, slip, toggleGood, undoSlip } from '../../src/lib/habits';
import { addTxn, adjustWallet, categoriseTxn, editTxn, removeTxn, saveItem, setPaid } from '../../src/lib/money';
import { buildSeed, ensureSeed } from '../../src/lib/seed';
import type { Book, Habit, HabitLog, ItemPayment, MoneyItem, Reminder, Summary, TodoItem, Txn, Wallet } from '../../src/lib/types';
import { byId, todayStr } from '../../src/lib/util';

const TODAY = todayStr();
const MONTH = TODAY.slice(0, 7);

async function get<T>(col: string, id: string) {
  const s = await getDoc(udoc(col, id));
  return (s.exists() ? { id: s.id, ...s.data() } : undefined) as T;
}
async function all<T>(col: string) {
  const s = await getDocs(ucol(col));
  return s.docs.map((d) => ({ id: d.id, ...d.data() }) as T);
}
const count = async (col: string) => (await getCountFromServer(ucol(col))).data().count;
const balance = async (id: string) => (await get<Wallet>('wallets', id)).balance;

beforeAll(async () => {
  const cred = await createUserWithEmailAndPassword(auth, `razin-${Date.now()}@example.com`, 'test-password-1');
  setUid(cred.user.uid);
});

describe('first login', () => {
  it('writes every seed document exactly once, even if it runs twice', async () => {
    const user = { uid: auth.currentUser!.uid, displayName: 'Razin', email: auth.currentUser!.email, photoURL: null, providerId: 'password' };
    expect(await ensureSeed(user, TODAY)).toBe(true);
    expect(await ensureSeed(user, TODAY)).toBe(false);
    const expected = buildSeed(TODAY).docs;
    const per = (c: string) => expected.filter((d) => d.col === c).length;
    for (const c of ['wallets', 'money_items', 'item_payments', 'wallet_snapshots', 'habits', 'habit_logs', 'habit_score_summaries', 'todo_items', 'books', 'reminders', 'password_categories']) {
      expect(await count(c), c).toBe(per(c));
    }
    const settings = await get<{ seed_version: number; monthly_income: number }>('settings', 'main');
    expect(settings.seed_version).toBe(1);
    expect(settings.monthly_income).toBe(380000);
  });
});

describe('money', () => {
  it('records a quick spend and moves the wallet balance in the same write', async () => {
    const before = await balance('w_cash');
    const id = await addTxn({ wallet_id: 'w_cash', amount: -1250, source: 'quick', txn_date: TODAY });
    expect(await balance('w_cash')).toBe(before - 1250);
    const t = await get<Txn>('transactions', id);
    await categoriseTxn(t, await get<MoneyItem>('money_items', 'i_makanan_beli'));
    expect(await get<Txn>('transactions', id)).toMatchObject({ group_id: 'spent_cash', item_id: 'i_makanan_beli', amount: -1250 });
    await editTxn(await get<Txn>('transactions', id), { amount: -2000 });
    expect(await balance('w_cash')).toBe(before - 2000);
    await removeTxn(await get<Txn>('transactions', id));
    expect(await balance('w_cash')).toBe(before);
  });

  it('ticks a savings item into its wallet and reverses it on untick', async () => {
    const item = await get<MoneyItem>('money_items', 'i_simpanan_kahwin');
    const month = '2026-12';
    const before = await balance('w_kahwin');
    await setPaid(item, month, true, undefined, 'w_cash', TODAY);
    expect(await balance('w_kahwin')).toBe(before + 120000);
    const p = await get<ItemPayment>('item_payments', `i_simpanan_kahwin_${month}`);
    expect(p).toMatchObject({ is_paid: true, txn_amount: 120000, wallet_id: 'w_kahwin' });
    await setPaid(item, month, false, p, 'w_cash', TODAY);
    expect(await balance('w_kahwin')).toBe(before);
    expect(await get<Txn>('transactions', p.transaction_id!)).toBeUndefined();
  });

  it('pays a bill out of its wallet and allocates a cash budget into the pool', async () => {
    const rent = { ...(await get<MoneyItem>('money_items', 'i_rumah_sewa')), wallet_id: 'w_kecemasan' };
    const before = await balance('w_kecemasan');
    await setPaid(rent, '2026-12', true, undefined, 'w_cash', TODAY);
    expect(await balance('w_kecemasan')).toBe(before - 36000);
    const food = await get<MoneyItem>('money_items', 'i_makanan_beli');
    const cash = await balance('w_cash');
    await setPaid(food, MONTH, true, await get<ItemPayment>('item_payments', `i_makanan_beli_${MONTH}`), 'w_cash', TODAY);
    expect(await balance('w_cash')).toBe(cash + 40000);
  });

  it('does not touch balances for ticks imported from the spreadsheet', async () => {
    const p = await get<ItemPayment>('item_payments', 'i_simpanan_kahwin_2026-11');
    expect(p).toMatchObject({ is_paid: true, transaction_id: null });
    const before = await balance('w_kahwin');
    await setPaid(await get<MoneyItem>('money_items', 'i_simpanan_kahwin'), '2026-11', false, p, 'w_cash', TODAY);
    expect(await balance('w_kahwin')).toBe(before);
  });

  it('records a balance adjustment so history adds up', async () => {
    const w = await get<Wallet>('wallets', 'w_cash');
    await adjustWallet(w, 61240, TODAY);
    expect(await balance('w_cash')).toBe(61240);
    const adj = (await all<Txn>('transactions')).filter((t) => t.source === 'adjustment');
    expect(adj.at(-1)?.amount).toBe(61240 - w.balance);
  });

  it('gives a subscription with a due day its own reminder', async () => {
    const id = await saveItem({ group_id: 'subscription_fixed', name: 'Netflix', amount: 1700, wallet_id: null, due_day: 12, remind_days_before: 1 });
    const r = await get<Reminder>('reminders', `item_${id}`);
    expect(r.recurrence).toMatchObject({ frequency: 'monthly', day_of_month: 12 });
    expect(r.remind_days_before).toBe(1);
  });
});

describe('habits', () => {
  it('keeps the day, week and month scores in step with the logs', async () => {
    const id = await saveHabit({ name: 'Stretch', type: 'good', points: 7, note: null, recurrence: { frequency: 'daily', interval: 1 }, track_streak: false, show_on_home: false }, undefined, TODAY);
    const h = await get<Habit>('habits', id);
    const dayBefore = (await get<Summary>('habit_score_summaries', `day_${TODAY}`))?.score ?? 0;
    await toggleGood(h, {}, TODAY, TODAY);
    expect((await get<Summary>('habit_score_summaries', `day_${TODAY}`)).score).toBe(dayBefore + 7);
    const log = await get<HabitLog>('habit_logs', logId(id, TODAY));
    await toggleGood(h, { [log.id]: log }, TODAY, TODAY);
    expect((await get<Summary>('habit_score_summaries', `day_${TODAY}`)).score).toBe(dayBefore);
  });

  it('handles the clean streak: check in, slip with −10 and best kept, undo', async () => {
    const h = await get<Habit>('habits', 'h_clean');
    const logs = () => all<HabitLog>('habit_logs').then(byId);
    expect(cleanStreak(h, await logs(), TODAY)).toBe(23);
    await checkInClean(h, undefined, TODAY);
    expect(cleanStreak(h, await logs(), TODAY)).toBe(24);
    const checked = await get<HabitLog>('habit_logs', logId('h_clean', TODAY));
    const day = (await get<Summary>('habit_score_summaries', `day_${TODAY}`))?.score ?? 0;
    await slip(h, checked, TODAY, 24);
    const after = await get<Habit>('habits', 'h_clean');
    expect(cleanStreak(after, await logs(), TODAY)).toBe(0);
    expect(after.best_streak).toBe(41);
    expect((await get<Summary>('habit_score_summaries', `day_${TODAY}`)).score).toBe(day - 10);
    await undoSlip(after, await get<HabitLog>('habit_logs', logId('h_clean', TODAY)), TODAY);
    expect(cleanStreak(await get<Habit>('habits', 'h_clean'), await logs(), TODAY)).toBe(23);
    await setLog(h, undefined, TODAY, null);
  });

  it('rebuilds the same totals from the logs', async () => {
    const before = byId(await all<Summary>('habit_score_summaries'));
    await rebuildSummaries();
    const after = byId(await all<Summary>('habit_score_summaries'));
    for (const [id, s] of Object.entries(after)) expect(s.score, id).toBe(before[id]?.score ?? 0);
  });
});

describe('books, to-dos and reminders', () => {
  it('moves the bookmark and logs the pages read today', async () => {
    const b = await get<Book>('books', 'b_atomic');
    await setPage(b, 152, TODAY);
    expect((await get<Book>('books', 'b_atomic')).current_page).toBe(152);
    const log = await get<{ pages_read: number }>('reading_logs', `b_atomic_${TODAY}`);
    expect(log.pages_read).toBeGreaterThanOrEqual(10);
    await setPage(await get<Book>('books', 'b_atomic'), 320, TODAY);
    expect((await get<Book>('books', 'b_atomic')).status).toBe('finished');
  });

  it('adds and completes a task', async () => {
    const id = await saveTodo({ title: 'Test task', note: null, due_date: TODAY, is_urgent: true, group_id: 'tg_work' });
    await toggleTodo(await get<TodoItem>('todo_items', id));
    expect((await get<TodoItem>('todo_items', id)).status).toBe('done');
  });

  it('fires a reminder once and schedules the next one', async () => {
    const r = await get<Reminder>('reminders', 'sys_savings');
    const now = Date.now();
    await fireReminder({ ...r, next_fire_at: now - 1000 }, now, false);
    await fireReminder({ ...r, next_fire_at: now - 1000 }, now, false); // a second tab doing the same
    const notifs = (await all<{ reminder_id: string }>('notifications')).filter((n) => n.reminder_id === 'sys_savings');
    expect(notifs).toHaveLength(1);
    expect((await get<Reminder>('reminders', 'sys_savings')).next_fire_at).toBeGreaterThan(now);
  });
});

describe('cleaning up', () => {
  it('removes example data but keeps money, the savings reminder and categories', async () => {
    const wallets = await count('wallets');
    const items = await count('money_items');
    await removeSampleData();
    expect(await count('wallets')).toBe(wallets);
    expect(await count('money_items')).toBe(items);
    expect((await getDocs(query(ucol('habits'), where('sample', '==', true)))).size).toBe(0);
    expect(await get<Reminder>('reminders', 'sys_savings')).toBeDefined();
    expect(await count('password_categories')).toBe(5);
    const dump = await exportAll();
    expect(dump.wallets.length).toBe(wallets);
  });
});
