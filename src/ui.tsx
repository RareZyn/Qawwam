import { type ReactNode, useEffect, useState, useSyncExternalStore } from 'react';

// ---------------------------------------------------------------- icons

const PATHS: Record<string, ReactNode> = {
  home: <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />,
  habits: <><circle cx="12" cy="12" r="9" /><path d="M8 12l3 3 5-6" /></>,
  money: <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18M16 15h2" /></>,
  todo: <path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />,
  more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  back: <path d="M15 6l-6 6 6 6" />,
  next: <path d="M9 6l6 6-6 6" />,
  bell: <><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10 21h4" /></>,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></>,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  tick: <path d="M5 12l5 5 9-10" />,
};

export function Icon({ name, size = 20, stroke = 1.8 }: { name: keyof typeof PATHS | string; size?: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

// ---------------------------------------------------------------- logo (Heatmap Q)

const GRID = ['.####.', '#....#', '#....#', '#..#.#', '#...#.', '.###.#'];
const TAIL = new Set(['3,3', '4,4', '5,5']);

function MarkCells() {
  return (
    <>
      {GRID.flatMap((row, r) =>
        [...row].map((ch, c) =>
          ch === '#' ? <rect key={`${r},${c}`} x={12 + c * 40} y={12 + r * 40} width="32" height="32" rx="8" fill={TAIL.has(`${r},${c}`) ? '#E0091F' : '#B6DFF5'} /> : null,
        ),
      )}
    </>
  );
}

export function LogoMark({ size = 72 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" aria-hidden="true">
      <MarkCells />
    </svg>
  );
}

export function LogoLockup({ height = 32 }: { height?: number }) {
  return (
    <svg height={height} viewBox="0 0 1031 256" role="img" aria-label="Qawwam" style={{ display: 'block', width: 'auto' }}>
      <MarkCells />
      <g fill="none" stroke="#B6DFF5" strokeWidth="22" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="348" cy="128" r="37" />
        <path d="M385 91V213" />
        <circle cx="466" cy="128" r="37" />
        <path d="M503 91V165" />
        <path d="M547 91L566.83 165L586.66 91L606.48 165L626.31 91" />
        <path d="M670.31 91L690.14 165L709.97 91L729.8 165L749.63 91" />
        <circle cx="830.63" cy="128" r="37" />
        <path d="M867.63 91V165" />
        <path d="M911.63 165V117A26 26 0 0 1 963.63 117V165M963.63 117A26 26 0 0 1 1015.63 117V165" />
      </g>
    </svg>
  );
}

export function Splash({ text }: { text?: string }) {
  return (
    <div className="splash">
      <LogoMark />
      {text && <span>{text}</span>}
    </div>
  );
}

// ---------------------------------------------------------------- controls

export function Seg<T extends string>({ options, value, onChange, label }: { options: [T, string][]; value: T; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="seg" role="tablist" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" role="tab" aria-selected={v === value} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

export function Chips<T extends string | number>({ options, value, onChange, scroll, label }: { options: [T, string][]; value: T; onChange: (v: T) => void; scroll?: boolean; label?: string }) {
  return (
    <div className={`chips${scroll ? ' scroll' : ''}`} role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={String(v)} type="button" aria-pressed={v === value} className={`chip${v === value ? ' on' : ''}`} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`toggle${checked ? ' on' : ''}`} onClick={() => onChange(!checked)}>
      <i />
    </button>
  );
}

export function Check({ checked, onChange, label, large }: { checked: boolean; onChange: (v: boolean) => void; label: string; large?: boolean }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} aria-label={label} className={`check${checked ? ' on' : ''}${large ? ' lg' : ''}`} onClick={() => onChange(!checked)}>
      <Icon name="tick" size={large ? 16 : 14} stroke={3} />
    </button>
  );
}

export function Bar({ pct, red, thick }: { pct: number; red?: boolean; thick?: boolean }) {
  return (
    <div className={`bar${red ? ' red' : ''}${thick ? ' thick' : ''}`}>
      <i style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      {label}
      {children}
    </label>
  );
}

/** A destructive button that asks once more before acting. */
export function ConfirmButton({ label, confirm = 'Tap again to confirm', onConfirm, className = 'btn danger sm' }: { label: string; confirm?: string; onConfirm: () => void; className?: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      className={armed ? className.replace('danger', 'danger solid') : className}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? confirm : label}
    </button>
  );
}

