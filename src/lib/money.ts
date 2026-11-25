import { deleteDoc, increment, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { db, udoc } from './db';
import type { GroupCode, ItemPayment, MoneyItem, Settings, Txn, TxnSource, Wallet, WalletType } from './types';
import { cycleMonth, cycleRange, newId } from './util';

/** The payday the money month starts on (see Settings). */
export const cycleDay = (s: Settings | null | undefined) => s?.money_cycle_day ?? 1;

/**
 * The three fixed groups. Ticking an item for a month means:
 *  - deposit:  the amount was put into the item's savings wallet (balance goes up)
 *  - pay:      the bill was paid from the item's wallet, if it has one (balance goes down)
 *  - allocate: the month's budget was moved into the cash wallet (balance goes up; spends then bring it down)
 */
export const GROUPS: { code: GroupCode; name: string; short: string; behaviour: 'deposit' | 'pay' | 'allocate' }[] = [
  { code: 'savings_investment', name: 'Savings & Investment', short: 'Savings', behaviour: 'deposit' },
  { code: 'subscription_fixed', name: 'Subscription & Fixed', short: 'Subscriptions', behaviour: 'pay' },
  { code: 'spent_cash', name: 'Spent & Cash', short: 'Cash', behaviour: 'allocate' },
];
export const groupOf = (code: GroupCode) => GROUPS.find((g) => g.code === code)!;

export interface TxnInput {
  wallet_id: string;
  amount: number;
  group_id?: GroupCode | null;
  item_id?: string | null;
  payment_id?: string | null;
  source: TxnSource;
  note?: string | null;
  txn_date: string;
}

type Batch = ReturnType<typeof writeBatch>;

function putTxn(b: Batch, id: string, t: TxnInput) {
  b.set(udoc('transactions', id), {
    wallet_id: t.wallet_id,
    group_id: t.group_id ?? null,
    item_id: t.item_id ?? null,
    payment_id: t.payment_id ?? null,
    amount: t.amount,
    source: t.source,
    note: t.note ?? null,
    txn_date: t.txn_date,
    created_ms: Date.now(),
    created_at: serverTimestamp(),
  });
  b.update(udoc('wallets', t.wallet_id), { balance: increment(t.amount), updated_at: serverTimestamp() });
}

/** Record a transaction and move the wallet balance in the same atomic write. */
export function addTxn(t: TxnInput, id: string = newId()) {
  const b = writeBatch(db);
  putTxn(b, id, t);
  return b.commit().then(() => id);
}

export function removeTxn(t: Txn) {
  const b = writeBatch(db);
  b.delete(udoc('transactions', t.id));
  b.update(udoc('wallets', t.wallet_id), { balance: increment(-t.amount), updated_at: serverTimestamp() });
  if (t.payment_id) {
    b.set(udoc('item_payments', t.payment_id), { is_paid: false, paid_at: null, transaction_id: null, wallet_id: null, txn_amount: null }, { merge: true });
  }
  return b.commit();
}

/** Change amount, note or date. The wallet balance follows the amount. */
export function editTxn(t: Txn, patch: { amount?: number; note?: string | null; txn_date?: string }) {
  const b = writeBatch(db);
  b.update(udoc('transactions', t.id), { ...patch, updated_at: serverTimestamp() });
  if (patch.amount !== undefined && patch.amount !== t.amount) {
    b.update(udoc('wallets', t.wallet_id), { balance: increment(patch.amount - t.amount), updated_at: serverTimestamp() });
    // Keep the checklist tick in step, so unticking later reverses the edited amount.
    if (t.payment_id) b.set(udoc('item_payments', t.payment_id), { txn_amount: patch.amount, amount: Math.abs(patch.amount) }, { merge: true });
  }
  return b.commit();
}

/** Sort an uncategorised spend into an item later. Amount and wallet stay as they are. */
export const categoriseTxn = (t: Txn, item: MoneyItem | null) =>
  updateDoc(udoc('transactions', t.id), {
    group_id: item ? item.group_id : null,
    item_id: item ? item.id : null,
    updated_at: serverTimestamp(),
  });

export const paymentId = (itemId: string, month: string) => `${itemId}_${month}`;

/**
 * Tick or untick an item for a month. A tick records a transaction against the right wallet when there is one;
 * an untick reverses exactly what the tick did.
 */
export function setPaid(item: MoneyItem, month: string, paid: boolean, existing: ItemPayment | undefined, cashWalletId: string | null, today: string, startDay = 1) {
  const b = writeBatch(db);
  const pid = paymentId(item.id, month);
  const ref = udoc('item_payments', pid);
  if (paid) {
    const behaviour = groupOf(item.group_id).behaviour;
    const walletId = behaviour === 'allocate' ? cashWalletId : item.wallet_id;
    const amount = behaviour === 'pay' ? -item.amount : item.amount;
    const txnId = walletId ? newId() : null;
    b.set(ref, {
      item_id: item.id,
      month,
      amount: item.amount,
      is_paid: true,
      paid_at: Date.now(),
      transaction_id: txnId,
      wallet_id: walletId,
      txn_amount: walletId ? amount : null,
      updated_at: serverTimestamp(),
    });
    if (walletId && txnId) {
      putTxn(b, txnId, {
        wallet_id: walletId,
        amount,
        group_id: item.group_id,
        item_id: item.id,
        payment_id: pid,
        source: 'item_payment',
        note: null,
        // A tick for another month is dated inside that month so history stays readable.
        txn_date: cycleMonth(today, startDay) === month ? today : cycleRange(month, startDay).start,
      });
    }
  } else {
    b.set(ref, { item_id: item.id, month, amount: existing?.amount ?? item.amount, is_paid: false, paid_at: null, transaction_id: null, wallet_id: null, txn_amount: null, updated_at: serverTimestamp() });
    if (existing?.transaction_id && existing.wallet_id && existing.txn_amount) {
      b.delete(udoc('transactions', existing.transaction_id));
      b.update(udoc('wallets', existing.wallet_id), { balance: increment(-existing.txn_amount), updated_at: serverTimestamp() });
    }
  }
  return b.commit();
}

// ---------------------------------------------------------------- wallets

export interface WalletInput {
  title: string;
  bank: string | null;
  type: WalletType;
  balance: number;
}

export function createWallet(w: WalletInput) {
  const id = newId();
  return setDoc(udoc('wallets', id), {
    ...w,
    is_cash_pool: false,
    status: 'active',
    sort_order: Date.now(),
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  }).then(() => id);
}

export const updateWallet = (id: string, patch: Partial<Pick<Wallet, 'title' | 'bank' | 'type' | 'status'>>) =>
  updateDoc(udoc('wallets', id), { ...patch, updated_at: serverTimestamp() });

/** Set a wallet to a known balance. The difference is recorded as an adjustment so history adds up. */
export function adjustWallet(w: Wallet, newBalance: number, today: string, note = 'Balance adjustment') {
  const delta = newBalance - w.balance;
  if (!delta) return Promise.resolve('');
  return addTxn({ wallet_id: w.id, amount: delta, source: 'adjustment', note, txn_date: today });
}

/** A wallet with no history can be deleted; one with transactions is archived so the history stays valid. */
export const deleteWallet = (id: string) => deleteDoc(udoc('wallets', id));

// ---------------------------------------------------------------- items

export interface ItemInput {
  group_id: GroupCode;
  name: string;
  amount: number;
  wallet_id: string | null;
  due_day: number | null;
  remind_days_before: number;
}

export function saveItem(input: ItemInput, existing?: MoneyItem) {
  const id = existing?.id ?? newId();
  const b = writeBatch(db);
  if (existing) b.update(udoc('money_items', id), { ...input, updated_at: serverTimestamp() });
  else b.set(udoc('money_items', id), { ...input, sort_order: Date.now(), status: 'active', created_at: serverTimestamp(), updated_at: serverTimestamp() });
  // An item with a due day gets its own monthly reminder; clearing the due day removes it.
  const rem = udoc('reminders', `item_${id}`);
  if (input.due_day) {
    b.set(rem, {
      module: 'money_item',
      ref_id: id,
      title: input.name,
      body: 'Payment due',
      recurrence: { frequency: 'monthly', interval: 1, day_of_month: input.due_day, time: '09:00' },
      remind_days_before: input.remind_days_before,
      is_enabled: true,
      is_system: false,
      next_fire_at: null,
      last_fired_at: null,
      updated_at: serverTimestamp(),
    });
  } else if (existing?.due_day) b.delete(rem);
  return b.commit().then(() => id);
}

/** Soft delete: past payments and transactions keep pointing at a real item. */
export function removeItem(item: MoneyItem) {
  const b = writeBatch(db);
  b.update(udoc('money_items', item.id), { status: 'removed', updated_at: serverTimestamp() });
  if (item.due_day) b.delete(udoc('reminders', `item_${item.id}`));
  return b.commit();
}

// ---------------------------------------------------------------- reading the numbers

/** Amount spent per Spent & Cash item in a money month (positive sen). */
export function spentByItem(txns: Txn[], month: string, startDay = 1): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of txns) {
    if (t.group_id !== 'spent_cash' || !t.item_id || t.source === 'item_payment') continue;
    if (cycleMonth(t.txn_date, startDay) !== month) continue;
    out[t.item_id] = (out[t.item_id] ?? 0) - t.amount;
  }
  return out;
}

/** Spends that still need a category. */
export const unsorted = (txns: Txn[]) => txns.filter((t) => t.source === 'quick' && !t.item_id);

export const isPaid = (payments: Record<string, ItemPayment>, itemId: string, month: string) =>
  !!payments[paymentId(itemId, month)]?.is_paid;
