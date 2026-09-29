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
import { ArrowLeft, Check, ChevronDown, ChevronRight, Search, X } from 'lucide-react';

const PANEL_WIDTH = 280;
/** Above this many choices the value list gets its own search box. */
const SEARCHABLE = 8;

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
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', away, true);
    window.addEventListener('resize', away);
    return () => {
      document.removeEventListener('mousedown', onDown);
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
        className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium shadow-sm ${
          count
            ? 'border-teal-200 bg-teal-50 text-teal-800 hover:bg-teal-100'
            : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50'}`}
      >
        {count ? `${count} filter${count === 1 ? '' : 's'}` : 'Filter'}
        <ChevronDown size={13} className={count ? 'text-teal-500' : 'text-gray-400'} />
      </button>

      {open && createPortal(
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Filter"
          className="fixed z-50 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl"
          style={{ top: pos.top, left: pos.left, width: PANEL_WIDTH }}
        >
          {count > 0 && (
            <div className="flex flex-wrap items-center gap-1 border-b border-gray-100 bg-gray-50/70 px-2 py-1.5">
              {fields.map((f) => {
                const text = textOf(f);
                if (!text) return null;
                return (
                  <span key={f.key} className="flex max-w-full items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] text-gray-700 ring-1 ring-gray-200">
                    <span className="truncate"><span className="text-gray-400">{f.label}:</span> {text}</span>
                    <button type="button" aria-label={`Clear ${f.label}`} onClick={() => onClear(f)} className="text-gray-400 hover:text-gray-700">
                      <X size={11} />
                    </button>
                  </span>
                );
              })}
              <button type="button" onClick={onClearAll} className="ml-auto text-[11px] text-gray-500 hover:text-gray-800">Clear all</button>
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
              <div className="max-h-72 overflow-y-auto py-1">
                {fields.filter((f) => matches(f.label)).map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => { setOpenField(f.key); setSearch(''); }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-gray-700 hover:bg-gray-50"
                  >
                    <f.Icon size={14} className="shrink-0 text-gray-400" />
                    <span className="flex-1 truncate">{f.label}</span>
                    {textOf(f) && <span className="max-w-24 truncate text-[11px] text-teal-700">{textOf(f)}</span>}
                    <ChevronRight size={13} className="shrink-0 text-gray-300" />
                  </button>
                ))}
                {fields.filter((f) => matches(f.label)).length === 0 && (
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
                {field.selected.length > 0 && (
                  <button type="button" onClick={() => onClear(field)} className="text-[11px] text-gray-500 hover:text-gray-800">Clear</button>
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
                  <p className="px-3 py-3 text-center text-xs text-gray-400">
                    {field.options.length === 0 ? 'Nothing to filter by here.' : `Nothing called “${search}”.`}
                  </p>
                ) : (
                  field.options.filter((o) => matches(o.label)).map((o) => {
                    const on = field.selected.includes(o.value);
                    return (
                      <button
                        key={o.value}
                        type="button"
                        onClick={() => onToggle(field, o.value)}
                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] ${
                          on ? 'bg-teal-50/70 font-medium text-teal-900' : 'text-gray-700 hover:bg-gray-50'}`}
                      >
                        <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center border ${
                          field.single ? 'rounded-full' : 'rounded'} ${
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
              {footer?.(field)}
            </>
          )}
        </div>,
        document.body,
      )}
    </>
  );
};
