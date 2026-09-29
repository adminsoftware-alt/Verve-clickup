// Goals, as in ClickUp: goals grouped in folders, each with measurable targets. Team goals belong to a Team.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Archive, ChevronLeft, Lock, Plus, Star, Target, Trash2, X } from 'lucide-react';
import { useWork } from '../WorkContext';
import { Avatar, Portal } from '../ui';
import { useFavorites } from '../Favorites';
import { useWritableLists } from '../task/TaskActions';
import { goalsApi, type CheckIn, type Goal, type GoalTarget, type TargetInput, type TargetKind } from './goalsApi';
import { notify } from '../../components/notify';
import { ask } from '../../components/ask';

const KINDS: { kind: TargetKind; label: string }[] = [
  { kind: 'number', label: 'Number' }, { kind: 'currency', label: 'Money' }, { kind: 'true_false', label: 'Done / not done' }, { kind: 'tasks', label: 'Tasks' },
];
const money = (v: number, unit: string | null) => {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: unit || 'INR', maximumFractionDigits: 0 }).format(v); } catch { return `${unit ?? ''} ${v}`; }
};
const valueText = (t: GoalTarget, v: number) =>
  t.kind === 'currency' ? money(v, t.unit) : t.kind === 'true_false' ? (v >= 1 ? 'Done' : 'Not done') : `${v.toLocaleString()}${t.unit ? ` ${t.unit}` : ''}`;
const dateText = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

const Bar: React.FC<{ value: number; color: string }> = ({ value, color }) => (
  <div className="h-2 overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
    <div className="h-full rounded-full" style={{ width: `${value}%`, backgroundColor: color }} />
  </div>
);

