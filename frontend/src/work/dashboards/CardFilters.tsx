// The filter control on a card's own header.
//
// Filtering used to mean opening the card's editor, which is a modal away from the question being
// asked ("what does this look like for urgent work only?"). This puts the same Filters object
// where the card is read.
//
// It is built the way ClickUp's is, and for the same reason: one flat panel listing every value of
// every filter is unreadable once a workspace has twenty people and thirty tags. So the panel asks
// two questions instead. First *what* you want to filter by -- a short, searchable list of fields.
// Then the values of that one field, and nothing else.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft, CalendarCheck, CalendarDays, CalendarRange, Check, ChevronDown, ChevronRight, Circle,
  CircleCheckBig, CircleDashed, CirclePlay, Filter, Flag, FlagOff, Hourglass, Search, Tag as TagIcon, User, Users,
} from 'lucide-react';

import { useMe, useWork } from '../WorkContext';
import { Avatar, InitialsAvatar } from '../ui';
import { workApi, type TagUsage } from '../api';
import type { Filters } from './api';
import { LinesSkeleton } from '../Skeleton';

const PANEL_WIDTH = 172;

/** Each field's colour, worn by its icon tile so the list is found by colour as much as by word. */
const TONE: Record<string, string> = {
  time: '#234788',
  status_groups: '#3B82F6',
  priorities: '#EF4444',
  assignees: '#8B5CF6',
  due: '#F59E0B',
  done: '#16A34A',
  tags: '#EC4899',
  estimate: '#0EA5E9',
};

/** The field's icon in a small raised tile of its colour, as on the Dashboard cards. */
const FieldTile: React.FC<{ field: { key: string; Icon: React.ElementType }; size?: number }> = ({ field, size = 18 }) => (
  <span className="tile-3d rounded-md" style={{ width: size, height: size, '--tile': TONE[field.key] ?? '#64748B' } as React.CSSProperties}>
    <field.Icon size={Math.round(size * 0.55)} strokeWidth={2.25} />
  </span>
);
/** Roughly what the panel grows to with a search box and a list; enough to decide which way to open. */
const PANEL_MAX_HEIGHT = 400;
/** Above this many choices the value list gets its own search box. */
const SEARCHABLE = 8;

/** A value to filter to. Status and priority carry a colour and an icon of their own. */
type Option = {
  value: string; label: string; tone?: string; Icon?: React.ElementType;
  /** A Team: the people it stands for. Picking it ticks every one of them. */
  members?: string[];
  /** A person's photo or initials ("HK"), or a Team's, shown before the name. */
  avatar?: React.ReactNode;
};

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
  { value: 'not_started', label: 'To do', tone: '#64748B', Icon: CircleDashed },
  { value: 'active', label: 'In progress', tone: '#3B82F6', Icon: CirclePlay },
  { value: 'completed', label: 'Completed', tone: '#16A34A', Icon: CircleCheckBig },
];

/** The status groups an option stands for. */
const STATUS_GROUPS: Record<string, string[]> = {
  not_started: ['not_started'], active: ['active'], completed: ['done', 'closed'],
};

const PRIORITY_OPTIONS: Option[] = [
  { value: '1', label: 'Urgent', tone: '#EF4444', Icon: Flag },
  { value: '2', label: 'High', tone: '#F59E0B', Icon: Flag },
  { value: '3', label: 'Normal', tone: '#3B82F6', Icon: Flag },
  { value: '4', label: 'Low', tone: '#94A3B8', Icon: Flag },
  { value: '0', label: 'No priority', tone: '#9CA3AF', Icon: FlagOff },
];

const DUE_OPTIONS: Option[] = [
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Due today' },
  { value: 'this_week', label: 'Due this week' },
  { value: 'next_7_days', label: 'Due in the next 7 days' },
  { value: 'set', label: 'Has a due date' },
  { value: 'none', label: 'No due date' },
];

