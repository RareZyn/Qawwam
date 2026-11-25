import { type FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { useItems, useSettings, useTxns, useWallets } from '../lib/db';
import { GROUPS, categoriseTxn, cycleDay, editTxn, removeTxn, unsorted } from '../lib/money';
import type { Txn } from '../lib/types';
import { addMonths, byId, cycleMonth, cycleRange, fmtDay, fmtMonth, fmtRM, senToInput, toSen } from '../lib/util';
import { ConfirmButton, Field, Icon, Sheet, run, useToday } from '../ui';
import QuickSpendForm from './QuickSpend';

const SOURCE: Record<Txn['source'], string> = { quick: 'Quick spend', item_spend: 'Spend', item_payment: 'Checklist', adjustment: 'Adjustment' };

function TxnForm({ txn, onDone }: { txn: Txn; onDone: () => void }) {
  const today = useToday();
  const [amount, setAmount] = useState(senToInput(Math.abs(txn.amount)));
  const [note, setNote] = useState(txn.note ?? '');
  const [date, setDate] = useState(txn.txn_date);
  async function save(e: FormEvent) {
    e.preventDefault();
    const sen = toSen(amount);
    if (sen <= 0) return;
    await editTxn(txn, { amount: txn.amount < 0 ? -sen : sen, note: note.trim() || null, txn_date: date });
    onDone();
  }
  return (
    <form id="txn-form" className="col loose" onSubmit={(e) => run(save(e))}>
      <Field label={txn.amount < 0 ? 'Amount out (RM)' : 'Amount in (RM)'}>
        <input className="input num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <Field label="Note">
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <Field label="Date">
        <input className="input" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value || txn.txn_date)} />
      </Field>
      <p className="tiny dim">Changing the amount moves the wallet balance by the difference. Deleting puts the money back{txn.payment_id ? ' and unticks the checklist item' : ''}.</p>
      <ConfirmButton label="Delete transaction" confirm="Tap again to delete" onConfirm={() => run(removeTxn(txn).then(onDone), 'Transaction deleted')} />
    </form>
  );
}

