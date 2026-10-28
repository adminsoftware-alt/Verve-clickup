// ClickUp's Create a Space, in its two steps.
//
// 1. "Create a Space": icon and colour, name, description, the default permission members get,
//    and Make Private. "Use Templates" leaves for the Template Center instead.
// 2. "Define your workflow": a starting point (Starter, Marketing Teams, Project Management,
//    Product + Engineering), then its defaults -- the views the Space and its Folders open with, the statuses,
//    and the ClickApps -- each one changeable before the Space is made.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Blocks, Check, ChevronDown, ChevronRight, CircleDot, Info, Layers, Plus, Trash2, X } from 'lucide-react';
import { workApi, type StatusGroup, type ViewType } from './api';
import { spacesApi, type ClickAppInfo } from './spacesApi';
import { Portal } from './ui';
import { useIsAdmin } from './WorkContext';

type Level = 'full' | 'edit' | 'comment' | 'view';
interface StatusRow { key: string; name: string; color: string; group: StatusGroup }
interface Preset { key: string; name: string; blurb: string; views: ViewType[]; statuses: [string, string, StatusGroup][]; clickapps: Record<string, boolean> }

const COLORS = ['#7c3aed', '#4f46e5', '#0ea5e9', '#0d9488', '#16a34a', '#f59e0b', '#ea580c', '#db2777', '#dc2626', '#64748b'];

const LEVELS: { key: Level; label: string; hint: string }[] = [
  { key: 'full', label: 'Full edit', hint: 'Can create and edit everything in this Space. Owners and admins can manage Space settings.' },
  { key: 'edit', label: 'Edit', hint: 'Can create and edit everything in this Space. Can’t manage Space settings or delete anything.' },
  { key: 'comment', label: 'Comment', hint: 'Can comment on everything in this Space. Can’t manage Space settings or edit anything.' },
  { key: 'view', label: 'View only', hint: 'Read-only. Can’t edit or comment in this Space.' },
];

// Views a new List can start with. The List view is always there; the Overview is the Space's own.
const VIEW_CHOICES: { type: ViewType; label: string }[] = [
  { type: 'board', label: 'Board' }, { type: 'calendar', label: 'Calendar' }, { type: 'table', label: 'Table' },
  { type: 'gantt', label: 'Gantt' }, { type: 'timeline', label: 'Timeline' }, { type: 'workload', label: 'Workload' },
  { type: 'team', label: 'Team' }, { type: 'activity', label: 'Activity' },
];
const VIEW_LABEL: Record<string, string> = Object.fromEntries([['list', 'List'], ...VIEW_CHOICES.map((v) => [v.type, v.label])]);

const GREY = '#87909e', BLUE = '#5b9fef', PURPLE = '#5f55ee', ORANGE = '#e16b16', RED = '#d33d44', YELLOW = '#f8ae00', GREEN = '#008844';
const PRESETS: Preset[] = [
  { key: 'starter', name: 'Starter', blurb: 'For everyday tasks', views: ['board'], clickapps: {},
    statuses: [['To do', GREY, 'not_started'], ['In progress', PURPLE, 'active'], ['Complete', GREEN, 'closed']] },
  { key: 'marketing', name: 'Marketing Teams', blurb: 'Run effective campaigns', views: ['board', 'calendar'], clickapps: {},
    statuses: [['To do', GREY, 'not_started'], ['Planning', BLUE, 'active'], ['In progress', PURPLE, 'active'], ['Review', YELLOW, 'done'], ['Complete', GREEN, 'closed']] },
  { key: 'pm', name: 'Project Management', blurb: 'Plan, manage, and execute projects', views: ['board', 'gantt', 'workload'], clickapps: {},
    statuses: [['To do', GREY, 'not_started'], ['Planning', BLUE, 'active'], ['In progress', PURPLE, 'active'], ['At risk', RED, 'active'],
      ['On hold', ORANGE, 'active'], ['Complete', GREEN, 'closed']] },
  { key: 'product', name: 'Product + Engineering', blurb: 'Streamline your product lifecycle', views: ['board', 'timeline'], clickapps: { sprint_points: true },
    statuses: [['Backlog', GREY, 'not_started'], ['Scoping', BLUE, 'active'], ['In development', PURPLE, 'active'], ['In review', YELLOW, 'active'],
      ['Testing', ORANGE, 'done'], ['Shipped', GREEN, 'closed']] },
];
const GROUP_LABEL: Record<StatusGroup, string> = { not_started: 'Not started', active: 'Active', done: 'Done', closed: 'Closed' };

