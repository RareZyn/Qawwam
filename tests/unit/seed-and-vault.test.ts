import { describe, expect, it } from 'vitest';
import { cleanStreak } from '../../src/lib/habits';
import { MONTHLY_INCOME, PAYMENT_MONTHS, buildSeed } from '../../src/lib/seed';
import type { Habit, HabitLog } from '../../src/lib/types';
import { byId } from '../../src/lib/util';
import { createVault, decryptSecret, encryptSecret, fingerprint, generatePassword, strength, unlockWithPassphrase, unlockWithPattern, wrapForDevice } from '../../src/lib/vault';

const TODAY = '2026-11-14';
const seed = buildSeed(TODAY, new Date(2026, 10, 14, 10).getTime());
const of = (col: string) => seed.docs.filter((d) => d.col === col);
const data = <T,>(col: string) => of(col).map((d) => ({ id: d.id, ...d.data }) as T);

describe('first-login data matches "CashFlow RAZIN.xlsx"', () => {
  const items = data<{ id: string; group_id: string; name: string; amount: number }>('money_items');
  const total = (g: string) => items.filter((i) => i.group_id === g).reduce((a, i) => a + i.amount, 0);

  it('has all 17 items and they add up to the RM 3,800 salary (sheet "Keep Track", B19)', () => {
    expect(items).toHaveLength(17);
    expect(items.reduce((a, i) => a + i.amount, 0)).toBe(MONTHLY_INCOME);
  });
  it('splits into the three groups', () => {
    expect(total('savings_investment')).toBe(47240 + 120000 + 10000 + 5000 + 25000);
    expect(total('subscription_fixed')).toBe(8742 + 1290 + 4000 + 36000 + 3000);
    expect(total('spent_cash')).toBe(5000 + 40000 + 25000 + 6000 + 5000 + 10000 + 28728);
  });
  it('keeps the November savings balances (sheet "Keep Track", column H)', () => {
    const w = byId(data<{ id: string; balance: number }>('wallets'));
    expect(w.w_kecemasan.balance).toBe(561323);
    expect(w.w_asnb.balance).toBe(65000);
    expect(w.w_tabung_haji.balance).toBe(2196529);
    expect(w.w_kahwin.balance).toBe(720000);
    expect(w.w_kwsp.balance).toBe(627721);
    const savings = ['w_kecemasan', 'w_asnb', 'w_tabung_haji', 'w_kahwin', 'w_kwsp'].reduce((a, k) => a + w[k].balance, 0);
    expect(savings).toBe(4170573); // H25 = 41,705.73
  });
  it('has the October total from the sheet (G25 = 39,692.76)', () => {
    const oct = data<{ month: string; balance: number }>('wallet_snapshots').filter((s) => s.month === '2026-10');
    expect(oct.reduce((a, s) => a + s.balance, 0)).toBe(3969276);
  });
  it('copies every tick from June to November', () => {
    const pays = data<{ item_id: string; month: string; is_paid: boolean }>('item_payments');
    const ticked = (item: string) => pays.filter((p) => p.item_id === item).map((p) => p.month);
    expect(ticked('i_simpanan_kahwin')).toEqual(PAYMENT_MONTHS);
    expect(ticked('i_simpanan_emergency')).toEqual(PAYMENT_MONTHS.slice(1)); // June unticked
    expect(ticked('i_claude')).toEqual(PAYMENT_MONTHS.slice(1));
    expect(ticked('i_sedeqah')).toEqual(PAYMENT_MONTHS.slice(0, 5)); // November not yet
    expect(ticked('i_makanan_beli')).not.toContain('2026-11');
    // 17 items × 6 months minus 2 (Emergency, Claude, Youtube in June) and 7 (Spent & Cash in November)
    expect(pays).toHaveLength(17 * 6 - 3 - 7);
  });
});

