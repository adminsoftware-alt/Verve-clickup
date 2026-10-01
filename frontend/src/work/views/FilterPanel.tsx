// The one control on My Tasks that says what you are looking at: which tasks (the filters) and
// how they are laid out (grouping, the details on each row, whether finished work counts).
//
// The old panel opened every value of every filter at once: every status, every person, every
// tag, in one scrolling sheet. That is readable in a workspace of five people and unusable in one
// of fifty. This asks two questions instead -- first *what* to filter by, from a short searchable
// list, then the values of that one field -- and keeps what is already set visible as chips, so
// the panel says what you are looking at without being read end to end.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft, CalendarDays, Check, ChevronDown, ChevronRight, Circle, Columns3, Flag, Layers, Search,
  Tag as TagIcon, User, X,
} from 'lucide-react';

import type { Status, Task, UserRef } from '../api';
import { PRIORITIES } from '../ui';
import { GROUP_BY_LABELS, PROGRESS_COLUMNS, type GroupBy } from './grouping';
import { COLUMNS, DUE_FILTERS, EMPTY_FILTERS, filterCount, type DueFilter, type ViewFilters } from './viewSettings';

const PANEL_WIDTH = 280;
/** Above this many choices the value list gets its own search box. */
const SEARCHABLE = 8;

type Option = { value: string; label: string; color?: string };

type Key = 'statuses' | 'assignees' | 'priorities' | 'due' | 'tags';

/**
 * An entry in the panel. Most are filters -- pick some values of one field. The last three are
 * about how the same tasks are laid out, which is a different question but the same sentence:
 * "show me these tasks, like this". They were three more buttons in the toolbar for no reason.
 */
type Entry =
  | { kind: 'filter'; key: Key; label: string; Icon: React.ElementType; options: Option[] }
  | { kind: 'group'; label: string; Icon: React.ElementType; options: Option[] }
  | { kind: 'columns'; label: string; Icon: React.ElementType; options: Option[] }
  | { kind: 'closed'; label: string; Icon: React.ElementType };

/** How the same tasks are laid out. Omitted where the caller has no view settings to offer. */
export interface ViewBits {
  /** Grouping, when the layout has groups at all. */
  groupBy?: GroupBy;
  groupOptions?: GroupBy[];
  onGroupBy?: (g: GroupBy) => void;
  /** Column keys that are hidden; the panel shows the inverse, which is what people mean. */
  hidden: string[];
  onHidden: (hidden: string[]) => void;
  columnsLabel?: string;
  showClosed: boolean;
  onShowClosed: (on: boolean) => void;
}

