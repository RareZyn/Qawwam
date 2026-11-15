import { type FormEvent, useState } from 'react';
import { type TodoInput, deleteTodo, deleteTodoGroup, saveTodo, saveTodoGroup, toggleTodo } from '../lib/actions';
import { useTodoGroups, useTodos } from '../lib/db';
import type { TodoGroup, TodoItem } from '../lib/types';
import { byId, diffDays, fmtDay } from '../lib/util';
import { Check, ConfirmButton, Field, Panel, Seg, Sheet, Toggle, run, toast, useToday } from '../ui';

type Tab = 'today' | 'overdue' | 'urgent' | 'all';

function dueLabel(t: TodoItem, today: string) {
  if (t.status === 'done') return 'Done';
  if (!t.due_date) return 'No date';
  const d = diffDays(today, t.due_date);
  if (d < 0) return `Overdue · ${fmtDay(t.due_date)}`;
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  return fmtDay(t.due_date);
}

function TodoForm({ formId, todo, groups, defaultGroup, onDone }: { formId: string; todo?: TodoItem; groups: TodoGroup[]; defaultGroup: string; onDone: () => void }) {
  const [title, setTitle] = useState(todo?.title ?? '');
  const [note, setNote] = useState(todo?.note ?? '');
  const [due, setDue] = useState(todo?.due_date ?? '');
  const [urgent, setUrgent] = useState(todo?.is_urgent ?? false);
  // Groups may still be loading when the form first appears, so fall back to the current default.
  const [picked, setGroup] = useState(todo?.group_id ?? '');
  const group = picked || defaultGroup;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    if (!group) return toast('Make a group first', true);
    const input: TodoInput = { title: title.trim(), note: note.trim() || null, due_date: due || null, is_urgent: urgent, group_id: group };
    await saveTodo(input, todo);
    if (!todo) {
      setTitle('');
      setNote('');
      setDue('');
      setUrgent(false);
    }
    onDone();
  }

  return (
    <form id={formId} className="col loose" onSubmit={(e) => run(save(e))}>
      <Field label="Task">
        <input className="input" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task…" />
      </Field>
      <div className="two">
        <Field label="Due date">
          <input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
        <Field label="Group">
          <select className="input" value={group} onChange={(e) => setGroup(e.target.value)}>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="row between">
        <span>Urgent</span>
        <Toggle checked={urgent} onChange={setUrgent} label="Urgent" />
      </div>
      <Field label="Note (optional)">
        <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {todo && <ConfirmButton label="Delete task" confirm="Tap again to delete" onConfirm={() => run(deleteTodo(todo.id).then(onDone), 'Task deleted')} />}
    </form>
  );
}

function GroupForm({ group, todos, onDone }: { group?: TodoGroup; todos: TodoItem[]; onDone: () => void }) {
  const [name, setName] = useState(group?.name ?? '');
  const count = group ? todos.filter((t) => t.group_id === group.id).length : 0;
  return (
    <form
      id="group-form"
      className="col loose"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) run(saveTodoGroup(name.trim(), group).then(onDone));
      }}
    >
      <Field label="Group name">
        <input className="input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Home" />
      </Field>
      {group && (
        <ConfirmButton
          label={count ? `Delete group and its ${count} tasks` : 'Delete group'}
          confirm="Tap again to delete"
          onConfirm={() => run(deleteTodoGroup(group.id, todos).then(onDone), 'Group deleted')}
        />
      )}
    </form>
  );
}