const TrackBadge: React.FC<{ goal: Goal }> = ({ goal }) => (goal.on_track === null ? null : (
  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${goal.on_track ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>
    {goal.on_track ? 'On track' : 'Behind'}
  </span>
));

// --- the list --------------------------------------------------------------------------------------

export const GoalsPage: React.FC = () => {
  const { id } = useParams();
  return id ? <GoalDetail id={id} /> : <GoalList />;
};

const GoalList: React.FC = () => {
  const { workspace, teams, hierarchy } = useWork();
  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [teamFilter, setTeamFilter] = useState('');
  const [archived, setArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const load = useCallback(() => {
    if (!workspace) return;
    goalsApi.list(workspace.id, { team_id: teamFilter || undefined, include_archived: archived }).then(setGoals).catch((e) => setError(e.message));
  }, [workspace, teamFilter, archived]);
  useEffect(() => { load(); }, [load]);
  const folders = useMemo(() => {
    const m = new Map<string, Goal[]>();
    (goals ?? []).forEach((g) => m.set(g.folder || 'No folder', [...(m.get(g.folder || 'No folder') ?? []), g]));
    return [...m.entries()];
  }, [goals]);
  const guest = hierarchy?.role === 'guest' || hierarchy?.role === 'limited';
  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-gray-900"><Target size={20} className="text-brand-600" /> Goals</h1>
        <select aria-label="Team" value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} className="ml-auto rounded-md border border-gray-300 px-2 py-1 text-sm">
          <option value="">All goals</option>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name} team goals</option>)}
        </select>
        <label className="flex items-center gap-1 text-sm text-gray-600"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Archived</label>
        {!guest && <button type="button" onClick={() => setCreating(true)} className="flex items-center gap-1 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"><Plus size={14} /> New goal</button>}
      </div>
      {error && <p className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {goals && goals.length === 0 && (
        <div className="mt-16 text-center text-sm text-gray-500">
          <Target size={32} className="mx-auto text-gray-300" />
          <p className="mt-2">Set goals with measurable targets — clients won, fees billed, filings done on time — and watch progress update as work gets done.</p>
        </div>
      )}
      {folders.map(([folder, list]) => (
        <section key={folder} className="mt-6" aria-label={folder}>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">{folder}</h2>
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
            {list.map((g) => (
              <li key={g.id}>
                <button type="button" onClick={() => navigate(`/goals/${g.id}`)} className="grid w-full grid-cols-[1fr_12rem_7rem] items-center gap-4 px-4 py-3 text-left hover:bg-gray-50">
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 font-medium text-gray-900">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: g.color }} /> <span className="truncate">{g.name}</span>
                      {g.is_private && <Lock size={12} className="text-gray-400" />}
                      {g.archived && <Archive size={12} className="text-gray-400" />}
                    </span>
                    <span className="mt-0.5 block text-xs text-gray-500">
                      {g.team ? `${g.team.name} · ` : ''}{g.targets.length} target{g.targets.length === 1 ? '' : 's'}{g.due_date ? ` · due ${dateText(g.due_date)}` : ''}
                    </span>
                  </span>
                  <span className="flex items-center gap-2"><span className="flex-1"><Bar value={g.progress} color={g.color} /></span><span className="w-10 text-right text-sm text-gray-700">{Math.round(g.progress)}%</span></span>
                  <span className="flex justify-end"><TrackBadge goal={g} /></span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {creating && <GoalDialog onClose={() => setCreating(false)} onSaved={(g) => { setCreating(false); navigate(`/goals/${g.id}`); }} />}
    </div>
  );
};

// --- creating ---------------------------------------------------------------------------------------

const TargetFields: React.FC<{ value: TargetInput; onChange: (t: TargetInput) => void }> = ({ value: t, onChange }) => {
  const lists = useWritableLists();
  const input = 'rounded border border-gray-300 px-2 py-1 text-sm';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input aria-label="Target name" placeholder="e.g. New clients signed" value={t.name} onChange={(e) => onChange({ ...t, name: e.target.value })} className={`${input} min-w-[12rem] flex-1`} />
      <select aria-label="Target type" value={t.kind} onChange={(e) => onChange({ ...t, kind: e.target.value as TargetKind })} className={input}>
        {KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
      </select>
      {(t.kind === 'number' || t.kind === 'currency') && (
        <>
          <input aria-label="From" type="number" value={t.start_value ?? 0} onChange={(e) => onChange({ ...t, start_value: Number(e.target.value) })} className={`${input} w-24`} />
          <span className="text-xs text-gray-400">→</span>
          <input aria-label="Target" type="number" value={t.target_value ?? ''} onChange={(e) => onChange({ ...t, target_value: Number(e.target.value) })} className={`${input} w-28`} />
          <input aria-label="Unit" placeholder={t.kind === 'currency' ? 'INR' : 'unit'} value={t.unit ?? ''} onChange={(e) => onChange({ ...t, unit: e.target.value || null })} className={`${input} w-20`} />
        </>
      )}
      {t.kind === 'tasks' && (
        <select aria-label="Tasks in List" value={t.list_ids?.[0] ?? ''} onChange={(e) => onChange({ ...t, list_ids: e.target.value ? [e.target.value] : [] })} className={input}>
          <option value="">Finish every task in…</option>
          {lists.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
      )}
    </div>
  );
};

const blankTarget = (): TargetInput => ({ name: '', kind: 'number', start_value: 0, target_value: 10 });

const GoalDialog: React.FC<{ goal?: Goal; onClose: () => void; onSaved: (g: Goal) => void }> = ({ goal, onClose, onSaved }) => {
  const { workspace, teams, members } = useWork();
  const [name, setName] = useState(goal?.name ?? '');
  const [description, setDescription] = useState(goal?.description ?? '');
  const [folder, setFolder] = useState(goal?.folder ?? '');
  const [teamId, setTeamId] = useState(goal?.team?.id ?? '');
  const [owners, setOwners] = useState<string[]>(goal?.owners.map((o) => o.id) ?? []);
  const [due, setDue] = useState(goal?.due_date?.slice(0, 10) ?? '');
  const [color, setColor] = useState(goal?.color ?? '#6366f1');
  const [isPrivate, setIsPrivate] = useState(goal?.is_private ?? false);
  const [targets, setTargets] = useState<TargetInput[]>(goal ? [] : [blankTarget()]);
  const [error, setError] = useState<string | null>(null);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspace) return;
    setError(null);
    const body = {
      name: name.trim(), description: description.trim() || null, folder: folder.trim() || null, team_id: teamId || null, color,
      owner_ids: owners.length ? owners : undefined, due_date: due ? new Date(`${due}T23:59:00`).toISOString() : null, is_private: isPrivate,
    };
    try {
      onSaved(goal ? await goalsApi.update(goal.id, body) : await goalsApi.create(workspace.id, { ...body, targets: targets.filter((t) => t.name.trim()) }));
    } catch (err) { setError((err as Error).message); }
  };
  const input = 'mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm font-normal';
  return (
    <Portal>
      <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/30" onMouseDown={onClose}>
        <form role="dialog" aria-label={goal ? 'Edit goal' : 'New goal'} onSubmit={save} onMouseDown={(e) => e.stopPropagation()}
          className="flex max-h-[90vh] w-[40rem] max-w-[calc(100vw-2rem)] flex-col gap-3 overflow-auto rounded-xl bg-white p-5 shadow-xl">
          <div className="flex items-center justify-between"><h3 className="font-semibold text-gray-900">{goal ? 'Edit goal' : 'New goal'}</h3>
            <button type="button" title="Close" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100"><X size={16} /></button></div>
          <label className="text-xs font-medium text-gray-600">Goal<input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={input} placeholder="e.g. Grow the practice" /></label>
          <label className="text-xs font-medium text-gray-600">Why it matters<textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} className={input} /></label>
          <div className="grid grid-cols-3 gap-3">
            <label className="text-xs font-medium text-gray-600">Folder<input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="FY 2026-27" className={input} /></label>
            <label className="text-xs font-medium text-gray-600">Team goal for<select aria-label="Team" value={teamId} onChange={(e) => setTeamId(e.target.value)} className={input}>
              <option value="">No Team</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
            <label className="text-xs font-medium text-gray-600">Due<input type="date" aria-label="Due" value={due} onChange={(e) => setDue(e.target.value)} className={input} /></label>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-600">Owners</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {members.map((m) => {
                const on = owners.includes(m.user.id);
                return (
                  <button key={m.user.id} type="button" aria-pressed={on} onClick={() => setOwners(on ? owners.filter((x) => x !== m.user.id) : [...owners, m.user.id])}
                    className={`flex items-center gap-1 rounded-full border py-0.5 pl-0.5 pr-2 text-xs ${on ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-gray-200 text-gray-500'}`}>
                    <Avatar user={m.user} size={18} /> {m.user.display_name || m.user.email}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <label className="flex items-center gap-1.5">Colour <input type="color" aria-label="Colour" value={color} onChange={(e) => setColor(e.target.value)} /></label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} /> <Lock size={12} /> Private (owners, its Team and admins)</label>
          </div>
          {!goal && (
            <section aria-label="Targets">
              <p className="text-xs font-medium text-gray-600">Targets</p>
              <ul className="mt-1 space-y-2">
                {targets.map((t, i) => (
                  <li key={i} className="flex items-start gap-1">
                    <div className="flex-1"><TargetFields value={t} onChange={(next) => setTargets(targets.map((x, j) => (j === i ? next : x)))} /></div>
                    {targets.length > 1 && <button type="button" aria-label="Remove target" onClick={() => setTargets(targets.filter((_, j) => j !== i))} className="p-1 text-gray-400 hover:text-red-600"><X size={14} /></button>}
                  </li>
                ))}
              </ul>
              <button type="button" onClick={() => setTargets([...targets, blankTarget()])} className="mt-2 flex items-center gap-1 text-xs text-brand-600 hover:underline"><Plus size={12} /> Add target</button>
            </section>
          )}
          {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
            <button type="submit" disabled={!name.trim()} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">{goal ? 'Save' : 'Create goal'}</button>
          </div>
        </form>
      </div>
    </Portal>
  );
};

// --- one goal ----------------------------------------------------------------------------------------

const TargetRow: React.FC<{ target: GoalTarget; color: string; canEdit: boolean; onChanged: (g: Goal) => void }> = ({ target: t, color, canEdit, onChanged }) => {
  const [value, setValue] = useState(String(t.current_value));
  const [note, setNote] = useState('');
  const [history, setHistory] = useState<CheckIn[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setValue(String(t.current_value)); }, [t.current_value]);
  const run = async (fn: () => Promise<Goal>) => {
    setError(null);
    try { onChanged(await fn()); setNote(''); if (history) setHistory(await goalsApi.checkIns(t.id)); } catch (e) { setError((e as Error).message); }
  };
  return (
    <li className="rounded-lg border border-gray-200 p-3" aria-label={t.name}>
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 truncate font-medium text-gray-800">{t.name}</span>
        {t.owner && <Avatar user={t.owner} size={20} />}
        <span className="w-14 text-right text-sm text-gray-700">{Math.round(t.progress)}%</span>
        {canEdit && <button type="button" aria-label={`Remove ${t.name}`} onClick={async () => { if (await ask.confirm({ danger: true, title: `Remove the target “${t.name}”?` })) run(() => goalsApi.removeTarget(t.id)); }} className="text-gray-300 hover:text-red-600"><Trash2 size={13} /></button>}
      </div>
      <div className="mt-2"><Bar value={t.progress} color={color} /></div>
      <p className="mt-1 text-xs text-gray-500">
        {t.kind === 'tasks' ? `${t.done_tasks} of ${t.total_tasks} tasks done` : t.kind === 'true_false' ? valueText(t, t.current_value)
          : `${valueText(t, t.current_value)} of ${valueText(t, t.target_value)} (from ${valueText(t, t.start_value)})`}
      </p>
      {t.kind !== 'tasks' && canEdit && (
        <form className="mt-2 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); run(() => goalsApi.checkIn(t.id, Number(value), note)); }}>
          {t.kind === 'true_false' ? (
            <button type="button" onClick={() => run(() => goalsApi.checkIn(t.id, t.current_value >= 1 ? 0 : 1, note))} className="rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50">
              {t.current_value >= 1 ? 'Mark not done' : 'Mark done'}
            </button>
          ) : (
            <>
              <input aria-label={`New value for ${t.name}`} type="number" value={value} onChange={(e) => setValue(e.target.value)} className="w-28 rounded border border-gray-300 px-2 py-1 text-sm" />
              <input aria-label="Note" placeholder="What changed? (optional)" value={note} onChange={(e) => setNote(e.target.value)} className="min-w-[10rem] flex-1 rounded border border-gray-300 px-2 py-1 text-sm" />
              <button type="submit" className="rounded-md bg-brand-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-700">Update</button>
            </>
          )}
        </form>
      )}
      {t.kind !== 'tasks' && (
        <button type="button" onClick={async () => setHistory(history ? null : await goalsApi.checkIns(t.id))} className="mt-2 text-xs text-brand-600 hover:underline">
          {history ? 'Hide history' : 'History'}
        </button>
      )}
      {history && (
        <ul className="mt-1 space-y-0.5 text-xs text-gray-600" aria-label="History">
          {history.length === 0 && <li className="text-gray-400">No updates yet.</li>}
          {history.map((h) => (
            <li key={h.id}>{new Date(h.created_at).toLocaleDateString()} · {h.user?.display_name || h.user?.email}: <b>{valueText(t, h.value)}</b>{h.note ? ` — ${h.note}` : ''}</li>
          ))}
        </ul>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </li>
  );
};

const GoalDetail: React.FC<{ id: string }> = ({ id }) => {
  const [goal, setGoal] = useState<Goal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState<TargetInput | null>(null);
  const favorites = useFavorites();
  const navigate = useNavigate();
  useEffect(() => { goalsApi.get(id).then(setGoal).catch((e) => setError(e.message)); }, [id]);
  if (!goal) return <p className="p-10 text-center text-sm text-gray-400">{error ?? 'Loading…'}</p>;
  const fav = favorites.isFavorite('goal', goal.id);
  return (
    <div className="mx-auto max-w-4xl p-6">
      <Link to="/goals" className="flex items-center gap-1 text-sm text-gray-500 no-underline hover:text-gray-800"><ChevronLeft size={14} /> Goals</Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <span className="h-3.5 w-3.5 rounded-full" style={{ backgroundColor: goal.color }} />
        <h1 className="text-2xl font-semibold text-gray-900">{goal.name}</h1>
        {goal.is_private && <Lock size={14} className="text-gray-400" />}
        <button type="button" title={fav ? 'Remove from Favourites' : 'Add to Favourites'} onClick={() => favorites.toggle('goal', goal.id)} className={fav ? 'text-amber-500' : 'text-gray-300 hover:text-amber-500'}><Star size={16} fill={fav ? 'currentColor' : 'none'} /></button>
        <TrackBadge goal={goal} />
        {goal.can_edit && (
          <span className="ml-auto flex gap-2">
            <button type="button" onClick={() => setEditing(true)} className="rounded-md border border-gray-300 px-2.5 py-1 text-sm hover:bg-gray-50">Edit</button>
            <button type="button" onClick={async () => setGoal(await goalsApi.update(goal.id, { archived: !goal.archived }))} className="rounded-md border border-gray-300 px-2.5 py-1 text-sm hover:bg-gray-50">{goal.archived ? 'Restore' : 'Archive'}</button>
            <button type="button" onClick={async () => { if (await ask.confirm({ danger: true, title: `Delete the goal “${goal.name}”?` })) { await goalsApi.remove(goal.id).catch((e) => notify.error(e)); navigate('/goals'); } }}
              className="rounded-md border border-red-200 px-2.5 py-1 text-sm text-red-600 hover:bg-red-50">Delete</button>
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-gray-500">
        {goal.team ? `${goal.team.name} team goal · ` : ''}{goal.folder ? `${goal.folder} · ` : ''}{goal.due_date ? `Due ${dateText(goal.due_date)}` : 'No due date'}
      </p>
      {goal.description && <p className="mt-3 whitespace-pre-wrap text-sm text-gray-700">{goal.description}</p>}
      <div className="mt-4 flex items-center gap-3">
        <div className="flex-1"><Bar value={goal.progress} color={goal.color} /></div>
        <span className="text-lg font-semibold text-gray-900" aria-label="Goal progress">{Math.round(goal.progress)}%</span>
      </div>
      <div className="mt-2 flex items-center gap-1 text-xs text-gray-500">Owners: {goal.owners.map((o) => <Avatar key={o.id} user={o} size={20} />)}</div>
      <h2 className="mt-6 text-sm font-semibold text-gray-700">Targets</h2>
      <ul className="mt-2 space-y-2">
        {goal.targets.map((t) => <TargetRow key={t.id} target={t} color={goal.color} canEdit={goal.can_edit} onChanged={setGoal} />)}
      </ul>
      {goal.can_edit && (adding ? (
        <form className="mt-3 rounded-lg border border-dashed border-brand-200 p-3" aria-label="New target"
          onSubmit={async (e) => { e.preventDefault(); try { setGoal(await goalsApi.addTarget(goal.id, adding)); setAdding(null); } catch (err) { notify.error(err); } }}>
          <TargetFields value={adding} onChange={setAdding} />
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => setAdding(null)} className="text-sm text-gray-500">Cancel</button>
            <button type="submit" disabled={!adding.name.trim()} className="rounded-md bg-brand-600 px-2.5 py-1 text-sm font-medium text-white disabled:opacity-50">Add target</button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setAdding(blankTarget())} className="mt-3 flex items-center gap-1 text-sm text-brand-600 hover:underline"><Plus size={14} /> Add target</button>
      ))}
      {editing && <GoalDialog goal={goal} onClose={() => setEditing(false)} onSaved={(g) => { setGoal(g); setEditing(false); }} />}
    </div>
  );
};
