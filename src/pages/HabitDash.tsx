import { getDocs, query, where } from 'firebase/firestore';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { rebuildSummaries } from '../lib/actions';
import { ucol, useHabits, useLogs, useSummaries } from '../lib/db';
import { cleanDays, cleanStreak, goodStreak, periods } from '../lib/habits';
import type { Habit, HabitLog, Summary } from '../lib/types';
import { addDays, addMonths, byId, fmtDay, fmtDayLong, fmtMonth, fmtPoints, monthKey, weekStart } from '../lib/util';
import { Bar, Icon, Seg, run, useIsDesktop, useToday } from '../ui';

type Period = 'day' | 'week' | 'month';

function level(score: number | undefined) {
  if (score === undefined) return '';
  if (score < 0) return 'neg';
  if (score === 0) return '';
  if (score < 8) return 'l1';
  if (score < 16) return 'l2';
  return 'l3';
}

/** Logs for one day. Recent days come from the live list; older ones are fetched when picked. */
function useDayLogs(date: string, live: HabitLog[] | undefined) {
  const [fetched, setFetched] = useState<{ date: string; logs: HabitLog[] } | null>(null);
  const inWindow = !!live && live.some((l) => l.log_date <= date);
  useEffect(() => {
    if (inWindow) return;
    let alive = true;
    getDocs(query(ucol('habit_logs'), where('log_date', '==', date)))
      .then((s) => alive && setFetched({ date, logs: s.docs.map((d) => ({ id: d.id, ...d.data() }) as HabitLog) }))
      .catch(() => alive && setFetched({ date, logs: [] }));
    return () => {
      alive = false;
    };
  }, [date, inWindow]);
  if (inWindow) return live!.filter((l) => l.log_date === date);
  return fetched?.date === date ? fetched.logs : undefined;
}

