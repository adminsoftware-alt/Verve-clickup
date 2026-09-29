// Mind map view, as in ClickUp: "Tasks" mode draws the location's Lists, tasks and subtasks as a tree
// (add tasks and subtasks straight from it); "Blank" mode is a free-form map of ideas saved with the view,
// where any idea can become a task.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckSquare, Plus, Trash2 } from 'lucide-react';
import type { Task } from '../api';
import { spacesApi } from '../spacesApi';
import { notify } from '../../components/notify';

interface Node { id: string; label: string; children: Node[]; kind: 'root' | 'list' | 'task' | 'idea'; taskId?: string; listId?: string; done?: boolean; color?: string }
interface Idea { id: string; text: string; parent: string | null; taskId?: string }

const COL = 250, ROW = 46, NODE_W = 200;
const newId = () => Math.random().toString(36).slice(2, 10);

function layout(root: Node) {
  const placed: { node: Node; x: number; y: number; parent: { x: number; y: number } | null }[] = [];
  let row = 0;
  const walk = (n: Node, depth: number, parent: { x: number; y: number } | null): number => {
    const x = depth * COL;
    if (n.children.length === 0) {
      const y = row++ * ROW;
      placed.push({ node: n, x, y, parent });
      return y;
    }
    const index = placed.length;
    placed.push({ node: n, x, y: 0, parent });
    const ys = n.children.map((c) => walk(c, depth + 1, null));
    const y = (ys[0] + ys[ys.length - 1]) / 2;
    placed[index].y = y;
    // children point back to this node
    placed.forEach((p) => { if (n.children.includes(p.node)) p.parent = { x, y }; });
    return y;
  };
  walk(root, 0, null);
  return { placed, height: Math.max(1, row) * ROW, width: (Math.max(...placed.map((p) => p.x)) + COL) };
}

