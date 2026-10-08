// The filter control on a card's own header.
//
// Filtering used to mean opening the card's editor, which is a modal away from the question being
// asked ("what does this look like for urgent work only?"). This puts the same Filters object
// where the card is read.
//
// It is built the way ClickUp's is, and for the same reason: one flat panel listing every value of
// every filter is unreadable once a workspace has twenty people and thirty tags. So the panel asks
// two questions instead. First *what* you want to filter by -- a short, searchable list of fields.
// Then the values of that one field, and nothing else. What is already set stays visible as chips
// above, so the panel says what the card is showing without being read top to bottom.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft, CalendarCheck, CalendarClock, CalendarDays, CalendarRange, Check, ChevronDown, ChevronRight, Circle,
  Flag, Hourglass, Search, SlidersHorizontal, Tag as TagIcon, User, X,
} from 'lucide-react';

import { useWork } from '../WorkContext';
import { workApi, type TagUsage } from '../api';
import type { Filters } from './api';

const PANEL_WIDTH = 280;
/** Roughly what the panel grows to with a search box and a list; enough to decide which way to open. */
const PANEL_MAX_HEIGHT = 360;
/** Above this many choices the value list gets its own search box. */
const SEARCHABLE = 8;

type Option = { value: string; label: string; dot?: string };

/** One thing a card can be filtered by: which key it writes, and what it offers. */
type Field = {
  key: keyof Filters | 'time';
  label: string;
  Icon: React.ElementType;
  /** Several values at once (checkboxes), or one (a choice). */
  many: boolean;
  options: Option[];
  /** Fetched the first time the field is opened, rather than on every card render. */
  lazy?: boolean;
  /** The window the card covers. It is saved on the card, not in its filters, so it is handled
   *  apart from the rest -- and it is the one entry that can be set back to "no window at all". */
  time?: boolean;
};

/** The Time option that means "no window at all", i.e. everything still open. */
export const ANY_TIME = 'any';

/**
 * To do, In progress, Completed.
 *
 * "Done" and "Closed" are two states of the same thing -- finished, and finished and filed --
 * and nobody filtering a card means only one of them. They are written together, so picking
 * Completed matches both.
 */
const STATUS_OPTIONS: Option[] = [
  { value: 'not_started', label: 'To do', dot: 'bg-slate-400' },
  { value: 'active', label: 'In progress', dot: 'bg-sky-500' },
  { value: 'completed', label: 'Completed', dot: 'bg-emerald-500' },
];

/** The status groups an option stands for. */
const STATUS_GROUPS: Record<string, string[]> = {
  not_started: ['not_started'], active: ['active'], completed: ['done', 'closed'],
};

const PRIORITY_OPTIONS: Option[] = [
  { value: '1', label: 'Urgent', dot: 'bg-red-500' },
  { value: '2', label: 'High', dot: 'bg-amber-500' },
  { value: '3', label: 'Normal', dot: 'bg-sky-500' },
  { value: '4', label: 'Low', dot: 'bg-gray-400' },
  { value: '0', label: 'No priority', dot: 'bg-gray-200' },
];

const DUE_OPTIONS: Option[] = [
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Due today' },
  { value: 'this_week', label: 'Due this week' },
  { value: 'next_7_days', label: 'Due in the next 7 days' },
  { value: 'set', label: 'Has a due date' },
  { value: 'none', label: 'No due date' },
];

const DONE_OPTIONS: Option[] = [
  { value: 'today', label: 'Finished today' },
  { value: 'this_week', label: 'Finished this week' },
  { value: 'last_7_days', label: 'Finished in the last 7 days' },
  { value: 'this_month', label: 'Finished this month' },
  { value: 'last_30_days', label: 'Finished in the last 30 days' },
];

const ESTIMATE_OPTIONS: Option[] = [
  { value: 'set', label: 'Has an estimate' },
  { value: 'missing', label: 'No estimate' },
];

const SCHEDULED_OPTIONS: Option[] = [
  { value: 'yes', label: 'Has a start or due date' },
  { value: 'no', label: 'Unscheduled' },
];