const toggled = <T,>(list: T[], item: T): T[] =>
  (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

export const FilterPanel: React.FC<{
  filters: ViewFilters;
  onChange: (f: ViewFilters) => void;
  /** The tasks in view, which is where the tags actually in use come from. */
  tasks: Task[];
  /** Accepted for symmetry with the older panel; the three states are the same everywhere. */
  statuses?: Status[] | null;
  people: UserRef[];
  view?: ViewBits;
}> = ({ filters, onChange, tasks, people, view }) => {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [openField, setOpenField] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const open = pos !== null;
  const count = filterCount(filters);

  /**
   * To do, In progress, Completed -- the three states, not the twenty status names.
   *
   * Above a List every List brings its own statuses, so listing them gave a filter with a dozen
   * near-duplicate entries ("Done", "Complete", "Completed") that each matched one List. The three
   * states mean the same thing everywhere, and Completed covers finished and archived work, which
   * is what the separate "Show closed" toggle used to be for.
   */
  const statusOptions = useMemo(() => PROGRESS_COLUMNS.map((c) => ({
    value: c.key, label: c.name, color: c.color,
  })), []);

  const tagOptions = useMemo(() => {
    const out = new Map<string, Option>();
    tasks.forEach((t) => t.tags.forEach((tag) => out.set(tag.name.toLowerCase(), { value: tag.name.toLowerCase(), label: tag.name, color: tag.bg_color })));
    return [...out.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [tasks]);

  const entries: Entry[] = useMemo(() => [
    { kind: 'filter', key: 'statuses', label: 'Status', Icon: Circle, options: statusOptions },
    { kind: 'filter', key: 'priorities', label: 'Priority', Icon: Flag, options: [1, 2, 3, 4]
      .map((p) => ({ value: String(p), label: PRIORITIES[p].label, color: PRIORITIES[p].color }))
      .concat([{ value: '0', label: 'No priority', color: '#9ca3af' }]) },
    { kind: 'filter', key: 'assignees', label: 'Assignee', Icon: User, options: [
      { value: 'me', label: 'Me' },
      { value: 'none', label: 'Unassigned' },
      ...people.map((p) => ({ value: p.id, label: p.display_name || p.email })),
    ] },
    { kind: 'filter', key: 'due', label: 'Due date', Icon: CalendarDays, options: DUE_FILTERS.map((d) => ({ value: d.key, label: d.label })) },
    ...(tagOptions.length ? [{ kind: 'filter' as const, key: 'tags' as const, label: 'Tags', Icon: TagIcon, options: tagOptions }] : []),
    ...(view?.groupOptions?.length
      ? [{ kind: 'group' as const, label: 'Group by', Icon: Layers,
           options: view.groupOptions.map((g) => ({ value: g, label: GROUP_BY_LABELS[g] })) }]
      : []),
    ...(view ? [
      { kind: 'columns' as const, label: view.columnsLabel ?? 'Fields', Icon: Columns3,
        options: COLUMNS.map((c) => ({ value: c.key, label: c.label })) },
    ] : []),
  ], [statusOptions, tagOptions, people, view]);

  const isFilter = (e: Entry): e is Extract<Entry, { kind: 'filter' }> => e.kind === 'filter';

  /** What an entry currently says, for the grey note beside it: "Urgent, High +2". */
  const textOf = (e: Entry): string | null => {
    if (e.kind === 'group') return view?.groupBy ? GROUP_BY_LABELS[view.groupBy] : null;
    if (e.kind === 'columns') {
      const on = e.options.filter((o) => !view?.hidden.includes(o.value)).length;
      return `${on} of ${e.options.length}`;
    }
    if (e.kind === 'closed') return view?.showClosed ? 'On' : null;
    const chosen = (filters[e.key] as (string | number)[]).map(String);
    if (!chosen.length) return null;
    const words = chosen.map((v) => e.options.find((o) => o.value === v)?.label ?? v);
    return words.length > 2 ? `${words.slice(0, 2).join(', ')} +${words.length - 2}` : words.join(', ');
  };

  const show = () => {
    if (open || !triggerRef.current) { setPos(null); return; }
    setOpenField(null);
    setSearch('');
    const rect = triggerRef.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - PANEL_WIDTH - 8));
    setPos({ top: rect.bottom + 4, left });
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) setPos(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPos(null);
    const away = (e: Event) => { if (!panelRef.current?.contains(e.target as Node)) setPos(null); };
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
  }, [open]);

  useEffect(() => { if (open) searchRef.current?.focus(); }, [open, openField]);

  const pick = (e: Entry, option: Option) => {
    if (e.kind === 'group') { view?.onGroupBy?.(option.value as GroupBy); return; }
    if (e.kind === 'columns') { view?.onHidden(toggled(view.hidden, option.value)); return; }
    if (e.kind === 'closed') return;
    if (e.key === 'priorities') onChange({ ...filters, priorities: toggled(filters.priorities, Number(option.value)) });
    else if (e.key === 'due') onChange({ ...filters, due: toggled(filters.due, option.value as DueFilter) });
    else onChange({ ...filters, [e.key]: toggled(filters[e.key] as string[], option.value) });
  };
  const isOn = (e: Entry, option: Option) => {
    if (e.kind === 'group') return view?.groupBy === option.value;
    if (e.kind === 'columns') return !view?.hidden.includes(option.value);
    if (e.kind === 'closed') return false;
    return (filters[e.key] as (string | number)[]).map(String).includes(option.value);
  };
  const clearField = (e: Entry) => {
    if (e.kind === 'group') view?.onGroupBy?.('none');
    else if (e.kind === 'columns') view?.onHidden([]);
    else if (e.kind === 'closed') view?.onShowClosed(false);
    else onChange({ ...filters, [e.key]: [] });
  };

  const field = entries.find((e) => e.kind !== 'closed' && e.label === openField) as
    Exclude<Entry, { kind: 'closed' }> | undefined;
  const matches = (label: string) => label.toLowerCase().includes(search.trim().toLowerCase());

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={show}
        aria-expanded={open}
        className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm ${
          count ? 'border-teal-200 bg-teal-50 text-teal-800' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
      >
        {count ? `${count} filter${count === 1 ? '' : 's'}` : 'Filter'}
        <ChevronDown size={13} className={count ? 'text-teal-500' : 'text-gray-400'} />
      </button>

      {open && createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Filter tasks"
          className="fixed z-50 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl"
          style={{ top: pos.top, left: pos.left, width: PANEL_WIDTH }}
        >
          {count > 0 && (
            <div className="flex flex-wrap items-center gap-1 border-b border-gray-100 bg-gray-50/70 px-2 py-1.5">
              {entries.filter(isFilter).map((f) => {
                const text = textOf(f);
                if (!text) return null;
                return (
                  <span key={f.key} className="flex max-w-full items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] text-gray-700 ring-1 ring-gray-200">
                    <span className="truncate"><span className="text-gray-400">{f.label}:</span> {text}</span>
                    <button type="button" aria-label={`Clear ${f.label}`} onClick={() => clearField(f)} className="text-gray-400 hover:text-gray-700">
                      <X size={11} />
                    </button>
                  </span>
                );
              })}
              <button type="button" onClick={() => onChange(EMPTY_FILTERS)} className="ml-auto text-[11px] text-gray-500 hover:text-gray-800">
                Clear all
              </button>
            </div>
          )}

          {!field ? (
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
              <div className="max-h-80 overflow-y-auto py-1">
                {entries.filter((e) => matches(e.label)).map((e, i, shown) => {
                  const text = textOf(e);
                  // Where the filters end and how they are laid out begins.
                  const rule = e.kind !== 'filter' && shown[i - 1]?.kind === 'filter';
                  const skin = `flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-gray-700 hover:bg-gray-50 ${
                    rule ? 'mt-1 border-t border-gray-100 pt-2' : ''}`;
                  // A yes-or-no needs no second step, so it is answered where it stands.
                  if (e.kind === 'closed') {
                    return (
                      <label key={e.label} className={`${skin} cursor-pointer`}>
                        <e.Icon size={14} className="shrink-0 text-gray-400" />
                        <span className="flex-1 truncate">{e.label}</span>
                        <input
                          type="checkbox"
                          checked={!!view?.showClosed}
                          onChange={(ev) => view?.onShowClosed(ev.target.checked)}
                          className="h-3.5 w-3.5 accent-teal-600"
                        />
                      </label>
                    );
                  }
                  return (
                    <button key={e.label} type="button" onClick={() => { setOpenField(e.label); setSearch(''); }} className={skin}>
                      <e.Icon size={14} className="shrink-0 text-gray-400" />
                      <span className="flex-1 truncate">{e.label}</span>
                      {text && <span className="max-w-24 truncate text-[11px] text-teal-700">{text}</span>}
                      <ChevronRight size={13} className="shrink-0 text-gray-300" />
                    </button>
                  );
                })}
                {entries.filter((e) => matches(e.label)).length === 0 && (
                  <p className="px-3 py-3 text-center text-xs text-gray-400">Nothing called “{search}”.</p>
                )}
              </div>
            </>
          ) : (
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
                {textOf(field) && (
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
                {field.options.filter((o) => matches(o.label)).length === 0 ? (
                  <p className="px-3 py-3 text-center text-xs text-gray-400">Nothing called “{search}”.</p>
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
                          field.kind === 'group' ? 'rounded-full' : 'rounded'} ${
                          on ? 'border-teal-500 bg-teal-500 text-white' : 'border-gray-300'}`}>
                          {on && <Check size={10} strokeWidth={3} />}
                        </span>
                        {o.color && <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: o.color }} />}
                        <span className="min-w-0 flex-1 truncate">{o.label}</span>
                      </button>
                    );
                  })
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
