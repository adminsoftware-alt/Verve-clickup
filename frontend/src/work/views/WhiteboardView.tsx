// Whiteboard view: sticky notes, shapes, text, arrows and freehand drawing on a shared canvas.
// A sticky note or text can become a task. Saved automatically (with a version, so edits never clash silently).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Circle, CheckSquare, MousePointer2, PenLine, Square, StickyNote, Trash2, Type } from 'lucide-react';
import { workApi } from '../api';
import { spacesApi } from '../spacesApi';
import { notify } from '../../components/notify';

type Kind = 'sticky' | 'rect' | 'ellipse' | 'text' | 'path' | 'arrow';
interface Item {
  id: string; kind: Kind; x: number; y: number; w: number; h: number; color: string; text?: string;
  points?: [number, number][]; x2?: number; y2?: number; taskId?: string;
}
type Tool = 'select' | Kind;

const W = 2400, H = 1600;
const COLORS = ['#fde68a', '#bbf7d0', '#bfdbfe', '#fbcfe8', '#ddd6fe', '#fed7aa', '#e5e7eb', '#1f2937'];
const newId = () => Math.random().toString(36).slice(2, 10);
const TOOLS: { tool: Tool; label: string; icon: React.ReactNode }[] = [
  { tool: 'select', label: 'Select and move', icon: <MousePointer2 size={15} /> },
  { tool: 'sticky', label: 'Sticky note', icon: <StickyNote size={15} /> },
  { tool: 'rect', label: 'Rectangle', icon: <Square size={15} /> },
  { tool: 'ellipse', label: 'Circle', icon: <Circle size={15} /> },
  { tool: 'text', label: 'Text', icon: <Type size={15} /> },
  { tool: 'arrow', label: 'Arrow', icon: <ArrowUpRight size={15} /> },
  { tool: 'path', label: 'Draw', icon: <PenLine size={15} /> },
];

const readItems = (raw: unknown): Item[] => {
  const items = (raw as { items?: unknown })?.items;
  return Array.isArray(items) ? items.filter((x): x is Item => !!x && typeof x === 'object' && typeof (x as Item).id === 'string') : [];
};

