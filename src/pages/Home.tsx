import type { User } from 'firebase/auth';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { setPage } from '../lib/actions';
import { useBooks, useHabits, useItems, useLogs, useNotifs, usePayments, useSettings, useTodos, useTxns, useWallets } from '../lib/db';
import { dueToday } from '../lib/habits';
import { cycleDay, isPaid, spentByItem } from '../lib/money';
import { byId, cycleMonth, cycleRange, daysInMonth, diffDays, fmtDayLong, fmtRM, monthKey, ordinal, pad, sum } from '../lib/util';
import { useQuickSpend } from '../quick';
import { Bar, Icon, run, useToday } from '../ui';
import { HabitRow, StreakCard } from './habitParts';

function BookWidget() {
  const books = useBooks();
  const today = useToday();
  const book = books?.find((b) => b.show_on_home) ?? books?.find((b) => b.status === 'reading');
  const [draft, setDraft] = useState<string | null>(null);
  if (!books) return null;
  if (!book) {
    return (
      <Link to="/books" className="card fill-blue">
        <span className="eyebrow">Now reading</span>
        <span>Add a book to track your page here.</span>
      </Link>
    );
  }
  const pct = book.total_pages ? Math.round((book.current_page / book.total_pages) * 100) : 0;
  const value = draft ?? String(book.current_page);
  const save = () => {
    const n = parseInt(value, 10);
    if (Number.isFinite(n)) run(setPage(book, n, today));
    setDraft(null);
  };
  return (
    <section className="card fill-blue" aria-label="Book widget">
      <div className="row between base">
        <span className="eyebrow">Now reading</span>
        <Link to="/books" className="small" style={{ fontWeight: 600 }}>
          All books
        </Link>
      </div>
      <span style={{ fontFamily: 'var(--head)', fontSize: 21, fontWeight: 600 }}>{book.title}</span>
      {book.total_pages ? <Bar pct={pct} /> : null}
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label className="row grow small" style={{ gap: 8 }}>
          Page
          <input
            type="number"
            inputMode="numeric"
            aria-label="Current page"
            value={value}
            onChange={(e) => setDraft(e.target.value)}
            style={{ width: 84, height: 44, borderRadius: 10, border: '1px solid rgba(8,4,2,0.35)', background: '#e6f4fc', padding: '0 12px', fontFamily: 'var(--mono)', fontSize: 16, color: 'var(--bg)' }}
          />
          {book.total_pages ? <span>/ {book.total_pages}</span> : null}
        </label>
        <button type="submit" className="btn dark">
          Update
        </button>
      </form>
    </section>
  );
}