export default function Todo() {
  const today = useToday();
  const todos = useTodos();
  const groupList = useTodoGroups();
  const groups = (groupList ?? []).slice().sort((a, b) => a.sort_order - b.sort_order);
  const gmap = byId(groupList);
  const [tab, setTab] = useState<Tab>('all');
  const [group, setGroup] = useState('');
  const [editing, setEditing] = useState<TodoItem | null>(null);
  const [adding, setAdding] = useState(false);
  const [addKey, setAddKey] = useState(0);
  const [groupSheet, setGroupSheet] = useState<{ group?: TodoGroup } | null>(null);

  const all = todos ?? [];
  const open = all.filter((t) => t.status === 'open');
  const filters: Record<Tab, (t: TodoItem) => boolean> = {
    today: (t) => t.status === 'open' && t.due_date === today,
    overdue: (t) => t.status === 'open' && !!t.due_date && t.due_date < today,
    urgent: (t) => t.status === 'open' && t.is_urgent,
    all: () => true,
  };
  const list = all
    .filter(filters[tab])
    .filter((t) => !group || t.group_id === group)
    .sort(
      (a, b) =>
        (a.status === 'done' ? 1 : 0) - (b.status === 'done' ? 1 : 0) ||
        Number(b.is_urgent) - Number(a.is_urgent) ||
        (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') ||
        a.created_ms - b.created_ms,
    );

  return (
    <div className="page">
      <header className="head">
        <div className="col tight">
          <h1>To-Do</h1>
          <span className="small muted">
            {open.length} open ·{' '}
            <span className="red">
              {open.filter((t) => t.is_urgent).length} urgent · {open.filter(filters.overdue).length} overdue
            </span>
          </span>
        </div>
        <div className="row">
          <Seg options={[['today', 'Today'], ['overdue', 'Overdue'], ['urgent', 'Urgent'], ['all', 'All']]} value={tab} onChange={setTab} label="Show" />
        </div>
      </header>

      <div className="chips" role="group" aria-label="Groups">
        <button type="button" className={`chip${!group ? ' on' : ''}`} onClick={() => setGroup('')}>
          All · {all.length}
        </button>
        {groups.map((g) => (
          <button
            key={g.id}
            type="button"
            className={`chip${group === g.id ? ' on' : ''}`}
            onClick={() => (group === g.id ? setGroupSheet({ group: g }) : setGroup(g.id))}
            title={group === g.id ? 'Tap again to rename or delete' : undefined}
          >
            {g.name} · {all.filter((t) => t.group_id === g.id).length}
          </button>
        ))}
        <button type="button" className="chip" onClick={() => setGroupSheet({})}>
          + Group
        </button>
      </div>

      <div className="split">
        <div className="wide col">
          <button type="button" className="btn primary only-mobile" onClick={() => setAdding(true)}>
            + Add task
          </button>
          {!todos ? (
            <p className="dim small">Loading…</p>
          ) : !list.length ? (
            <p className="dim small center" style={{ padding: 24 }}>
              Nothing here. Enjoy the free time.
            </p>
          ) : (
            list.map((t) => {
              const overdue = t.status === 'open' && !!t.due_date && t.due_date < today;
              return (
                <div key={t.id} className={`item${overdue ? ' red-line' : ''}`}>
                  <Check large checked={t.status === 'done'} label={`Mark ${t.title} done`} onChange={() => run(toggleTodo(t))} />
                  <button type="button" className="grow col tight link" style={{ color: 'var(--text)', textAlign: 'left', fontSize: 15 }} onClick={() => setEditing(t)}>
                    <span className={t.status === 'done' ? 'strike' : ''}>{t.title}</span>
                    <span className="tiny dim">
                      {gmap[t.group_id]?.name ?? 'No group'} · <span className={overdue ? 'red' : t.due_date === today ? 'blue' : ''}>{dueLabel(t, today)}</span>
                    </span>
                  </button>
                  {t.is_urgent && t.status === 'open' && <span className="badge red">Urgent</span>}
                </div>
              );
            })
          )}
        </div>
        <div className="side">
          <Panel open={adding} onClose={() => setAdding(false)} title="Add task" formId="todo-form">
            <TodoForm
              key={addKey}
              formId="todo-form"
              groups={groups}
              defaultGroup={group || groups[0]?.id || ''}
              onDone={() => {
                setAdding(false);
                setAddKey((k) => k + 1);
              }}
            />
          </Panel>
        </div>
      </div>

      <Sheet open={!!editing} onClose={() => setEditing(null)} title="Edit task" formId="todo-form-edit">
        {editing && <TodoForm key={editing.id} formId="todo-form-edit" todo={editing} groups={groups} defaultGroup={editing.group_id} onDone={() => setEditing(null)} />}
      </Sheet>
      <Sheet open={!!groupSheet} onClose={() => setGroupSheet(null)} title={groupSheet?.group ? 'Edit group' : 'New group'} formId="group-form">
        {groupSheet && (
          <GroupForm
            group={groupSheet.group}
            todos={all}
            onDone={() => {
              if (groupSheet.group && !groups.some((g) => g.id === groupSheet.group!.id)) setGroup('');
              setGroupSheet(null);
            }}
          />
        )}
      </Sheet>
    </div>
  );
}