/** What a filter reads as on its chip: "Priority: Urgent, High". */
function chipText(field: Field, f: Filters, name: (token: string) => string): string | null {
  if (field.time) return null;  // the window has its own label, below
  const raw = f[field.key as keyof Filters];
  if (raw === null || raw === undefined) return null;
  if (Array.isArray(raw)) {
    if (!raw.length) return null;
    if (field.key === 'status_groups') {
      const on = raw.map(String);
      const words = field.options
        .filter((o) => (STATUS_GROUPS[o.value] ?? [o.value]).every((g) => on.includes(g)))
        .map((o) => o.label);
      return words.length ? words.join(', ') : on.join(', ');
    }
    const words = raw.map((v) => (field.key === 'assignees' ? name(String(v))
      : field.options.find((o) => o.value === String(v))?.label ?? String(v)));
    return words.length > 2 ? `${words.slice(0, 2).join(', ')} +${words.length - 2}` : words.join(', ');
  }
  // "period" belongs to the card's own period control, not to anything set here.
  if (raw === 'period') return null;
  return field.options.find((o) => o.value === raw)?.label ?? String(raw);
}

/** Everything this control can set, cleared. What the card itself owns is left alone. */
function cleared(f: Filters, fields: Field[]): Filters {
  const out: Filters = { ...f };
  for (const field of fields) {
    if (field.time) continue;  // clearing filters must not silently widen the card to all time
    const raw = f[field.key as keyof Filters];
    // A date filter reading "period" is the card's period control; clearing it would silently
    // widen the card to all time.
    if (raw === 'period') continue;
    (out as Record<string, unknown>)[field.key] = null;
  }
  return out;
}

const toggle = <T,>(list: T[] | null | undefined, item: T): T[] | null => {
  const next = list?.includes(item) ? list.filter((x) => x !== item) : [...(list ?? []), item];
  return next.length ? next : null;
};

