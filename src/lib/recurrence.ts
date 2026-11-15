import type { Recurrence } from './types';
import { DOW, daysInMonth, dow, fmtDay, monthKey, ordinal, parseYmd, ymd } from './util';

export const DAILY: Recurrence = { frequency: 'daily', interval: 1 };

/** Is something with this recurrence due on the given day? */
export function isDue(rec: Recurrence, date: string, start?: string | null): boolean {
  if (start && date < start) return false;
  switch (rec.frequency) {
    case 'daily':
      return true;
    case 'weekly':
      return (rec.days_of_week ?? []).includes(dow(date));
    case 'monthly': {
      const want = Math.min(rec.day_of_month ?? 1, daysInMonth(monthKey(date)));
      return parseYmd(date).getDate() === want;
    }
    case 'once':
      return rec.date === date;
  }
}

/** Short label such as "Daily", "Mon, Wed, Fri" or "Monthly · 25th". */
export function describe(rec: Recurrence): string {
  switch (rec.frequency) {
    case 'daily':
      return 'Daily';
    case 'weekly': {
      const days = [...(rec.days_of_week ?? [])].sort((a, b) => a - b);
      if (days.length === 7) return 'Daily';
      if (!days.length) return 'Weekly';
      return days.map((d) => DOW[d]).join(', ');
    }
    case 'monthly':
      return `Monthly · ${ordinal(rec.day_of_month ?? 1)}`;
    case 'once':
      return rec.date ? `Once · ${fmtDay(rec.date)}` : 'Once';
  }
}

/**
 * Next time a reminder should fire after `fromMs` (epoch ms), or null when there is none.
 * `daysBefore` moves the fire time that many days ahead of each occurrence.
 */
export function nextFire(rec: Recurrence, fromMs: number, daysBefore = 0): number | null {
  const [hh, mm] = (rec.time ?? '09:00').split(':').map(Number);
  const at = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysBefore, hh, mm, 0, 0).getTime();
  if (rec.frequency === 'once') {
    if (!rec.date) return null;
    const t = at(parseYmd(rec.date));
    return t > fromMs ? t : null;
  }
  const from = new Date(fromMs);
  for (let i = 0; i <= 400; i++) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
    if (!isDue(rec, ymd(d))) continue;
    const t = at(d);
    if (t > fromMs) return t;
  }
  return null;
}