/**
 * A form container. On a phone it is hidden until opened, then covers the screen;
 * on desktop it is always visible as a card beside the list.
 */
export function Panel({ open, onClose, title, formId, saveLabel = 'Save', children }: { open: boolean; onClose: () => void; title: string; formId?: string; saveLabel?: string; children: ReactNode }) {
  return (
    <section className={`panel${open ? ' open' : ''}`} aria-label={title}>
      <div className="panel-head">
        <button type="button" className="link panel-cancel muted" style={{ fontSize: 15, minHeight: 44 }} onClick={onClose}>
          Cancel
        </button>
        <h2>{title}</h2>
        {formId ? (
          <button type="submit" form={formId} className="link only-mobile" style={{ fontSize: 15, fontWeight: 600, minHeight: 44 }}>
            {saveLabel}
          </button>
        ) : (
          <span className="only-mobile" style={{ width: 44 }} />
        )}
      </div>
      <div className="panel-body">
        {children}
        {formId && (
          <button type="submit" form={formId} className="btn primary only-desktop">
            {saveLabel}
          </button>
        )}
      </div>
    </section>
  );
}

/** A dialog: full screen on a phone, a centred box on desktop. Its Save button submits the form with id `formId`. */
export function Sheet({ open, onClose, title, children, formId, saveLabel = 'Save' }: { open: boolean; onClose: () => void; title: string; children: ReactNode; formId?: string; saveLabel?: string }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="sheet-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="panel-head" style={{ position: 'sticky', background: 'inherit', borderBottom: '1px solid var(--line)', padding: '14px 20px' }}>
          <button type="button" className="link muted" style={{ fontSize: 15, minHeight: 44 }} onClick={onClose}>
            Cancel
          </button>
          <h2>{title}</h2>
          {formId ? (
            <button type="submit" form={formId} className="link" style={{ fontSize: 15, fontWeight: 600, minHeight: 44 }}>
              {saveLabel}
            </button>
          ) : (
            <span style={{ width: 44 }} />
          )}
        </div>
        <div className="panel-body" style={{ padding: 20 }}>{children}</div>
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="dim center small" style={{ padding: '20px 0' }}>{children}</p>;
}

// ---------------------------------------------------------------- toasts

type Toast = { id: number; text: string; err: boolean };
let toasts: Toast[] = [];
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function toast(text: string, err = false) {
  const t = { id: Date.now() + Math.random(), text, err };
  toasts = [...toasts, t];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((x) => x !== t);
    emit();
  }, 3200);
}

/** Run a write without blocking the screen; show a message only when it fails. */
export function run(p: Promise<unknown>, ok?: string) {
  if (ok) toast(ok);
  p.catch((e: unknown) => {
    console.error(e);
    toast(e instanceof Error ? e.message : 'Something went wrong', true);
  });
}

export function Toasts() {
  const list = useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => toasts,
  );
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast${t.err ? ' err' : ''}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- small hooks

/** Today's date as a string; re-renders the page when the day changes. */
export function useToday() {
  const [today, setToday] = useState(() => new Date().toDateString());
  useEffect(() => {
    const t = setInterval(() => setToday(new Date().toDateString()), 60_000);
    return () => clearInterval(t);
  }, []);
  const d = new Date(today);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function useIsDesktop() {
  const q = '(min-width: 900px)';
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(q);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => window.matchMedia(q).matches,
  );
}