export default function Transactions() {
  const today = useToday();
  const txns = useTxns();
  const wallets = useWallets();
  const items = useItems();
  const wmap = byId(wallets);
  const imap = byId(items);
  const [wallet, setWallet] = useState('');
  const [group, setGroup] = useState('');
  const startDay = cycleDay(useSettings());
  const [picked, setMonth] = useState<string | null>(null);
  const month = picked ?? cycleMonth(today, startDay);
  const [editing, setEditing] = useState<Txn | null>(null);
  const toSort = unsorted(txns ?? []).sort((a, b) => b.txn_date.localeCompare(a.txn_date) || b.created_ms - a.created_ms);
  const cats = (items ?? []).filter((i) => i.status === 'active').sort((a, b) => a.group_id.localeCompare(b.group_id) || a.sort_order - b.sort_order);
  const months = [0, -1, -2, -3].map((n) => addMonths(cycleMonth(today, startDay), n));

  const list = (txns ?? [])
    .filter((t) => cycleMonth(t.txn_date, startDay) === month)
    .filter((t) => !wallet || t.wallet_id === wallet)
    .filter((t) => !group || (group === 'none' ? !t.group_id : t.group_id === group))
    .sort((a, b) => b.txn_date.localeCompare(a.txn_date) || b.created_ms - a.created_ms);
  const days = [...new Set(list.map((t) => t.txn_date))];
  const net = list.reduce((a, t) => a + t.amount, 0);

  return (
    <div className="page">
      <header className="head">
        <div className="row">
          <Link to="/money" className="btn icon only-mobile" aria-label="Back to money">
            <Icon name="back" />
          </Link>
          <h1>Transactions</h1>
        </div>
        <div className="row wrap">
          <select className="input sm" style={{ width: 'auto' }} aria-label="Wallet" value={wallet} onChange={(e) => setWallet(e.target.value)}>
            <option value="">All wallets</option>
            {(wallets ?? []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.title}
              </option>
            ))}
          </select>
          <select className="input sm" style={{ width: 'auto' }} aria-label="Group" value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="">All groups</option>
            {GROUPS.map((g) => (
              <option key={g.code} value={g.code}>
                {g.name}
              </option>
            ))}
            <option value="none">Uncategorised</option>
          </select>
          <select className="input sm" style={{ width: 'auto' }} aria-label="Month" value={month} onChange={(e) => setMonth(e.target.value)}>
            {months.map((m) => (
              <option key={m} value={m}>
                {fmtMonth(m)}
                {startDay > 1 && ` (${fmtDay(cycleRange(m, startDay).start)} – ${fmtDay(cycleRange(m, startDay).end)})`}
              </option>
            ))}
          </select>
        </div>
      </header>

      <div className="split">
        <div className="wide col loose">
          {toSort.length > 0 && (
            <section className="card red-line">
              <div className="row between base">
                <h2>To sort · {toSort.length}</h2>
                <span className="mono small muted">{fmtRM(-toSort.reduce((a, t) => a + t.amount, 0))}</span>
              </div>
              {toSort.map((t) => (
                <div key={t.id} className="line wrap" style={{ flexWrap: 'wrap' }}>
                  <div className="grow col tight" style={{ minWidth: 140 }}>
                    <span className="mono">{fmtRM(Math.abs(t.amount))}</span>
                    <span className="tiny dim">
                      {wmap[t.wallet_id]?.title ?? 'Wallet'} · {fmtDay(t.txn_date)}
                      {t.note ? ` · ${t.note}` : ''}
                    </span>
                  </div>
                  <select
                    className="input sm"
                    style={{ width: 'auto', maxWidth: 200 }}
                    aria-label="Assign category"
                    value=""
                    onChange={(e) => run(categoriseTxn(t, imap[e.target.value] ?? null), 'Sorted')}
                  >
                    <option value="">Assign category…</option>
                    {cats.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </section>
          )}

          <div className="row between small muted">
            <span>
              {list.length} transactions in {fmtMonth(month)}
            </span>
            <span className="mono">{fmtRM(net, true)}</span>
          </div>
          {!txns ? (
            <p className="dim small">Loading…</p>
          ) : !list.length ? (
            <p className="dim small">No transactions here yet. Quick spends, checklist ticks and balance changes show up in this list.</p>
          ) : (
            days.map((d) => (
              <section key={d} className="col tight">
                <h2 className="eyebrow">{d === today ? `Today · ${fmtDay(d)}` : fmtDay(d)}</h2>
                {list
                  .filter((t) => t.txn_date === d)
                  .map((t) => (
                    <button key={t.id} type="button" className="line" style={{ background: 'none', border: 0, borderTop: '1px solid var(--soft)', width: '100%', textAlign: 'left' }} onClick={() => setEditing(t)}>
                      <div className="grow col tight">
                        <span>{(t.item_id && imap[t.item_id]?.name) || t.note || (t.source === 'adjustment' ? 'Balance adjustment' : 'Uncategorised')}</span>
                        <span className="tiny dim">
                          {SOURCE[t.source]} · {wmap[t.wallet_id]?.title ?? 'Wallet'}
                          {t.note && t.item_id ? ` · ${t.note}` : ''}
                        </span>
                      </div>
                      <span className={`mono ${t.amount > 0 ? 'blue' : ''}`}>{fmtRM(t.amount, true)}</span>
                    </button>
                  ))}
              </section>
            ))
          )}
          <p className="tiny dim">Showing the last 4 months.</p>
        </div>

        <aside className="side card blue-line only-desktop" aria-label="Quick spend">
          <h2>Quick spend</h2>
          <QuickSpendForm />
        </aside>
      </div>

      <Sheet open={!!editing} onClose={() => setEditing(null)} title="Edit transaction" formId="txn-form">
        {editing && <TxnForm key={editing.id} txn={editing} onDone={() => setEditing(null)} />}
      </Sheet>
    </div>
  );
}
