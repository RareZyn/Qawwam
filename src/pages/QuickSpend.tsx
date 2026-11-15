import { useState } from 'react';
import { useItems, useSettings, useWallets } from '../lib/db';
import { addTxn } from '../lib/money';
import { fmtRM, toSen } from '../lib/util';
import { Chips, Field, run, useIsDesktop, useToday } from '../ui';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'];

/** Two taps from Home: open, type the amount, save. Wallet and category are optional extras. */
export default function QuickSpendForm({ presetItemId, onDone }: { presetItemId?: string; onDone?: () => void }) {
  const today = useToday();
  const desktop = useIsDesktop();
  const wallets = useWallets();
  const items = useItems();
  const settings = useSettings();
  const cashId = settings?.cash_wallet_id ?? wallets?.find((w) => w.is_cash_pool)?.id ?? '';
  const [amount, setAmount] = useState('');
  const [walletId, setWalletId] = useState('');
  const [itemId, setItemId] = useState(presetItemId ?? '');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(today);
  const wallet = wallets?.find((w) => w.id === (walletId || cashId));
  const cats = (items ?? []).filter((i) => i.group_id === 'spent_cash' && i.status === 'active').sort((a, b) => a.sort_order - b.sort_order);
  const sen = toSen(amount);

  const press = (k: string) =>
    setAmount((a) => {
      if (k === 'del') return a.slice(0, -1);
      if (k === '.') return a.includes('.') ? a : (a || '0') + '.';
      if (a.includes('.') && a.split('.')[1].length >= 2) return a;
      if (a.replace('.', '').length >= 7) return a;
      return a === '0' ? k : a + k;
    });

  function save() {
    if (!wallet || sen <= 0) return;
    const item = cats.find((c) => c.id === itemId);
    run(
      addTxn({
        wallet_id: wallet.id,
        amount: -sen,
        group_id: item ? 'spent_cash' : null,
        item_id: item?.id ?? null,
        source: item ? 'item_spend' : 'quick',
        note: note.trim() || null,
        txn_date: date,
      }),
      `Saved ${fmtRM(sen)}${item ? ` · ${item.name}` : ' · sort it later'}`,
    );
    setAmount('');
    setNote('');
    setItemId(presetItemId ?? '');
    onDone?.();
  }

  return (
    <form
      className="col loose"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <label className="col tight center">
        <span className="small dim">Amount</span>
        <span className="amount">
          <small>RM </small>
          <input
            aria-label="Amount in ringgit"
            value={amount}
            inputMode={desktop ? 'decimal' : 'none'}
            placeholder="0"
            autoFocus={desktop}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
            style={{ width: `${Math.max(1, amount.length || 1) + 0.5}ch`, maxWidth: '8ch', background: 'transparent', border: 0, outline: 'none', font: 'inherit', color: 'inherit', textAlign: 'left' }}
          />
        </span>
      </label>
      {wallet && sen > wallet.balance && <p className="tiny red center">More than {wallet.title} holds ({fmtRM(wallet.balance)}). It will still be saved.</p>}

      <div className="col tight">
        <span className="tiny dim">From wallet</span>
        <Chips
          scroll={!desktop}
          options={(wallets ?? []).filter((w) => w.status === 'active').map((w) => [w.id, w.title] as [string, string])}
          value={walletId || cashId}
          onChange={setWalletId}
          label="From wallet"
        />
      </div>
      <div className="col tight">
        <span className="tiny dim">Category (optional, sort it later)</span>
        <Chips scroll={!desktop} options={[['', 'None'], ...cats.map((c) => [c.id, c.name] as [string, string])]} value={itemId} onChange={setItemId} label="Category" />
      </div>
      <div className="two">
        <Field label="Note">
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
        </Field>
        <Field label="Date">
          <input className="input" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value || today)} />
        </Field>
      </div>
      <div className="keypad only-mobile">
        {KEYS.map((k) => (
          <button key={k} type="button" aria-label={k === 'del' ? 'Delete' : k} onClick={() => press(k)}>
            {k === 'del' ? '⌫' : k}
          </button>
        ))}
      </div>
      <button type="submit" className="btn primary lg" disabled={!wallet || sen <= 0}>
        Save spend
      </button>
    </form>
  );
}