let seq = 0;
const rowsOf = (p: Preset): StatusRow[] => p.statuses.map(([name, color, group]) => ({ key: `s${++seq}`, name, color, group }));

const Shell: React.FC<{ label: string; onClose: () => void; children: React.ReactNode; width?: string }> = ({ label, onClose, children, width = 'w-[34rem]' }) => (
  <Portal>
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <div role="dialog" aria-label={label} onMouseDown={(e) => e.stopPropagation()}
        className={`${width} flex max-h-[90vh] max-w-full flex-col overflow-hidden rounded-2xl bg-white shadow-2xl`}>
        {children}
      </div>
    </div>
  </Portal>
);

const CloseButton: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <button type="button" aria-label="Close" onClick={onClose} className="rounded-full bg-gray-100 p-1.5 text-gray-500 hover:bg-gray-200"><X size={16} /></button>
);

const Toggle: React.FC<{ on: boolean; onChange: (v: boolean) => void; label: string }> = ({ on, onChange, label }) => (
  <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
    className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? 'bg-brand-600' : 'bg-gray-300'}`}>
    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : 'translate-x-0.5'}`} />
  </button>
);

export const CreateSpaceDialog: React.FC<{
  workspaceId: string;
  onClose: () => void;
  onCreated: (id: string) => void;
  onUseTemplates: () => void;
}> = ({ workspaceId, onClose, onCreated, onUseTemplates }) => {
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const [icon, setIcon] = useState('');
  // An admin's own picture for the Space: kept here and uploaded once the Space exists.
  const isAdmin = useIsAdmin();
  const [picture, setPicture] = useState<File | null>(null);
  const pictureUrl = useMemo(() => (picture ? URL.createObjectURL(picture) : null), [picture]);
  useEffect(() => () => { if (pictureUrl) URL.revokeObjectURL(pictureUrl); }, [pictureUrl]);
  const [picking, setPicking] = useState(false);
  const [level, setLevel] = useState<Level>('full');
  const [levelOpen, setLevelOpen] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [preset, setPreset] = useState<Preset>(PRESETS[0]);
  const [views, setViews] = useState<ViewType[]>(PRESETS[0].views);
  const [statuses, setStatuses] = useState<StatusRow[]>(() => rowsOf(PRESETS[0]));
  const [catalogue, setCatalogue] = useState<ClickAppInfo[]>([]);
  const [apps, setApps] = useState<Record<string, boolean>>({});
  const [open, setOpen] = useState<'views' | 'statuses' | 'clickapps' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameInput = useRef<HTMLInputElement>(null);

  useEffect(() => { nameInput.current?.focus(); }, []);
  useEffect(() => {
    spacesApi.clickapps().then((cat) => { setCatalogue(cat); setApps(Object.fromEntries(cat.map((c) => [c.name, c.default]))); }).catch(() => setCatalogue([]));
  }, []);

  const choose = (p: Preset) => {
    setPreset(p);
    setViews(p.views);
    setStatuses(rowsOf(p));
    setApps(Object.fromEntries(catalogue.map((c) => [c.name, p.clickapps[c.name] ?? c.default])));
  };

  const statusProblem = useMemo(() => {
    const names = statuses.map((s) => s.name.trim().toLowerCase());
    if (names.some((n) => !n)) return 'Every status needs a name.';
    if (new Set(names).size !== names.length) return 'Two statuses have the same name.';
    if (statuses.filter((s) => s.group === 'closed').length !== 1) return 'Exactly one status must be Closed — the final one.';
    if (!statuses.some((s) => s.group === 'not_started' || s.group === 'active')) return 'Add at least one Not started or Active status.';
    return null;
  }, [statuses]);

  const create = async () => {
    if (statusProblem) { setOpen('statuses'); setError(statusProblem); return; }
    setBusy(true);
    setError(null);
    try {
      const made = await workApi.createSpace(workspaceId, {
        name: name.trim(), description: description.trim() || undefined, color, icon: icon.trim() || undefined, is_private: isPrivate,
        default_permission: level === 'full' ? undefined : level,
        statuses: statuses.map(({ name: n, color: c, group }) => ({ name: n.trim(), color: c, group })),
        views, clickapps: apps,
      });
      if (picture) {
        // The Space is made either way; a picture that fails can be added again from its settings.
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

  if (step === 1) {
    const current = LEVELS.find((l) => l.key === level)!;
    return (
      <Shell label="Create a Space" onClose={onClose}>
        <div className="flex items-start justify-between gap-3 px-6 pt-6">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Create a Space</h2>
            <p className="mt-1 text-sm text-gray-500">A Space represents teams, departments, or groups, each with its own Lists, workflows, and settings.</p>
          </div>
          <CloseButton onClose={onClose} />
        </div>
        <div className="space-y-5 overflow-y-auto px-6 py-5">
          <div>
            <label htmlFor="space-name" className="mb-1.5 block text-sm text-gray-600">Icon &amp; name</label>
            <div className="flex items-center gap-2">
              <div className="relative">
                <button type="button" aria-label="Choose icon and colour" onClick={() => setPicking((v) => !v)} className="rounded-lg ring-offset-2 hover:ring-2 hover:ring-gray-200">{badge}</button>
                {picking && (
                  <div className="absolute left-0 top-12 z-10 w-60 rounded-xl border border-gray-200 bg-white p-3 shadow-lg">
                    <p className="mb-2 text-xs font-medium text-gray-500">Colour</p>
                    <div className="grid grid-cols-5 gap-2">
                      {COLORS.map((c) => (
                        <button key={c} type="button" aria-label={`Colour ${c}`} onClick={() => setColor(c)}
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
                          <label className="cursor-pointer rounded-md border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50">
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
                  </div>
                )}
              </div>
              <input id="space-name" ref={nameInput} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Marketing, Engineering, HR"
                onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) setStep(2); }}
                className="h-10 flex-1 rounded-lg border border-gray-300 px-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100" />
            </div>
          </div>
          <div>
            <label htmlFor="space-description" className="mb-1.5 block text-sm text-gray-600">Description <span className="text-gray-400">(optional)</span></label>
            <textarea id="space-description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)}
              className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100" />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-sm text-gray-800">
              Default permission
              <span title="What everyone in the workspace gets in this Space, unless you share more or less with them. Admins always have full access."><Info size={14} className="text-gray-400" /></span>
            </span>
            <div className="relative">
              <button type="button" aria-haspopup="listbox" aria-expanded={levelOpen} onClick={() => setLevelOpen((v) => !v)}
                className="flex items-center gap-1 rounded-md border border-gray-200 px-2.5 py-1 text-sm text-gray-700 hover:bg-gray-50">
                {current.label} <ChevronDown size={14} />
              </button>
              {levelOpen && (
                <ul role="listbox" aria-label="Default permission" className="absolute right-0 top-9 z-10 w-72 rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
                  {LEVELS.map((l) => (
                    <li key={l.key}>
                      <button type="button" role="option" aria-selected={l.key === level} onClick={() => { setLevel(l.key); setLevelOpen(false); }}
                        className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-gray-50">
                        <span className="flex-1"><span className="block text-sm font-medium text-gray-900">{l.label}</span><span className="block text-xs text-gray-500">{l.hint}</span></span>
                        {l.key === level && <Check size={15} className="mt-0.5 text-brand-600" />}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span><span className="block text-sm text-gray-800">Make Private</span><span className="block text-xs text-gray-500">Only you and invited members have access</span></span>
            <Toggle on={isPrivate} onChange={setIsPrivate} label="Make Private" />
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50/60 px-6 py-4">
          <button type="button" onClick={onUseTemplates} className="text-sm text-gray-600 hover:text-gray-900">Use Templates</button>
          <button type="button" disabled={!name.trim()} onClick={() => setStep(2)}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">Continue</button>
        </div>
      </Shell>
    );
  }

  const row = (key: 'views' | 'statuses' | 'clickapps', icon: React.ReactNode, title: string, summary: React.ReactNode, help: string, body: React.ReactNode) => (
    <div className="rounded-xl border border-gray-200">
      <button type="button" aria-expanded={open === key} onClick={() => setOpen(open === key ? null : key)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-600">{icon}</span>
        <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-gray-900">{title}</span><span className="block truncate text-xs text-gray-500">{summary}</span></span>
        <span title={help}><Info size={14} className="text-gray-400" /></span>
        <ChevronRight size={16} className={`text-gray-400 transition-transform ${open === key ? 'rotate-90' : ''}`} />
      </button>
      {open === key && <div className="border-t border-gray-100 px-4 py-3">{body}</div>}
    </div>
  );

  const onApps = catalogue.filter((c) => apps[c.name]).map((c) => c.label);

  return (
    <Shell label="Define your workflow" onClose={onClose} width="w-[44rem]">
      <div className="flex items-start justify-between gap-3 px-6 pt-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Define your workflow</h2>
          <p className="mt-1 text-sm text-gray-500">Choose a pre-configured solution or customise it: the Space’s views, task statuses, and ClickApps.</p>
        </div>
        <CloseButton onClose={onClose} />
      </div>
      <div className="min-h-0 space-y-5 overflow-y-auto px-6 py-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Workflow">
          {PRESETS.map((p) => (
            <button key={p.key} type="button" role="radio" aria-checked={p.key === preset.key} onClick={() => choose(p)}
              className={`rounded-xl border px-4 py-3 text-left transition-colors ${p.key === preset.key ? 'border-brand-500 bg-brand-50/60 ring-1 ring-brand-500' : 'border-gray-200 hover:border-gray-300'}`}>
              <span className="block text-sm font-medium text-gray-900">{p.name}</span>
              <span className="block text-xs text-gray-500">{p.blurb}</span>
            </button>
          ))}
        </div>
        <div className="border-t border-gray-100 pt-4">
          <p className="mb-3 text-sm text-gray-600">Customise defaults for <span className="font-semibold text-gray-900">{preset.name}</span></p>
          <div className="space-y-3">
            {row('views', <Layers size={18} />, 'Default views', ['list', ...views].map((v) => VIEW_LABEL[v]).join(', '),
              'The views this Space and its Folders open with. Lists always show just their List view.',
              <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                <label className="flex items-center gap-2 rounded px-1 py-1 text-sm text-gray-500"><input type="checkbox" checked disabled /> List</label>
                {VIEW_CHOICES.map((v) => (
                  <label key={v.type} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-gray-50">
                    <input type="checkbox" checked={views.includes(v.type)}
                      onChange={(e) => setViews((vs) => (e.target.checked ? [...vs, v.type] : vs.filter((x) => x !== v.type)))} />
                    {v.label}
                  </label>
                ))}
              </div>)}
            {row('statuses', <CircleDot size={18} />,
              'Task statuses',
              <span className="flex flex-wrap items-center gap-1">
                {statuses.map((s, i) => (
                  <React.Fragment key={s.key}>
                    {i > 0 && <span className="text-gray-300">→</span>}
                    <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />{s.name.toUpperCase()}</span>
                  </React.Fragment>
                ))}
              </span>,
              'The steps a task moves through. Exactly one is Closed: the final status.',
              <div>
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
              </div>)}
            {row('clickapps', <Blocks size={18} />, 'ClickApps', onApps.length ? onApps.join(', ') : 'None',
              'Optional features switched on for everything in this Space. You can change them later from the Space’s menu.',
              <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                {catalogue.map((c) => (
                  <li key={c.name} className="flex items-center justify-between gap-2 rounded px-1 py-1 text-sm">
                    {c.label}
                    <Toggle on={!!apps[c.name]} onChange={(v) => setApps((a) => ({ ...a, [c.name]: v }))} label={c.label} />
                  </li>
                ))}
              </ul>)}
          </div>
        </div>
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </div>
      <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50/60 px-6 py-4">
        <button type="button" onClick={() => { setError(null); setStep(1); }} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Back</button>
        <button type="button" disabled={busy} onClick={create}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">{busy ? 'Creating…' : 'Create Space'}</button>
      </div>
    </Shell>
  );
};