// "Done", not "Finished". The cards these filters build are called "Done this week", the field is
// called "Date done", and the row control writes "Done <period>" when it re-scopes one -- so a menu
// offering "Finished this week" was the only place in the Dashboard using a third word for it.
const DONE_OPTIONS: Option[] = [
  { value: 'today', label: 'Done today' },
  { value: 'this_week', label: 'Done this week' },
  { value: 'last_7_days', label: 'Done in the last 7 days' },
  { value: 'this_month', label: 'Done this month' },
  { value: 'last_30_days', label: 'Done in the last 30 days' },
];

const ESTIMATE_OPTIONS: Option[] = [
  { value: 'set', label: 'Has an estimate' },
  { value: 'missing', label: 'No estimate' },
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
  /** What the card was built to filter by. Those are part of what the card is, not filters
   *  someone added -- "Clear all filters" keeps them -- so they are not counted on the badge. */
  base?: Filters | null;
  /** The viewer sees only their own time, so there is nobody to pick under "Whose time". */
  noPeople?: boolean;
}> = ({ value, disabled, triggerLabel = 'Filter', title = 'Filter this card', compact, hideDue, peopleOnly, time, onApply, base, noPeople }) => {
  const { members, teams, hierarchy } = useWork();
  const meId = useMe();
  // Below the button (top), or above it with its bottom edge on the button (bottom); maxHeight keeps it on screen.
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number; maxHeight: number } | null>(null);
  const [draft, setDraft] = useState<Filters>(value);
  const [openField, setOpenField] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  /** Assignee shows People or Teams, not both in one list. */
  const [whoTab, setWhoTab] = useState<'people' | 'teams'>('people');
  const [tags, setTags] = useState<TagUsage[] | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const timer = useRef<number | undefined>(undefined);
  /** A change waiting for its save; sent at once if the panel closes first. */
  const pending = useRef<Filters | null>(null);
  const open = pos !== null;

  const personName = (token: string) => {
    if (token === 'me') return 'Me';
    if (token === 'none') return 'Nobody';
    if (token.startsWith('team:')) return teams.find((t) => t.id === token.slice(5))?.name ?? 'Team';
    const m = members.find((x) => x.user.id === token);
    return m ? m.user.display_name || m.user.email : 'Former member';
  };

  const people: Option[] = useMemo(() => [
    { value: 'me', label: 'Me', avatar: (() => { const m = members.find((x) => x.user.id === meId); return m ? <Avatar user={m.user} size={20} /> : undefined; })() },
    // Everyone ticks every person at once, the way a Team ticks its own people.
    {
      value: 'everyone', label: 'Everyone', members: members.map((m) => m.user.id),
      avatar: <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#EEF2F8] text-[#234788]"><Users size={12} strokeWidth={2.25} /></span>,
    },
    ...teams.map((t) => ({
      value: `team:${t.id}`, label: t.name, members: t.members.map((u) => u.id),
      avatar: <InitialsAvatar id={t.id} name={t.name} size={20} />,
    })),
    ...members.map((m) => ({ value: m.user.id, label: m.user.display_name || m.user.email, avatar: <Avatar user={m.user} size={20} /> })),
  ], [members, teams, meId]);

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
    if (peopleOnly) return noPeople ? when : [...when, assignee];
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
    ];
  }, [people, peopleOnly, hideDue, tags, time, noPeople]);

  const activeCount = useMemo(
    () => fields.filter((f) => {
      const now = chipText(f, value, personName);
      return now !== null && (!base || now !== chipText(f, base, personName));
    }).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fields, value, base],
  );

  // A run of ticks is one save rather than one per click, so the card is re-read once.
  const change = (next: Filters) => {
    setDraft(next);
    pending.current = next;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { pending.current = null; onApply(next); }, 400);
  };
  // Closing the panel inside those 400ms used to drop the last tick or untick; now it is sent.
  const flush = (next?: Filters) => {
    window.clearTimeout(timer.current);
    const send = next ?? pending.current;
    pending.current = null;
    if (send) onApply(send);
  };

  /** Filters set in the panel right now, past what the card was built with. */
  const draftCount = fields.filter((f) => {
    const now = chipText(f, draft, personName);
    return now !== null && (!base || now !== chipText(f, base, personName));
  }).length;
  /** Every filter off at once: what the card was built with stays, and so does its time window. */
  const clearAll = () => {
    const next: Filters = { ...draft };
    for (const f of fields) {
      if (f.time) continue;
      const raw = draft[f.key as keyof Filters];
      if (raw === 'period') continue; // the card's own period control, not a filter someone added
      (next as Record<string, unknown>)[f.key] = base?.[f.key as keyof Filters] ?? null;
    }
    setDraft(next);
    flush(next);
  };

  const show = () => {
    if (open || !triggerRef.current) { setPos(null); return; }
    setDraft(value);
    // One filter only (an Employee's own time card has just Time): open straight on its choices.
    setOpenField(fields.length === 1 ? fields[0].label : null);
    setSearch('');
    const rect = triggerRef.current.getBoundingClientRect();
    // Hang it from the left of its trigger, the way a dropdown is expected to open, and only
    // pull it leftwards when that would run off the right edge. Right-aligning it unconditionally
    // sent the panel 280px to the left of a button near the start of the row, where it ended up
    // underneath the sidebar.
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - PANEL_WIDTH - 8));
    // Below the trigger, unless there is more room above it -- a filter button low on a long
    // Dashboard would otherwise open a panel that runs off the bottom of the window.
    // Opening upwards, the panel's bottom edge sits on the button whatever its height, so it never
    // floats off towards the top of the window with a gap under it.
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    setPos(below < PANEL_MAX_HEIGHT && above > below
      ? { bottom: window.innerHeight - rect.top + 4, left, maxHeight: above }
      : { top: rect.bottom + 4, left, maxHeight: below });
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
  const splitWho = field?.key === 'assignees' && teams.length > 0;
  /** The open field's choices, on the People or Teams side for Assignee. */
  const listed = (field?.options ?? []).filter((o) => !splitWho || (whoTab === 'teams') === o.value.startsWith('team:'));

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
    if (option.members) {
      // A Team is shorthand for its people: all on if any is missing, all off if all are on.
      const on = ((draft.assignees ?? []) as string[]).filter((v) => v !== option.value);
      const all = option.members.length > 0 && option.members.every((id) => on.includes(id));
      const next = all ? on.filter((id) => !option.members!.includes(id)) : [...new Set([...on, ...option.members])];
      change({ ...draft, assignees: next.length ? next : null });
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

  /** A Team (or Everyone) is on when each of its people is; an older filter saved the Team itself. */
  const allOf = (option: Option) => {
    const on = (draft.assignees ?? []) as string[];
    return on.includes(option.value) || (!!option.members?.length && option.members.every((id) => on.includes(id)));
  };

  const isOn = (f: Field, option: Option) => {
    if (f.time) return time?.value === option.value;
    if (option.members) return allOf(option);
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

  /** How many choices are on in a field: a Team counts as its people, a single-choice field as one. */
  const pickedCount = (f: Field): number => {
    if (f.time) return time && time.value !== ANY_TIME ? 1 : 0;
    const raw = draft[f.key as keyof Filters];
    if (raw === null || raw === undefined || raw === 'period') return 0;
    if (f.key === 'status_groups') return f.options.filter((o) => isOn(f, o)).length;
    if (Array.isArray(raw)) return new Set((raw as (string | number)[]).map(String)).size;
    return 1;
  };

  const clearField = (f: Field) => change({ ...draft, [f.key]: null } as Filters);

  if (disabled) {
    if (!activeCount) return null;
    if (compact) {
      return (
        <span aria-label={`${activeCount} filter${activeCount === 1 ? '' : 's'}`} className="flex items-center gap-1 rounded-lg border border-gray-200 p-1.5 text-[10px] font-semibold text-gray-500">
          <Filter size={12} /> {activeCount}
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
        data-active={activeCount > 0 ? '' : undefined}
        className={compact
          ? `no-print cf-trigger relative flex items-center gap-1.5 rounded-lg border p-1.5 font-medium shadow-sm ${activeCount ? 'border-brand-200 bg-brand-50 text-brand-800' : 'border-gray-200 bg-white text-gray-700'}`
          : 'no-print cf-pill relative flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium'}
      >
        {compact ? (
          <>
            {/* A funnel in a small tile of the card's own colour (--tile), filled once filters are set. */}
            <Filter size={13} className="cf-i-funnel" />
            {activeCount > 0 && (
              <span className="cf-badge absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-brand-600 px-1 text-[9px] font-semibold leading-none text-white">
                {activeCount}
              </span>
            )}
          </>
        ) : (
          <>
            {triggerLabel}
            {activeCount > 0 && (
              <span className="cf-pill-count flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none">
                {activeCount}
              </span>
            )}
            <ChevronDown size={13} className={`cf-pill-caret transition-transform ${open ? 'rotate-180' : ''}`} />
          </>
        )}
      </button>

      {open && createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-label={title}
          className="fixed z-50 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl"
          style={{ top: pos.top, bottom: pos.bottom, left: pos.left, width: PANEL_WIDTH, maxHeight: pos.maxHeight, overflowY: 'auto' }}
        >
          {!field ? (
            // --- step one: what to filter by -----------------------------------------------
            <>
              {/* What is set, and the one click that takes it all off. */}
              <div className="flex items-center gap-2 border-b border-gray-100 px-2.5 py-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Filters</span>
                {draftCount > 0 && (
                  <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[#234788] px-1 text-[10px] font-bold leading-none text-white">{draftCount}</span>
                )}
                {/* Only when there is something to take off, and then in rose, so it is found at a glance. */}
                {draftCount > 0 && (
                  <button type="button" onClick={clearAll} className="filter-clear ml-auto">Clear all</button>
                )}
              </div>
              {/* A search only earns its row when there are enough filters to look through. */}
              {fields.length > 4 && (
                <label className="flex items-center gap-1.5 border-b border-gray-100 px-2.5 py-1">
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
              )}
              <div className="max-h-[23rem] overflow-y-auto py-1">
                {fields.filter((f) => matches(f.label)).map((f) => {
                  const count = pickedCount(f);
                  return (
                    <button
                      key={String(f.key)}
                      type="button"
                      onClick={() => { setOpenField(f.label); setSearch(''); setWhoTab('people'); }}
                      className="group/row mx-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-md px-1.5 py-1 text-left text-[12.5px] font-medium text-gray-700 transition-colors hover:bg-gray-100/80 hover:text-gray-900"
                    >
                      <FieldTile field={{ key: String(f.key), Icon: f.Icon }} />
                      {/* Only how many are picked, as a small number: the picks themselves are one
                          click away, and spelling them out made the panel wide and tall. */}
                      <span className="min-w-0 flex-1 whitespace-nowrap">{f.label}</span>
                      {count > 0 && (
                        <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-[#234788] px-1 text-[10px] font-semibold tabular-nums text-white" aria-label={`${count} picked`}>
                          {count}
                        </span>
                      )}
                      <ChevronRight size={13} className="shrink-0 text-gray-300 transition-transform group-hover/row:translate-x-0.5 group-hover/row:text-gray-500" />
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
                {fields.length > 1 && (
                  <button
                    type="button"
                    onClick={() => { setOpenField(null); setSearch(''); }}
                    aria-label="Back to all filters"
                    className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                  >
                    <ArrowLeft size={14} />
                  </button>
                )}
                <FieldTile field={{ key: String(field.key), Icon: field.Icon }} size={18} />
                <span className="flex-1 truncate text-[13px] font-semibold text-gray-800">{field.label}</span>
                {!field.time && chipText(field, draft, personName) && (
                  <button type="button" onClick={() => clearField(field)} className="filter-clear">Clear</button>
                )}
              </div>

              {splitWho && (
                <div className="border-b border-gray-100 px-2.5 py-2">
                  <div className="grid grid-cols-2 rounded-lg bg-gray-100 p-0.5 text-xs font-semibold" role="tablist" aria-label="People or Teams">
                    {(['people', 'teams'] as const).map((t) => (
                      <button key={t} type="button" role="tab" aria-selected={whoTab === t} onClick={() => { setWhoTab(t); setSearch(''); }}
                        className={`flex items-center justify-center gap-1.5 rounded-md py-1 transition-colors ${whoTab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}>
                        {t === 'people' ? <User size={12} /> : <Users size={12} />} {t === 'people' ? 'People' : 'Teams'}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {listed.length > SEARCHABLE && (
                <label className="flex items-center gap-1.5 border-b border-gray-100 px-2.5 py-1">
                  <Search size={13} className="shrink-0 text-gray-400" />
                  <input
                    ref={searchRef}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={splitWho ? `Search ${whoTab}…` : `Search ${field.label.toLowerCase()}…`}
                    aria-label={`Search ${field.label}`}
                    className="w-full bg-transparent text-[13px] text-gray-800 outline-none placeholder:text-gray-400"
                  />
                </label>
              )}

              <div className="max-h-72 space-y-0.5 overflow-y-auto py-1.5">
                {field.lazy && tags === null ? (
                  <p className="px-3 py-3 text-center text-xs text-gray-400"><LinesSkeleton /></p>
                ) : listed.filter((o) => matches(o.label)).length === 0 ? (
                  <p className="px-3 py-3 text-center text-xs text-gray-400">
                    {field.lazy ? 'No tags in the Spaces you can see.' : `Nothing called “${search}”.`}
                  </p>
                ) : (
                  listed.filter((o) => matches(o.label)).map((o) => {
                    const on = isOn(field, o);
                    const tone = o.tone ?? '#234788';
                    // Picked rows take a light wash of their own colour, so "In progress" picked
                    // looks blue and "Urgent" red; the tick sits at the end, where it is scanned.
                    return (
                      <button
                        key={o.value}
                        type="button"
                        role={field.many ? 'checkbox' : 'radio'}
                        aria-checked={on}
                        onClick={() => pick(field, o)}
                        style={{ '--opt': tone } as React.CSSProperties}
                        className={`filter-opt mx-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-md px-1.5 py-1 text-left text-[12.5px] transition-colors ${
                          on ? 'is-on font-semibold text-gray-900' : 'font-medium text-gray-700 hover:bg-gray-100/80'}`}
                      >
                        {o.avatar}
                        {o.Icon && (
                          <span className="filter-opt-icon flex h-5 w-5 shrink-0 items-center justify-center rounded-md">
                            <o.Icon size={12} strokeWidth={2.25} fill={o.Icon === Flag ? 'currentColor' : 'none'} />
                          </span>
                        )}
                        <span className="min-w-0 flex-1 truncate">{o.label}</span>
                        {o.members && o.value.startsWith('team:') && (
                          <span className="shrink-0 rounded-full bg-gray-100 px-1.5 text-[11px] font-medium text-gray-500" aria-label={`${o.members.length} in this Team`}>{o.members.length}</span>
                        )}
                        <span className={`filter-opt-check flex h-4 w-4 shrink-0 items-center justify-center ${field.many ? 'rounded-[5px]' : 'rounded-full'} ${on ? 'text-white' : 'border border-gray-300'}`}>
                          {on && <Check size={10} strokeWidth={3.5} />}
                        </span>
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
