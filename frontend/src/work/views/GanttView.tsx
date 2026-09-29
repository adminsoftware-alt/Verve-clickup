import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarPlus, ChevronDown, ChevronRight, Diamond } from 'lucide-react';
import type { Dependency, Task, TaskInput, UserRef } from '../api';
import { Avatar } from '../ui';
import { useWork } from '../WorkContext';

const DAY = 86_400_000;
const ROW = 34;
const HEAD = 44;
const NAME_W = 260;
type Zoom = 'day' | 'week' | 'month';
const PX: Record<Zoom, number> = { day: 36, week: 14, month: 4 };

const midnight = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
const addDays = (t: number, n: number) => { const d = new Date(t); d.setDate(d.getDate() + n); return d.getTime(); };
const daysBetween = (a: number, b: number) => Math.round((b - a) / DAY);

/** A task's span in whole days: [first day, last day]. Only-due or only-start tasks take one day. */
function span(t: Task): [number, number] | null {
  const s = t.start_date ? midnight(new Date(t.start_date)) : null;
  const d = t.due_date ? midnight(new Date(t.due_date)) : null;
  if (s === null && d === null) return null;
  return [s ?? d!, Math.max(d ?? s!, s ?? d!)];
}

interface Row { key: string; label?: React.ReactNode; task?: Task; depth?: number; lane?: Task[]; header?: boolean }

/**
 * ClickUp's Gantt and Timeline views. Gantt: one row per task, with arrows for dependencies.
 * Timeline: one lane per person, their tasks side by side. Drag a bar to move it; drag its
 * ends to change the start or due date.
 */
