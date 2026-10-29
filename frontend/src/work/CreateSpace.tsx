// Create a Space, on one screen: icon and colour, name, description, how its work moves (one of
// the firm's three workflows, with the statuses editable before the Space is made), the default
// permission members get, and Make Private.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Eye, MessageSquare, Pencil, Plus, ShieldCheck, Trash2, X } from 'lucide-react';
import { workApi, type StatusGroup } from './api';
import { Portal } from './ui';
import { useIsAdmin } from './WorkContext';
import { SPACE_COLORS } from './spaceColors';

type Level = 'full' | 'edit' | 'comment' | 'view';
interface StatusRow { key: string; name: string; color: string; group: StatusGroup }
interface Workflow { key: string; name: string; blurb: string; statuses: [string, string, StatusGroup][] }

const LEVELS: { key: Level; label: string; hint: string; Icon: React.ElementType; tone: string }[] = [
  { key: 'full', label: 'Full edit', hint: 'Create and edit everything. Owners and admins also manage settings.', Icon: ShieldCheck, tone: '#234788' },
  { key: 'edit', label: 'Edit', hint: 'Create and edit everything, but not settings or deleting.', Icon: Pencil, tone: '#7C3AED' },
  { key: 'comment', label: 'Comment', hint: 'Comment on everything, without editing.', Icon: MessageSquare, tone: '#0284C7' },
  { key: 'view', label: 'View only', hint: 'Read only: no editing or comments.', Icon: Eye, tone: '#64748B' },
];

/** A level's icon in a small tile washed in its colour. */
const LevelTile: React.FC<{ Icon: React.ElementType; tone: string; size?: number }> = ({ Icon, tone, size = 26 }) => (
  <span className="flex shrink-0 items-center justify-center rounded-lg" style={{ width: size, height: size, backgroundColor: `color-mix(in srgb, ${tone} 12%, white)`, color: tone }}>
    <Icon size={Math.round(size * 0.52)} strokeWidth={2.1} />
  </span>
);

// The same colours the server gives its default statuses, so a Space made here and one made
// without choosing look alike.
const GREY = '#87909e', BLUE = '#5b9fef', YELLOW = '#f8ae00', ORANGE = '#e16b16', GREEN = '#008844';
// Review stays an open status: work waiting for a partner's sign-off still counts as late when
// its due date passes.
const WORKFLOWS: Workflow[] = [
  { key: 'client', name: 'Client engagement', blurb: 'Client work that is checked before it goes out',
    statuses: [['To do', GREY, 'not_started'], ['In progress', BLUE, 'active'], ['Review', YELLOW, 'active'], ['Complete', GREEN, 'closed']] },
  { key: 'internal', name: 'Internal', blurb: 'The firm’s own work, with no sign-off step',
    statuses: [['To do', GREY, 'not_started'], ['In progress', BLUE, 'active'], ['Complete', GREEN, 'closed']] },
  { key: 'department', name: 'Department', blurb: 'A team’s running work, which sometimes waits on others',
    statuses: [['To do', GREY, 'not_started'], ['In progress', BLUE, 'active'], ['On hold', ORANGE, 'active'], ['Complete', GREEN, 'closed']] },
];
const GROUP_LABEL: Record<StatusGroup, string> = { not_started: 'Not started', active: 'Active', done: 'Done', closed: 'Closed' };

let seq = 0;
const rowsOf = (w: Workflow): StatusRow[] => w.statuses.map(([name, color, group]) => ({ key: `s${++seq}`, name, color, group }));

const label = 'mb-1.5 block text-sm font-medium text-gray-700';
const field = 'w-full rounded-md border border-gray-300 px-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100';