export const MindMapView: React.FC<{
  viewId: string; title: string; tasks: Task[]; lists: { id: string; name: string; canCreate: boolean }[]; canEdit: boolean; defaultListId: string | null;
  onCreate: (listId: string, name: string, parentId: string | null) => Promise<void>; onOpenTask: (id: string) => void;
}> = ({ viewId, title, tasks, lists, canEdit, defaultListId, onCreate, onOpenTask }) => {
  const [mode, setMode] = useState<'tasks' | 'blank'>('tasks');
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [adding, setAdding] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState('');
  const version = useRef(0);

  const loadIdeas = useCallback(async () => {
    try {
      const got = await spacesApi.content<{ ideas?: Idea[]; mode?: 'tasks' | 'blank' }>(viewId);
      version.current = got.version;
      setIdeas(Array.isArray(got.content.ideas) ? got.content.ideas : []);
      if (got.content.mode === 'blank') setMode('blank');
    } catch (e) { setStatus((e as Error).message); }
  }, [viewId]);
  useEffect(() => { loadIdeas(); }, [loadIdeas]);
  const saveIdeas = async (next: Idea[], nextMode = mode) => {
    setIdeas(next);
    if (!canEdit) return;
    try {
      const saved = await spacesApi.saveContent(viewId, { ideas: next, mode: nextMode }, version.current);
      version.current = saved.version;
      setStatus('Saved');
    } catch (e) { setStatus((e as Error).message); loadIdeas(); }
  };

  const tree: Node = useMemo(() => {
    if (mode === 'blank') {
      const build = (parent: string | null): Node[] => ideas.filter((i) => i.parent === parent).map((i) => ({ id: i.id, label: i.text, kind: 'idea', taskId: i.taskId, children: build(i.id) }));
      return { id: 'root', label: title, kind: 'root', children: build(null) };
    }
    const byParent = new Map<string, Task[]>();
    tasks.forEach((t) => { const k = t.parent_id && tasks.some((x) => x.id === t.parent_id) ? t.parent_id : `list:${t.list_id}`; byParent.set(k, [...(byParent.get(k) ?? []), t]); });
    const taskNode = (t: Task): Node => ({ id: t.id, label: t.name, kind: 'task', taskId: t.id, listId: t.list_id, done: t.status.group === 'done' || t.status.group === 'closed', color: t.status.color, children: (byParent.get(t.id) ?? []).map(taskNode) });
    if (lists.length === 1) return { id: 'root', label: title, kind: 'root', listId: lists[0].id, children: (byParent.get(`list:${lists[0].id}`) ?? []).map(taskNode) };
    return { id: 'root', label: title, kind: 'root', children: lists.map((l) => ({ id: `list:${l.id}`, label: l.name, kind: 'list' as const, listId: l.id, children: (byParent.get(`list:${l.id}`) ?? []).map(taskNode) })) };
  }, [mode, ideas, tasks, lists, title]);
  const { placed, height, width } = useMemo(() => layout(tree), [tree]);

  const canAddUnder = (n: Node) => canEdit && (mode === 'blank' || (n.listId ? lists.find((l) => l.id === n.listId)?.canCreate : false));
  const submit = async (n: Node) => {
    const name = draft.trim();
    setAdding(null);
    setDraft('');
    if (!name) return;
    if (mode === 'blank') { saveIdeas([...ideas, { id: newId(), text: name, parent: n.kind === 'root' ? null : n.id }]); return; }
    try { await onCreate(n.listId!, name, n.kind === 'task' ? n.taskId! : null); } catch (e) { setStatus((e as Error).message); }
  };
  const ideaToTask = async (n: Node) => {
    const target = defaultListId ?? lists.find((l) => l.canCreate)?.id;
    if (!target) { notify.info('You need a List you can add tasks to.'); return; }
    try {
      await onCreate(target, n.label, null);
      saveIdeas(ideas.map((i) => (i.id === n.id ? { ...i, taskId: 'made' } : i)));
    } catch (e) { setStatus((e as Error).message); }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-gray-100 px-6 py-1.5 text-sm">
        <nav className="flex rounded-lg bg-gray-100 p-0.5" aria-label="Mind map mode">
          {(['tasks', 'blank'] as const).map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => { setMode(m); if (canEdit) saveIdeas(ideas, m); }}
              className={`rounded-md px-2.5 py-0.5 ${mode === m ? 'bg-white font-medium shadow-sm' : 'text-gray-500'}`}>{m === 'tasks' ? 'Tasks' : 'Blank'}</button>
          ))}
        </nav>
        <span className="text-xs text-gray-400">{mode === 'tasks' ? 'Your Lists, tasks and subtasks. Use + to add under any of them.' : 'Free-form ideas; turn any into a task.'}</span>
        <span className="ml-auto text-xs text-gray-400" role="status">{status}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-8">
        <div className="relative" style={{ width: width + NODE_W, height: height + 20 }}>
          <svg className="pointer-events-none absolute inset-0" width={width + NODE_W} height={height + 20} aria-hidden="true">
            {placed.filter((p) => p.parent).map((p) => {
              const x1 = p.parent!.x + NODE_W, y1 = p.parent!.y + 16, x2 = p.x, y2 = p.y + 16, mid = (x1 + x2) / 2;
              return <path key={p.node.id} d={`M${x1} ${y1} C${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`} stroke="#c7d2fe" strokeWidth={2} fill="none" />;
            })}
          </svg>
          <ul aria-label="Mind map">
            {placed.map(({ node: n, x, y }) => (
              <li key={n.id} className="group absolute flex items-center gap-1" style={{ left: x, top: y, width: NODE_W + 40 }}>
                <button type="button" onClick={() => n.taskId && n.kind === 'task' && onOpenTask(n.taskId)}
                  className={`flex h-8 w-[200px] items-center gap-1.5 truncate rounded-full border px-3 text-left text-sm shadow-sm ${
                    n.kind === 'root' ? 'border-brand-500 bg-brand-600 font-semibold text-white'
                      : n.kind === 'list' ? 'border-brand-200 bg-brand-50 font-medium text-brand-900'
                        : 'border-gray-200 bg-white text-gray-800 hover:border-brand-300'}`}>
                  {n.kind === 'task' && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: n.color }} />}
                  <span className={`truncate ${n.done ? 'text-gray-400 line-through' : ''}`}>{n.label}</span>
                  {n.kind === 'idea' && n.taskId && <CheckSquare size={12} className="shrink-0 text-emerald-600" aria-label="Made into a task" />}
                </button>
                <span className="hidden items-center group-hover:flex">
                  {canAddUnder(n) && (
                    <button type="button" aria-label={`Add under ${n.label}`} onClick={() => { setAdding(n.id); setDraft(''); }} className="rounded-full bg-white p-1 text-gray-500 shadow hover:text-brand-700"><Plus size={12} /></button>
                  )}
                  {n.kind === 'idea' && canEdit && !n.taskId && (
                    <button type="button" aria-label={`Make ${n.label} a task`} onClick={() => ideaToTask(n)} className="rounded-full bg-white p-1 text-gray-500 shadow hover:text-emerald-700"><CheckSquare size={12} /></button>
                  )}
                  {n.kind === 'idea' && canEdit && (
                    <button type="button" aria-label={`Remove ${n.label}`} onClick={() => {
                      const gone = new Set([n.id]);
                      let grew = true;
                      while (grew) { grew = false; ideas.forEach((i) => { if (i.parent && gone.has(i.parent) && !gone.has(i.id)) { gone.add(i.id); grew = true; } }); }
                      saveIdeas(ideas.filter((i) => !gone.has(i.id)));
                    }} className="rounded-full bg-white p-1 text-gray-500 shadow hover:text-red-600"><Trash2 size={12} /></button>
                  )}
                </span>
                {adding === n.id && (
                  <form className="absolute left-[210px] top-9 z-10 flex gap-1 rounded-md bg-white p-1 shadow-lg" onSubmit={(e) => { e.preventDefault(); submit(n); }}>
                    <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => submit(n)} aria-label="New node"
                      placeholder={mode === 'blank' ? 'Idea' : n.kind === 'task' ? 'Subtask name' : 'Task name'} className="w-48 rounded border border-gray-300 px-2 py-1 text-sm" />
                  </form>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};
