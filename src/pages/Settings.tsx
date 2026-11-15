import { type User, signOut } from 'firebase/auth';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { exportAll, rebuildSummaries, removeSampleData, saveReminder, updateSettings } from '../lib/actions';
import { useReminders, useSettings, useWallets } from '../lib/db';
import { auth } from '../lib/firebase';
import { fmtRM, senToInput, toSen } from '../lib/util';
import { ConfirmButton, Field, Toggle, run, toast } from '../ui';
import { PermissionNote } from './Reminders';
import { resetDevicePattern } from './Vault';

const HUB: [string, string, string][] = [
  ['/vault', 'Passwords', 'Locked vault'],
  ['/books', 'Books', 'Reading tracker'],
  ['/reminders', 'Reminders', 'Scheduled and recent'],
  ['/money/transactions', 'Transactions', 'History and sorting'],
  ['/habits/dashboard', 'Habit dashboard', 'Scores and heatmap'],
  ['/money/checklist', 'Monthly checklist', 'Savings and bills'],
];

const MODULES: [string, string][] = [
  ['habit', 'Habits'],
  ['money', 'Money'],
  ['todo', 'To-Do'],
  ['book', 'Books'],
];

function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Settings({ user }: { user: User }) {
  const settings = useSettings();
  const wallets = useWallets();
  const reminders = useReminders();
  const [income, setIncome] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [install, setInstall] = useState(() => window.__qwInstall ?? null);
  const enabled = settings?.notifications_enabled ?? {};
  const provider = user.providerData[0]?.providerId === 'google.com' ? 'Google' : 'email and password';
  const name = user.displayName || user.email?.split('@')[0] || 'You';

  async function saveDay() {
    const d = Math.max(1, Math.min(28, parseInt(day ?? '', 10) || 25));
    await updateSettings({ savings_reminder_day: d });
    const sys = reminders?.find((r) => r.id === 'sys_savings');
    if (sys) {
      await saveReminder(
        { module: sys.module, ref_id: sys.ref_id, title: sys.title, body: sys.body, recurrence: { ...sys.recurrence, day_of_month: d }, remind_days_before: sys.remind_days_before },
        sys,
      );
    }
    setDay(null);
    toast(`Savings reminder moved to day ${d}`);
  }

  return (
    <div className="page narrow">
      <h1>
        <span className="only-mobile">More</span>
        <span className="only-desktop">Settings</span>
      </h1>

      <section className="card" style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="avatar">{name.charAt(0).toUpperCase()}</span>
        <div className="grow col tight">
          <strong>{name}</strong>
          <span className="small dim">
            {user.email} · signed in with {provider}
          </span>
        </div>
        <button type="button" className="btn danger" onClick={() => run(signOut(auth))}>
          Log out
        </button>
      </section>

      <section className="cards small only-mobile" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        {HUB.map(([to, title, sub]) => (
          <Link key={to} to={to} className="card" style={{ minHeight: 84, justifyContent: 'space-between', padding: 14 }}>
            <strong>{title}</strong>
            <span className="tiny dim">{sub}</span>
          </Link>
        ))}
      </section>

      <div className="cards">
        <section className="card">
          <h2>Password vault</h2>
          <label className="line row between small">
            Lock after being idle for
            <select
              className="input sm"
              style={{ width: 'auto' }}
              value={settings?.lock_timeout_seconds ?? 60}
              onChange={(e) => run(updateSettings({ lock_timeout_seconds: Number(e.target.value) }))}
            >
              <option value={30}>30 seconds</option>
              <option value={60}>60 seconds</option>
              <option value={300}>5 minutes</option>
            </select>
          </label>
          <div className="line row between small">
            <span>Pattern on this device</span>
            <ConfirmButton
              className="btn sm"
              label="Reset pattern"
              confirm="Tap again: you will need the passphrase"
              onConfirm={() => {
                resetDevicePattern();
                toast('Pattern cleared. Unlock with your passphrase to set a new one.');
              }}
            />
          </div>
          <p className="tiny dim">The master passphrase encrypts everything and cannot be recovered. The pattern only unlocks it on this device.</p>
        </section>

        <section className="card">
          <h2>Notifications</h2>
          {MODULES.map(([k, label]) => (
            <div key={k} className="line row between small">
              <span>{label}</span>
              <Toggle
                checked={enabled[k] !== false}
                onChange={(v) => run(updateSettings({ notifications_enabled: { ...enabled, [k]: v } }))}
                label={`${label} notifications`}
              />
            </div>
          ))}
          <PermissionNote />
        </section>

        <section className="card">
          <h2>Money</h2>
          <form
            className="line row between small"
            onSubmit={(e) => {
              e.preventDefault();
              run(updateSettings({ monthly_income: toSen(income ?? '0') }).then(() => setIncome(null)), 'Income saved');
            }}
          >
            <span>Monthly income (RM)</span>
            <span className="row">
              <input className="input sm num" style={{ width: 110 }} inputMode="decimal" value={income ?? senToInput(settings?.monthly_income ?? 0)} onChange={(e) => setIncome(e.target.value)} aria-label="Monthly income" />
              {income !== null && (
                <button type="submit" className="btn sm soft">
                  Save
                </button>
              )}
            </span>
          </form>
          <form
            className="line row between small"
            onSubmit={(e) => {
              e.preventDefault();
              run(saveDay());
            }}
          >
            <span>Savings reminder day</span>
            <span className="row">
              <input className="input sm num" style={{ width: 70 }} type="number" min={1} max={28} value={day ?? String(settings?.savings_reminder_day ?? 25)} onChange={(e) => setDay(e.target.value)} aria-label="Savings reminder day" />
              {day !== null && (
                <button type="submit" className="btn sm soft">
                  Save
                </button>
              )}
            </span>
          </form>
          <label className="line row between small">
            Cash pool wallet
            <select className="input sm" style={{ width: 'auto' }} value={settings?.cash_wallet_id ?? ''} onChange={(e) => run(updateSettings({ cash_wallet_id: e.target.value }))}>
              {(wallets ?? [])
                .filter((w) => w.type === 'cash' && w.status === 'active')
                .map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.title} · {fmtRM(w.balance)}
                  </option>
                ))}
            </select>
          </label>
        </section>

        <section className="card">
          <h2>Data</h2>
          <div className="line row between small">
            <span>Export everything (JSON)</span>
            <button type="button" className="btn sm soft" onClick={() => run(exportAll().then((d) => download(`qawwam-export-${new Date().toISOString().slice(0, 10)}.json`, d)), 'Preparing export…')}>
              Download
            </button>
          </div>
          <div className="line row between small">
            <span>Recalculate habit scores</span>
            <button type="button" className="btn sm" onClick={() => run(rebuildSummaries().then((n) => toast(`Recalculated ${n} periods`)))}>
              Recalculate
            </button>
          </div>
          {!settings?.sample_removed_ms && (
            <div className="line row between small" style={{ flexWrap: 'wrap' }}>
              <span className="grow">Remove the example habits, to-dos, books, reminders and accounts (your money data stays)</span>
              <ConfirmButton label="Remove examples" confirm="Tap again to remove" onConfirm={() => run(removeSampleData().then((n) => toast(`Removed ${n} example records`)))} />
            </div>
          )}
          <div className="line row between small">
            <span>Install app</span>
            {install ? (
              <button
                type="button"
                className="btn sm primary"
                onClick={() => {
                  void install.prompt();
                  window.__qwInstall = null;
                  setInstall(null);
                }}
              >
                Install
              </button>
            ) : (
              <span className="tiny dim right">{matchMedia('(display-mode: standalone)').matches ? 'Installed' : 'Use “Add to Home Screen” in your browser menu'}</span>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
