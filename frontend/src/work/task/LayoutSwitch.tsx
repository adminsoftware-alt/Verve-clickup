// How the task opens: beside the list, over it, or instead of it.
//
// A task panel is read in three different situations. Glancing at one while working down a list
// wants it beside the list. Writing a long description wants the width. Reading a task with a
// dozen comments wants the whole screen. One fixed shape serves one of those three, so the
// choice is the person's and it is remembered.
import { Columns2, Maximize2, Square } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';

export type PanelLayout = 'sidebar' | 'modal' | 'full';

const KEY = 'verve.taskLayout';

const OPTIONS: { value: PanelLayout; label: string; hint: string; Icon: React.ElementType }[] = [
  { value: 'modal', label: 'Modal', hint: 'A window over the list', Icon: Square },
  { value: 'full', label: 'Full screen', hint: 'The whole screen', Icon: Maximize2 },
  { value: 'sidebar', label: 'Sidebar', hint: 'Beside the list', Icon: Columns2 },
];

/** The chosen layout, remembered per browser. Falls back to the side panel. */
export function usePanelLayout(): [PanelLayout, (l: PanelLayout) => void] {
  const [layout, setLayout] = useState<PanelLayout>('sidebar');
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === 'sidebar' || saved === 'modal' || saved === 'full') setLayout(saved);
    } catch { /* a private window has no storage; the default is fine */ }
  }, []);
  const choose = (l: PanelLayout) => {
    setLayout(l);
    try { localStorage.setItem(KEY, l); } catch { /* ignore */ }
  };
  return [layout, choose];
}

/** The classes for the backdrop and the panel itself, for each layout. */
export const SHELL: Record<PanelLayout, { backdrop: string; panel: string }> = {
  sidebar: {
    backdrop: 'justify-end',
    panel: 'h-full w-full max-w-[46rem] shadow-2xl',
  },
  modal: {
    backdrop: 'items-center justify-center p-4 sm:p-8',
    panel: 'h-full max-h-[90vh] w-full max-w-5xl rounded-2xl shadow-2xl',
  },
  full: {
    backdrop: 'justify-center',
    panel: 'h-full w-full max-w-none',
  },
};

export const LayoutSwitch: React.FC<{ value: PanelLayout; onChange: (l: PanelLayout) => void }> = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const current = OPTIONS.find((o) => o.value === value) ?? OPTIONS[2];

  useEffect(() => {
    if (!open) return;
    // The check matters now these listen in the capture phase: without it a click on the
    // menu itself would close it before the choice registered.
    const away = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away, true);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', away, true); document.removeEventListener('keydown', key); };
  }, [open]);

  return (
    <span ref={wrap} className="relative" onMouseDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        title="Switch layout"
        aria-label="Switch layout"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={`rounded p-1.5 transition-colors ${open ? 'bg-gray-100 text-gray-700' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700'}`}
      >
        <current.Icon size={16} />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Task layout"
          className="absolute right-0 top-full z-50 mt-1 flex gap-1.5 rounded-xl border border-gray-200 bg-white p-1.5 shadow-xl"
        >
          {OPTIONS.map((o) => {
            const on = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                role="menuitemradio"
                aria-checked={on}
                title={o.hint}
                onClick={() => { onChange(o.value); setOpen(false); }}
                className={`w-[5.5rem] rounded-lg p-2 text-center transition-colors ${on ? 'bg-brand-50 ring-1 ring-brand-300' : 'hover:bg-gray-50'}`}
              >
                {/* A small drawing of the shape, which reads faster than the word does. */}
                <span className={`mx-auto flex h-9 w-full items-center justify-center rounded border ${on ? 'border-brand-300 bg-white' : 'border-gray-200 bg-gray-50'}`}>
                  {o.value === 'sidebar' && (
                    <span className="flex h-6 w-14 overflow-hidden rounded-sm border border-gray-300">
                      <span className="flex-1 bg-gray-100" />
                      <span className={`w-5 ${on ? 'bg-brand-400' : 'bg-gray-400'}`} />
                    </span>
                  )}
                  {o.value === 'modal' && (
                    <span className="relative flex h-6 w-14 items-center justify-center rounded-sm border border-gray-300 bg-gray-100">
                      <span className={`h-4 w-9 rounded-sm ${on ? 'bg-brand-400' : 'bg-gray-400'}`} />
                    </span>
                  )}
                  {o.value === 'full' && (
                    <span className={`h-6 w-14 rounded-sm border ${on ? 'border-brand-400 bg-brand-400' : 'border-gray-400 bg-gray-400'}`} />
                  )}
                </span>
                <span className={`mt-1.5 block text-[11px] font-medium ${on ? 'text-brand-700' : 'text-gray-600'}`}>{o.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </span>
  );
};
