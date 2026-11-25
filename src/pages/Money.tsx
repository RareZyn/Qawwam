import { getDocs, limit, query, where } from 'firebase/firestore';
import { type FormEvent, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ucol, useItems, usePayments, useSettings, useSnapshots, useTxns, useWallets } from '../lib/db';
import { GROUPS, type ItemInput, adjustWallet, createWallet, cycleDay, deleteWallet, groupOf, isPaid, paymentId, removeItem, saveItem, setPaid, spentByItem, unsorted, updateWallet } from '../lib/money';
import type { GroupCode, MoneyItem, Wallet, WalletType } from '../lib/types';
import { addMonths, byId, cycleMonth, cycleRange, fmtDay, fmtMonth, fmtMonthShort, fmtRM, ordinal, senToInput, sum, toSen } from '../lib/util';
import { useQuickSpend } from '../quick';
import { Bar, Check, Chips, ConfirmButton, Field, Icon, Seg, Sheet, run, toast, useToday } from '../ui';

const TYPE_LABEL: Record<WalletType, string> = { saving: 'Saving', investment: 'Investment', cash: 'Cash' };

// ---------------------------------------------------------------- wallet form

function WalletForm({ wallet, onDone }: { wallet?: Wallet; onDone: () => void }) {
  const today = useToday();
  const [title, setTitle] = useState(wallet?.title ?? '');
  const [bank, setBank] = useState(wallet?.bank ?? '');
  const [type, setType] = useState<WalletType>(wallet?.type ?? 'saving');
  const [balance, setBalance] = useState(senToInput(wallet?.balance ?? 0));

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const sen = toSen(balance);
    if (wallet) {
      await updateWallet(wallet.id, { title: title.trim(), bank: bank.trim() || null, type });
      if (sen !== wallet.balance) await adjustWallet(wallet, sen, today);
    } else await createWallet({ title: title.trim(), bank: bank.trim() || null, type, balance: sen });
    onDone();
  }

  async function remove() {
    if (!wallet) return;
    const used = await getDocs(query(ucol('transactions'), where('wallet_id', '==', wallet.id), limit(1)));
    if (used.empty) {
      await deleteWallet(wallet.id);
      toast('Wallet deleted');
    } else {
      await updateWallet(wallet.id, { status: 'archived' });
      toast('Wallet has history, so it was archived instead');
    }
    onDone();
  }

  return (
    <form id="wallet-form" className="col loose" onSubmit={(e) => run(save(e))}>
      <Field label="Title">
        <input className="input" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Maybank Savings" />
      </Field>
      <Field label="Bank (optional)">
        <input className="input" value={bank} onChange={(e) => setBank(e.target.value)} placeholder="e.g. Maybank" />
      </Field>
      {!wallet?.is_cash_pool && (
        <div className="col tight">
          <span className="small muted">Type</span>
          <Chips options={[['saving', 'Saving'], ['investment', 'Investment'], ['cash', 'Cash']]} value={type} onChange={setType} label="Wallet type" />
        </div>
      )}
      <Field label={wallet ? 'Balance now (RM). A change is saved as an adjustment.' : 'Starting balance (RM)'}>
        <input className="input num" inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} />
      </Field>
      {wallet && !wallet.is_cash_pool && <ConfirmButton label="Delete or archive wallet" confirm="Tap again to remove" onConfirm={() => run(remove())} />}
    </form>
  );
}

// ---------------------------------------------------------------- item form