export const CreateSpaceDialog: React.FC<{
  workspaceId: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}> = ({ workspaceId, onClose, onCreated }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(SPACE_COLORS[0]);
  const [icon, setIcon] = useState('');
  // An admin's own picture for the Space: kept here and uploaded once the Space exists.
  const isAdmin = useIsAdmin();
  const [picture, setPicture] = useState<File | null>(null);
  const pictureUrl = useMemo(() => (picture ? URL.createObjectURL(picture) : null), [picture]);
  useEffect(() => () => { if (pictureUrl) URL.revokeObjectURL(pictureUrl); }, [pictureUrl]);
  const [picking, setPicking] = useState(false);
  // The icon panel closes the ways a panel should: its own Done or close button, a click anywhere
  // outside it, or Esc -- which closes only the panel, not the whole Create a Space window.
  const pickerRef = useRef<HTMLDivElement>(null);
  const levelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!picking) return undefined;
    const away = (e: MouseEvent) => { if (!pickerRef.current?.contains(e.target as Node)) setPicking(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setPicking(false); } };
    document.addEventListener('mousedown', away, true);
    window.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('mousedown', away, true); window.removeEventListener('keydown', esc, true); };
  }, [picking]);
  const [level, setLevel] = useState<Level>('full');
  const [levelOpen, setLevelOpen] = useState(false);
  useEffect(() => {
    if (!levelOpen) return undefined;
    const away = (e: MouseEvent) => { if (!levelRef.current?.contains(e.target as Node)) setLevelOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setLevelOpen(false); } };
    document.addEventListener('mousedown', away, true);
    window.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('mousedown', away, true); window.removeEventListener('keydown', esc, true); };
  }, [levelOpen]);
  const [isPrivate, setIsPrivate] = useState(false);
  const [workflow, setWorkflow] = useState<Workflow>(WORKFLOWS[0]);
  const [statuses, setStatuses] = useState<StatusRow[]>(() => rowsOf(WORKFLOWS[0]));
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);

  useEffect(() => { nameInput.current?.focus(); }, []);

  const choose = (w: Workflow) => { setWorkflow(w); setStatuses(rowsOf(w)); };

  const statusProblem = useMemo(() => {
    const names = statuses.map((s) => s.name.trim().toLowerCase());
    if (names.some((n) => !n)) return 'Every status needs a name.';
    if (new Set(names).size !== names.length) return 'Two statuses have the same name.';
    if (statuses.filter((s) => s.group === 'closed').length !== 1) return 'Exactly one status must be Closed — the final one.';
    if (!statuses.some((s) => s.group === 'not_started' || s.group === 'active')) return 'Add at least one Not started or Active status.';
    return null;
  }, [statuses]);

  const create = async () => {
    if (!name.trim()) { nameInput.current?.focus(); setError('Give the Space a name.'); return; }
    if (statusProblem) { setEditing(true); setError(statusProblem); return; }
    setBusy(true);
    setError(null);
    try {
      const made = await workApi.createSpace(workspaceId, {
        name: name.trim(), description: description.trim() || undefined, color, icon: icon.trim() || undefined, is_private: isPrivate,
        default_permission: level === 'full' ? undefined : level,
        statuses: statuses.map(({ name: n, color: c, group }) => ({ name: n.trim(), color: c, group })),
      });
      if (picture) {
        // The Space is made either way; a picture that fails can be added again later.
        try { await workApi.setSpaceIcon(workspaceId, made.id, picture); } catch { /* keeps its letter */ }
      }
      onCreated(made.id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const badge = (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg text-base font-bold text-white" style={{ backgroundColor: color }}>
      {pictureUrl
        ? <img src={pictureUrl} alt="" className="h-full w-full object-cover" />
        : icon.trim() || name.trim()[0]?.toUpperCase() || 'S'}
    </span>
  );
  const current = LEVELS.find((l) => l.key === level)!;

  return (
    <Portal>
      <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/30 p-4" onMouseDown={onClose}>
        <form role="dialog" aria-label="Create a Space" onMouseDown={(e) => e.stopPropagation()}
          onSubmit={(e) => { e.preventDefault(); create(); }}
          className="flex max-h-[90vh] w-[38rem] max-w-full flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl">
          <header className="flex items-start justify-between gap-3 border-b border-gray-100 px-6 py-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Create a Space</h2>
              <p className="mt-0.5 text-sm text-gray-500">A client, a department or a group of work, with its own Folders and Lists.</p>
            </div>
            <button type="button" aria-label="Close" onClick={onClose} className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><X size={16} /></button>
          </header>

          <div className="min-h-0 space-y-5 overflow-y-auto px-6 py-5">
            <div>
              <label htmlFor="space-name" className={label}>Icon &amp; name</label>
              <div className="flex items-center gap-2">
                <div ref={pickerRef} className="relative">
                  <button type="button" aria-label="Choose icon and colour" aria-expanded={picking} onClick={() => setPicking((v) => !v)} className="rounded-lg">{badge}</button>
                  {picking && (
                    <div role="dialog" aria-label="Icon and colour" className="absolute left-0 top-12 z-10 w-60 rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-xs font-medium text-gray-500">Colour</p>
                        <button type="button" aria-label="Close" onClick={() => setPicking(false)} className="-mr-1 -mt-1 rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><X size={14} /></button>
                      </div>
                      <div className="grid grid-cols-6 gap-2">
                        {SPACE_COLORS.map((c) => (
                          <button key={c} type="button" aria-label={`Colour ${c}`} aria-pressed={c === color} onClick={() => setColor(c)}
                            className="flex h-8 w-8 items-center justify-center rounded-full" style={{ backgroundColor: c }}>
                            {c === color && <Check size={14} className="text-white" />}
                          </button>
                        ))}
                      </div>
                      <label className="mt-3 block text-xs font-medium text-gray-500">Icon (a letter or emoji)
                        <input value={icon} maxLength={2} onChange={(e) => setIcon(e.target.value)} placeholder={name.trim()[0]?.toUpperCase() || 'S'}
                          className="mt-1 w-full rounded-md border border-gray-200 px-2 py-1 text-sm focus:border-brand-500 focus:outline-none" />
                      </label>
                      {isAdmin && (
                        <div className="mt-3">
                          <p className="text-xs font-medium text-gray-500">Or your own picture</p>
                          <div className="mt-1 flex items-center gap-2">
                            <label className="vf-tool cursor-pointer rounded-md border px-2.5 py-1 text-xs font-medium text-gray-700">
                              {picture ? 'Change picture' : 'Upload picture'}
                              <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  e.target.value = '';
                                  if (!file) return;
                                  if (file.size > 1024 * 1024) { setError('The picture must be 1 MB or smaller.'); return; }
                                  setError(null);
                                  setPicture(file);
                                }} />
                            </label>
                            {picture && (
                              <button type="button" onClick={() => setPicture(null)} className="rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-gray-100">Remove</button>
                            )}
                          </div>
                          <p className="mt-1 text-[11px] text-gray-400">PNG, JPG or WebP, up to 1 MB</p>
                        </div>
                      )}
                      <div className="mt-3 flex justify-end border-t border-gray-100 pt-2.5">
                        <button type="button" onClick={() => setPicking(false)} className="rounded-md bg-[#234788] px-3 py-1 text-xs font-semibold text-white hover:bg-[#1B3A72]">Done</button>
                      </div>
                    </div>
                  )}
                </div>
                <input id="space-name" ref={nameInput} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Client Services, Internal, HR"
                  className={`${field} h-10 flex-1`} />
              </div>
            </div>

            <div>
              <label htmlFor="space-description" className={label}>Description <span className="font-normal text-gray-400">(optional)</span></label>
              <textarea id="space-description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} className={`${field} resize-none py-2`} />
            </div>

            <div>
              <span className={label}>Workflow</span>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Workflow">
                {WORKFLOWS.map((w) => (
                  <button key={w.key} type="button" role="radio" aria-checked={w.key === workflow.key} onClick={() => choose(w)}
                    className={`rounded-lg border px-3 py-2.5 text-left ${w.key === workflow.key ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-600' : 'border-gray-200 hover:border-brand-300'}`}>
                    <span className="block text-sm font-medium text-gray-900">{w.name}</span>
                    <span className="mt-0.5 block text-xs leading-snug text-gray-500">{w.blurb}</span>
                  </button>
                ))}
              </div>
              <div className="mt-2 rounded-lg border border-gray-200">
                <button type="button" aria-expanded={editing} onClick={() => setEditing((v) => !v)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-gray-50">
                  <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-gray-700">
                    {statuses.map((s, i) => (
                      <React.Fragment key={s.key}>
                        {i > 0 && <span className="text-gray-300">→</span>}
                        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />{s.name || 'Untitled'}</span>
                      </React.Fragment>
                    ))}
                  </span>
                  <span className="shrink-0 text-xs font-medium text-brand-700">{editing ? 'Done' : 'Edit statuses'}</span>
                  <ChevronRight size={14} className={`shrink-0 text-gray-400 ${editing ? 'rotate-90' : ''}`} />
                </button>
                {editing && (
                  <div className="border-t border-gray-100 px-3 py-3">
                    <p className="mb-2 text-xs text-gray-500">The steps a task moves through. Exactly one is Closed: the final status.</p>
                    <ul className="space-y-1.5">
                      {statuses.map((s, i) => (
                        <li key={s.key} className="flex items-center gap-2">
                          <input type="color" aria-label={`Colour of ${s.name || 'status'}`} value={s.color}
                            onChange={(e) => setStatuses((rs) => rs.map((r, j) => (j === i ? { ...r, color: e.target.value } : r)))}
                            className="h-7 w-7 shrink-0 cursor-pointer rounded border border-gray-200 bg-white p-0.5" />
                          <input value={s.name} aria-label="Status name" maxLength={64}
                            onChange={(e) => setStatuses((rs) => rs.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))}
                            className="min-w-0 flex-1 rounded-md border border-gray-200 px-2 py-1 text-sm focus:border-brand-500 focus:outline-none" />
                          <select value={s.group} aria-label="Status group"
                            onChange={(e) => setStatuses((rs) => rs.map((r, j) => (j === i ? { ...r, group: e.target.value as StatusGroup } : r)))}
                            className="rounded-md border border-gray-200 px-1.5 py-1 text-sm text-gray-700">
                            {(Object.keys(GROUP_LABEL) as StatusGroup[]).map((g) => <option key={g} value={g}>{GROUP_LABEL[g]}</option>)}
                          </select>
                          <button type="button" aria-label={`Remove ${s.name || 'status'}`} disabled={statuses.length <= 2}
                            onClick={() => setStatuses((rs) => rs.filter((_, j) => j !== i))}
                            className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"><Trash2 size={14} /></button>
                        </li>
                      ))}
                    </ul>
                    <button type="button" onClick={() => setStatuses((rs) => {
                      const closed = rs.findIndex((r) => r.group === 'closed');
                      const added = { key: `s${++seq}`, name: '', color: BLUE, group: 'active' as StatusGroup };
                      return closed < 0 ? [...rs, added] : [...rs.slice(0, closed), added, ...rs.slice(closed)];
                    })} className="mt-2 flex items-center gap-1 text-sm text-brand-700 hover:underline"><Plus size={14} /> Add status</button>
                    {statusProblem && <p className="mt-2 text-xs text-red-600">{statusProblem}</p>}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <span>
                <span className="block text-sm font-medium text-gray-700">Default permission</span>
                <span className="block text-xs text-gray-500">What everyone gets here unless you share more or less. Admins always have full access.</span>
              </span>
              <div ref={levelRef} className="relative shrink-0">
                <button type="button" aria-haspopup="listbox" aria-expanded={levelOpen} onClick={() => setLevelOpen((v) => !v)}
                  className={`flex items-center gap-2 whitespace-nowrap rounded-lg border bg-white py-1.5 pl-1.5 pr-2.5 text-sm font-medium text-gray-800 transition-colors ${levelOpen ? 'border-[#234788] ring-4 ring-[#234788]/10' : 'border-[#E4E8F0] hover:border-[#B9C7E2]'}`}>
                  <LevelTile Icon={current.Icon} tone={current.tone} size={22} />
                  {current.label}
                  <ChevronDown size={14} className={`text-gray-400 transition-transform ${levelOpen ? 'rotate-180' : ''}`} />
                </button>
                {levelOpen && (
                  <ul role="listbox" aria-label="Default permission"
                    className="absolute right-0 top-11 z-10 w-80 space-y-0.5 rounded-xl border border-[#D9E1EF] bg-white p-1.5 shadow-[0_18px_40px_-12px_rgba(16,24,40,0.3)]">
                    {LEVELS.map((l) => {
                      const on = l.key === level;
                      return (
                        <li key={l.key}>
                          <button type="button" role="option" aria-selected={on} onClick={() => { setLevel(l.key); setLevelOpen(false); }}
                            className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors ${on ? 'bg-[#F3F6FB]' : 'hover:bg-gray-50'}`}>
                            <LevelTile Icon={l.Icon} tone={l.tone} />
                            <span className="min-w-0 flex-1">
                              <span className={`block text-[13px] ${on ? 'font-semibold text-[#142B57]' : 'font-medium text-gray-900'}`}>{l.label}</span>
                              <span className="block text-[11.5px] leading-snug text-gray-500">{l.hint}</span>
                            </span>
                            <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${on ? 'border-[#234788]' : 'border-gray-300'}`}>
                              {on && <span className="h-2 w-2 rounded-full bg-[#234788]" />}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>

            <label className="flex items-start gap-2.5">
              <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer" />
              <span><span className="block text-sm font-medium text-gray-700">Make private</span><span className="block text-xs text-gray-500">Only you and the people you invite can open it</span></span>
            </label>

            {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          </div>

          <footer className="flex items-center justify-end gap-2 border-t border-gray-100 bg-gray-50/60 px-6 py-3">
            <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-sm text-gray-600 hover:bg-gray-200/70">Cancel</button>
            <button type="submit" disabled={busy || !name.trim()}
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">{busy ? 'Creating…' : 'Create Space'}</button>
          </footer>
        </form>
      </div>
    </Portal>
  );
};
