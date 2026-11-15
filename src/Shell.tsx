import type { User } from 'firebase/auth';
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { BrowserRouter, Link, NavLink, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { dueReminders, fireReminder, primeReminder } from './lib/actions';
import { resetStore, setUid, uid, useItems, useLogs, usePayments, useReminders, useSettings, useTodos } from './lib/db';
import { logId } from './lib/habits';
import { paymentId } from './lib/money';
import { ensureSeed } from './lib/seed';
import type { Reminder } from './lib/types';
import { byId, monthKey, todayStr } from './lib/util';
import { setVk, useVk } from './lib/vaultState';
import Home from './pages/Home';
import QuickSpendForm from './pages/QuickSpend';
import { QuickCtx, useQuickSpend } from './quick';
import { Icon, LogoLockup, Sheet, Splash } from './ui';

// Home ships with the shell; every other screen is its own small file, fetched when first opened
// and prefetched once the app is idle (the service worker then keeps them all for offline use).
const pages = {
  habits: () => import('./pages/Habits'),
  habitDash: () => import('./pages/HabitDash'),
  money: () => import('./pages/Money'),
  transactions: () => import('./pages/Transactions'),
  todo: () => import('./pages/Todo'),
  books: () => import('./pages/Books'),
  vault: () => import('./pages/Vault'),
  reminders: () => import('./pages/Reminders'),
  settings: () => import('./pages/Settings'),
};
const Habits = lazy(pages.habits);
const HabitDash = lazy(pages.habitDash);
const Money = lazy(pages.money);
const Checklist = lazy(() => pages.money().then((m) => ({ default: m.Checklist })));
const Spent = lazy(() => pages.money().then((m) => ({ default: m.Spent })));
const Transactions = lazy(pages.transactions);
const Todo = lazy(pages.todo);
const Books = lazy(pages.books);
const Vault = lazy(pages.vault);
const VaultDash = lazy(() => pages.vault().then((m) => ({ default: m.VaultDash })));
const Reminders = lazy(pages.reminders);
const Settings = lazy(pages.settings);

function prefetchPages() {
  const go = () => Object.values(pages).forEach((load) => void load().catch(() => {}));
  if ('requestIdleCallback' in window) window.requestIdleCallback(go, { timeout: 4000 });
  else setTimeout(go, 2000);
}

const NAV: [string, string][] = [
  ['/', 'Home'],
  ['/habits', 'Habits'],
  ['/habits/dashboard', 'Habit dashboard'],
  ['/money', 'Money'],
  ['/money/transactions', 'Transactions'],
  ['/todo', 'To-Do'],
  ['/books', 'Books'],
  ['/vault', 'Passwords'],
  ['/vault/dashboard', 'Password dashboard'],
  ['/reminders', 'Reminders'],
  ['/settings', 'Settings'],
];

const TABS: [string, string, string, (p: string) => boolean][] = [
  ['/', 'Home', 'home', (p) => p === '/'],
  ['/habits', 'Habits', 'habits', (p) => p.startsWith('/habits')],
  ['/money', 'Money', 'money', (p) => p.startsWith('/money')],
  ['/todo', 'To-Do', 'todo', (p) => p.startsWith('/todo')],
  ['/settings', 'More', 'more', (p) => ['/settings', '/books', '/vault', '/reminders'].some((x) => p.startsWith(x))],
];

function Layout() {
  const { pathname } = useLocation();
  const quick = useQuickSpend();
  const showFab = pathname === '/' || pathname === '/money' || pathname === '/money/spent' || pathname === '/money/transactions';
  return (
    <div className="app">
      <nav className="sidebar" aria-label="Main">
        <Link to="/" className="brand" aria-label="Qawwam home">
          <LogoLockup height={32} />
        </Link>
        {NAV.map(([to, label]) => (
          <NavLink key={to} to={to} end className={({ isActive }) => `nav${isActive ? ' active' : ''}`}>
            {label}
          </NavLink>
        ))}
      </nav>
      <main className="main">
        <Suspense fallback={<p className="dim small">Loading…</p>}>
          <Outlet />
        </Suspense>
      </main>
      {showFab && (
        <button type="button" className="fab" aria-label="Quick spend" onClick={() => quick()}>
          <Icon name="plus" size={24} stroke={2.2} />
        </button>
      )}
      <nav className="tabbar" aria-label="Main">
        {TABS.map(([to, label, icon, match]) => (
          <Link key={to} to={to} className={match(pathname) ? 'active' : ''} aria-current={match(pathname) ? 'page' : undefined}>
            <Icon name={icon} size={22} />
            {label}
          </Link>
        ))}
      </nav>
      <ReminderRunner />
      <VaultAutoLock />
    </div>
  );
}

// ---------------------------------------------------------------- reminders (while the app is open)

function showSystemNotification(title: string, body: string | null) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const options = { body: body ?? undefined, icon: '/icon-192.png', badge: '/icon-192.png', tag: title };
  navigator.serviceWorker
    ?.getRegistration()
    .then((reg) => {
      if (reg) return reg.showNotification(title, options);
      new Notification(title, options);
    })
    .catch(() => {});
}