function ItemForm({ group, item, wallets, onDone }: { group: GroupCode; item?: MoneyItem; wallets: Wallet[]; onDone: () => void }) {
  const [name, setName] = useState(item?.name ?? '');
  const [amount, setAmount] = useState(item ? senToInput(item.amount) : '');
  const [walletId, setWalletId] = useState(item?.wallet_id ?? '');
  const [due, setDue] = useState(item?.due_day ? String(item.due_day) : '');
  const [before, setBefore] = useState(item?.remind_days_before ?? 0);
  const cash = group === 'spent_cash';

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || toSen(amount) <= 0) return toast('Give the item a name and an amount', true);
    const dueDay = due ? Math.max(1, Math.min(31, parseInt(due, 10))) : null;
    const input: ItemInput = {
      group_id: group,
      name: name.trim(),
      amount: toSen(amount),
      wallet_id: cash ? (wallets.find((w) => w.is_cash_pool)?.id ?? null) : walletId || null,
      due_day: cash ? null : dueDay,
      remind_days_before: before,
    };
    await saveItem(input, item);
    onDone();
  }

  return (
    <form id="item-form" className="col loose" onSubmit={(e) => run(save(e))}>
      <Field label="Name">
        <input className="input" required value={name} onChange={(e) => setName(e.target.value)} placeholder={cash ? 'e.g. Makanan Beli' : 'e.g. Netflix'} />
      </Field>
      <Field label={cash ? 'Monthly budget (RM)' : 'Amount each month (RM)'}>
        <input className="input num" inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
      </Field>
      {!cash && (
        <Field label={groupOf(group).behaviour === 'deposit' ? 'Saved into wallet (ticking adds to its balance)' : 'Paid from wallet (ticking takes it off the balance)'}>
          <select className="input" value={walletId} onChange={(e) => setWalletId(e.target.value)}>
            <option value="">No wallet (just tick it)</option>
            {wallets
              .filter((w) => w.status === 'active')
              .map((w) => (
                <option key={w.id} value={w.id}>
                  {w.title}
                </option>
              ))}
          </select>
        </Field>
      )}
      {!cash && (
        <div className="two">
          <Field label="Due day (1–31)">
            <input className="input num" type="number" min={1} max={31} value={due} onChange={(e) => setDue(e.target.value)} placeholder="none" />
          </Field>
          <Field label="Remind days before">
            <select className="input" value={before} onChange={(e) => setBefore(Number(e.target.value))}>
              {[0, 1, 2, 3, 5, 7].map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? 'On the day' : `${n} day${n > 1 ? 's' : ''} before`}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}
      {item && <ConfirmButton label="Remove item" confirm="Tap again to remove" onConfirm={() => run(removeItem(item).then(onDone), 'Item removed. Its history is kept.')} />}
    </form>
  );
}

// ---------------------------------------------------------------- shared state for the sheets

function useSheets() {
  const wallets = useWallets();
  const [walletSheet, setWalletSheet] = useState<{ wallet?: Wallet } | null>(null);
  const [itemSheet, setItemSheet] = useState<{ group: GroupCode; item?: MoneyItem } | null>(null);
  const sheets = (
    <>
      <Sheet open={!!walletSheet} onClose={() => setWalletSheet(null)} title={walletSheet?.wallet ? 'Edit wallet' : 'New wallet'} formId="wallet-form">
        {walletSheet && <WalletForm key={walletSheet.wallet?.id ?? 'new'} wallet={walletSheet.wallet} onDone={() => setWalletSheet(null)} />}
      </Sheet>
      <Sheet open={!!itemSheet} onClose={() => setItemSheet(null)} title={itemSheet?.item ? 'Edit item' : `New ${itemSheet ? groupOf(itemSheet.group).short.toLowerCase() : ''} item`} formId="item-form">
        {itemSheet && wallets && <ItemForm key={itemSheet.item?.id ?? itemSheet.group} group={itemSheet.group} item={itemSheet.item} wallets={wallets} onDone={() => setItemSheet(null)} />}
      </Sheet>
    </>
  );
  return { openWallet: (wallet?: Wallet) => setWalletSheet({ wallet }), openItem: (group: GroupCode, item?: MoneyItem) => setItemSheet({ group, item }), sheets };
}

/** "25 Oct – 24 Nov" when the money month does not start on the 1st, otherwise nothing. */
export function CycleRange({ month, startDay }: { month: string; startDay: number }) {
  if (startDay <= 1) return null;
  const r = cycleRange(month, startDay);
  return (
    <span className="tiny dim">
      {fmtDay(r.start)} – {fmtDay(r.end)}
    </span>
  );
}