export const WhiteboardView: React.FC<{ viewId: string; canEdit: boolean; listId: string | null; onOpenTask: (id: string) => void; onTaskCreated: () => void }> = ({
  viewId, canEdit, listId, onOpenTask, onTaskCreated,
}) => {
  const [items, setItems] = useState<Item[] | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [selected, setSelected] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const version = useRef(0);
  const dirty = useRef(false);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ mode: 'move' | 'resize' | 'draw' | 'arrow'; id: string; dx: number; dy: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const got = await spacesApi.content<{ items: Item[] }>(viewId);
      version.current = got.version;
      setItems(readItems(got.content));
      dirty.current = false;
    } catch (e) { setStatus((e as Error).message); }
  }, [viewId]);
  useEffect(() => { load(); }, [load]);

  // Save a moment after the last change; saves run one at a time, each on the version before it.
  const latest = useRef<Item[] | null>(null);
  useEffect(() => { latest.current = items; }, [items]);
  const queue = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    if (!canEdit || items === null || !dirty.current) return;
    const t = window.setTimeout(() => {
      queue.current = queue.current.then(async () => {
        if (!dirty.current || !latest.current) return;
        dirty.current = false;
        setStatus('Saving…');
        try {
          const saved = await spacesApi.saveContent(viewId, { items: latest.current }, version.current);
          version.current = saved.version;
          setStatus(dirty.current ? 'Saving…' : 'Saved');
        } catch (e) {
          setStatus(`${(e as Error).message} — reloaded`);
          await load();
        }
      });
    }, 700);
    return () => window.clearTimeout(t);
  }, [items, canEdit, viewId, load]);

  const change = (fn: (prev: Item[]) => Item[]) => { dirty.current = true; setItems((prev) => fn(prev ?? [])); };
  const patch = (id: string, p: Partial<Item>) => change((prev) => prev.map((it) => (it.id === id ? { ...it, ...p } : it)));
  const point = (e: React.MouseEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return [Math.round(e.clientX - r.left), Math.round(e.clientY - r.top)] as const;
  };

  const down = (e: React.MouseEvent) => {
    if (!canEdit || e.button !== 0) return;
    e.preventDefault(); // keep focus where it is, so a new note's text box isn't blurred straight away
    const [x, y] = point(e);
    if (tool === 'select') { setSelected(null); setEditingText(null); return; }
    const id = newId();
    const base: Item = { id, kind: tool, x, y, w: 160, h: 110, color: tool === 'sticky' ? COLORS[0] : tool === 'text' ? '#1f2937' : '#bfdbfe', text: '' };
    if (tool === 'text') Object.assign(base, { w: 220, h: 40 });
    if (tool === 'rect' || tool === 'ellipse') Object.assign(base, { w: 160, h: 100 });
    if (tool === 'path') Object.assign(base, { points: [[x, y]], color: '#1f2937', w: 0, h: 0 });
    if (tool === 'arrow') Object.assign(base, { x2: x, y2: y, color: '#1f2937', w: 0, h: 0 });
    change((prev) => [...prev, base]);
    setSelected(id);
    if (tool === 'path') drag.current = { mode: 'draw', id, dx: 0, dy: 0 };
    else if (tool === 'arrow') drag.current = { mode: 'arrow', id, dx: 0, dy: 0 };
    else { setEditingText(id); setTool('select'); }
  };
  const startMove = (e: React.MouseEvent, it: Item, mode: 'move' | 'resize' = 'move') => {
    e.stopPropagation();
    setSelected(it.id);
    if (!canEdit || tool !== 'select') return;
    const [x, y] = point(e);
    drag.current = { mode, id: it.id, dx: mode === 'move' ? x - it.x : x - it.w, dy: mode === 'move' ? y - it.y : y - it.h };
  };
  const move = (e: React.MouseEvent) => {
    const d = drag.current;
    if (!d) return;
    const [x, y] = point(e);
    change((prev) => prev.map((it) => {
      if (it.id !== d.id) return it;
      if (d.mode === 'draw') return { ...it, points: [...(it.points ?? []), [x, y]] };
      if (d.mode === 'arrow') return { ...it, x2: x, y2: y };
      if (d.mode === 'resize') return { ...it, w: Math.max(40, x - d.dx), h: Math.max(24, y - d.dy) };
      if (it.kind === 'path') {
        const ox = x - d.dx - it.x, oy = y - d.dy - it.y;
        return { ...it, x: x - d.dx, y: y - d.dy, points: (it.points ?? []).map(([px, py]) => [px + ox, py + oy] as [number, number]) };
      }
      if (it.kind === 'arrow') {
        const ox = x - d.dx - it.x, oy = y - d.dy - it.y;
        return { ...it, x: x - d.dx, y: y - d.dy, x2: (it.x2 ?? 0) + ox, y2: (it.y2 ?? 0) + oy };
      }
      return { ...it, x: x - d.dx, y: y - d.dy };
    }));
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (d && (d.mode === 'draw' || d.mode === 'arrow')) setTool('select');
  };
  const remove = (id: string) => { change((prev) => prev.filter((it) => it.id !== id)); setSelected(null); };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!selected || editingText || !canEdit) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && !(e.target as HTMLElement).closest('input,textarea')) { e.preventDefault(); remove(selected); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const toTask = async (it: Item) => {
    if (!listId) { notify.info('Open this whiteboard on a List to turn notes into tasks there.'); return; }
    const name = (it.text || '').trim().split('\n')[0];
    if (!name) { notify.info('Write something on it first.'); return; }
    try {
      const t = await workApi.createTask(listId, { name: name.slice(0, 500), description: it.text!.trim() });
      patch(it.id, { taskId: t.id });
      onTaskCreated();
    } catch (e) { notify.error(e); }
  };

  if (items === null) return <p className="p-10 text-center text-sm text-gray-400">{status || 'Loading…'}</p>;
  const sel = items.find((it) => it.id === selected) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-1 border-b border-gray-100 px-6 py-1.5" role="toolbar" aria-label="Whiteboard tools">
        {canEdit && TOOLS.map((t) => (
          <button key={t.tool} type="button" title={t.label} aria-label={t.label} aria-pressed={tool === t.tool} onClick={() => setTool(t.tool)}
            className={`rounded p-1.5 ${tool === t.tool ? 'bg-brand-100 text-brand-700' : 'text-gray-600 hover:bg-gray-100'}`}>{t.icon}</button>
        ))}
        {sel && canEdit && (
          <>
            <span className="mx-2 h-5 w-px bg-gray-200" />
            {COLORS.map((c) => (
              <button key={c} type="button" aria-label={`Colour ${c}`} onClick={() => patch(sel.id, { color: c })}
                className={`h-5 w-5 rounded-full border ${sel.color === c ? 'ring-2 ring-brand-400' : 'border-gray-300'}`} style={{ backgroundColor: c }} />
            ))}
            {(sel.kind === 'sticky' || sel.kind === 'text') && !sel.taskId && (
              <button type="button" onClick={() => toTask(sel)} className="ml-2 flex items-center gap-1 rounded border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-50"><CheckSquare size={12} /> Make it a task</button>
            )}
            <button type="button" aria-label="Delete item" title="Delete (Del)" onClick={() => remove(sel.id)} className="ml-1 rounded p-1 text-gray-500 hover:bg-red-50 hover:text-red-600"><Trash2 size={14} /></button>
          </>
        )}
        <span className="ml-auto text-xs text-gray-400" role="status">{status}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:20px_20px]">
        <div className="relative" style={{ width: W, height: H }}>
          <svg ref={svg} width={W} height={H} aria-label="Whiteboard" role="img" onMouseDown={down} onMouseMove={move} onMouseUp={up} onMouseLeave={up}
            className={tool === 'select' ? 'cursor-default' : 'cursor-crosshair'}>
            <defs>
              <marker id={`arrow-${viewId}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#1f2937" />
              </marker>
            </defs>
            {items.map((it) => {
              const isSel = it.id === selected;
              const common = { onMouseDown: (e: React.MouseEvent) => startMove(e, it), onDoubleClick: () => canEdit && setEditingText(it.id), style: { cursor: canEdit ? 'move' : 'default' } };
              if (it.kind === 'path') {
                const d = (it.points ?? []).map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ');
                return <path key={it.id} d={d} fill="none" stroke={it.color} strokeWidth={isSel ? 4 : 3} strokeLinecap="round" strokeLinejoin="round" {...common} />;
              }
              if (it.kind === 'arrow') {
                return <line key={it.id} x1={it.x} y1={it.y} x2={it.x2} y2={it.y2} stroke={it.color} strokeWidth={isSel ? 3 : 2} markerEnd={`url(#arrow-${viewId})`} {...common} />;
              }
              return (
                <g key={it.id} data-kind={it.kind} aria-label={it.text || it.kind} {...common}>
                  {it.kind === 'sticky' && <rect x={it.x} y={it.y} width={it.w} height={it.h} fill={it.color} rx={4} style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.2))' }} />}
                  {it.kind === 'rect' && <rect x={it.x} y={it.y} width={it.w} height={it.h} fill={it.color} fillOpacity={0.5} stroke="#374151" rx={6} />}
                  {it.kind === 'ellipse' && <ellipse cx={it.x + it.w / 2} cy={it.y + it.h / 2} rx={it.w / 2} ry={it.h / 2} fill={it.color} fillOpacity={0.5} stroke="#374151" />}
                  {it.kind === 'text' && isSel && <rect x={it.x} y={it.y} width={it.w} height={it.h} fill="none" stroke="#a5b4fc" strokeDasharray="4 3" />}
                  {editingText !== it.id && (
                    <foreignObject x={it.x + 6} y={it.y + 4} width={Math.max(0, it.w - 12)} height={Math.max(0, it.h - 8)} pointerEvents="none">
                      <div className={`h-full overflow-hidden whitespace-pre-wrap break-words ${it.kind === 'text' ? 'text-base font-medium' : 'text-sm'}`}
                        style={{ color: it.kind === 'text' ? it.color : '#111827', textAlign: it.kind === 'sticky' || it.kind === 'text' ? 'left' : 'center' }}>{it.text}</div>
                    </foreignObject>
                  )}
                  {isSel && canEdit && <rect x={it.x + it.w - 6} y={it.y + it.h - 6} width={10} height={10} fill="#6366f1" style={{ cursor: 'nwse-resize' }}
                    onMouseDown={(e) => startMove(e, it, 'resize')} aria-label="Resize" />}
                  {it.taskId && (
                    <g onMouseDown={(e) => { e.stopPropagation(); onOpenTask(it.taskId!); }} style={{ cursor: 'pointer' }} aria-label="Open the task">
                      <circle cx={it.x + it.w - 4} cy={it.y + 4} r={9} fill="#16a34a" />
                      <path d={`M${it.x + it.w - 8} ${it.y + 4} l3 3 l5 -6`} stroke="white" strokeWidth={2} fill="none" />
                    </g>
                  )}
                </g>
              );
            })}
          </svg>
          {editingText && (() => {
            const it = items.find((x) => x.id === editingText);
            if (!it) return null;
            return (
              <textarea autoFocus aria-label="Text" defaultValue={it.text} style={{ left: it.x + 4, top: it.y + 2, width: Math.max(80, it.w - 8), height: Math.max(30, it.h - 4) }}
                onBlur={(e) => { patch(it.id, { text: e.target.value.slice(0, 2000) }); setEditingText(null); }}
                onKeyDown={(e) => { if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur(); }}
                className="absolute resize-none rounded border border-brand-300 bg-white/90 p-1 text-sm focus:outline-none" />
            );
          })()}
        </div>
      </div>
    </div>
  );
};
