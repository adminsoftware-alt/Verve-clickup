// What someone sees when they open a public link: read-only, no sign-in.
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckSquare, Lock } from 'lucide-react';
import { Markdown } from './task/RichText';
import { PRIORITIES } from './ui';
import { fetchPublicPage, type PublicPage as Page, type PublicTask } from './spacesApi';

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

const Row: React.FC<{ task: PublicTask; depth: number }> = ({ task, depth }) => (
  <li className="flex items-center gap-3 border-b border-gray-100 py-2 text-sm" style={{ paddingLeft: depth * 20 }}>
    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: task.status_color }} title={task.status} />
    <span className="min-w-0 flex-1 truncate text-gray-900">{task.name}</span>
    <span className="w-28 shrink-0 text-xs text-gray-500">{task.status}</span>
    {task.assignees.length > 0 && <span className="w-32 shrink-0 truncate text-xs text-gray-500">{task.assignees.join(', ')}</span>}
    <span className="w-24 shrink-0 text-right text-xs text-gray-500">{fmt(task.due_date)}</span>
  </li>
);

function tree(tasks: PublicTask[]): { task: PublicTask; depth: number }[] {
  const ids = new Set(tasks.map((t) => t.id));
  const kids = new Map<string, PublicTask[]>();
  tasks.forEach((t) => { const p = t.parent_id && ids.has(t.parent_id) ? t.parent_id : ''; kids.set(p, [...(kids.get(p) ?? []), t]); });
  const out: { task: PublicTask; depth: number }[] = [];
  const walk = (parent: string, depth: number) => (kids.get(parent) ?? []).forEach((t) => { out.push({ task: t, depth }); walk(t.id, depth + 1); });
  walk('', 0);
  return out;
}

export const PublicPage: React.FC = () => {
  const { token = '' } = useParams();
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { fetchPublicPage(token).then(setPage).catch((e) => setError(e.message)); }, [token]);
  useEffect(() => { if (page) document.title = `${page.title} · ${page.workspace}`; }, [page]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
        <div className="max-w-sm rounded-xl bg-white p-8 text-center shadow">
          <Lock className="mx-auto text-gray-300" size={32} />
          <h1 className="mt-3 text-lg font-semibold text-gray-900">Link unavailable</h1>
          <p className="mt-1 text-sm text-gray-500">{error}</p>
        </div>
      </div>
    );
  }
  if (!page) return <div className="p-10 text-center text-sm text-gray-400">Loading…</div>;
  const pages = Array.isArray(page.doc?.pages) ? (page.doc!.pages as { title?: string; body?: string }[]) : [];
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white px-6 py-4">
        <p className="text-xs uppercase tracking-wide text-gray-400">{page.workspace} · shared publicly · read only</p>
        <h1 className="mt-1 text-xl font-semibold text-gray-900">{page.title}</h1>
      </header>
      <main className="mx-auto max-w-4xl p-6">
        {page.task && (
          <article className="rounded-xl bg-white p-6 shadow-sm" aria-label="Task">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="rounded px-2 py-0.5 text-xs font-medium text-white" style={{ backgroundColor: page.task.status_color }}>{page.task.status}</span>
              {page.task.priority && <span className="text-xs" style={{ color: PRIORITIES[page.task.priority].color }}>{PRIORITIES[page.task.priority].label}</span>}
              {page.task.due_date && <span className="text-xs text-gray-500">Due {fmt(page.task.due_date)}</span>}
              {page.task.checklist_total > 0 && <span className="flex items-center gap-1 text-xs text-gray-500"><CheckSquare size={12} /> {page.task.checklist_done}/{page.task.checklist_total}</span>}
              {page.task.assignees.length > 0 && <span className="text-xs text-gray-500">{page.task.assignees.join(', ')}</span>}
            </div>
            {page.task.description && <div className="mt-4 text-sm text-gray-800"><Markdown text={page.task.description} /></div>}
            {page.subtasks.length > 0 && (
              <>
                <h2 className="mt-6 text-sm font-semibold text-gray-700">Subtasks</h2>
                <ul aria-label="Subtasks">{tree(page.subtasks).map((r) => <Row key={r.task.id} task={r.task} depth={Math.max(0, r.depth)} />)}</ul>
              </>
            )}
          </article>
        )}
        {pages.length > 0 && (
          <article className="space-y-6 rounded-xl bg-white p-6 shadow-sm" aria-label="Doc">
            {pages.map((p, i) => (
              <section key={i}>
                <h2 className="mb-2 text-lg font-semibold text-gray-900">{p.title || 'Untitled'}</h2>
                <div className="text-sm text-gray-800"><Markdown text={p.body ?? ''} /></div>
              </section>
            ))}
          </article>
        )}
        {page.view_type === 'embed' && typeof page.doc?.url === 'string' && (
          <iframe title={page.title} src={page.doc.url} className="h-[75vh] w-full rounded-xl border border-gray-200 bg-white"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />
        )}
        {page.kind !== 'task' && page.tasks.length > 0 && (
          <section className="rounded-xl bg-white px-4 shadow-sm">
            <ul aria-label="Tasks">{tree(page.tasks).map((r) => <Row key={r.task.id} task={r.task} depth={r.depth} />)}</ul>
          </section>
        )}
        {page.kind !== 'task' && page.tasks.length === 0 && pages.length === 0 && page.view_type !== 'embed' && (
          <p className="text-center text-sm text-gray-400">Nothing to show yet.</p>
        )}
      </main>
    </div>
  );
};
