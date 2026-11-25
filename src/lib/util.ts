/** Dates are local calendar days as 'YYYY-MM-DD' strings; money is whole sen. */

export const pad = (n: number) => String(n).padStart(2, '0');
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseYmd = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const todayStr = () => ymd(new Date());
export const addDays = (s: string, n: number) => {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
};
/** Whole days from a to b (positive when b is later). */
export const diffDays = (a: string, b: string) => Math.round((parseYmd(b).getTime() - parseYmd(a).getTime()) / 86400000);
export const dow = (s: string) => parseYmd(s).getDay();

export const monthKey = (s: string) => s.slice(0, 7);
export const addMonths = (m: string, n: number) => {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};
export const daysInMonth = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(y, mo, 0).getDate();
};

/**
 * Money month (pay cycle) that contains s. With a start day of 25, 25 Nov – 24 Dec is the December cycle,
 * so ticks reset on payday. A start day of 1 is the plain calendar month.
 */
export const cycleMonth = (s: string, startDay = 1) =>
  startDay > 1 && Number(s.slice(8, 10)) >= startDay ? addMonths(monthKey(s), 1) : monthKey(s);
/** First and last day of a money month. */
export const cycleRange = (m: string, startDay = 1) =>
  startDay > 1
    ? { start: `${addMonths(m, -1)}-${pad(startDay)}`, end: addDays(`${m}-${pad(startDay)}`, -1) }
    : { start: `${m}-01`, end: `${m}-${pad(daysInMonth(m))}` };

/** Monday of the week that contains s. */
export const weekStart = (s: string) => {
  const d = parseYmd(s);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return ymd(d);
};
/** ISO week key, e.g. 2026-W46. */
export const weekKey = (s: string) => {
  const d = parseYmd(s);
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const w = Math.ceil(((t.getTime() - y0.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${pad(w)}`;
};

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** 14 Nov */
export const fmtDay = (s: string) => `${parseYmd(s).getDate()} ${MON[parseYmd(s).getMonth()]}`;
/** Sat · 14 Nov */
export const fmtDayLong = (s: string) => `${DOW[dow(s)]} · ${fmtDay(s)}`;
/** November 2026 */
export const fmtMonth = (m: string) => `${MONTH[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;
export const fmtMonthShort = (m: string) => `${MON[Number(m.slice(5)) - 1]} ${m.slice(2, 4)}`;
export const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

/** RM 1,234.50 (with a true minus sign, and an optional plus). */
export const fmtRM = (sen: number, sign = false) => {
  const a = (Math.abs(sen) / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sen < 0 ? '−' : sign && sen > 0 ? '+' : ''}RM ${a}`;
};
/** "12.50" → 1250. Anything unreadable becomes 0. */
export const toSen = (v: string | number) => {
  const n = Math.round(parseFloat(String(v).replace(/,/g, '')) * 100);
  return Number.isFinite(n) ? n : 0;
};
export const senToInput = (sen: number) => (sen / 100).toFixed(2);

export const fmtPoints = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}`;

export const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 20);

export function byId<T extends { id: string }>(list: T[] | undefined): Record<string, T> {
  const out: Record<string, T> = {};
  for (const x of list ?? []) out[x.id] = x;
  return out;
}

export const sum = <T,>(list: T[], f: (x: T) => number) => list.reduce((a, x) => a + f(x), 0);
