import {
  type DocumentData,
  type QueryConstraint,
  collection,
  connectFirestoreEmulator,
  doc,
  initializeFirestore,
  limit,
  memoryLocalCache,
  onSnapshot,
  orderBy,
  persistentLocalCache,
  persistentMultipleTabManager,
  query,
  where,
} from 'firebase/firestore';
import { useSyncExternalStore } from 'react';
import { app, useEmulator } from './firebase';
import type {
  Book, Habit, HabitLog, ItemPayment, MoneyItem, Notif, PwCategory, PwEntry, ReadingLog, Reminder,
  Settings, Summary, TodoGroup, TodoItem, Txn, Wallet, WalletSnapshot,
} from './types';
import { addDays, addMonths, monthKey, todayStr } from './util';

// Offline-first: data is cached on the device, so repeat visits paint from the cache before the network answers.
export const db = initializeFirestore(app, {
  localCache:
    typeof indexedDB === 'undefined'
      ? memoryLocalCache()
      : persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
if (useEmulator) connectFirestoreEmulator(db, '127.0.0.1', 8181);

let _uid = '';
export const setUid = (u: string) => {
  _uid = u;
};
export const uid = () => _uid;
/** A collection under the signed-in user: users/{uid}/{name}. */
export const ucol = (name: string) => collection(db, 'users', _uid, name);
export const udoc = (name: string, id: string) => doc(db, 'users', _uid, name, id);

// ---------------------------------------------------------------- live store
// One Firestore listener per query, shared by every component and kept for the whole session,
// so moving between pages never waits for data that is already on screen elsewhere.

type Entry = { data: unknown; listeners: Set<() => void>; unsub: () => void };
const entries = new Map<string, Entry>();

function ensure(key: string, start: (emit: (d: unknown) => void) => () => void): Entry {
  let e = entries.get(key);
  if (!e) {
    const created: Entry = { data: undefined, listeners: new Set(), unsub: () => {} };
    entries.set(key, created);
    created.unsub = start((d) => {
      created.data = d;
      created.listeners.forEach((l) => l());
    });
    e = created;
  }
  return e;
}

export function resetStore() {
  entries.forEach((e) => e.unsub());
  entries.clear();
}

function useEntry<T>(e: Entry): T | undefined {
  return useSyncExternalStore(
    (cb) => {
      e.listeners.add(cb);
      return () => e.listeners.delete(cb);
    },
    () => e.data as T | undefined,
  );
}

/** Live list of a user collection. `undefined` while the first snapshot is loading. */
export function useCol<T>(name: string, key: string = name, ...cons: QueryConstraint[]): T[] | undefined {
  const e = ensure(`${_uid}/${key}`, (emit) =>
    onSnapshot(
      cons.length ? query(ucol(name), ...cons) : ucol(name),
      (snap) => emit(snap.docs.map((d) => ({ id: d.id, ...(d.data() as DocumentData) }))),
      (err) => {
        console.error(`[qawwam] ${name}:`, err.message);
        emit([]);
      },
    ),
  );
  return useEntry<T[]>(e);
}

/** Live single document. `null` when it does not exist. */
export function useDocData<T>(name: string, id: string): T | null | undefined {
  const e = ensure(`${_uid}/${name}/${id}`, (emit) =>
    onSnapshot(
      udoc(name, id),
      (snap) => emit(snap.exists() ? snap.data() : null),
      (err) => {
        console.error(`[qawwam] ${name}/${id}:`, err.message);
        emit(null);
      },
    ),
  );
  return useEntry<T | null>(e);
}

// ---------------------------------------------------------------- named queries

export const LOG_WINDOW_DAYS = 120;

export const useHabits = () => useCol<Habit>('habits');
export const useLogs = () => {
  const from = addDays(todayStr(), -LOG_WINDOW_DAYS);
  return useCol<HabitLog>('habit_logs', `habit_logs>=${from}`, where('log_date', '>=', from));
};
export const useSummaries = () => {
  const from = addDays(todayStr(), -400);
  return useCol<Summary>('habit_score_summaries', `summaries>=${from}`, where('period_start', '>=', from));
};
export const useWallets = () => useCol<Wallet>('wallets');
export const useSnapshots = () => useCol<WalletSnapshot>('wallet_snapshots');
export const useItems = () => useCol<MoneyItem>('money_items');
export const usePayments = () => useCol<ItemPayment>('item_payments');
export const useTxns = () => {
  const from = `${addMonths(monthKey(todayStr()), -3)}-01`;
  return useCol<Txn>('transactions', `transactions>=${from}`, where('txn_date', '>=', from));
};
export const useTodoGroups = () => useCol<TodoGroup>('todo_groups');
export const useTodos = () => useCol<TodoItem>('todo_items');
export const useBooks = () => useCol<Book>('books');
export const useReadingLogs = () => {
  const from = addDays(todayStr(), -60);
  return useCol<ReadingLog>('reading_logs', `reading_logs>=${from}`, where('log_date', '>=', from));
};
export const useReminders = () => useCol<Reminder>('reminders');
export const useNotifs = () => useCol<Notif>('notifications', 'notifications:recent', orderBy('sent_at', 'desc'), limit(30));
export const usePwCats = () => useCol<PwCategory>('password_categories');
export const usePwEntries = () => useCol<PwEntry>('password_entries');
export const useSettings = () => useDocData<Settings>('settings', 'main');
