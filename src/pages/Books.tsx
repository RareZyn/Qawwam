import { type FormEvent, useState } from 'react';
import { type BookInput, deleteBook, saveBook, setPage } from '../lib/actions';
import { useBooks, useReadingLogs } from '../lib/db';
import type { Book } from '../lib/types';
import { DOW, addDays, dow, fmtDay } from '../lib/util';
import { Bar, Chips, ConfirmButton, Field, Panel, Sheet, Toggle, run, useToday } from '../ui';

const STATUS: Record<Book['status'], string> = { reading: 'Reading', on_hold: 'On hold', finished: 'Finished' };

function BookForm({ formId, book, books, onDone }: { formId: string; book?: Book; books: Book[]; onDone: () => void }) {
  const today = useToday();
  const [title, setTitle] = useState(book?.title ?? '');
  const [author, setAuthor] = useState(book?.author ?? '');
  const [pages, setPages] = useState(book?.total_pages ? String(book.total_pages) : '');
  const [home, setHome] = useState(book?.show_on_home ?? !books.some((b) => b.show_on_home));
  const [status, setStatus] = useState<Book['status']>(book?.status ?? 'reading');

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const n = parseInt(pages, 10);
    const input: BookInput = { title: title.trim(), author: author.trim() || null, total_pages: n > 0 ? n : null, show_on_home: home, status };
    await saveBook(input, books, today, book);
    if (!book) {
      setTitle('');
      setAuthor('');
      setPages('');
    }
    onDone();
  }

  return (
    <form id={formId} className="col loose" onSubmit={(e) => run(save(e))}>
      <Field label="Title">
        <input className="input" required value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
        <Field label="Author (optional)">
          <input className="input" value={author} onChange={(e) => setAuthor(e.target.value)} />
        </Field>
        <Field label="Pages">
          <input className="input num" type="number" min={1} value={pages} onChange={(e) => setPages(e.target.value)} />
        </Field>
      </div>
      {book && <Chips options={[['reading', 'Reading'], ['on_hold', 'On hold'], ['finished', 'Finished']]} value={status} onChange={setStatus} label="Status" />}
      <div className="row between">
        <span>Show on the Home widget</span>
        <Toggle checked={home} onChange={setHome} label="Show on the Home widget" />
      </div>
      {book && <ConfirmButton label="Delete book" confirm="Tap again to delete" onConfirm={() => run(deleteBook(book.id).then(onDone), 'Book deleted')} />}
    </form>
  );
}

export default function Books() {
  const today = useToday();
  const books = useBooks();
  const logs = useReadingLogs();
  const [adding, setAdding] = useState(false);
  const [addKey, setAddKey] = useState(0);
  const [editing, setEditing] = useState<Book | null>(null);
  const list = (books ?? []).slice().sort((a, b) => ['reading', 'on_hold', 'finished'].indexOf(a.status) - ['reading', 'on_hold', 'finished'].indexOf(b.status) || b.created_ms - a.created_ms);
  const current = list.find((b) => b.show_on_home) ?? list.find((b) => b.status === 'reading');
  const pct = current?.total_pages ? Math.round((current.current_page / current.total_pages) * 100) : 0;

  const byDay: Record<string, number> = {};
  // Only count logs of books that still exist, so deleting a book also clears its pages from the chart.
  const bookIds = new Set((books ?? []).map((b) => b.id));
  for (const l of logs ?? []) if (bookIds.has(l.book_id)) byDay[l.log_date] = (byDay[l.log_date] ?? 0) + l.pages_read;
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));
  const max = Math.max(1, ...days.map((d) => byDay[d] ?? 0));
  const total = days.reduce((a, d) => a + Math.max(0, byDay[d] ?? 0), 0);
  const finishedThisYear = list.filter((b) => b.status === 'finished' && b.finished_at?.slice(0, 4) === today.slice(0, 4)).length;
  const step = (n: number) => current && run(setPage(current, current.current_page + n, today));

  return (
    <div className="page">
      <header className="head">
        <h1>Books</h1>
        <button type="button" className="btn primary only-mobile" onClick={() => setAdding(true)}>
          + Add book
        </button>
      </header>

      <div className="split">
        <div className="wide col loose">
          {current ? (
            <section className="card blue-line" aria-label="Now reading">
              <div className="row between base">
                <span className="eyebrow blue">Now reading · on home widget</span>
                <span className="small muted">{current.total_pages ? `${pct}%` : ''}</span>
              </div>
              <div className="col tight">
                <span style={{ fontFamily: 'var(--head)', fontSize: 26, fontWeight: 600 }}>{current.title}</span>
                <span className="small dim">
                  {[current.author, current.total_pages ? `${current.total_pages} pages` : null].filter(Boolean).join(' · ')}
                </span>
              </div>
              {current.total_pages ? <Bar pct={pct} thick /> : null}
              <div className="stepper">
                <button type="button" className="sq" aria-label="Back one page" onClick={() => step(-1)}>
                  −
                </button>
                <div className="val" aria-live="polite">
                  {current.current_page}
                  {current.total_pages ? <span className="small dim">/ {current.total_pages}</span> : null}
                </div>
                <button type="button" className="sq" aria-label="Forward one page" onClick={() => step(1)}>
                  +
                </button>
                <button type="button" className="btn primary" style={{ height: 48 }} onClick={() => step(10)}>
                  +10
                </button>
              </div>
              <span className="tiny dim">Every change is saved to today's reading log.</span>
            </section>
          ) : (
            books && <p className="dim">No book yet. Add the one you are reading.</p>
          )}

          <section className="card">
            <div className="row between base">
              <h2>Pages read · last 14 days</h2>
              <span className="small muted">{total} pages</span>
            </div>
            <div className="bars" role="img" aria-label={days.map((d) => `${fmtDay(d)}: ${byDay[d] ?? 0} pages`).join('; ')}>
              {days.map((d) => {
                const n = Math.max(0, byDay[d] ?? 0);
                return (
                  <div key={d}>
                    <span>{n || ''}</span>
                    <i className={n ? '' : 'zero'} style={{ height: `${Math.max(3, (n / max) * 80)}px` }} />
                    <span>{DOW[dow(d)][0]}</span>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="card">
            <div className="row between base">
              <h2>Library</h2>
              <span className="small muted">{finishedThisYear} finished this year</span>
            </div>
            {list.map((b) => {
              const p = b.total_pages ? Math.round((b.current_page / b.total_pages) * 100) : 0;
              return (
                <button key={b.id} type="button" className="line" style={{ background: 'none', border: 0, borderTop: '1px solid var(--soft)', width: '100%', textAlign: 'left' }} onClick={() => setEditing(b)}>
                  <div className="grow col" style={{ gap: 6 }}>
                    <span>{b.title}</span>
                    <Bar pct={p} />
                  </div>
                  <span className={`badge${b.status === 'finished' ? ' solid' : b.status === 'on_hold' ? ' grey' : ''}`}>{STATUS[b.status]}</span>
                </button>
              );
            })}
          </section>
        </div>

        <div className="side">
          <Panel open={adding} onClose={() => setAdding(false)} title="Add book" formId="book-form">
            <BookForm
              key={addKey}
              formId="book-form"
              books={list}
              onDone={() => {
                setAdding(false);
                setAddKey((k) => k + 1);
              }}
            />
          </Panel>
        </div>
      </div>

      <Sheet open={!!editing} onClose={() => setEditing(null)} title="Edit book" formId="book-form-edit">
        {editing && <BookForm key={editing.id} formId="book-form-edit" book={editing} books={list} onDone={() => setEditing(null)} />}
      </Sheet>
    </div>
  );
}
