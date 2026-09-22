import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Task, TaskInput } from '../api';
import { startOfDay } from '../ui';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_MS = 86_400_000;

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** The six-week grid shown for a month, starting on Monday. */
function monthGrid(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
  return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

const shift = (iso: string | null, days: number) => (iso ? new Date(new Date(iso).getTime() + days * DAY_MS).toISOString() : null);

export const CalendarView: React.FC<{
  tasks: Task[];
  canCreate: boolean;
  onCreate: (name: string, dueIso: string) => Promise<void>;
  onUpdate: (id: string, input: TaskInput) => Promise<void>;
  onOpenTask: (id: string) => void;
}> = ({ tasks, canCreate, onCreate, onUpdate, onOpenTask }) => {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [addingOn, setAddingOn] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [dragOver, setDragOver] = useState<string | null>(null);

  const days = useMemo(() => monthGrid(month), [month]);
  const byDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    tasks.forEach((t) => {
      const anchor = t.due_date ?? t.start_date;
      if (!anchor) return;
      const key = dayKey(new Date(anchor));
      map.set(key, [...(map.get(key) ?? []), t]);
    });
    return map;
  }, [tasks]);
  const unscheduled = tasks.filter((t) => !t.due_date && !t.start_date).length;
  const todayKey = dayKey(new Date());

  const drop = async (e: React.DragEvent, day: Date) => {
    e.preventDefault();
    setDragOver(null);
    const task = tasks.find((t) => t.id === e.dataTransfer.getData('text/task-id'));
    if (!task) return;
    const anchor = new Date(task.due_date ?? task.start_date!);
    const days = Math.round((startOfDay(day).getTime() - startOfDay(anchor).getTime()) / DAY_MS);
    if (days === 0) return;
    // Move the whole span, so a task keeps its duration.
    await onUpdate(task.id, { start_date: shift(task.start_date, days), due_date: shift(task.due_date, days) });
  };

  const create = async (e: React.FormEvent, day: Date) => {
    e.preventDefault();
    if (!draft.trim()) return;
    await onCreate(draft.trim(), new Date(day.getFullYear(), day.getMonth(), day.getDate()).toISOString());
    setDraft('');
    setAddingOn(null);
  };

  return (
    <div className="flex h-full flex-col px-6 pb-6">
      <div className="flex items-center gap-3 py-3">
        <button type="button" onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))} className="rounded-md border border-gray-200 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50">
          Today
        </button>
        <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="rounded p-1 text-gray-500 hover:bg-gray-100"><ChevronLeft size={18} /></button>
        <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="rounded p-1 text-gray-500 hover:bg-gray-100"><ChevronRight size={18} /></button>
        <h3 className="text-lg font-semibold text-gray-800">{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h3>
        {unscheduled > 0 && <span className="ml-auto text-xs text-gray-400">{unscheduled} unscheduled task{unscheduled === 1 ? '' : 's'} not shown</span>}
      </div>

      <div className="grid grid-cols-7 border-l border-t border-gray-200 text-xs font-medium text-gray-500">
        {WEEKDAYS.map((d) => <div key={d} className="border-b border-r border-gray-200 bg-gray-50 px-2 py-1.5">{d}</div>)}
      </div>
      <div className="grid flex-1 grid-cols-7 grid-rows-6 border-l border-gray-200">
        {days.map((day) => {
          const key = dayKey(day);
          const inMonth = day.getMonth() === month.getMonth();
          const items = byDay.get(key) ?? [];
          return (
            <div
              key={key}
              onDragOver={(e) => { e.preventDefault(); setDragOver(key); }}
              onDragLeave={() => setDragOver((k) => (k === key ? null : k))}
              onDrop={(e) => drop(e, day)}
              onClick={() => canCreate && setAddingOn(key)}
              className={`min-h-24 border-b border-r border-gray-200 p-1 ${inMonth ? 'bg-white' : 'bg-gray-50/60'} ${dragOver === key ? 'bg-indigo-50' : ''} ${canCreate ? 'cursor-cell' : ''}`}
            >
              <div className={`mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs ${key === todayKey ? 'bg-indigo-600 font-semibold text-white' : inMonth ? 'text-gray-700' : 'text-gray-400'}`}>
                {day.getDate()}
              </div>
              <div className="space-y-0.5">
                {items.map((t) => (
                  <div
                    key={t.id}
                    draggable={t.permission_level === 'edit' || t.permission_level === 'full'}
                    onDragStart={(e) => e.dataTransfer.setData('text/task-id', t.id)}
                    onClick={(e) => { e.stopPropagation(); onOpenTask(t.id); }}
                    className="flex cursor-pointer items-center gap-1 truncate rounded px-1.5 py-0.5 text-xs text-gray-800 hover:brightness-95"
                    style={{ backgroundColor: `${t.status.color}22`, borderLeft: `3px solid ${t.status.color}` }}
                    title={t.name}
                  >
                    <span className={`truncate ${t.status.group === 'closed' ? 'line-through opacity-60' : ''}`}>{t.name}</span>
                  </div>
                ))}
                {addingOn === key && (
                  <form onSubmit={(e) => create(e, day)} onClick={(e) => e.stopPropagation()}>
                    <input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => !draft && setAddingOn(null)}
                      onKeyDown={(e) => e.key === 'Escape' && setAddingOn(null)}
                      placeholder="Task name"
                      className="w-full rounded border border-indigo-300 px-1 py-0.5 text-xs focus:outline-none"
                    />
                  </form>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
