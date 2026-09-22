import React, { useCallback, useEffect, useState } from 'react';
import { Lock, Trash2, Users, X } from 'lucide-react';
import { useWork } from './WorkContext';
import { workApi, type Level, type ShareKind, type Sharing } from './api';
import { Avatar, Portal } from './ui';

const LEVELS: { value: Level; label: string; hint: string }[] = [
  { value: 'view', label: 'View only', hint: 'Can see it' },
  { value: 'comment', label: 'Comment', hint: 'Can comment; assignees can change status' },
  { value: 'edit', label: 'Edit', hint: 'Can change it, but not create or delete' },
  { value: 'full', label: 'Full', hint: 'Can create, edit, share and delete' },
];
const RANK: Record<Level, number> = { view: 1, comment: 2, edit: 3, full: 4 };

export const ShareDialog: React.FC<{
  kind: ShareKind;
  id: string;
  name: string;
  onClose: () => void;
  onChanged?: () => void;
}> = ({ kind, id, name, onClose, onChanged }) => {
  const { members, teams, hierarchy } = useWork();
  const [info, setInfo] = useState<Sharing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [grantee, setGrantee] = useState('');
  const [level, setLevel] = useState<Level>('edit');

  const load = useCallback(async () => {
    try { setInfo(await workApi.sharing(kind, id)); } catch (e) { setError((e as Error).message); }
  }, [kind, id]);
  useEffect(() => { load(); }, [load]);

  const run = async (action: () => Promise<unknown>) => {
    try {
      setError(null);
      await action();
      await load();
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const target = (value: string) =>
    value.startsWith('team:') ? { team_id: value.slice(5) } : { user_id: value.slice(5) };

  const yourRank = info ? RANK[info.your_level] : 0;
  const canShare = !!info && yourRank >= RANK.edit && hierarchy?.role !== 'guest';
  const allowedLevels = LEVELS.filter((l) => RANK[l.value] <= yourRank);
  const sharedUsers = new Set(info?.shares.filter((s) => s.user).map((s) => s.user!.id));
  const sharedTeams = new Set(info?.shares.filter((s) => s.team).map((s) => s.team!.id));
  // As in ClickUp, a Space can never be shared with a guest.
  const people = members.filter((m) => !sharedUsers.has(m.user.id) && !(kind === 'space' && m.role === 'guest'));
  const openTeams = teams.filter((t) => !sharedTeams.has(t.id));

  return (
    <Portal>
      <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/30" onMouseDown={onClose}>
        <div
          role="dialog"
          aria-label={`Share ${name}`}
          onMouseDown={(e) => e.stopPropagation()}
          className="flex max-h-[85vh] w-[34rem] max-w-[calc(100vw-2rem)] flex-col rounded-xl bg-white shadow-xl"
        >
          <header className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
            <h3 className="truncate text-base font-semibold text-gray-900">Share “{name}”</h3>
            <button type="button" title="Close" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100"><X size={18} /></button>
          </header>

          {!info ? (
            <div className="p-5 text-sm text-gray-500">{error ?? 'Loading…'}</div>
          ) : (
            <div className="overflow-y-auto px-5 py-4">
              <label className={`flex items-start gap-3 rounded-lg border p-3 ${info.is_private ? 'border-amber-200 bg-amber-50' : 'border-gray-200'}`}>
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={info.is_private}
                  disabled={info.your_level !== 'full'}
                  onChange={(e) => run(() => workApi.setPrivate(kind, id, e.target.checked))}
                />
                <span className="text-sm">
                  <span className="flex items-center gap-1.5 font-medium text-gray-800"><Lock size={13} /> Private</span>
                  <span className="text-gray-500">
                    {info.is_private
                      ? 'Only the people and Teams below, and whoever created it, can see this.'
                      : 'Everyone in the workspace (except guests) can see this. Make it private to limit access.'}
                    {info.your_level !== 'full' && ' You need full access to change this.'}
                  </span>
                </span>
              </label>

              {canShare && (
                <form
                  className="mt-4 flex gap-2"
                  onSubmit={(e) => { e.preventDefault(); if (grantee) run(() => workApi.share(kind, id, target(grantee), level)).then(() => setGrantee('')); }}
                >
                  <select aria-label="Person or Team" value={grantee} onChange={(e) => setGrantee(e.target.value)} className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm">
                    <option value="">Add a person or Team…</option>
                    {openTeams.length > 0 && (
                      <optgroup label="Teams">
                        {openTeams.map((t) => <option key={t.id} value={`team:${t.id}`}>{t.name} ({t.members.length})</option>)}
                      </optgroup>
                    )}
                    {people.length > 0 && (
                      <optgroup label="People">
                        {people.map((m) => <option key={m.user.id} value={`user:${m.user.id}`}>{m.user.display_name || m.user.email}{m.role === 'guest' ? ' (guest)' : ''}</option>)}
                      </optgroup>
                    )}
                  </select>
                  <select aria-label="Access level" value={level} onChange={(e) => setLevel(e.target.value as Level)} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm">
                    {allowedLevels.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                  </select>
                  <button type="submit" disabled={!grantee} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">Share</button>
                </form>
              )}

              {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

              <h4 className="mb-1 mt-5 text-xs font-semibold uppercase tracking-wide text-gray-400">Shared with</h4>
              {info.shares.length === 0 ? (
                <p className="py-2 text-sm text-gray-400">No one has been given access directly.</p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {info.shares.map((sh) => {
                    const g = sh.team ? { team_id: sh.team.id } : { user_id: sh.user!.id };
                    const editable = canShare && RANK[sh.level] <= yourRank;
                    return (
                      <li key={sh.id} className="flex items-center gap-3 py-2">
                        {sh.team ? (
                          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-100 text-indigo-700"><Users size={14} /></span>
                        ) : (
                          <Avatar user={sh.user!} size={28} />
                        )}
                        <span className="min-w-0 flex-1 truncate text-sm text-gray-800">
                          {sh.team ? sh.team.name : sh.user!.display_name || sh.user!.email}
                          {sh.team && <span className="ml-1.5 text-xs text-gray-400">Team</span>}
                        </span>
                        <select
                          aria-label="Change access"
                          value={sh.level}
                          disabled={!editable}
                          onChange={(e) => run(() => workApi.share(kind, id, g, e.target.value as Level))}
                          className="rounded-md border border-gray-200 px-1.5 py-1 text-sm disabled:bg-gray-50"
                        >
                          {LEVELS.map((l) => <option key={l.value} value={l.value} disabled={RANK[l.value] > yourRank}>{l.label}</option>)}
                        </select>
                        {editable && (
                          <button type="button" title="Remove access" onClick={() => run(() => workApi.unshare(kind, id, g))} className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600">
                            <Trash2 size={15} />
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              <details className="mt-4 text-xs text-gray-500">
                <summary className="cursor-pointer">How access works</summary>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {LEVELS.map((l) => <li key={l.value}><b>{l.label}</b> — {l.hint}</li>)}
                  <li>Access flows down: sharing a Folder shares its Lists and tasks too.</li>
                  <li>The most specific share wins, so a List can be narrowed or opened up individually.</li>
                  <li>A person's own access beats their Team's on the same item. Guests never get a whole Space.</li>
                </ul>
              </details>
            </div>
          )}
        </div>
      </div>
    </Portal>
  );
};