export default function HabitDash() {
  const today = useToday();
  const desktop = useIsDesktop();
  const habits = useHabits();
  const logList = useLogs();
  const summaries = useSummaries();
  const logs = byId(logList);
  const sums = byId(summaries);
  const [period, setPeriod] = useState<Period>('week');
  const [picked, setPicked] = useState(today);
  const dayLogs = useDayLogs(picked, logList);

  // Score for the current and the previous period of the chosen kind.
  const card = useMemo(() => {
    const cur = periods(today).find((p) => p.period_type === period)!;
    const prevDate = period === 'day' ? addDays(today, -1) : period === 'week' ? addDays(weekStart(today), -7) : `${addMonths(monthKey(today), -1)}-01`;
    const prev = periods(prevDate).find((p) => p.period_type === period)!;
    const s: Summary | undefined = sums[cur.id];
    const p: Summary | undefined = sums[prev.id];
    const label = period === 'day' ? `Today · ${fmtDayLong(today)}` : period === 'week' ? `This week · ${fmtDay(cur.period_start)}–${fmtDay(cur.period_end)}` : fmtMonth(cur.period_key);
    const vs = period === 'day' ? 'yesterday' : period === 'week' ? 'last week' : fmtMonth(prev.period_key);
    const diff = (s?.score ?? 0) - (p?.score ?? 0);
    return { label, score: s?.score ?? 0, trend: `${fmtPoints(diff)} vs ${vs}`, good: s?.good_count ?? 0, bad: s?.bad_count ?? 0 };
  }, [period, today, sums]);

  // Heatmap: whole weeks, Sunday at the top, ending with the current week.
  const weeks = desktop ? 52 : 20;
  const end = addDays(today, 6 - new Date().getDay());
  const startDay = addDays(end, -(weeks * 7) + 1);
  const cells = Array.from({ length: weeks * 7 }, (_, i) => addDays(startDay, i));
  const months = Array.from({ length: weeks }, (_, w) => {
    const d = cells[w * 7];
    return d.slice(8) <= '07' ? fmtMonth(monthKey(d)).slice(0, 3) : '';
  });
  const logged = cells.filter((d) => sums[`day_${d}`]).length;
  const best = Math.max(0, ...cells.map((d) => sums[`day_${d}`]?.score ?? 0));

  const hmap = byId(habits);
  const active = (habits ?? []).filter((h) => h.status === 'active');
  const streakRows = active
    .map((h: Habit) => {
      const cur = h.type === 'good' ? goodStreak(h, logs, today) : h.track_streak ? cleanStreak(h, logs, today) : cleanDays(h, logs, today);
      const best = Math.max(h.best_streak ?? 0, cur);
      // Plain bad habits do not keep a best run, so only good habits and streak habits show one.
      const showBest = h.type === 'good' || h.track_streak;
      const label = `${h.type === 'good' ? `${cur} in a row` : `clean ${cur} ${cur === 1 ? 'day' : 'days'}`}${showBest ? ` · best ${best}` : ''}`;
      return { h, cur, best: showBest ? best : Math.max(cur, 7), label };
    })
    .sort((a, b) => b.cur - a.cur);

  return (
    <div className="page">
      <header className="head">
        <div className="row">
          <Link to="/habits" className="btn icon only-mobile" aria-label="Back to habits">
            <Icon name="back" />
          </Link>
          <h1>Habit dashboard</h1>
        </div>
        <Link to="/habits" className="btn only-desktop">
          Back to habits
        </Link>
      </header>

      <Seg options={[['day', 'Day'], ['week', 'Week'], ['month', 'Month']]} value={period} onChange={setPeriod} label="Score period" />

      <section className="card">
        <span className="eyebrow">{card.label}</span>
        <div className="row base" style={{ gap: 12, flexWrap: 'wrap' }}>
          <span className="big xl blue">{summaries ? fmtPoints(card.score) : '…'}</span>
          <span className="small muted">{card.trend}</span>
        </div>
        <div className="row small muted" style={{ gap: 16 }}>
          <span>
            <span className="blue">■</span> {card.good} good
          </span>
          <span>
            <span className="red">■</span> {card.bad} bad
          </span>
        </div>
      </section>

      <section className="card">
        <div className="row between base wrap">
          <h2>Daily score · last {desktop ? '12 months' : '20 weeks'}</h2>
          <span className="small muted">
            {logged} days logged · best day {fmtPoints(best)}
          </span>
        </div>
        <div className="heat-scroll">
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${weeks}, 13px)`, columnGap: 3, fontSize: 10, color: 'var(--dim)', height: 14, marginBottom: 4 }}>
            {months.map((m, i) => (
              <span key={i} style={{ whiteSpace: 'nowrap' }}>
                {m}
              </span>
            ))}
          </div>
          <div className="heat" role="grid" aria-label="Daily habit score heatmap">
            {cells.map((d) => {
              const s = sums[`day_${d}`];
              const future = d > today;
              return (
                <button
                  key={d}
                  type="button"
                  disabled={future}
                  className={`${future ? 'future' : level(s?.score)}${d === picked ? ' sel' : ''}`}
                  aria-label={`${fmtDayLong(d)}: ${s ? fmtPoints(s.score) : 'nothing logged'}`}
                  title={`${fmtDay(d)}: ${s ? fmtPoints(s.score) : '0'}`}
                  onClick={() => setPicked(d)}
                />
              );
            })}
          </div>
        </div>
        <div className="legend">
          <span>Negative</span>
          <i style={{ background: '#8a1420' }} />
          <span style={{ marginLeft: 10 }}>Less</span>
          <i style={{ background: '#1f1916' }} />
          <i style={{ background: '#24404f' }} />
          <i style={{ background: '#4f86a6' }} />
          <i style={{ background: 'var(--blue)' }} />
          <span>More</span>
        </div>
      </section>

      <div className="cards">
        <section className="card blue-line">
          <div className="row between base">
            <h2>{fmtDayLong(picked)}</h2>
            <span className="big md blue">{fmtPoints(sums[`day_${picked}`]?.score ?? 0)}</span>
          </div>
          <span className="tiny dim">Tap a day on the heatmap to see it here.</span>
          {!dayLogs ? (
            <span className="small dim">Loading…</span>
          ) : !dayLogs.filter((l) => l.count > 0).length ? (
            <span className="small dim">Nothing logged that day.</span>
          ) : (
            dayLogs
              .filter((l) => l.count > 0)
              .map((l) => (
                <div key={l.id} className="line small">
                  <span className="grow">
                    {hmap[l.habit_id]?.name ?? 'Deleted habit'}
                    {l.count > 1 ? ` ×${l.count}` : ''}
                  </span>
                  <span className={`mono ${l.score >= 0 ? 'blue' : 'red'}`}>{fmtPoints(l.score)}</span>
                </div>
              ))
          )}
        </section>

        <section className="card">
          <h2>Streaks</h2>
          {streakRows.map(({ h, cur, best, label }) => (
            <div key={h.id} className="col tight" style={{ padding: '10px 0', borderTop: '1px solid var(--soft)' }}>
              <div className="row between base small">
                <span>{h.name}</span>
                <span className="mono tiny muted nowrap">{label}</span>
              </div>
              <Bar pct={best ? (cur / best) * 100 : 0} red={h.type === 'bad'} />
            </div>
          ))}
          <button type="button" className="link" style={{ alignSelf: 'flex-start' }} onClick={() => run(rebuildSummaries(), 'Recalculating scores from your logs…')}>
            Recalculate scores
          </button>
        </section>
      </div>
    </div>
  );
}