export default function Home({ user }: { user: User }) {
  const today = useToday();
  const habits = useHabits();
  const logList = useLogs();
  const wallets = useWallets();
  const todos = useTodos();
  const items = useItems();
  const payList = usePayments();
  const txns = useTxns();
  const settings = useSettings();
  const notifs = useNotifs();
  const quick = useQuickSpend();
  const logs = byId(logList);
  const payments = byId(payList);

  const first = (user.displayName ?? '').split(' ')[0] || 'there';
  const unread = (notifs ?? []).filter((n) => !n.read_at).length;
  const active = (habits ?? []).filter((h) => h.status === 'active').sort((a, b) => a.sort_order - b.sort_order);
  const streaks = active.filter((h) => h.track_streak && h.show_on_home);
  const due = active.filter((h) => !h.track_streak && dueToday(h, today));

  const cash = wallets?.find((w) => w.id === settings?.cash_wallet_id) ?? wallets?.find((w) => w.is_cash_pool);
  const spentItems = (items ?? []).filter((i) => i.group_id === 'spent_cash' && i.status === 'active');
  const budget = sum(spentItems, (i) => i.amount);
  const cycle = cycleMonth(today, cycleDay(settings));
  const spent = sum(Object.values(spentByItem(txns ?? [], cycle, cycleDay(settings))), (x) => x);

  const open = (todos ?? []).filter((t) => t.status === 'open');
  const urgent = open.filter((t) => t.is_urgent).length;
  const overdue = open.filter((t) => t.due_date && t.due_date < today).length;

  const savings = (items ?? []).filter((i) => i.group_id === 'savings_investment' && i.status === 'active');
  const savingsPaid = savings.filter((i) => isPaid(payments, i.id, cycle)).length;
  // The savings day that falls inside the current money month.
  const range = cycleRange(cycle, cycleDay(settings));
  const dueIn = (m: string) => `${m}-${pad(Math.min(settings?.savings_reminder_day ?? 25, daysInMonth(m)))}`;
  const dueDate = dueIn(monthKey(range.start)) >= range.start ? dueIn(monthKey(range.start)) : dueIn(monthKey(range.end));
  const day = Number(dueDate.slice(8));
  const daysLeft = diffDays(today, dueDate);

  return (
    <div className="page">
      <header className="head">
        <div className="col tight">
          <span className="eyebrow">{fmtDayLong(today)}</span>
          <h1>Hi, {first}</h1>
        </div>
        <div className="row">
          <button type="button" className="btn primary only-desktop" onClick={() => quick()}>
            + Quick spend
          </button>
          <Link to="/reminders" className="btn icon" aria-label={unread ? `Reminders, ${unread} new` : 'Reminders'} style={{ position: 'relative' }}>
            <Icon name="bell" />
            {unread > 0 && <span style={{ position: 'absolute', top: 8, right: 9, width: 8, height: 8, borderRadius: 4, background: 'var(--red)' }} />}
          </Link>
        </div>
      </header>

      <div className="cards">
        <BookWidget />
        {habits && streaks.map((h) => <StreakCard key={h.id} habit={h} logs={logs} today={today} />)}
        {wallets && cash && (
          <div className="cards small" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
            <Link to="/money/spent" className="card" style={{ gap: 6, padding: 14 }}>
              <span className="tiny dim">Cash in hand</span>
              <span className="mono" style={{ fontSize: 18 }}>
                {fmtRM(cash.balance)}
              </span>
              <span className="tiny blue">{budget ? `${Math.max(0, Math.round(((budget - spent) / budget) * 100))}% of budget left` : 'No budget set'}</span>
            </Link>
            <Link to="/todo" className="card" style={{ gap: 6, padding: 14 }}>
              <span className="tiny dim">To-do</span>
              <span className="mono" style={{ fontSize: 18 }}>
                {open.length} open
              </span>
              <span className={`tiny ${urgent || overdue ? 'red' : 'dim'}`}>
                {urgent} urgent · {overdue} overdue
              </span>
            </Link>
          </div>
        )}
      </div>

      <div className="cards">
        <section className="col" aria-label="Habits due today">
          <div className="row between base">
            <h2>Habits due today</h2>
            <Link to="/habits" className="small">
              See all
            </Link>
          </div>
          {habits && logList ? (
            due.length ? due.map((h) => <HabitRow key={h.id} habit={h} logs={logs} today={today} compact />) : <p className="dim small">Nothing due today.</p>
          ) : (
            <p className="dim small">Loading…</p>
          )}
        </section>

        <section className="col" aria-label="This month">
          {items && payList && savings.length > 0 && savingsPaid < savings.length && (
            <Link to="/money/checklist" className="item red-line" style={{ color: 'var(--text)' }}>
              <span className="badge red">{ordinal(day)}</span>
              <span className="grow small">
                Savings &amp; Investment {daysLeft > 0 ? `due in ${daysLeft} days` : daysLeft === 0 ? 'due today' : `was due on the ${ordinal(day)}`} · {savingsPaid} of {savings.length} paid
              </span>
            </Link>
          )}
          <Link to="/money" className="card" style={{ gap: 8 }}>
            <div className="row between">
              <span className="eyebrow">Money this month</span>
              <Icon name="next" size={16} />
            </div>
            <div className="row between small">
              <span>Spent from cash</span>
              <span className="mono">
                {fmtRM(spent)} / {fmtRM(budget)}
              </span>
            </div>
            <Bar pct={budget ? (spent / budget) * 100 : 0} red={spent > budget} />
          </Link>
        </section>
      </div>
    </div>
  );
}