export const CardFilterMenu: React.FC<{
  value: Filters;
  disabled?: boolean;
  /** What the button says when nothing is set, and what the panel is called. The same control
   *  serves one card and the whole Dashboard, and the wording is the only difference. */
  triggerLabel?: string;
  title?: string;
  /** On a small tile the word does not fit beside the figure, so the funnel stands alone and
   *  carries the count as a badge. It is still always on show. */
  compact?: boolean;
  /** Cards whose period control already means "due in this window" keep Due date out. */
  hideDue?: boolean;
  /** Time cards are filtered by who tracked the hours, so only the people field applies. */
  peopleOnly?: boolean;
  /** The card's own window, offered as a filter like any other. */
  time?: {
    /** Which option is in force. */
    value: string;
    /** What the card can be scoped to, in the order it should be read. */
    options: { value: string; label: string }[];
    onPick: (value: string) => void;
    onCustom: () => void;
  };
  onApply: (filters: Filters) => void;
}> = ({ value, disabled, triggerLabel = 'Filter', title = 'Filter this card', compact, hideDue, peopleOnly, time, onApply }) => {
  const { members, teams, hierarchy } = useWork();
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [draft, setDraft] = useState<Filters>(value);
  const [openField, setOpenField] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [tags, setTags] = useState<TagUsage[] | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const open = pos !== null;

  const personName = (token: string) => {
    if (token === 'me') return 'Me';
    if (token === 'none') return 'Nobody';
    if (token.startsWith('team:')) return teams.find((t) => t.id === token.slice(5))?.name ?? 'Team';
    const m = members.find((x) => x.user.id === token);
    return m ? m.user.display_name || m.user.email : 'Former member';
  };

  const people: Option[] = useMemo(() => [
    { value: 'me', label: 'Me' },
    ...(peopleOnly ? [] : [{ value: 'none', label: 'Nobody' }]),
    ...teams.map((t) => ({ value: `team:${t.id}`, label: t.name })),
    ...members.map((m) => ({ value: m.user.id, label: m.user.display_name || m.user.email })),
  ], [members, teams, peopleOnly]);

  // The order is the order they get asked about: what state is it in, how urgent, whose it is,
  // then the dates, then the two questions about sizing.
  const fields: Field[] = useMemo(() => {
    const assignee: Field = {
      key: 'assignees', label: peopleOnly ? 'Whose time' : 'Assignee', Icon: User, many: true, options: people,
    };
    // The window the card covers is the scope everything else sits inside, so it is asked first.
    const when: Field[] = time
      ? [{ key: 'time', label: 'Time', Icon: CalendarRange, many: false, time: true, options: time.options }]
      : [];
    if (peopleOnly) return [...when, assignee];
    return [
      ...when,
      { key: 'status_groups', label: 'Status', Icon: Circle, many: true, options: STATUS_OPTIONS },
      { key: 'priorities', label: 'Priority', Icon: Flag, many: true, options: PRIORITY_OPTIONS },
      assignee,
      ...(hideDue ? [] : [{ key: 'due' as const, label: 'Due date', Icon: CalendarDays, many: false, options: DUE_OPTIONS }]),
      { key: 'done', label: 'Date done', Icon: CalendarCheck, many: false, options: DONE_OPTIONS },
      { key: 'tags', label: 'Tags', Icon: TagIcon, many: true, lazy: true,
        options: (tags ?? []).map((t) => ({ value: t.name, label: t.name })) },
      { key: 'estimate', label: 'Time estimate', Icon: Hourglass, many: false, options: ESTIMATE_OPTIONS },
      { key: 'scheduled', label: 'Scheduled', Icon: CalendarClock, many: false, options: SCHEDULED_OPTIONS },
    ];
  }, [people, peopleOnly, hideDue, tags, time]);

  const chips = useMemo(
    () => fields.map((f) => ({ field: f, text: chipText(f, draft, personName) })).filter((c) => c.text !== null),
    // personName only reads members/teams, which `fields` already depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fields, draft],
  );
  const activeCount = useMemo(
    () => fields.filter((f) => chipText(f, value, personName) !== null).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fields, value],
  );

  // A run of ticks is one save rather than one per click, so the card is re-read once.
  const change = (next: Filters) => {
    setDraft(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => onApply(next), 400);
  };
  const flush = (next?: Filters) => {
    window.clearTimeout(timer.current);
    if (next) onApply(next);
  };

  const show = () => {
    if (open || !triggerRef.current) { setPos(null); return; }
    setDraft(value);
    setOpenField(null);
    setSearch('');
    const rect = triggerRef.current.getBoundingClientRect();
    // Hang it from the left of its trigger, the way a dropdown is expected to open, and only
    // pull it leftwards when that would run off the right edge. Right-aligning it unconditionally
    // sent the panel 280px to the left of a button near the start of the row, where it ended up
    // underneath the sidebar.
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - PANEL_WIDTH - 8));
    // Below the trigger, unless there is more room above it -- a filter button low on a long
    // Dashboard would otherwise open a panel that runs off the bottom of the window.
    const room = window.innerHeight - rect.bottom;
    const top = room < PANEL_MAX_HEIGHT && rect.top > room
      ? Math.max(8, rect.top - Math.min(PANEL_MAX_HEIGHT, rect.top - 8) - 4)
      : rect.bottom + 4;
    setPos({ top, left });
  };

  useEffect(() => {
    if (!open) return;
    const close = () => { flush(); setPos(null); };
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    const away = (e: Event) => { if (!panelRef.current?.contains(e.target as Node)) close(); };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', away, true);
    window.addEventListener('resize', away);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', away, true);
      window.removeEventListener('resize', away);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => { if (open) searchRef.current?.focus(); }, [open, openField]);

  // Tags live per Space, so they are gathered across the Spaces you can see, once, on first use.
  useEffect(() => {
    if (openField !== 'tags' || tags !== null || !hierarchy) return;
    let alive = true;
    Promise.all(hierarchy.spaces.map((sp) => workApi.spaceTags(sp.id).catch(() => [])))
      .then((lists) => {
        if (!alive) return;
        const seen = new Map<string, TagUsage>();
        for (const row of lists.flat()) if (!seen.has(row.name)) seen.set(row.name, row);
        setTags([...seen.values()].sort((a, b) => a.name.localeCompare(b.name)));
      });
    return () => { alive = false; };
  }, [openField, tags, hierarchy]);

  const field = fields.find((f) => f.label === openField || f.key === openField);

  /** The current value of a field, for the grey note beside it in the list. */
  const valueOf = (f: Field): string | null => {
    if (f.time) return f.options.find((o) => o.value === time?.value)?.label ?? 'Custom range';
    return chipText(f, draft, personName);
  };

  const pick = (f: Field, option: Option) => {
    if (f.time && time) {
      flush(draft !== value ? draft : undefined);
      setPos(null);
      time.onPick(option.value);
      return;
    }
    if (f.key === 'status_groups') {
      const groups = STATUS_GROUPS[option.value] ?? [option.value];
      const on = (draft.status_groups ?? []) as string[];
      const has = groups.every((g) => on.includes(g));
      const next = has ? on.filter((g) => !groups.includes(g)) : [...new Set([...on, ...groups])];
      change({ ...draft, status_groups: (next.length ? next : null) as Filters['status_groups'] });
      return;
    }
    if (f.many) {
      const list = (draft[f.key as keyof Filters] as (string | number)[] | null | undefined) ?? null;
      const item = f.key === 'priorities' ? Number(option.value) : option.value;
      change({ ...draft, [f.key]: toggle(list, item) });
      return;
    }
    const on = draft[f.key as keyof Filters] === option.value;
    change({ ...draft, [f.key]: on ? null : option.value } as Filters);
  };

  const isOn = (f: Field, option: Option) => {
    if (f.time) return time?.value === option.value;
    if (f.key === 'status_groups') {
      const on = (draft.status_groups ?? []) as string[];
      return (STATUS_GROUPS[option.value] ?? [option.value]).every((g) => on.includes(g));
    }
    const raw = draft[f.key as keyof Filters];
    if (Array.isArray(raw)) {
      return f.key === 'priorities' ? raw.includes(Number(option.value) as never) : raw.includes(option.value as never);
    }
    return raw === option.value;
  };

  const clearField = (f: Field) => change({ ...draft, [f.key]: null } as Filters);

  if (disabled) {
    if (!activeCount) return null;
    if (compact) {
      return (
        <span title={`${activeCount} filter${activeCount === 1 ? '' : 's'}`} className="flex items-center gap-1 rounded-lg border border-gray-200 p-1.5 text-[10px] font-semibold text-gray-500">
          <SlidersHorizontal size={12} /> {activeCount}
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-500">
        {activeCount} filter{activeCount === 1 ? '' : 's'}
      </span>
    );
  }

  const matches = (label: string) => label.toLowerCase().includes(search.trim().toLowerCase());

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={show}
        aria-expanded={open}
        aria-label={activeCount ? `${title} (${activeCount} set)` : title}
        title={title}
        className={`no-print relative flex items-center gap-1.5 rounded-lg border font-medium shadow-sm ${
          compact ? 'p-1.5' : 'px-2.5 py-1.5 text-xs'} ${
          activeCount
            ? 'border-teal-200 bg-teal-50 text-teal-800 hover:bg-teal-100'
            : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50'}`}
      >
        {compact ? (
          <>
            <SlidersHorizontal size={13} className={activeCount ? 'text-teal-600' : 'text-gray-500'} />
            {activeCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-teal-600 px-1 text-[9px] font-semibold leading-none text-white">
                {activeCount}
              </span>
            )}
          </>
        ) : (
          <>
            {activeCount ? `${activeCount} filter${activeCount === 1 ? '' : 's'}` : triggerLabel}
            <ChevronDown size={13} className={activeCount ? 'text-teal-500' : 'text-gray-400'} />
          </>
        )}
      </button>

      {open && createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-label={title}
          className="fixed z-50 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl"
          style={{ top: pos.top, left: pos.left, width: PANEL_WIDTH }}
        >
          {/* What the card is filtered by right now, whichever view is open. */}
          {chips.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 border-b border-gray-100 bg-gray-50/70 px-2 py-1.5">
              {chips.map(({ field: f, text }) => (
                <span key={String(f.key)} className="flex max-w-full items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] text-gray-700 ring-1 ring-gray-200">
                  <span className="truncate"><span className="text-gray-400">{f.label}:</span> {text}</span>
                  <button type="button" aria-label={`Clear ${f.label}`} onClick={() => clearField(f)} className="text-gray-400 hover:text-gray-700">
                    <X size={11} />
                  </button>
                </span>
              ))}
              <button
                type="button"
                onClick={() => { const next = cleared(draft, fields); flush(next); setDraft(next); }}
                className="ml-auto text-[11px] text-gray-500 hover:text-gray-800"
              >
                Clear all
              </button>
            </div>
          )}

          {!field ? (
            // --- step one: what to filter by -----------------------------------------------
            <>
              <label className="flex items-center gap-1.5 border-b border-gray-100 px-2.5 py-1.5">
                <Search size={13} className="shrink-0 text-gray-400" />
                <input
                  ref={searchRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search…"
                  aria-label="Search filters"
                  className="w-full bg-transparent text-[13px] text-gray-800 outline-none placeholder:text-gray-400"
                />
              </label>
              <div className="max-h-72 overflow-y-auto py-1">
                {fields.filter((f) => matches(f.label)).map((f) => {
                  const text = valueOf(f);
                  return (
                    <button
                      key={String(f.key)}
                      type="button"
                      onClick={() => { setOpenField(f.label); setSearch(''); }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-gray-700 hover:bg-gray-50"
                    >
                      <f.Icon size={14} className="shrink-0 text-gray-400" />
                      <span className="flex-1 truncate">{f.label}</span>
                      {text && <span className="max-w-24 truncate text-[11px] text-teal-700">{text}</span>}
                      <ChevronRight size={13} className="shrink-0 text-gray-300" />
                    </button>
                  );
                })}
                {fields.filter((f) => matches(f.label)).length === 0 && (
                  <p className="px-3 py-3 text-center text-xs text-gray-400">Nothing called “{search}”.</p>
                )}
              </div>
            </>
          ) : (
            // --- step two: the values of that one field -------------------------------------
            <>
              <div className="flex items-center gap-1.5 border-b border-gray-100 px-2 py-1.5">
                <button
                  type="button"
                  onClick={() => { setOpenField(null); setSearch(''); }}
                  aria-label="Back to all filters"
                  className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                >
                  <ArrowLeft size={14} />
                </button>
                <field.Icon size={14} className="shrink-0 text-gray-400" />
                <span className="flex-1 truncate text-[13px] font-medium text-gray-800">{field.label}</span>
                {!field.time && chipText(field, draft, personName) && (
                  <button type="button" onClick={() => clearField(field)} className="text-[11px] text-gray-500 hover:text-gray-800">Clear</button>
                )}
              </div>

              {field.options.length > SEARCHABLE && (
                <label className="flex items-center gap-1.5 border-b border-gray-100 px-2.5 py-1.5">
                  <Search size={13} className="shrink-0 text-gray-400" />
                  <input
                    ref={searchRef}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={`Search ${field.label.toLowerCase()}…`}
                    aria-label={`Search ${field.label}`}
                    className="w-full bg-transparent text-[13px] text-gray-800 outline-none placeholder:text-gray-400"
                  />
                </label>
              )}

              <div className="max-h-72 overflow-y-auto py-1">
                {field.lazy && tags === null ? (
                  <p className="px-3 py-3 text-center text-xs text-gray-400">Loading…</p>
                ) : field.options.filter((o) => matches(o.label)).length === 0 ? (
                  <p className="px-3 py-3 text-center text-xs text-gray-400">
                    {field.lazy ? 'No tags in the Spaces you can see.' : `Nothing called “${search}”.`}
                  </p>
                ) : (
                  field.options.filter((o) => matches(o.label)).map((o) => {
                    const on = isOn(field, o);
                    return (
                      <button
                        key={o.value}
                        type="button"
                        onClick={() => pick(field, o)}
                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] ${
                          on ? 'bg-teal-50/70 font-medium text-teal-900' : 'text-gray-700 hover:bg-gray-50'}`}
                      >
                        <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center border ${
                          field.many ? 'rounded' : 'rounded-full'} ${on ? 'border-teal-500 bg-teal-500 text-white' : 'border-gray-300'}`}>
                          {on && <Check size={10} strokeWidth={3} />}
                        </span>
                        {o.dot && <span className={`h-2 w-2 shrink-0 rounded-full ${o.dot}`} />}
                        <span className="min-w-0 flex-1 truncate">{o.label}</span>
                      </button>
                    );
                  })
                )}
                {field.time && time && (
                  <button
                    type="button"
                    onClick={() => { flush(draft !== value ? draft : undefined); setPos(null); time.onCustom(); }}
                    className="flex w-full items-center gap-2 border-t border-gray-100 px-3 py-1.5 text-left text-[13px] text-gray-600 hover:bg-gray-50"
                  >
                    <span className="w-3.5" />
                    Custom range…
                  </button>
                )}
              </div>
            </>
          )}
        </div>,
        document.body,
      )}
    </>
  );
};