describe('example data matches the design', () => {
  const habits = data<Habit>('habits');
  const logs = byId(data<HabitLog>('habit_logs'));
  it('has a 23-day clean streak with a best of 41, as a bad habit', () => {
    const clean = habits.find((h) => h.id === 'h_clean')!;
    expect(clean.type).toBe('bad');
    expect(clean.points).toBe(-10);
    expect(cleanStreak(clean, logs, TODAY)).toBe(23);
    expect(clean.best_streak).toBe(41);
  });
  it('keeps the score totals equal to the logs', () => {
    const sums = data<{ id: string; score: number }>('habit_score_summaries');
    const fromLogs = Object.values(logs).reduce((a, l) => a + l.score, 0);
    const months = sums.filter((s) => s.id.startsWith('month_')).reduce((a, s) => a + s.score, 0);
    expect(months).toBe(fromLogs);
  });
  it('puts Atomic Habits on page 142 of 320 on the home widget', () => {
    const b = data<{ id: string; current_page: number; total_pages: number; show_on_home: boolean }>('books').find((x) => x.id === 'b_atomic')!;
    expect([b.current_page, b.total_pages, b.show_on_home]).toEqual([142, 320, true]);
  });
  it('creates the savings reminder on the 25th and keeps it when examples are removed', () => {
    const r = of('reminders').find((d) => d.id === 'sys_savings')!;
    expect(r.data.recurrence).toMatchObject({ frequency: 'monthly', day_of_month: 25 });
    expect(r.data.sample).toBe(false);
  });
  it('marks money data as real and the rest as examples', () => {
    for (const c of ['wallets', 'money_items', 'item_payments', 'wallet_snapshots']) expect(of(c).every((d) => !d.data.sample)).toBe(true);
    for (const c of ['habits', 'habit_logs', 'todo_items', 'books']) expect(of(c).every((d) => d.data.sample === true)).toBe(true);
  });
  it('uses unique document ids', () => {
    const keys = seed.docs.map((d) => `${d.col}/${d.id}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('vault', () => {
  it('round-trips a secret and only unlocks with the right passphrase or pattern', async () => {
    const { vk, forServer } = await createVault('correct horse battery');
    const enc = await encryptSecret(vk, { username: 'razin', password: 'Kq7#vT2!pLx9', note: '' });
    expect(enc.data_enc).not.toContain('Kq7');
    const back = await unlockWithPassphrase(forServer, 'correct horse battery');
    expect((await decryptSecret(back, enc.data_enc, enc.iv)).password).toBe('Kq7#vT2!pLx9');
    await expect(unlockWithPassphrase(forServer, 'wrong')).rejects.toBeTruthy();
    const device = await wrapForDevice(vk, '0-1-2-4');
    expect(Array.from(await unlockWithPattern(device, '0-1-2-4'))).toEqual(Array.from(vk));
    await expect(unlockWithPattern(device, '0-1-2-5')).rejects.toBeTruthy();
  }, 30_000);
  it('gives equal passwords equal fingerprints, and different keys different ones', async () => {
    const a = await createVault('passphrase-one');
    const b = await createVault('passphrase-two');
    expect(await fingerprint(a.vk, 'Sunset2024!')).toBe(await fingerprint(a.vk, 'Sunset2024!'));
    expect(await fingerprint(a.vk, 'Sunset2024!')).not.toBe(await fingerprint(b.vk, 'Sunset2024!'));
  }, 30_000);
  it('generates passwords that follow the rules', () => {
    for (let i = 0; i < 200; i++) {
      const p = generatePassword({ length: 12, upper: true, lower: true, digits: true, symbols: true });
      expect(p).toHaveLength(12);
      expect(p).toMatch(/[A-Z]/);
      expect(p).toMatch(/[a-z]/);
      expect(p).toMatch(/\d/);
      expect(p).toMatch(/[!#$%&*?@]/);
    }
    expect(generatePassword({ length: 8, upper: false, lower: false, digits: true, symbols: false })).toMatch(/^\d{8}$/);
    expect(strength('Sunset2024!')).toBe(1);
    expect(strength('Kq7#vT2!pLx9')).toBeGreaterThanOrEqual(3);
    expect(strength('r7#Vq!Lm2$Xt9pWk')).toBe(4);
  });
});
