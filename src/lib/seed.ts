/**
 * First-login data. Money comes from "CashFlow RAZIN.xlsx" (real figures, as of November 2026).
 * Everything else is the example data shown in the design and is flagged `sample: true`
 * so it can be removed in one go from Settings.
 */
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { commitInChunks } from './actions';
import { db, udoc } from './db';
import { periods } from './habits';
import { isDue, nextFire } from './recurrence';
import type { GroupCode, Recurrence } from './types';
import { addDays, todayStr } from './util';

export const SEED_VERSION = 1;

export interface SeedDoc {
  col: string;
  id: string;
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------- spreadsheet: sheet "Main" and "Keep Track"

/** Gaji kasar (gross salary), sen. */
export const MONTHLY_INCOME = 380000;

const WALLETS: { id: string; title: string; type: 'saving' | 'investment' | 'cash'; bank: string | null; balance: number; pool?: boolean }[] = [
  { id: 'w_cash', title: 'Cash in Hand', type: 'cash', bank: null, balance: 0, pool: true },
  { id: 'w_kecemasan', title: 'Simpanan Kecemasan', type: 'saving', bank: null, balance: 561323 },
  { id: 'w_kahwin', title: 'Simpanan Kahwin', type: 'saving', bank: null, balance: 720000 },
  { id: 'w_tabung_haji', title: 'Tabung Haji', type: 'saving', bank: 'Tabung Haji', balance: 2196529 },
  { id: 'w_asnb', title: 'ASNB', type: 'investment', bank: 'ASNB', balance: 65000 },
  { id: 'w_kwsp', title: 'KWSP', type: 'investment', bank: 'KWSP', balance: 627721 },
];

/** Month-end balances from rows 20-24 of "Keep Track" (sen). */
const SNAPSHOTS: Record<string, Record<string, number>> = {
  w_kecemasan: { '2026-08': 703464, '2026-09': 665067, '2026-10': 581226, '2026-11': 561323 },
  w_asnb: { '2026-08': 35000, '2026-09': 45000, '2026-10': 55000, '2026-11': 65000 },
  w_tabung_haji: { '2026-08': 2175629, '2026-09': 2196529, '2026-10': 2196529, '2026-11': 2196529 },
  w_kahwin: { '2026-08': 360000, '2026-09': 480000, '2026-10': 600000, '2026-11': 720000 },
  w_kwsp: { '2026-10': 536521, '2026-11': 627721 },
};

export const PAYMENT_MONTHS = ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'];
const ALL = [1, 1, 1, 1, 1, 1];
const FROM_JULY = [0, 1, 1, 1, 1, 1];
const TO_OCTOBER = [1, 1, 1, 1, 1, 0];

/** Items with their amount (sen), mapped wallet and the Jun-Nov 2026 ticks from "Keep Track". */
const ITEMS: { id: string; group: GroupCode; name: string; amount: number; wallet: string | null; paid: number[] }[] = [
  { id: 'i_potongan_gaji', group: 'savings_investment', name: 'Gaji bersih (KWSP, SOCSO, EIS)', amount: 47240, wallet: null, paid: ALL },
  { id: 'i_simpanan_kahwin', group: 'savings_investment', name: 'Simpanan Kahwin', amount: 120000, wallet: 'w_kahwin', paid: ALL },
  { id: 'i_asnb', group: 'savings_investment', name: 'ASNB', amount: 10000, wallet: 'w_asnb', paid: ALL },
  { id: 'i_ishtarakat', group: 'savings_investment', name: 'Ishtarakat Ikram', amount: 5000, wallet: null, paid: ALL },
  { id: 'i_simpanan_emergency', group: 'savings_investment', name: 'Simpanan Emergency', amount: 25000, wallet: 'w_kecemasan', paid: FROM_JULY },
  { id: 'i_claude', group: 'subscription_fixed', name: 'Claude', amount: 8742, wallet: null, paid: FROM_JULY },
  { id: 'i_youtube', group: 'subscription_fixed', name: 'Youtube', amount: 1290, wallet: null, paid: FROM_JULY },
  { id: 'i_topup_digi', group: 'subscription_fixed', name: 'Topup Digi', amount: 4000, wallet: null, paid: ALL },
  // "Keep Track" has 360.00 (it makes the items add up to the 3,800 salary); sheet "Main" still shows 370.00.
  { id: 'i_rumah_sewa', group: 'subscription_fixed', name: 'Rumah Sewa', amount: 36000, wallet: null, paid: ALL },
  { id: 'i_canva', group: 'subscription_fixed', name: 'Canva', amount: 3000, wallet: null, paid: ALL },
  { id: 'i_sedeqah', group: 'spent_cash', name: 'Sedeqah', amount: 5000, wallet: 'w_cash', paid: TO_OCTOBER },
  { id: 'i_makanan_beli', group: 'spent_cash', name: 'Makanan Beli', amount: 40000, wallet: 'w_cash', paid: TO_OCTOBER },
  { id: 'i_barang_dapur', group: 'spent_cash', name: 'Barang Dapur', amount: 25000, wallet: 'w_cash', paid: TO_OCTOBER },
  { id: 'i_minyak_motor', group: 'spent_cash', name: 'Minyak Motor', amount: 6000, wallet: 'w_cash', paid: TO_OCTOBER },
  { id: 'i_minyak_kereta', group: 'spent_cash', name: 'Minyak Kereta', amount: 5000, wallet: 'w_cash', paid: TO_OCTOBER },
  { id: 'i_service_motor', group: 'spent_cash', name: 'Service Motor', amount: 10000, wallet: 'w_cash', paid: TO_OCTOBER },
  { id: 'i_self_reward', group: 'spent_cash', name: 'Self Reward', amount: 28728, wallet: 'w_cash', paid: TO_OCTOBER },
];

function moneyDocs(): SeedDoc[] {
  const out: SeedDoc[] = [];
  WALLETS.forEach((w, i) =>
    out.push({ col: 'wallets', id: w.id, data: { title: w.title, type: w.type, bank: w.bank, balance: w.balance, is_cash_pool: !!w.pool, status: 'active', sort_order: i } }),
  );
  for (const [wallet_id, months] of Object.entries(SNAPSHOTS)) {
    for (const [month, balance] of Object.entries(months)) out.push({ col: 'wallet_snapshots', id: `${wallet_id}_${month}`, data: { wallet_id, month, balance } });
  }
  ITEMS.forEach((it, i) => {
    out.push({
      col: 'money_items',
      id: it.id,
      data: { group_id: it.group, name: it.name, amount: it.amount, wallet_id: it.wallet, due_day: null, remind_days_before: 0, sort_order: i, status: 'active' },
    });
    it.paid.forEach((p, m) => {
      if (!p) return;
      const month = PAYMENT_MONTHS[m];
      // History from the spreadsheet: marked paid, with no transaction, because the wallet balances already include it.
      out.push({
        col: 'item_payments',
        id: `${it.id}_${month}`,
        data: { item_id: it.id, month, amount: it.amount, is_paid: true, paid_at: null, transaction_id: null, wallet_id: null, txn_amount: null },
      });
    });
  });
  return out;
}

// ---------------------------------------------------------------- example data from the design

/** Small deterministic random generator, so the example history is the same on every device. */
function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WEEKDAYS: Recurrence = { frequency: 'weekly', interval: 1, days_of_week: [1, 3, 5] };
const DAILY: Recurrence = { frequency: 'daily', interval: 1 };
const HISTORY_DAYS = 56;

function habitDocs(today: string): SeedDoc[] {
  const rnd = mulberry32(20261114);
  const start = addDays(today, -HISTORY_DAYS);
  const habits: { id: string; name: string; type: 'good' | 'bad'; points: number; rec: Recurrence; best: number; streak?: boolean; start?: string }[] = [
    { id: 'h_workout', name: 'Workout 30 min', type: 'good', points: 10, rec: WEEKDAYS, best: 9 },
    { id: 'h_read', name: 'Read 10 pages', type: 'good', points: 5, rec: DAILY, best: 21 },
    { id: 'h_water', name: 'Drink 2L water', type: 'good', points: 3, rec: DAILY, best: 14 },
    { id: 'h_sleep', name: 'Sleep before 12am', type: 'good', points: 5, rec: DAILY, best: 11 },
    { id: 'h_clean', name: 'Clean streak', type: 'bad', points: -10, rec: DAILY, best: 41, streak: true, start: addDays(today, -80) },
    { id: 'h_social', name: 'Social media over 1 hour', type: 'bad', points: -5, rec: DAILY, best: 0 },
    { id: 'h_snack', name: 'Late-night snack', type: 'bad', points: -3, rec: DAILY, best: 0 },
  ];
  const out: SeedDoc[] = habits.map((h, i) => ({
    col: 'habits',
    id: h.id,
    data: {
      name: h.name, type: h.type, points: h.points, note: null, recurrence: h.rec, start_date: h.start ?? start, status: 'active',
      track_streak: !!h.streak, show_on_home: !!h.streak, streak_start: h.streak ? addDays(today, -23) : null, prev_streak_start: null,
      best_streak: h.best, sort_order: i, sample: true,
    },
  }));

  const logs: { habit: (typeof habits)[number]; date: string }[] = [];
  const add = (id: string, back: number) => logs.push({ habit: habits.find((h) => h.id === id)!, date: addDays(today, -back) });

  // Workout: the last six due days done, the one before missed.
  let done = 0;
  for (let i = 1; i <= HISTORY_DAYS; i++) {
    if (!isDue(WEEKDAYS, addDays(today, -i))) continue;
    done++;
    if (done <= 6 || (done > 7 && rnd() < 0.8)) add('h_workout', i);
  }
  for (let i = 0; i <= HISTORY_DAYS; i++) {
    // Read: 12 days in a row up to yesterday, today still open.
    if ((i >= 1 && i <= 12) || (i > 13 && rnd() < 0.7)) add('h_read', i);
    // Water: 3 days in a row including today.
    if (i <= 2 || (i > 3 && rnd() < 0.75)) add('h_water', i);
    // Sleep: done today, missed yesterday.
    if (i === 0 || (i > 1 && rnd() < 0.65)) add('h_sleep', i);
    // Social media: last happened two days ago.
    if (i === 2 || (i > 2 && rnd() < 0.25)) add('h_social', i);
    // Snack: happened today.
    if (i === 0 || (i > 0 && rnd() < 0.3)) add('h_snack', i);
  }
  // Clean streak: slips 66 and 24 days ago, so the best run is 41 days and the current one is 23.
  add('h_clean', 66);
  add('h_clean', 24);

  const totals = new Map<string, { meta: Record<string, unknown>; score: number; good: number; bad: number }>();
  for (const { habit, date } of logs) {
    out.push({
      col: 'habit_logs',
      id: `${habit.id}_${date}`,
      data: { habit_id: habit.id, log_date: date, count: 1, points: habit.points, score: habit.points, sample: true },
    });
    for (const { id, ...meta } of periods(date)) {
      const t = totals.get(id) ?? { meta, score: 0, good: 0, bad: 0 };
      t.score += habit.points;
      if (habit.type === 'good') t.good++;
      else t.bad++;
      totals.set(id, t);
    }
  }
  for (const [id, t] of totals) {
    out.push({ col: 'habit_score_summaries', id, data: { ...t.meta, score: t.score, good_count: t.good, bad_count: t.bad, sample: true } });
  }
  return out;
}

function todoDocs(today: string, now: number): SeedDoc[] {
  const groups = [['tg_personal', 'Personal'], ['tg_work', 'Work'], ['tg_home', 'Home']];
  const tasks: [string, string, string, number, boolean, boolean][] = [
    ['t_roadtax', 'Renew road tax', 'tg_personal', -2, true, false],
    ['t_claim', 'Submit claim form', 'tg_work', 0, true, false],
    ['t_service', 'Book motor service', 'tg_personal', 0, false, false],
    ['t_slides', 'Prepare slides for Monday', 'tg_work', 2, false, false],
    ['t_landlord', 'Call landlord about sink', 'tg_home', 6, false, false],
    ['t_digi', 'Pay Digi top-up', 'tg_personal', -1, false, true],
  ];
  return [
    ...groups.map(([id, name], i) => ({ col: 'todo_groups', id, data: { name, sort_order: i, sample: true } })),
    ...tasks.map(([id, title, group_id, offset, urgent, done], i) => ({
      col: 'todo_items',
      id,
      data: {
        title, group_id, note: null, due_date: addDays(today, offset), is_urgent: urgent, status: done ? 'done' : 'open',
        completed_ms: done ? now : null, created_ms: now + i, sample: true,
      },
    })),
  ];
}

function bookDocs(today: string, now: number): SeedDoc[] {
  const books: [string, string, string, number, number, 'reading' | 'on_hold' | 'finished', boolean][] = [
    ['b_atomic', 'Atomic Habits', 'James Clear', 320, 142, 'reading', true],
    ['b_deepwork', 'Deep Work', 'Cal Newport', 304, 55, 'on_hold', false],
    ['b_money', 'The Psychology of Money', 'Morgan Housel', 256, 256, 'finished', false],
    ['b_sapiens', 'Sapiens', 'Yuval Noah Harari', 498, 498, 'finished', false],
  ];
  const out: SeedDoc[] = books.map(([id, title, author, total, page, status, home], i) => ({
    col: 'books',
    id,
    data: {
      title, author, total_pages: total, current_page: page, status, show_on_home: home,
      started_at: addDays(today, -24 - i * 30), finished_at: status === 'finished' ? addDays(today, -30 * i) : null, created_ms: now + i, sample: true,
    },
  }));
  // Pages read on each of the last 14 days (oldest first); they add up to page 142.
  const pages = [6, 0, 8, 6, 4, 8, 0, 18, 0, 24, 12, 30, 8, 10];
  let page = 142 - pages.reduce((a, b) => a + b, 0);
  pages.forEach((n, i) => {
    page += n;
    if (!n) return;
    const date = addDays(today, i - 13);
    out.push({ col: 'reading_logs', id: `b_atomic_${date}`, data: { book_id: 'b_atomic', log_date: date, page, pages_read: n, sample: true } });
  });
  return out;
}

function reminderDocs(today: string, now: number): SeedDoc[] {
  const mk = (id: string, module: string, ref_id: string | null, title: string, body: string, recurrence: Recurrence, extra: Record<string, unknown> = {}): SeedDoc => ({
    col: 'reminders',
    id,
    data: {
      module, ref_id, title, body, recurrence, remind_days_before: 0, is_enabled: true, is_system: false,
      next_fire_at: nextFire(recurrence, now), last_fired_at: null, sample: true, ...extra,
    },
  });
  return [
    // The one reminder the requirements ask for by default: savings on the 25th.
    mk('sys_savings', 'money_group', 'savings_investment', 'Savings & Investment', 'Tick this month’s savings and investments.',
      { frequency: 'monthly', interval: 1, day_of_month: 25, time: '09:00' }, { is_system: true, sample: false }),
    mk('r_read', 'habit', 'h_read', 'Read 10 pages', 'Keep your streak going.', { ...DAILY, time: '21:00' }),
    mk('r_snack', 'habit', 'h_snack', 'Late-night snack', 'Kitchen is closed.', { ...DAILY, time: '23:00' }, { is_enabled: false }),
    mk('r_roadtax', 'todo', 't_roadtax', 'Renew road tax', 'Due today.', { frequency: 'once', interval: 1, date: addDays(today, -2), time: '09:00' }),
    mk('r_book', 'book', 'b_atomic', 'Update reading page', 'Where did you stop today?', { ...DAILY, time: '22:30' }),
  ];
}

const PW_CATEGORIES = ['Bank', 'Social', 'Work', 'Shopping', 'Other'];
export const pwCategoryId = (name: string) => `pc_${name.toLowerCase()}`;

/** Everything written on first login. Pure, so it can be checked without a database. */
export function buildSeed(today: string, now: number = Date.now()) {
  const docs: SeedDoc[] = [
    ...moneyDocs(),
    ...habitDocs(today),
    ...todoDocs(today, now),
    ...bookDocs(today, now),
    ...reminderDocs(today, now),
    ...PW_CATEGORIES.map((name, i) => ({ col: 'password_categories', id: pwCategoryId(name), data: { name, gen_rules: null, sort_order: i } })),
  ];
  const settings = {
    currency: 'MYR',
    cash_wallet_id: 'w_cash',
    monthly_income: MONTHLY_INCOME,
    savings_reminder_day: 25,
    lock_timeout_seconds: 60,
    notifications_enabled: { habit: true, money: true, todo: true, book: true },
    vault_kdf_salt: null,
    vault_key_wrapped: null,
    vault_key_iv: null,
    seed_version: SEED_VERSION,
    seeded_ms: now,
    sample_removed_ms: null,
  };
  return { docs, settings };
}

export interface SeedUser {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
  providerId: string;
}

/**
 * Load the starting data the first time an account signs in. Document IDs are fixed, so running it twice
 * writes the same documents again instead of duplicating them. The settings document is written last and
 * marks the seed as finished.
 */
export async function ensureSeed(user: SeedUser, today: string = todayStr()): Promise<boolean> {
  const ref = udoc('settings', 'main');
  const snap = await getDoc(ref);
  if (snap.exists() && snap.data().seed_version) return false;
  const { docs, settings } = buildSeed(today);
  await setDoc(
    doc(db, 'users', user.uid),
    { display_name: user.displayName, email: user.email, avatar_url: user.photoURL, provider_id: user.providerId, created_at: serverTimestamp() },
    { merge: true },
  );
  await commitInChunks(docs.map((d) => (b) => b.set(udoc(d.col, d.id), { ...d.data, created_at: serverTimestamp(), updated_at: serverTimestamp() })));
  await setDoc(ref, { ...settings, created_at: serverTimestamp(), updated_at: serverTimestamp() });
  return true;
}
