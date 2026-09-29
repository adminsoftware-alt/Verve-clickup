// Who can see a Space, Folder or List.
//
// One question asked two ways, because that is how people think about it: hand it to a Team, or
// hand it to named people. Either way the rule is the same -- once it belongs to someone, it is
// theirs, and it stops appearing for everyone else. Owners and admins keep seeing everything,
// because somebody has to be able to find it again.
import React, { useEffect, useMemo, useState } from 'react';
import { Check, Search, User, Users, X } from 'lucide-react';

import { useWork } from './WorkContext';
import { workApi, type LocationKind, type Sharing } from './api';
import { Avatar, Portal } from './ui';

type Tab = 'people' | 'teams';

export const ShareLocationDialog: React.FC<{
  kind: LocationKind;
  id: string;
  name: string;
  /** The Team it belongs to now, if any. */
  team: string | null;
  onClose: () => void;
  onDone: () => void;
}> = ({ kind, id, name, team, onClose, onDone }) => {
  const { members, teams } = useWork();
  const [tab, setTab] = useState<Tab>(team ? 'teams' : 'people');
  const [info, setInfo] = useState<Sharing | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [pickedTeam, setPickedTeam] = useState<string | null>(team);
  const [everyone, setEveryone] = useState(true);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const what = kind === 'space' ? 'Space' : kind === 'folder' ? 'Folder' : 'List';

  useEffect(() => {
    workApi.sharing(kind, id)
      .then((s) => {
        setInfo(s);
        setEveryone(!s.is_private);
        setPicked(s.shares.filter((x) => x.user).map((x) => x.user!.id));
      })
      .catch((e) => setError((e as Error).message));
  }, [kind, id]);

  const shown = useMemo(() => {
    const text = q.trim().toLowerCase();
    const all = members.map((m) => ({ id: m.user.id, name: m.user.display_name || m.user.email, user: m.user }));
    return text ? all.filter((p) => p.name.toLowerCase().includes(text)) : all;
  }, [members, q]);

  const toggle = (userId: string) =>
    setPicked((on) => (on.includes(userId) ? on.filter((x) => x !== userId) : [...on, userId]));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (tab === 'teams') {
        await workApi.giveToTeam(kind, id, pickedTeam);
      } else {
        // Named people means nobody else, so the location is closed at the same time as it is
        // opened to them -- otherwise "only these people" would be a label with nothing behind it.
        const had = new Set((info?.shares ?? []).filter((s) => s.user).map((s) => s.user!.id));
        const want = new Set(everyone ? [] : picked);
        for (const userId of want) if (!had.has(userId)) await workApi.share(kind, id, { user_id: userId }, 'full');
        for (const userId of had) if (!want.has(userId)) await workApi.unshare(kind, id, { user_id: userId });
        if (!!info?.is_private !== !everyone) await workApi.setPrivate(kind, id, !everyone);
        // People and Teams are two answers to one question; choosing people clears the Team.
        if (!everyone && team) await workApi.giveToTeam(kind, id, null);
      }
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const Choice: React.FC<{ on: boolean; onPick: () => void; title: string; note: string }> = ({ on, onPick, title, note }) => (
    <button
      type="button"
      onClick={onPick}
      className={`flex w-full items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left ${
        on ? 'border-teal-300 bg-teal-50/60' : 'border-gray-200 hover:bg-gray-50'}`}
    >
      <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
        on ? 'border-teal-500 bg-teal-500 text-white' : 'border-gray-300'}`}>
        {on && <Check size={10} strokeWidth={3} />}
      </span>
      <span className="min-w-0">
        <span className={`block text-sm font-medium ${on ? 'text-teal-900' : 'text-gray-800'}`}>{title}</span>
        <span className="block text-xs text-gray-500">{note}</span>
      </span>
    </button>
  );

  return (
    <Portal>
      <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/30 p-4" onMouseDown={onClose}>
        <div
          role="dialog"
          aria-label={`Share ${name}`}
          onMouseDown={(e) => e.stopPropagation()}
          className="flex max-h-[85vh] w-[30rem] max-w-full flex-col rounded-xl bg-white shadow-xl"
        >
          <header className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
            <h3 className="truncate font-semibold text-gray-900">Share “{name}”</h3>
            <button type="button" title="Close" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100"><X size={18} /></button>
          </header>

          <div className="flex gap-1 border-b border-gray-200 px-5" role="tablist" aria-label="Share with">
            {([['people', 'People', User], ['teams', 'Teams', Users]] as const).map(([key, label, Icon]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm ${
                  tab === key ? 'border-teal-500 font-semibold text-teal-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
              >
                <Icon size={14} /> {label}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {tab === 'teams' ? (
              <div className="space-y-2">
                <Choice
                  on={pickedTeam === null}
                  onPick={() => setPickedTeam(null)}
                  title="Everyone in the workspace"
                  note={`Anyone here can open this ${what}.`}
                />
                {teams.length === 0 ? (
                  <p className="px-1 py-3 text-sm text-gray-400">There are no Teams yet.</p>
                ) : teams.map((t) => (
                  <Choice
                    key={t.id}
                    on={pickedTeam === t.id}
                    onPick={() => setPickedTeam(t.id)}
                    title={t.name}
                    note={`${t.members.length} ${t.members.length === 1 ? 'person' : 'people'} — only they will see it`}
                  />
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                <Choice
                  on={everyone}
                  onPick={() => setEveryone(true)}
                  title="Everyone in the workspace"
                  note={`Anyone here can open this ${what}.`}
                />
                <Choice
                  on={!everyone}
                  onPick={() => setEveryone(false)}
                  title="Only the people I pick"
                  note="Nobody else will see it, apart from owners and admins."
                />
                {!everyone && (
                  <div className="overflow-hidden rounded-lg border border-gray-200">
                    <label className="flex items-center gap-1.5 border-b border-gray-200 bg-gray-50/70 px-2.5 py-1.5">
                      <Search size={13} className="shrink-0 text-gray-400" />
                      <input
                        autoFocus
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder="Search people…"
                        aria-label="Search people"
                        className="w-full bg-transparent text-[13px] text-gray-800 outline-none placeholder:text-gray-400"
                      />
                    </label>
                    <div className="max-h-56 overflow-y-auto py-1">
                      {shown.length === 0 && <p className="px-3 py-3 text-center text-xs text-gray-400">Nobody matches “{q}”.</p>}
                      {shown.map((p) => {
                        const on = picked.includes(p.id);
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => toggle(p.id)}
                            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                              on ? 'bg-teal-50/70 font-medium text-teal-900' : 'text-gray-700 hover:bg-gray-50'}`}
                          >
                            <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                              on ? 'border-teal-500 bg-teal-500 text-white' : 'border-gray-300'}`}>
                              {on && <Check size={10} strokeWidth={3} />}
                            </span>
                            <Avatar user={p.user} size={20} />
                            <span className="min-w-0 flex-1 truncate">{p.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          </div>

          <footer className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-3">
            <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
            <button
              type="button"
              onClick={save}
              disabled={busy || (tab === 'people' && !everyone && picked.length === 0)}
              className="rounded-md bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          </footer>
        </div>
      </div>
    </Portal>
  );
};