function MonthSwitch({ month, startDay, onChange }: { month: string; startDay: number; onChange: (m: string) => void }) {
  return (
    <div className="row" style={{ gap: 6 }}>
      <button type="button" className="btn sm icon" aria-label="Previous month" onClick={() => onChange(addMonths(month, -1))}>
        <Icon name="back" size={16} />
      </button>
      <span className="col tight small" style={{ minWidth: 112, textAlign: 'center' }}>
        {fmtMonth(month)}
        <CycleRange month={month} startDay={startDay} />
      </span>
      <button type="button" className="btn sm icon" aria-label="Next month" onClick={() => onChange(addMonths(month, 1))}>
        <Icon name="next" size={16} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- checklist (Savings & Investment, Subscription & Fixed)

function ChecklistBody({ group, month, onEdit }: { group: 'savings_investment' | 'subscription_fixed'; month: string; onEdit: (g: GroupCode, i?: MoneyItem) => void }) {
  const today = useToday();
  const items = useItems();
  const payList = usePayments();
  const wallets = useWallets();
  const settings = useSettings();
  const payments = byId(payList);
  const wmap = byId(wallets);
  const list = (items ?? []).filter((i) => i.group_id === group && i.status === 'active').sort((a, b) => a.sort_order - b.sort_order);
  const total = sum(list, (i) => i.amount);
  const paidList = list.filter((i) => isPaid(payments, i.id, month));
  const paid = sum(paidList, (i) => payments[paymentId(i.id, month)]?.amount ?? i.amount);
  const g = groupOf(group);

  return (
    <section className="card" aria-label={g.name}>
      <div className="row between base">
        <h2>{g.name}</h2>
        <button type="button" className="link" onClick={() => onEdit(group)}>
          + Item
        </button>
      </div>
      <div className="row between small muted">
        <span>
          <strong style={{ color: 'var(--text)', fontFamily: 'var(--mono)' }}>{fmtRM(paid)}</strong> of {fmtRM(total)}
        </span>
        <span>
          {paidList.length} of {list.length} ticked
        </span>
      </div>
      <Bar pct={total ? (paid / total) * 100 : 0} />
      <span className="tiny blue">{group === 'savings_investment' ? `Reminder every ${ordinal(settings?.savings_reminder_day ?? 25)}` : 'Reminder on each item’s due day'}</span>
      {!items || !payList ? (
        <span className="small dim">Loading…</span>
      ) : (
        list.map((i) => {
          const on = isPaid(payments, i.id, month);
          const w = i.wallet_id ? wmap[i.wallet_id] : undefined;
          return (
            <div key={i.id} className="line">
              <Check checked={on} label={`${i.name} paid for ${fmtMonth(month)}`} onChange={(v) => run(setPaid(i, month, v, payments[paymentId(i.id, month)], settings?.cash_wallet_id ?? null, today, cycleDay(settings)))} />
              <button type="button" className="grow col tight link" style={{ color: 'var(--text)', textAlign: 'left', fontSize: 15 }} onClick={() => onEdit(group, i)}>
                <span>{i.name}</span>
                <span className="tiny dim">
                  {w ? w.title : 'No wallet'}
                  {i.due_day ? ` · due ${ordinal(i.due_day)}` : ''}
                </span>
              </button>
              <span className="mono small nowrap">{fmtRM(i.amount)}</span>
            </div>
          );
        })
      )}
    </section>
  );
}

export function Checklist() {
  const today = useToday();
  const [params, setParams] = useSearchParams();
  const group = (params.get('g') === 'subs' ? 'subscription_fixed' : 'savings_investment') as 'savings_investment' | 'subscription_fixed';
  const settings = useSettings();
  const startDay = cycleDay(settings);
  // Follow the current cycle until a month is picked, so it is right once settings load.
  const [picked, setMonth] = useState<string | null>(null);
  const month = picked ?? cycleMonth(today, startDay);
  const { openItem, sheets } = useSheets();
  return (
    <div className="page narrow">
      <header className="head">
        <div className="row">
          <Link to="/money" className="btn icon" aria-label="Back to money">
            <Icon name="back" />
          </Link>
          <h1>Monthly checklist</h1>
        </div>
        <MonthSwitch month={month} startDay={startDay} onChange={setMonth} />
      </header>
      <Seg
        options={[['savings_investment', 'Savings & Invest.'], ['subscription_fixed', 'Subscription & Fixed']]}
        value={group}
        onChange={(g) => setParams(g === 'subscription_fixed' ? { g: 'subs' } : {}, { replace: true })}
        label="Group"
      />
      <ChecklistBody group={group} month={month} onEdit={openItem} />
      <p className="tiny dim">
        Ticking records the amount against the item's wallet (savings go in, bills come out) and unticking reverses it. Ticks from your spreadsheet (June to November 2026) are already
        in, without changing balances.
      </p>
      {sheets}
    </div>
  );
}

// ---------------------------------------------------------------- Spent & Cash

function SpentBody({ onEdit }: { onEdit: (g: GroupCode, i?: MoneyItem) => void }) {
  const today = useToday();
  const items = useItems();
  const payList = usePayments();
  const txns = useTxns();
  const wallets = useWallets();
  const settings = useSettings();
  const quick = useQuickSpend();
  const startDay = cycleDay(settings);
  const month = cycleMonth(today, startDay);
  const payments = byId(payList);
  const cash = wallets?.find((w) => w.id === settings?.cash_wallet_id) ?? wallets?.find((w) => w.is_cash_pool);
  const list = (items ?? []).filter((i) => i.group_id === 'spent_cash' && i.status === 'active').sort((a, b) => a.sort_order - b.sort_order);
  const spent = spentByItem(txns ?? [], month, startDay);
  const budget = sum(list, (i) => i.amount);
  const totalSpent = sum(list, (i) => spent[i.id] ?? 0);
  const over = list.filter((i) => (spent[i.id] ?? 0) > i.amount);
  const loose = unsorted(txns ?? []).filter((t) => t.wallet_id === cash?.id && cycleMonth(t.txn_date, startDay) === month);

  return (
    <section className="col" aria-label="Spent and cash">
      <div className="card fill-blue">
        <span className="eyebrow">Cash in hand · pool wallet</span>
        <span className="big">{cash ? fmtRM(cash.balance) : '…'}</span>
        <Bar pct={budget ? (totalSpent / budget) * 100 : 0} thick />
        <div className="row between small">
          <span>{fmtRM(totalSpent)} spent</span>
          <span>Budget {fmtRM(budget)}</span>
        </div>
      </div>
      {over.map((i) => (
        <div key={i.id} className="alert" role="alert">
          <span className="badge red">!</span>
          <span>
            {i.name} is {fmtRM((spent[i.id] ?? 0) - i.amount)} over budget. The extra still comes out of Cash in Hand.
          </span>
        </div>
      ))}
      {list.map((i) => {
        const s = spent[i.id] ?? 0;
        const isOver = s > i.amount;
        const allocated = isPaid(payments, i.id, month);
        return (
          <div key={i.id} className="item" style={{ alignItems: 'flex-start', paddingTop: 12, paddingBottom: 12 }}>
            <Check checked={allocated} label={`Move ${i.name} budget into cash for ${fmtMonth(month)}`} onChange={(v) => run(setPaid(i, month, v, payments[paymentId(i.id, month)], cash?.id ?? null, today, startDay))} />
            <div className="grow col" style={{ gap: 6 }}>
              <div className="row between base">
                <button type="button" className="link" style={{ color: 'var(--text)', fontSize: 15, textAlign: 'left' }} onClick={() => onEdit('spent_cash', i)}>
                  {i.name}
                </button>
                <span className="mono small nowrap">
                  <span className={isOver ? 'red' : ''}>{fmtRM(s)}</span>
                  <span className="dim"> / {fmtRM(i.amount)}</span>
                </span>
              </div>
              <Bar pct={(s / i.amount) * 100} red={isOver} />
              <div className="row between">
                <span className={`tiny ${isOver ? 'red' : 'dim'}`}>{isOver ? `${fmtRM(s - i.amount)} over budget` : `${fmtRM(i.amount - s)} left`}</span>
                <button type="button" className="link" onClick={() => quick(i.id)}>
                  + Spend
                </button>
              </div>
            </div>
          </div>
        );
      })}
      <div className="row between">
        <button type="button" className="link" onClick={() => onEdit('spent_cash')}>
          + Item
        </button>
        <span className="tiny dim">Tick = this month's budget moved into cash</span>
      </div>
      {loose.length > 0 && (
        <Link to="/money/transactions" className="item" style={{ borderStyle: 'dashed', color: 'var(--text)', justifyContent: 'space-between' }}>
          <span className="small">Uncategorised from cash</span>
          <span className="mono small muted">
            {loose.length} · {fmtRM(-sum(loose, (t) => t.amount))}
          </span>
        </Link>
      )}
    </section>
  );
}

export function Spent() {
  const today = useToday();
  const startDay = cycleDay(useSettings());
  const month = cycleMonth(today, startDay);
  const { openItem, sheets } = useSheets();
  return (
    <div className="page narrow">
      <header className="head">
        <div className="row">
          <Link to="/money" className="btn icon" aria-label="Back to money">
            <Icon name="back" />
          </Link>
          <div className="col tight">
            <h1>Spent &amp; Cash</h1>
            <span className="tiny dim">
              {fmtMonth(month)}
              {startDay > 1 && ` · ${fmtDay(cycleRange(month, startDay).start)} – ${fmtDay(cycleRange(month, startDay).end)}`}
            </span>
          </div>
        </div>
      </header>
      <SpentBody onEdit={openItem} />
      {sheets}
    </div>
  );
}

// ---------------------------------------------------------------- overview

function WalletRail({ wallets, onOpen }: { wallets: Wallet[]; onOpen: (w?: Wallet) => void }) {
  const [active, setActive] = useState(0);
  return (
    <>
      <div
        className="rail"
        onScroll={(e) => {
          const el = e.currentTarget;
          const i = el.scrollLeft >= el.scrollWidth - el.clientWidth - 2 ? wallets.length - 1 : Math.round(el.scrollLeft / 178);
          if (i !== active) setActive(i);
        }}
      >
        {wallets.map((w) => (
          <button key={w.id} type="button" className={`wallet${w.is_cash_pool ? ' pool' : ''}`} onClick={() => onOpen(w)}>
            <span className="eyebrow">{w.is_cash_pool ? 'Cash · pool' : TYPE_LABEL[w.type]}</span>
            <span style={{ fontWeight: 600 }}>{w.title}</span>
            <span className="tiny" style={{ opacity: 0.75 }}>
              {w.bank ?? (w.is_cash_pool ? 'Spent & Cash' : '—')}
            </span>
            <span className="mono" style={{ fontSize: 17, marginTop: 'auto' }}>
              {fmtRM(w.balance)}
            </span>
          </button>
        ))}
      </div>
      <div className="dots only-mobile" aria-hidden="true">
        {wallets.map((w, i) => (
          <i key={w.id} className={i === active ? 'on' : ''} />
        ))}
      </div>
    </>
  );
}

function SavingsTrend() {
  const snaps = useSnapshots();
  const rows = useMemo(() => {
    const byMonth = new Map<string, number>();
    for (const s of snaps ?? []) byMonth.set(s.month, (byMonth.get(s.month) ?? 0) + s.balance);
    return [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-6);
  }, [snaps]);
  if (!rows.length) return null;
  const max = Math.max(...rows.map(([, v]) => v));
  return (
    <section className="card">
      <div className="row between base">
        <h2>Total savings, month end</h2>
        <span className="mono small">{fmtRM(rows[rows.length - 1][1])}</span>
      </div>
      <div className="bars" role="img" aria-label={rows.map(([m, v]) => `${fmtMonth(m)}: ${fmtRM(v)}`).join('; ')}>
        {rows.map(([m, v]) => (
          <div key={m}>
            <span className="mono">{(v / 100000).toFixed(1)}k</span>
            <i style={{ height: `${Math.max(4, (v / max) * 80)}px` }} />
            <span>{fmtMonthShort(m)}</span>
          </div>
        ))}
      </div>
      <span className="tiny dim">From your spreadsheet: Kecemasan, ASNB, Tabung Haji, Kahwin and KWSP. The October total includes KWSP for the first time.</span>
    </section>
  );
}

export default function Money() {
  const today = useToday();
  const wallets = useWallets();
  const items = useItems();
  const payList = usePayments();
  const txns = useTxns();
  const settings = useSettings();
  const quick = useQuickSpend();
  const { openWallet, openItem, sheets } = useSheets();
  const startDay = cycleDay(settings);
  const month = cycleMonth(today, startDay);
  const payments = byId(payList);
  const activeWallets = (wallets ?? []).filter((w) => w.status === 'active').sort((a, b) => a.sort_order - b.sort_order);
  const total = sum(activeWallets, (w) => w.balance);
  const toSort = unsorted(txns ?? []).length;
  const planned = sum((items ?? []).filter((i) => i.status === 'active'), (i) => i.amount);
  const spent = spentByItem(txns ?? [], month, startDay);

  const groupCard = (code: GroupCode) => {
    const list = (items ?? []).filter((i) => i.group_id === code && i.status === 'active');
    const tot = sum(list, (i) => i.amount);
    if (code === 'spent_cash') {
      const s = sum(list, (i) => spent[i.id] ?? 0);
      const over = list.filter((i) => (spent[i.id] ?? 0) > i.amount);
      return { tot, pct: tot ? (s / tot) * 100 : 0, progress: `${fmtRM(s)} spent`, note: over.length ? `${over[0].name} over budget` : 'Within budget', warn: over.length > 0 };
    }
    const done = list.filter((i) => isPaid(payments, i.id, month));
    const paid = sum(done, (i) => i.amount);
    return { tot, pct: tot ? (paid / tot) * 100 : 0, progress: `${done.length} of ${list.length} ticked`, note: fmtRM(paid), warn: false };
  };

  return (
    <div className="page">
      <header className="head">
        <h1>Money</h1>
        <div className="row">
          <Link to="/money/transactions" className="btn">
            History {toSort > 0 && <span className="badge red">{toSort}</span>}
          </Link>
          <button type="button" className="btn primary only-desktop" onClick={() => quick()}>
            + Quick spend
          </button>
        </div>
      </header>

      <section className="col tight">
        <span className="small dim">Total across wallets</span>
        <span className="big">{wallets ? fmtRM(total) : '…'}</span>
        {settings?.monthly_income ? (
          <span className="tiny muted">
            Monthly plan: {fmtRM(planned)} of {fmtRM(settings.monthly_income)} income ({fmtRM(settings.monthly_income - planned)} unplanned)
          </span>
        ) : null}
      </section>

      <section className="col">
        <div className="row between base">
          <h2>Wallets</h2>
          <button type="button" className="link" onClick={() => openWallet()}>
            + New wallet
          </button>
        </div>
        {wallets ? <WalletRail wallets={activeWallets} onOpen={openWallet} /> : <p className="dim small">Loading…</p>}
      </section>

      <section className="col only-mobile">
        <div className="row between base">
          <h2>{fmtMonth(month)}</h2>
          <CycleRange month={month} startDay={startDay} />
        </div>
        {GROUPS.map((g) => {
          const c = groupCard(g.code);
          const to = g.code === 'spent_cash' ? '/money/spent' : g.code === 'subscription_fixed' ? '/money/checklist?g=subs' : '/money/checklist';
          return (
            <Link key={g.code} to={to} className="card" style={{ gap: 10 }}>
              <div className="row between base">
                <span style={{ fontWeight: 600 }}>{g.name}</span>
                <span className="mono small">{fmtRM(c.tot)}</span>
              </div>
              <Bar pct={c.pct} />
              <div className="row between tiny muted">
                <span>{c.progress}</span>
                <span className={c.warn ? 'red' : ''}>{c.note}</span>
              </div>
            </Link>
          );
        })}
      </section>

      <div className="cards only-desktop">
        <ChecklistBody group="savings_investment" month={month} onEdit={openItem} />
        <ChecklistBody group="subscription_fixed" month={month} onEdit={openItem} />
        <div className="card">
          <div className="row between base">
            <h2>Spent &amp; Cash</h2>
            <Link to="/money/spent" className="small">
              Open
            </Link>
          </div>
          <SpentBody onEdit={openItem} />
        </div>
      </div>
      <Link to="/money/checklist" className="small only-desktop">
        See other months in the checklist
      </Link>

      <SavingsTrend />
      {sheets}
    </div>
  );
}