export const GanttView: React.FC<{
  mode: 'gantt' | 'timeline';
  tasks: Task[];
  dependencies: Dependency[];
  people: UserRef[];
  listName: (listId: string) => string | null;
  groupByList: boolean;
  onOpenTask: (id: string) => void;
  onUpdate: (taskId: string, input: TaskInput) => Promise<void>;
}> = ({ mode, tasks, dependencies, people, listName, groupByList, onOpenTask, onUpdate }) => {
  const { taskTypes } = useWork();
  const [zoom, setZoom] = useState<Zoom>(() => { try { return (localStorage.getItem('timetriq.ganttZoom') as Zoom) || 'week'; } catch { return 'week'; } });
  useEffect(() => { try { localStorage.setItem('timetriq.ganttZoom', zoom); } catch { /* ignore */ } }, [zoom]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<Record<string, [number, number]>>({});
  const scroller = useRef<HTMLDivElement>(null);
  const px = PX[zoom];
  const today = midnight(new Date());

  const spans = useMemo(() => {
    const m = new Map<string, [number, number]>();
    tasks.forEach((t) => { const sp = preview[t.id] ?? span(t); if (sp) m.set(t.id, sp); });
    return m;
  }, [tasks, preview]);
  const [from, to] = useMemo(() => {
    let lo = addDays(today, -14);
    let hi = addDays(today, 60);
    spans.forEach(([a, b]) => { lo = Math.min(lo, addDays(a, -7)); hi = Math.max(hi, addDays(b, 21)); });
    const first = new Date(lo);
    first.setDate(first.getDate() - ((first.getDay() + 6) % 7)); // start on a Monday
    return [midnight(first), hi];
  }, [spans, today]);
  const width = (daysBetween(from, to) + 1) * px;
  const x = (t: number) => daysBetween(from, t) * px;

  // Rows: tasks (by List, subtasks indented) for Gantt; people for Timeline.
  const rows: Row[] = useMemo(() => {
    const scheduled = tasks.filter((t) => spans.has(t.id));
    if (mode === 'timeline') {
      const byPerson = new Map<string, Task[]>();
      scheduled.forEach((t) => (t.assignees.length ? t.assignees.map((u) => u.id) : ['none']).forEach((id) => byPerson.set(id, [...(byPerson.get(id) ?? []), t])));
      const out: Row[] = [];
      [...byPerson.entries()]
        .sort(([a], [b]) => (a === 'none' ? 1 : b === 'none' ? -1 : 0))
        .forEach(([id, list]) => {
          const who = people.find((p) => p.id === id);
          // Pack bars into as few lines as possible without overlaps.
          const lines: Task[][] = [];
          [...list].sort((a, b) => spans.get(a.id)![0] - spans.get(b.id)![0]).forEach((t) => {
            const [a] = spans.get(t.id)!;
            const line = lines.find((l) => spans.get(l[l.length - 1].id)![1] < a);
            if (line) line.push(t); else lines.push([t]);
          });
          lines.forEach((lane, i) => out.push({
            key: `${id}-${i}`, lane,
            label: i === 0 ? (who ? <span className="flex items-center gap-2"><Avatar user={who} size={20} />{who.display_name || who.email}</span> : <span className="text-gray-500">Unassigned</span>) : null,
          }));
        });
      return out;
    }
    const ids = new Set(tasks.map((t) => t.id));
    const kids = new Map<string, Task[]>();
    tasks.forEach((t) => { if (t.parent_id && ids.has(t.parent_id)) kids.set(t.parent_id, [...(kids.get(t.parent_id) ?? []), t]); });
    const out: Row[] = [];
    const add = (t: Task, depth: number) => {
      out.push({ key: t.id, task: t, depth });
      if (!collapsed.has(t.id)) (kids.get(t.id) ?? []).forEach((k) => add(k, depth + 1));
    };
    const roots = tasks.filter((t) => !t.parent_id || !ids.has(t.parent_id));
    if (groupByList) {
      const lists = [...new Set(roots.map((t) => t.list_id))];
      lists.forEach((l) => {
        out.push({ key: `list-${l}`, header: true, label: listName(l) ?? 'List' });
        if (!collapsed.has(`list-${l}`)) roots.filter((t) => t.list_id === l).forEach((t) => add(t, 0));
      });
    } else roots.forEach((t) => add(t, 0));
    return out;
  }, [mode, tasks, spans, people, collapsed, groupByList, listName]);
  const unscheduled = tasks.filter((t) => !spans.has(t.id) && !t.parent_id);
  const rowOf = useMemo(() => new Map(rows.map((r, i) => [r.task?.id ?? '', i])), [rows]);

  useEffect(() => { // start scrolled to a few days before today
    if (scroller.current) scroller.current.scrollLeft = Math.max(0, x(addDays(today, -3)) - 40);
  }, [zoom]); // eslint-disable-line react-hooks/exhaustive-deps

  const canEdit = (t: Task) => t.permission_level === 'edit' || t.permission_level === 'full';
  const drag = (e: React.MouseEvent, t: Task, edge: 'move' | 'start' | 'end') => {
    if (!canEdit(t)) return;
    e.preventDefault();
    e.stopPropagation();
    const [a0, b0] = spans.get(t.id)!;
    const startX = e.clientX;
    let moved = false;
    const at = (ev: MouseEvent): [number, number] => {
      const delta = Math.round((ev.clientX - startX) / px);
      if (edge === 'move') return [addDays(a0, delta), addDays(b0, delta)];
      if (edge === 'start') return [Math.min(addDays(a0, delta), b0), b0];
      return [a0, Math.max(addDays(b0, delta), a0)];
    };
    const onMove = (ev: MouseEvent) => {
      if (Math.abs(ev.clientX - startX) > 3) moved = true;
      if (moved) setPreview((p) => ({ ...p, [t.id]: at(ev) }));
    };
    const onUp = async (ev: MouseEvent) => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (!moved) { onOpenTask(t.id); return; }
      const [a, b] = at(ev);
      const hadStart = !!t.start_date;
      const input: TaskInput = { due_date: new Date(addDays(b, 0) + 17 * 3600_000).toISOString() };
      if (hadStart || edge !== 'end' || a !== b) input.start_date = new Date(a + 9 * 3600_000).toISOString();
      await onUpdate(t.id, input);
      setPreview((p) => { const n = { ...p }; delete n[t.id]; return n; });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const bar = (t: Task, top: number) => {
    const [a, b] = spans.get(t.id)!;
    const type = t.type_id ? taskTypes.find((k) => k.id === t.type_id) : undefined;
    const left = x(a);
    const w = Math.max(px, (daysBetween(a, b) + 1) * px);
    const done = t.status.group === 'done' || t.status.group === 'closed';
    if (type?.is_milestone) {
      return (
        <button key={t.id} type="button" title={`${t.name} (milestone)`} aria-label={`Bar: ${t.name}`} onMouseDown={(e) => drag(e, t, 'move')}
          className="absolute flex items-center gap-1 text-xs text-gray-700" style={{ left: x(b) - 7, top: top + 9 }}>
          <Diamond size={16} fill={type.color} style={{ color: type.color }} /><span className="whitespace-nowrap">{t.name}</span>
        </button>
      );
    }
    return (
      <div key={t.id} role="button" tabIndex={0} aria-label={`Bar: ${t.name}`} title={`${t.name} · ${new Date(a).toLocaleDateString()} → ${new Date(b).toLocaleDateString()}`}
        onMouseDown={(e) => drag(e, t, 'move')} onKeyDown={(e) => e.key === 'Enter' && onOpenTask(t.id)}
        className={`group absolute flex h-6 items-center overflow-hidden rounded-md text-[11px] font-medium text-white shadow-sm ${canEdit(t) ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'} ${done ? 'opacity-60' : ''}`}
        style={{ left, top: top + 5, width: w, backgroundColor: t.status.color }}>
        {canEdit(t) && <span onMouseDown={(e) => drag(e, t, 'start')} aria-label={`Change start of ${t.name}`} className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize bg-black/10 opacity-0 group-hover:opacity-100" />}
        <span className="truncate px-2">{mode === 'timeline' || w > 90 ? t.name : ''}</span>
        {canEdit(t) && <span onMouseDown={(e) => drag(e, t, 'end')} aria-label={`Change due date of ${t.name}`} className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize bg-black/10 opacity-0 group-hover:opacity-100" />}
      </div>
    );
  };

  // Header: months, and days (or week starts) under them.
  const days = daysBetween(from, to) + 1;
  const months: { label: string; left: number; w: number }[] = [];
  for (let i = 0; i < days; i += 1) {
    const d = new Date(addDays(from, i));
    const label = d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    if (!months.length || months[months.length - 1].label !== label) months.push({ label, left: i * px, w: px });
    else months[months.length - 1].w += px;
  }
  const ticks: { left: number; label: string; weekend: boolean }[] = [];
  for (let i = 0; i < days; i += 1) {
    const d = new Date(addDays(from, i));
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    if (zoom === 'day') ticks.push({ left: i * px, label: String(d.getDate()), weekend });
    else if (zoom === 'week' && d.getDay() === 1) ticks.push({ left: i * px, label: `${d.getDate()} ${d.toLocaleDateString(undefined, { month: 'short' })}`, weekend: false });
  }

  const arrows = mode === 'gantt' ? dependencies.flatMap((dep) => {
    const ra = rowOf.get(dep.blocker_id), rb = rowOf.get(dep.waiting_id);
    const sa = spans.get(dep.blocker_id), sb = spans.get(dep.waiting_id);
    if (ra === undefined || rb === undefined || !sa || !sb) return [];
    const x1 = x(sa[1]) + px, y1 = ra * ROW + ROW / 2, x2 = x(sb[0]), y2 = rb * ROW + ROW / 2;
    const late = sb[0] <= sa[1];
    const midX = Math.max(x1 + 8, Math.min(x2 - 8, x1 + 12));
    return [{ key: `${dep.blocker_id}-${dep.waiting_id}`, d: `M${x1},${y1} H${midX} V${y2} H${x2 - 2}`, late }];
  }) : [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-6 py-2">
        <span className="text-xs text-gray-500">{mode === 'gantt' ? 'Drag bars to reschedule; drag their ends to change dates. Arrows show what each task waits on.' : 'Each person’s scheduled work, side by side.'}</span>
        <span className="ml-auto flex rounded-md border border-gray-200 bg-white p-0.5" role="radiogroup" aria-label="Zoom">
          {(['day', 'week', 'month'] as Zoom[]).map((z) => (
            <button key={z} type="button" role="radio" aria-checked={zoom === z} onClick={() => setZoom(z)} className={`rounded px-2 py-0.5 text-xs capitalize ${zoom === z ? 'bg-gray-100 font-medium text-gray-900' : 'text-gray-500'}`}>{z}</button>
          ))}
        </span>
        <button type="button" onClick={() => { if (scroller.current) scroller.current.scrollLeft = Math.max(0, x(today) - 200); }} className="rounded-md border border-gray-200 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50">Today</button>
      </div>
      <div ref={scroller} className="relative mx-6 min-h-0 flex-1 overflow-auto rounded-lg border border-gray-200 bg-white" aria-label={mode === 'gantt' ? 'Gantt chart' : 'Timeline'}>
        <div className="relative" style={{ width: NAME_W + width, minHeight: HEAD + rows.length * ROW }}>
          {/* header */}
          <div className="sticky top-0 z-20 flex border-b border-gray-200 bg-gray-50" style={{ height: HEAD }}>
            <div className="sticky left-0 z-30 flex shrink-0 items-end border-r border-gray-200 bg-gray-50 px-3 pb-1.5 text-xs font-medium text-gray-500" style={{ width: NAME_W }}>
              {mode === 'gantt' ? 'Task' : 'Person'}
            </div>
            <div className="relative" style={{ width }}>
              {months.map((m) => (
                // The label sticks to the left edge while its month is in view, so long months stay named.
                <div key={m.left} className="absolute top-0 h-full border-l border-gray-200 pt-1 text-[11px] font-semibold text-gray-600" style={{ left: m.left, width: m.w }}>
                  <span className="sticky inline-block max-w-full truncate whitespace-nowrap px-1.5" style={{ left: NAME_W }}>{m.label}</span>
                </div>
              ))}
              {ticks.map((t) => <div key={t.left} className={`absolute bottom-0 border-l border-gray-100 pb-1 pl-1 text-[10px] ${t.weekend ? 'text-gray-300' : 'text-gray-400'}`} style={{ left: t.left }}>{t.label}</div>)}
            </div>
          </div>
          {/* background: weekends and today */}
          <div className="pointer-events-none absolute bottom-0" style={{ left: NAME_W, top: HEAD, width }}>
            {zoom !== 'month' && Array.from({ length: days }, (_, i) => i).filter((i) => [0, 6].includes(new Date(addDays(from, i)).getDay())).map((i) => (
              <div key={i} className="absolute inset-y-0 bg-gray-50" style={{ left: i * px, width: px }} />
            ))}
            <div className="absolute inset-y-0 w-px bg-red-400" style={{ left: x(today) + px / 2 }} title="Today" />
          </div>
          {/* rows */}
          {rows.map((r, i) => (
            <div key={r.key} className={`relative flex border-b border-gray-100 ${r.header ? 'bg-gray-50' : ''}`} style={{ height: ROW }}>
              <div className="sticky left-0 z-10 flex shrink-0 items-center gap-1.5 truncate border-r border-gray-200 bg-white px-3 text-sm" style={{ width: NAME_W, paddingLeft: 12 + (r.depth ?? 0) * 16 }}>
                {r.header && (
                  <button type="button" onClick={() => setCollapsed((c) => { const n = new Set(c); if (n.has(r.key)) n.delete(r.key); else n.add(r.key); return n; })} className="flex items-center gap-1 font-semibold text-gray-700">
                    {collapsed.has(r.key) ? <ChevronRight size={13} /> : <ChevronDown size={13} />} {r.label}
                  </button>
                )}
                {r.task && (
                  <button type="button" onClick={() => onOpenTask(r.task!.id)} className={`truncate text-left hover:underline ${r.task.status.group === 'closed' ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{r.task.name}</button>
                )}
                {r.lane && r.label}
              </div>
              <div className="relative" style={{ width }}>
                {r.task && spans.has(r.task.id) && bar(r.task, 0)}
                {r.lane?.map((t) => bar(t, 0))}
              </div>
              {i === 0 && null}
            </div>
          ))}
          {/* dependency arrows */}
          {arrows.length > 0 && (
            <svg className="pointer-events-none absolute" style={{ left: NAME_W, top: HEAD, width, height: rows.length * ROW }} aria-hidden>
              <defs>
                <marker id="gantt-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#6b7280" /></marker>
                <marker id="gantt-arrow-late" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#dc2626" /></marker>
              </defs>
              {arrows.map((a) => <path key={a.key} d={a.d} fill="none" stroke={a.late ? '#dc2626' : '#6b7280'} strokeWidth={1.5} markerEnd={`url(#${a.late ? 'gantt-arrow-late' : 'gantt-arrow'})`} />)}
            </svg>
          )}
          {rows.length === 0 && <p className="p-10 text-center text-sm text-gray-400" style={{ marginLeft: NAME_W }}>No tasks with dates yet.</p>}
        </div>
      </div>
      {unscheduled.length > 0 && (
        <div className="mx-6 mb-4 mt-2 rounded-lg border border-dashed border-gray-300 bg-white p-2" aria-label="Unscheduled tasks">
          <p className="mb-1 text-xs font-semibold text-gray-500">No dates ({unscheduled.length}) — give them dates to place them</p>
          <div className="flex flex-wrap gap-1.5">
            {unscheduled.slice(0, 30).map((t) => (
              <span key={t.id} className="flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                <button type="button" onClick={() => onOpenTask(t.id)} className="hover:underline">{t.name}</button>
                {canEdit(t) && (
                  <button type="button" title="Schedule this week" aria-label={`Schedule ${t.name}`} onClick={() => onUpdate(t.id, { start_date: new Date(today + 9 * 3600_000).toISOString(), due_date: new Date(addDays(today, 4) + 17 * 3600_000).toISOString() })}
                    className="text-brand-600 hover:text-brand-800"><CalendarPlus size={12} /></button>
                )}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
