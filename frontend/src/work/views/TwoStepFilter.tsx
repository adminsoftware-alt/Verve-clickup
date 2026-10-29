// The filter control used across the app: ask what to filter by, then what to filter it to.
//
// One flat panel listing every value of every field is unreadable once a workspace has twenty
// people and thirty tags, so this asks two questions instead. First a short, searchable list of
// fields; then the values of the one you opened, and nothing else. What is already set stays
// visible as chips above, so the panel says what you are looking at without being read end to end.
//
// It holds no state about what a filter means -- the caller says which fields exist, which values
// are on, and what to do when one is picked. That is what lets a Dashboard card, My Tasks and the
// Workload view all wear the same control over completely different data.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Check, ChevronDown, ChevronRight, Search } from 'lucide-react';

const PANEL_WIDTH = 236;
/** Above this many choices the value list gets its own search box. */
const SEARCHABLE = 8;

/** Each field's colour, worn by its icon tile -- the same colours as the Dashboard card filters. */
const TONE: Record<string, string> = {
  statuses: '#3B82F6', status: '#3B82F6', groups: '#3B82F6',
  priorities: '#EF4444', priority: '#EF4444',
  assignees: '#8B5CF6',
  due: '#F59E0B', scheduled: '#F59E0B',
  estimate: '#0EA5E9',
  taskTags: '#EC4899', tags: '#EC4899',
  lists: '#234788',
  includeArchived: '#64748B',
};

/** The field's icon in a small tile of its colour, as in the Dashboard card filters. */
const FieldTile: React.FC<{ field: { key: string; Icon: React.ElementType } }> = ({ field }) => (
  <span className="tile-3d rounded-md" style={{ width: 18, height: 18, '--tile': TONE[field.key] ?? '#64748B' } as React.CSSProperties}>
    <field.Icon size={10} strokeWidth={2.25} />
  </span>
);

export interface FilterOption {
  value: string;
  label: string;
  /** A dot before the label, for statuses and priorities. */
  color?: string;
}

export interface FilterField {
  key: string;
  label: string;
  Icon: React.ElementType;
  options: FilterOption[];
  /** The values currently on. */
  selected: string[];
  /** One value at a time, drawn with round ticks rather than square. */
  single?: boolean;
}

