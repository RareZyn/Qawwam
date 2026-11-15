import { deleteDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { type FormEvent, type PointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { updateSettings } from '../lib/actions';
import { uid, udoc, usePwCats, usePwEntries, useSettings } from '../lib/db';
import { pwCategoryId } from '../lib/seed';
import type { GenRules, PwCategory, PwEntry, PwSecret } from '../lib/types';
import { newId } from '../lib/util';
import {
  DEFAULT_RULES, SAMPLE_ACCOUNTS, STRENGTH_LABEL, type Wrapped, createVault, decryptSecret, encryptSecret, fingerprint, generatePassword, strength,
  unlockWithPassphrase, unlockWithPattern, wrapForDevice,
} from '../lib/vault';
import { MAX_TRIES, clearDeviceWrap, clearFails, failState, getVk, loadDeviceWrap, recordFail, saveDeviceWrap, setVk, useVk } from '../lib/vaultState';
import { Bar, Chips, ConfirmButton, Field, Icon, Panel, Sheet, Toggle, run, toast } from '../ui';

// ---------------------------------------------------------------- pattern pad

const CELL = 64;
const GAP = 26;
const center = (i: number) => ({ x: (i % 3) * (CELL + GAP) + CELL / 2, y: Math.floor(i / 3) * (CELL + GAP) + CELL / 2 });

/** 3×3 pattern. Drag across the dots, or tap them one by one and press the button. */
function PatternPad({ onComplete, busy, action }: { onComplete: (pattern: string) => void; busy?: boolean; action: string }) {
  const [seq, setSeq] = useState<number[]>([]);
  const seqRef = useRef<number[]>([]);
  const dragging = useRef(false);
  const moved = useRef(false);
  const update = (s: number[]) => {
    seqRef.current = s;
    setSeq(s);
  };
  const add = (i: number) => {
    if (i < 0 || seqRef.current.includes(i)) return;
    update([...seqRef.current, i]);
  };
  const hit = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-dot]');
    return el ? Number(el.dataset.dot) : -1;
  };
  const finish = () => {
    if (seqRef.current.length < 4) return;
    const p = seqRef.current.join('-');
    update([]);
    onComplete(p);
  };

  const down = (e: PointerEvent) => {
    if (busy) return;
    dragging.current = true;
    moved.current = false;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    add(hit(e.clientX, e.clientY));
  };
  const move = (e: PointerEvent) => {
    if (!dragging.current) return;
    const before = seqRef.current.length;
    add(hit(e.clientX, e.clientY));
    if (seqRef.current.length > before && before > 0) moved.current = true;
  };
  const up = () => {
    dragging.current = false;
    // A drag through 4+ dots submits right away; single taps keep adding until the button is pressed.
    if (moved.current) finish();
  };

  const pts = seq.map(center);
  return (
    <div className="col" style={{ alignItems: 'center', gap: 18 }}>
      <div className="pattern" role="group" aria-label="Pattern lock: drag across at least 4 dots, or tap them in order" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <svg aria-hidden="true">
          <polyline points={pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#B6DFF5" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" />
        </svg>
        {Array.from({ length: 9 }, (_, i) => {
          const k = seq.indexOf(i);
          return (
            <button
              key={i}
              type="button"
              data-dot={i}
              disabled={busy}
              className={k >= 0 ? 'on' : ''}
              aria-label={`Dot ${i + 1}${k >= 0 ? `, selected ${k + 1}` : ''}`}
              onClick={(e) => e.detail === 0 && add(i)}
            >
              <i>{k >= 0 ? k + 1 : ''}</i>
            </button>
          );
        })}
      </div>
      <div className="row">
        <button type="button" className="btn" disabled={!seq.length || busy} onClick={() => update([])}>
          Clear
        </button>
        <button type="button" className="btn primary" disabled={seq.length < 4 || busy} onClick={finish}>
          {busy ? 'Checking…' : action}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- gate: set up, unlock with passphrase, unlock with pattern

function serverWrap(s: { vault_kdf_salt: string | null; vault_key_iv: string | null; vault_key_wrapped: string | null }): Wrapped | null {
  return s.vault_kdf_salt && s.vault_key_iv && s.vault_key_wrapped ? { salt: s.vault_kdf_salt, iv: s.vault_key_iv, wrapped: s.vault_key_wrapped } : null;
}

async function addSamples(vk: Uint8Array) {
  for (const a of SAMPLE_ACCOUNTS) {
    const enc = await encryptSecret(vk, { username: a.username, password: a.password, note: '' });
    await setDoc(udoc('password_entries', `sample_${a.account_name.toLowerCase().replace(/\W+/g, '_')}`), {
      category_id: pwCategoryId(a.category),
      account_name: a.account_name,
      url: null,
      ...enc,
      password_fingerprint: await fingerprint(vk, a.password),
      sample: true,
      created_at: serverTimestamp(),
    });
  }
}

/** Two draws of the same pattern, then wraps the vault key for this device. `beforeUnlock` runs first (e.g. saving a new vault). */
function NewPattern({ vk, onDone, beforeUnlock }: { vk: Uint8Array; onDone: () => void; beforeUnlock?: () => Promise<void> }) {
  const [first, setFirst] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('Draw a pattern for this device (at least 4 dots).');
  return (
    <>
      <p className="muted center" aria-live="polite">
        {msg}
      </p>
      <PatternPad
        busy={busy}
        action={first ? 'Confirm' : 'Next'}
        onComplete={async (p) => {
          if (!first) {
            setFirst(p);
            setMsg('Draw the same pattern again to confirm.');
            return;
          }
          if (p !== first) {
            setFirst('');
            setMsg('The two patterns did not match. Start again.');
            return;
          }
          setBusy(true);
          try {
            const device = await wrapForDevice(vk, p);
            await beforeUnlock?.();
            saveDeviceWrap(uid(), device);
            clearFails(uid());
            setVk(vk);
            onDone();
          } catch (err) {
            toast(err instanceof Error ? err.message : 'Could not save the vault', true);
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}

/**
 * New vault: passphrase first, then the device pattern. Nothing is saved until the pattern is set,
 * so leaving half-way leaves no vault behind.
 */
function Setup({ onStart, onFinish }: { onStart: () => void; onFinish: () => void }) {
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [samples, setSamples] = useState(false);
  const [pending, setPending] = useState<{ vk: Uint8Array; forServer: Wrapped } | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (pass.length < 8) return toast('Use at least 8 characters for the master passphrase', true);
    if (pass !== pass2) return toast('The two passphrases do not match', true);
    setBusy(true);
    try {
      setPending(await createVault(pass));
      onStart();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not create the vault', true);
    } finally {
      setBusy(false);
    }
  }

  if (pending) {
    return (
      <NewPattern
        vk={pending.vk}
        beforeUnlock={async () => {
          const w = pending.forServer;
          await updateSettings({ vault_kdf_salt: w.salt, vault_key_iv: w.iv, vault_key_wrapped: w.wrapped });
          if (samples) await addSamples(pending.vk);
        }}
        onDone={() => {
          onFinish();
          toast('Vault ready');
        }}
      />
    );
  }
  return (
    <form className="col loose" onSubmit={create} style={{ width: '100%', maxWidth: 400 }}>
      <p className="muted">
        Set a master passphrase. It encrypts your passwords before they leave this device, and it unlocks the vault on a new phone or computer. It cannot be recovered, so keep
        it somewhere safe.
      </p>
      <Field label="Master passphrase (8+ characters)">
        <input className="input" type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} />
      </Field>
      <Field label="Type it again">
        <input className="input" type="password" autoComplete="new-password" value={pass2} onChange={(e) => setPass2(e.target.value)} />
      </Field>
      <div className="row between">
        <span className="small">Add the 6 example accounts from the design</span>
        <Toggle checked={samples} onChange={setSamples} label="Add example accounts" />
      </div>
      <button type="submit" className="btn primary lg" disabled={busy}>
        {busy ? 'Creating…' : 'Create vault'}
      </button>
    </form>
  );
}

function PassphraseUnlock({ wrap, onBack }: { wrap: Wrapped; onBack?: () => void }) {
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [vk, setVkLocal] = useState<Uint8Array | null>(null);
  if (vk) return <NewPattern vk={vk} onDone={() => toast('Vault unlocked and pattern set for this device')} />;
  return (
    <form
      className="col loose"
      style={{ width: '100%', maxWidth: 400 }}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          setVkLocal(await unlockWithPassphrase(wrap, pass));
        } catch {
          toast('That passphrase is not right', true);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="muted">Enter your master passphrase. You will then set a pattern for this device.</p>
      <Field label="Master passphrase">
        <input className="input" type="password" autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} />
      </Field>
      <button type="submit" className="btn primary lg" disabled={busy || !pass}>
        {busy ? 'Checking…' : 'Unlock'}
      </button>
      {onBack && (
        <button type="button" className="link" onClick={onBack}>
          Back to pattern
        </button>
      )}
    </form>
  );
}

function PatternUnlock({ wrap, onForgot }: { wrap: Wrapped; onForgot: () => void }) {
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState(() => failState(uid()));
  const [now, setNow] = useState(Date.now());
  const locked = state.until > now;
  useEffect(() => {
    if (!locked) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [locked]);
  const left = MAX_TRIES - state.fails;
  const msg = locked
    ? `Too many wrong tries. Try again in ${Math.ceil((state.until - now) / 1000)} s.`
    : state.fails
      ? `Wrong pattern. ${left > 0 ? `${left} ${left === 1 ? 'try' : 'tries'} left before a pause.` : 'The next miss pauses entry for longer.'}`
      : 'Draw your pattern to see your passwords.';

  return (
    <>
      <p className={`center ${state.fails ? 'red' : 'muted'}`} aria-live="polite">
        {msg}
      </p>
      {!locked && (
        <PatternPad
          busy={busy}
          action="Unlock"
          onComplete={async (p) => {
            setBusy(true);
            try {
              const vk = await unlockWithPattern(wrap, p);
              clearFails(uid());
              setVk(vk);
            } catch {
              setState(recordFail(uid()));
              setNow(Date.now());
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
      <button type="button" className="link" onClick={onForgot}>
        Forgot pattern? Use the master passphrase
      </button>
    </>
  );
}

/** Shows the lock screens until the vault key is in memory, then the children. */
export function VaultGate({ children }: { children: React.ReactNode }) {
  const vk = useVk();
  const settings = useSettings();
  const [usePass, setUsePass] = useState(false);
  // Keeps the setup screen up while a new vault is being saved, even after the database says one exists.
  const [settingUp, setSettingUp] = useState(false);
  if (vk) return <>{children}</>;
  if (!settings) return <p className="dim">Loading…</p>;
  const wrap = settingUp ? null : serverWrap(settings);
  const device = loadDeviceWrap(uid());
  return (
    <div className="col loose" style={{ alignItems: 'center', padding: '24px 0' }}>
      <div style={{ width: 64, height: 64, borderRadius: 20, border: '1px solid var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--blue)' }}>
        <Icon name="lock" size={28} />
      </div>
      <h2 style={{ fontSize: 24 }}>{wrap ? 'Password vault is locked' : 'Set up your password vault'}</h2>
      {!wrap ? <Setup onStart={() => setSettingUp(true)} onFinish={() => setSettingUp(false)} /> :!device || usePass ? <PassphraseUnlock wrap={wrap} onBack={device ? () => setUsePass(false) : undefined} /> : <PatternUnlock wrap={device} onForgot={() => setUsePass(true)} />}
    </div>
  );
}

// ---------------------------------------------------------------- decrypted view

function useSecrets(entries: PwEntry[] | undefined) {
  const vk = useVk();
  const [secrets, setSecrets] = useState<Record<string, PwSecret>>({});
  useEffect(() => {
    if (!vk || !entries) return;
    let alive = true;
    Promise.all(
      entries.map((e) =>
        decryptSecret(vk, e.data_enc, e.iv)
          .then((s) => [e.id, s] as const)
          .catch(() => [e.id, { username: '?', password: '', note: 'Could not decrypt' }] as const),
      ),
    ).then((pairs) => alive && setSecrets(Object.fromEntries(pairs)));
    return () => {
      alive = false;
    };
  }, [vk, entries]);
  return secrets;
}

function useReuse(entries: PwEntry[] | undefined) {
  return useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of entries ?? []) counts[e.password_fingerprint] = (counts[e.password_fingerprint] ?? 0) + 1;
    return counts;
  }, [entries]);
}

async function copySecret(text: string) {
  await navigator.clipboard.writeText(text);
  toast('Copied. The clipboard clears in 30 seconds.');
  setTimeout(() => {
    navigator.clipboard.writeText('').catch(() => {});
  }, 30_000);
}

// ---------------------------------------------------------------- entry form with generator

function EntryForm({ formId, entry, secret, cats, onDone }: { formId: string; entry?: PwEntry; secret?: PwSecret; cats: PwCategory[]; onDone: () => void }) {
  const [account, setAccount] = useState(entry?.account_name ?? '');
  const [username, setUsername] = useState(secret?.username ?? '');
  const [category, setCategory] = useState(entry?.category_id ?? cats[0]?.id ?? '');
  const [url, setUrl] = useState(entry?.url ?? '');
  const [note, setNote] = useState(secret?.note ?? '');
  const catRules = cats.find((c) => c.id === category)?.gen_rules;
  const [rules, setRules] = useState<GenRules>(catRules ?? DEFAULT_RULES);
  const [password, setPassword] = useState(secret?.password ?? (entry ? '' : generatePassword(catRules ?? DEFAULT_RULES)));
  const [show, setShow] = useState(!entry);
  const s = strength(password);

  const regen = (r: GenRules) => {
    setRules(r);
    setPassword(generatePassword(r));
    setShow(true);
  };

  async function save(e: FormEvent) {
    e.preventDefault();
    const vk = getVk();
    if (!vk) return toast('The vault locked. Unlock it and try again.', true);
    if (!account.trim() || !password) return toast('Account and password are needed', true);
    const enc = await encryptSecret(vk, { username: username.trim(), password, note: note.trim() });
    const id = entry?.id ?? newId();
    await setDoc(
      udoc('password_entries', id),
      { category_id: category, account_name: account.trim(), url: url.trim() || null, ...enc, password_fingerprint: await fingerprint(vk, password), updated_at: serverTimestamp() },
      { merge: true },
    );
    onDone();
  }

  return (
    <form id={formId} className="col loose" onSubmit={(e) => run(save(e))}>
      <Field label="Account">
        <input className="input" required value={account} onChange={(e) => setAccount(e.target.value)} placeholder="e.g. Touch 'n Go eWallet" />
      </Field>
      <div className="two">
        <Field label="Username">
          <input className="input" value={username} autoComplete="off" onChange={(e) => setUsername(e.target.value)} />
        </Field>
        <Field label="Category">
          <select
            className="input"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              const r = cats.find((c) => c.id === e.target.value)?.gen_rules;
              if (r && !entry) regen(r);
            }}
          >
            {cats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="col tight">
        <span className="small muted">Password</span>
        <div className="row">
          <input
            className="input num grow"
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            aria-label="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ borderColor: 'var(--blue-line)' }}
          />
          <button type="button" className="btn sm" onClick={() => setShow((v) => !v)}>
            {show ? 'Hide' : 'Show'}
          </button>
          <button type="button" className="btn sm primary" onClick={() => regen(rules)}>
            Generate
          </button>
        </div>
        <div className="row">
          <div className={`meter${s <= 1 ? ' weak' : ''}`}>
            {[1, 2, 3, 4].map((i) => (
              <i key={i} className={i <= s ? 'on' : ''} />
            ))}
          </div>
          <span className={`tiny ${s <= 1 ? 'red' : 'blue'}`} style={{ width: 48, textAlign: 'right' }}>
            {STRENGTH_LABEL[s]}
          </span>
        </div>
      </div>
      <section className="card" style={{ background: 'var(--bg)', gap: 10 }}>
        <div className="row between">
          <h2 style={{ fontSize: 15 }}>Generator rules</h2>
          <span className="mono small blue">{rules.length}</span>
        </div>
        <Chips options={[8, 12, 16, 20, 24].map((n) => [n, String(n)] as [number, string])} value={rules.length} onChange={(n) => regen({ ...rules, length: n })} label="Length" />
        {(
          [
            ['upper', 'Capital letters A–Z'],
            ['lower', 'Small letters a–z'],
            ['digits', 'Digits 0–9'],
            ['symbols', 'Special characters !#$%'],
          ] as const
        ).map(([k, label]) => (
          <div key={k} className="row between small">
            <span>{label}</span>
            <Toggle checked={rules[k]} onChange={(v) => regen({ ...rules, [k]: v })} label={label} />
          </div>
        ))}
        <button
          type="button"
          className="link"
          style={{ alignSelf: 'flex-start' }}
          onClick={() => run(updateDoc(udoc('password_categories', category), { gen_rules: rules }), `Saved as the default for ${cats.find((c) => c.id === category)?.name ?? 'this category'}`)}
        >
          Use these rules for this category
        </button>
      </section>
      <Field label="Website (optional)">
        <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
      </Field>
      <Field label="Note (optional, encrypted)">
        <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {entry && <ConfirmButton label="Delete account" confirm="Tap again to delete" onConfirm={() => run(deleteDoc(udoc('password_entries', entry.id)).then(onDone), 'Account deleted')} />}
    </form>
  );
}

function CategoryForm({ cat, used, onDone }: { cat?: PwCategory; used: number; onDone: () => void }) {
  const [name, setName] = useState(cat?.name ?? '');
  return (
    <form
      id="pwcat-form"
      className="col loose"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        const id = cat?.id ?? newId();
        run(setDoc(udoc('password_categories', id), { name: name.trim(), gen_rules: cat?.gen_rules ?? null, sort_order: cat?.sort_order ?? Date.now() }, { merge: true }).then(onDone));
      }}
    >
      <Field label="Category name">
        <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      {cat &&
        (used ? (
          <p className="tiny dim">{used} accounts use this category. Move them first to delete it.</p>
        ) : (
          <ConfirmButton label="Delete category" confirm="Tap again to delete" onConfirm={() => run(deleteDoc(udoc('password_categories', cat.id)).then(onDone), 'Category deleted')} />
        ))}
    </form>
  );
}

// ---------------------------------------------------------------- pages

function VaultList() {
  const entries = usePwEntries();
  const catList = usePwCats();
  const cats = (catList ?? []).slice().sort((a, b) => a.sort_order - b.sort_order);
  const secrets = useSecrets(entries);
  const reuse = useReuse(entries);
  const [cat, setCat] = useState('');
  const [q, setQ] = useState('');
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [adding, setAdding] = useState(false);
  const [addKey, setAddKey] = useState(0);
  const [editing, setEditing] = useState<PwEntry | null>(null);
  const [catSheet, setCatSheet] = useState<{ cat?: PwCategory } | null>(null);
  const cmap = Object.fromEntries(cats.map((c) => [c.id, c.name]));
  const list = (entries ?? [])
    .filter((e) => !cat || e.category_id === cat)
    .filter((e) => !q || e.account_name.toLowerCase().includes(q.toLowerCase()) || (cmap[e.category_id] ?? '').toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.account_name.localeCompare(b.account_name));

  return (
    <div className="split">
      <div className="wide col">
        <label className="row input" style={{ gap: 10, color: 'var(--dim)' }}>
          <Icon name="search" size={18} />
          <input type="search" placeholder="Search accounts" aria-label="Search accounts" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, minWidth: 0, background: 'transparent', border: 0, outline: 'none', color: 'var(--text)' }} />
        </label>
        <div className="chips" role="group" aria-label="Categories">
          <button type="button" className={`chip${!cat ? ' on' : ''}`} onClick={() => setCat('')}>
            All
          </button>
          {cats.map((c) => (
            <button key={c.id} type="button" className={`chip${cat === c.id ? ' on' : ''}`} onClick={() => (cat === c.id ? setCatSheet({ cat: c }) : setCat(c.id))}>
              {c.name}
            </button>
          ))}
          <button type="button" className="chip" onClick={() => setCatSheet({})}>
            + Category
          </button>
        </div>
        <button type="button" className="btn primary only-mobile" onClick={() => setAdding(true)}>
          + Add account
        </button>
        {!entries ? (
          <p className="dim small">Loading…</p>
        ) : !list.length ? (
          <p className="dim small">{entries.length ? 'No accounts match.' : 'No accounts yet. Add your first one.'}</p>
        ) : (
          list.map((e) => {
            const s = secrets[e.id];
            const on = shown[e.id];
            return (
              <div key={e.id} className="card" style={{ padding: 12, gap: 8 }}>
                <div className="row">
                  <span className="initial">{e.account_name.charAt(0).toUpperCase()}</span>
                  <button type="button" className="grow col tight link" style={{ color: 'var(--text)', textAlign: 'left', fontSize: 15 }} onClick={() => setEditing(e)}>
                    <span>{e.account_name}</span>
                    <span className="tiny dim">
                      {s?.username || '…'} · {cmap[e.category_id] ?? 'No category'}
                    </span>
                  </button>
                  {(reuse[e.password_fingerprint] ?? 0) > 1 && <span className="badge red">Reused</span>}
                </div>
                <div className="row">
                  <span className="secret">{on && s ? s.password : '••••••••••'}</span>
                  <button type="button" className="btn sm" onClick={() => setShown((x) => ({ ...x, [e.id]: !on }))}>
                    {on ? 'Hide' : 'Show'}
                  </button>
                  <button type="button" className="btn sm" aria-label={`Copy password for ${e.account_name}`} disabled={!s} onClick={() => s && run(copySecret(s.password))}>
                    Copy
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
      <div className="side">
        <Panel open={adding} onClose={() => setAdding(false)} title="New account" formId="entry-form">
          {cats.length > 0 && (
            <EntryForm
              key={addKey}
              formId="entry-form"
              cats={cats}
              onDone={() => {
                setAdding(false);
                setAddKey((k) => k + 1);
                toast('Account saved');
              }}
            />
          )}
        </Panel>
      </div>
      <Sheet open={!!editing} onClose={() => setEditing(null)} title="Edit account" formId="entry-form-edit">
        {editing && secrets[editing.id] && <EntryForm key={editing.id} formId="entry-form-edit" entry={editing} secret={secrets[editing.id]} cats={cats} onDone={() => setEditing(null)} />}
      </Sheet>
      <Sheet open={!!catSheet} onClose={() => setCatSheet(null)} title={catSheet?.cat ? 'Edit category' : 'New category'} formId="pwcat-form">
        {catSheet && <CategoryForm cat={catSheet.cat} used={(entries ?? []).filter((e) => e.category_id === catSheet.cat?.id).length} onDone={() => setCatSheet(null)} />}
      </Sheet>
    </div>
  );
}

export default function Vault() {
  const vk = useVk();
  return (
    <div className="page">
      <header className="head">
        <div className="col tight">
          <h1>Password vault</h1>
          {vk && <span className="tiny blue">Unlocked · locks itself when idle or when you leave the app</span>}
        </div>
        {vk && (
          <div className="row">
            <Link to="/vault/dashboard" className="btn">
              Dashboard
            </Link>
            <button type="button" className="btn" onClick={() => setVk(null)}>
              Lock now
            </button>
          </div>
        )}
      </header>
      <VaultGate>
        <VaultList />
      </VaultGate>
    </div>
  );
}

export function VaultDash() {
  const entries = usePwEntries();
  const catList = usePwCats();
  const secrets = useSecrets(entries);
  const reuse = useReuse(entries);
  const cats = (catList ?? []).slice().sort((a, b) => a.sort_order - b.sort_order);
  const cmap = Object.fromEntries(cats.map((c) => [c.id, c.name]));
  const all = entries ?? [];
  const groups = Object.entries(reuse)
    .filter(([, n]) => n > 1)
    .map(([fp]) => all.filter((e) => e.password_fingerprint === fp));
  const reusedCount = groups.reduce((a, g) => a + g.length, 0);
  const weak = all.filter((e) => secrets[e.id] && strength(secrets[e.id].password) <= 1).length;
  const perCat = cats.map((c) => [c, all.filter((e) => e.category_id === c.id).length] as const);
  const maxCat = Math.max(1, ...perCat.map(([, n]) => n));

  return (
    <div className="page">
      <header className="head">
        <div className="row">
          <Link to="/vault" className="btn icon only-mobile" aria-label="Back to vault">
            <Icon name="back" />
          </Link>
          <h1>Password dashboard</h1>
        </div>
        <Link to="/vault" className="btn only-desktop">
          Open vault
        </Link>
      </header>
      <VaultGate>
        <div className="cards small">
          <div className="card">
            <span className="big">{all.length}</span>
            <span className="tiny dim">Accounts saved</span>
          </div>
          <div className={`card${reusedCount ? ' red-line' : ''}`}>
            <span className={`big${reusedCount ? ' red' : ''}`}>{reusedCount}</span>
            <span className="tiny dim">Accounts sharing a password</span>
          </div>
          <div className="card">
            <span className="big">{weak}</span>
            <span className="tiny dim">Weak passwords</span>
          </div>
          <div className="card">
            <span className="big">{cats.length}</span>
            <span className="tiny dim">Categories</span>
          </div>
        </div>
        <div className="cards">
          <section className="col">
            <h2>Same password, different accounts</h2>
            {!groups.length && <p className="dim small">No reused passwords. Nice.</p>}
            {groups.map((g, i) => {
              const pw = secrets[g[0].id]?.password ?? '';
              return (
                <div key={g[0].password_fingerprint} className="card red-line">
                  <div className="row between">
                    <span className="mono small muted">
                      Password group {String.fromCharCode(65 + i)} · {STRENGTH_LABEL[strength(pw)] || '…'}
                    </span>
                    <span className="badge red">{g.length} accounts</span>
                  </div>
                  {g.map((e) => (
                    <div key={e.id} className="line small">
                      <span className="grow">{e.account_name}</span>
                      <span className="dim">{cmap[e.category_id]}</span>
                      <Link to="/vault" className="btn sm">
                        Change
                      </Link>
                    </div>
                  ))}
                </div>
              );
            })}
            <p className="tiny dim">Matching uses a keyed fingerprint of each password, so nothing is compared in plain text.</p>
          </section>
          <section className="card">
            <h2>Accounts by category</h2>
            {perCat.map(([c, n]) => (
              <div key={c.id} className="small" style={{ display: 'grid', gridTemplateColumns: '90px 1fr 28px', alignItems: 'center', gap: 12 }}>
                <span>{c.name}</span>
                <Bar pct={(n / maxCat) * 100} thick />
                <span className="mono right">{n}</span>
              </div>
            ))}
          </section>
        </div>
      </VaultGate>
    </div>
  );
}

/** Settings: forget this device's pattern so it has to be set again with the passphrase. */
export function resetDevicePattern() {
  clearDeviceWrap(uid());
  clearFails(uid());
  setVk(null);
}