function ReminderRunner() {
  const reminders = useReminders();
  const settings = useSettings();
  const logs = useLogs();
  const payments = usePayments();
  const todos = useTodos();
  const items = useItems();
  const latest = useRef({ reminders, settings, logs, payments, todos, items });
  latest.current = { reminders, settings, logs, payments, todos, items };
  const primed = useRef(new Set<string>());

  useEffect(() => {
    const tick = () => {
      const s = latest.current;
      if (!s.reminders || !s.settings || !s.logs || !s.payments || !s.todos || !s.items) return;
      const now = Date.now();
      const today = todayStr();
      const month = monthKey(today);
      const logMap = byId(s.logs);
      const payMap = byId(s.payments);
      const todoMap = byId(s.todos);

      // Already done today / this month? Then stay quiet (the reminder still moves on to its next date).
      const done = (r: Reminder) => {
        if (!r.ref_id) return false;
        if (r.module === 'habit') return (logMap[logId(r.ref_id, today)]?.count ?? 0) > 0;
        if (r.module === 'money_item') return !!payMap[paymentId(r.ref_id, month)]?.is_paid;
        if (r.module === 'money_group') {
          const group = s.items!.filter((i) => i.group_id === r.ref_id && i.status === 'active');
          return group.length > 0 && group.every((i) => payMap[paymentId(i.id, month)]?.is_paid);
        }
        if (r.module === 'todo') return todoMap[r.ref_id]?.status !== 'open';
        return false;
      };

      for (const r of s.reminders) {
        if (r.is_enabled && r.next_fire_at === null && r.recurrence.frequency !== 'once' && !primed.current.has(r.id)) {
          primed.current.add(r.id);
          void primeReminder(r, now).catch(() => {});
        }
      }
      for (const r of dueReminders(s.reminders, now, s.settings.notifications_enabled ?? {})) {
        const skipped = done(r);
        void fireReminder(r, now, skipped).catch(() => {});
        if (!skipped) showSystemNotification(r.title, r.body);
      }
    };
    const first = setTimeout(tick, 3000);
    const every = setInterval(tick, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, []);
  return null;
}

// ---------------------------------------------------------------- vault auto-lock

function VaultAutoLock() {
  const vk = useVk();
  const settings = useSettings();
  const seconds = settings?.lock_timeout_seconds ?? 60;
  useEffect(() => {
    if (!vk) return;
    let t = setTimeout(() => setVk(null), seconds * 1000);
    const reset = () => {
      clearTimeout(t);
      t = setTimeout(() => setVk(null), seconds * 1000);
    };
    const hidden = () => document.hidden && setVk(null);
    window.addEventListener('pointerdown', reset);
    window.addEventListener('keydown', reset);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      clearTimeout(t);
      window.removeEventListener('pointerdown', reset);
      window.removeEventListener('keydown', reset);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [vk, seconds]);
  return null;
}

// ---------------------------------------------------------------- shell

export default function Shell({ user }: { user: User }) {
  // Point the data layer at this account before any screen asks for data.
  if (uid() !== user.uid) {
    resetStore();
    setUid(user.uid);
  }
  const seededKey = `qw_seeded_${user.uid}`;
  const [ready, setReady] = useState(() => !!localStorage.getItem(seededKey));
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [quick, setQuick] = useState<{ open: boolean; itemId?: string }>({ open: false });
  const openQuick = useCallback((itemId?: string) => setQuick({ open: true, itemId }), []);
  const closeQuick = useCallback(() => setQuick({ open: false }), []);

  useEffect(() => {
    if (ready) return;
    let live = true;
    setError('');
    ensureSeed({
      uid: user.uid,
      displayName: user.displayName,
      email: user.email,
      photoURL: user.photoURL,
      providerId: user.providerData[0]?.providerId ?? 'password',
    })
      .then(() => {
        localStorage.setItem(seededKey, '1');
        if (live) setReady(true);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [user, ready, seededKey, attempt]);

  useEffect(() => {
    if (ready) prefetchPages();
  }, [ready]);

  useEffect(
    () => () => {
      setVk(null);
      resetStore();
      setUid('');
    },
    [],
  );

  if (error) {
    return (
      <div className="splash">
        <p role="alert" className="alert" style={{ maxWidth: 420 }}>
          Could not load your data: {error}
        </p>
        <button type="button" className="btn" onClick={() => setAttempt((n) => n + 1)}>
          Try again
        </button>
      </div>
    );
  }
  if (!ready) return <Splash text="Setting up your data…" />;

  return (
    <BrowserRouter>
      <QuickCtx.Provider value={openQuick}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Home user={user} />} />
            <Route path="habits" element={<Habits />} />
            <Route path="habits/dashboard" element={<HabitDash />} />
            <Route path="money" element={<Money />} />
            <Route path="money/checklist" element={<Checklist />} />
            <Route path="money/spent" element={<Spent />} />
            <Route path="money/transactions" element={<Transactions />} />
            <Route path="todo" element={<Todo />} />
            <Route path="books" element={<Books />} />
            <Route path="vault" element={<Vault />} />
            <Route path="vault/dashboard" element={<VaultDash />} />
            <Route path="reminders" element={<Reminders />} />
            <Route path="settings" element={<Settings user={user} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
        <Sheet open={quick.open} onClose={closeQuick} title="Quick spend">
          <QuickSpendForm key={quick.itemId ?? 'none'} presetItemId={quick.itemId} onDone={closeQuick} />
        </Sheet>
      </QuickCtx.Provider>
    </BrowserRouter>
  );
}