export const TwoStepFilter: React.FC<{
  fields: FilterField[];
  onToggle: (field: FilterField, value: string) => void;
  onClear: (field: FilterField) => void;
  onClearAll: () => void;
  /** Placed left of the trigger, e.g. a sort control that belongs to the same row. */
  align?: 'left' | 'right';
  /** Shown under one field's values, for anything a list of options cannot say -- a custom
   *  amount, a date you type. Return null for the fields that need nothing. */
  footer?: (field: FilterField) => React.ReactNode;
}> = ({ fields, onToggle, onClear, onClearAll, align = 'left', footer }) => {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [openField, setOpenField] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const open = pos !== null;

  const count = useMemo(() => fields.filter((f) => f.selected.length > 0).length, [fields]);
  const field = fields.find((f) => f.key === openField);

  /** What is set on one field, as words: "Urgent, High +2". */
  const textOf = (f: FilterField): string | null => {
    if (!f.selected.length) return null;
    const words = f.selected.map((v) => f.options.find((o) => o.value === v)?.label ?? v);
    return words.length > 2 ? `${words.slice(0, 2).join(', ')} +${words.length - 2}` : words.join(', ');
  };

  const show = () => {
    if (open || !triggerRef.current) { setPos(null); return; }
    setOpenField(null);
    setSearch('');
    const rect = triggerRef.current.getBoundingClientRect();
    const wanted = align === 'right' ? rect.right - PANEL_WIDTH : rect.left;
    setPos({ top: rect.bottom + 4, left: Math.max(8, Math.min(wanted, window.innerWidth - PANEL_WIDTH - 8)) });
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

  const matches = (label: string) => label.toLowerCase().includes(search.trim().toLowerCase());

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={show}
        aria-expanded={open}
        data-active={count ? '' : undefined}
        className="cf-pill relative flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium"
      >
        {/* Always the word, never the tally in words. The control said "Filter", then "1 filter",
            then "3 filters", so its width jumped and the one thing that never changed -- what the
            button is for -- was the thing that kept being replaced. The number is a badge now, and
            which filters they are is inside, where there is room to say. */}
        Filter
        {count > 0 && <span className="cf-pill-count flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none">{count}</span>}
        <ChevronDown size={13} className={`cf-pill-caret transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Filter"
          className="fixed z-50 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl"
          style={{ top: pos.top, left: pos.left, width: PANEL_WIDTH }}
        >
          {!field ? (
            // --- step one: what to filter by -----------------------------------------------
            <>
              {/* What is set, and the one click that takes it all off -- as on the Dashboard cards. */}
              <div className="flex items-center gap-2 border-b border-gray-100 px-2.5 py-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Filters</span>
                {count > 0 && (
                  <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[#234788] px-1 text-[10px] font-bold leading-none text-white">{count}</span>
                )}
                {count > 0 && <button type="button" onClick={onClearAll} className="filter-clear ml-auto">Clear all</button>}
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
                {fields.filter((f) => matches(f.label)).map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => { setOpenField(f.key); setSearch(''); }}
                    className="mx-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-md px-1.5 py-1 text-left text-[12.5px] font-medium text-gray-700 transition-colors hover:bg-gray-100/80 hover:text-gray-900"
                  >
                    <FieldTile field={f} />
                    <span className="min-w-0 flex-1 truncate">{f.label}</span>
                    {f.selected.length > 0 && (
                      <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-[#234788] px-1 text-[10px] font-semibold tabular-nums text-white" aria-label={`${f.selected.length} picked: ${textOf(f)}`}>
                        {f.selected.length}
                      </span>
                    )}
                    <ChevronRight size={13} className="shrink-0 text-gray-300" />
                  </button>
                ))}
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
                <FieldTile field={field} />
                <span className="flex-1 truncate text-[13px] font-semibold text-gray-800">{field.label}</span>
                {field.selected.length > 0 && (
                  <button type="button" onClick={() => onClear(field)} className="filter-clear">Clear</button>
                )}
              </div>

              {field.options.length > SEARCHABLE && (
                <label className="flex items-center gap-1.5 border-b border-gray-100 px-2.5 py-1">
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

              <div className="max-h-72 space-y-0.5 overflow-y-auto py-1.5">
                {field.options.filter((o) => matches(o.label)).length === 0 ? (
                  <p className="px-3 py-3 text-center text-xs text-gray-400">
                    {field.options.length === 0 ? 'Nothing to filter by here.' : `Nothing called “${search}”.`}
                  </p>
                ) : (
                  field.options.filter((o) => matches(o.label)).map((o) => {
                    const on = field.selected.includes(o.value);
                    // Picked rows take a light wash of their own colour (navy when they have none),
                    // with the tick at the end, where it is scanned.
                    return (
                      <button
                        key={o.value}
                        type="button"
                        role={field.single ? 'radio' : 'checkbox'}
                        aria-checked={on}
                        onClick={() => onToggle(field, o.value)}
                        style={{ '--opt': o.color ?? '#234788' } as React.CSSProperties}
                        className={`filter-opt mx-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-md px-1.5 py-1 text-left text-[12.5px] transition-colors ${
                          on ? 'is-on font-semibold text-gray-900' : 'font-medium text-gray-700 hover:bg-gray-100/80'}`}
                      >
                        {o.color && <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: o.color }} />}
                        <span className="min-w-0 flex-1 truncate">{o.label}</span>
                        <span className={`filter-opt-check flex h-4 w-4 shrink-0 items-center justify-center ${field.single ? 'rounded-full' : 'rounded-[5px]'} ${on ? 'text-white' : 'border border-gray-300'}`}>
                          {on && <Check size={10} strokeWidth={3.5} />}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
              {footer?.(field)}
            </>
          )}
        </div>,
        document.body,
      )}
    </>
  );
};
