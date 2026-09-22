import React, { useState } from 'react';
import { Pencil, Plus, Trash2, Users, X } from 'lucide-react';
import { useAuth } from '../components/AuthContext';
import { useWork } from './WorkContext';
import { workApi, type Role, type Team } from './api';
import { Avatar, NameDialog, Portal } from './ui';

const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', admin: 'Admin', member: 'Member', guest: 'Guest' };

export const PeoplePage: React.FC = () => {
  const { workspace, hierarchy, members, teams, refresh } = useWork();
  const { user } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [dialog, setDialog] = useState<{ mode: 'create' } | { mode: 'rename'; team: Team } | null>(null);
  const [editingMembers, setEditingMembers] = useState<Team | null>(null);

  if (!workspace || !hierarchy) return <div className="p-10 text-center text-sm text-gray-500">Loading…</div>;
  const myRole = hierarchy.role;
  const canManage = myRole === 'owner' || myRole === 'admin';
  const isOwner = myRole === 'owner';

  const run = async (action: () => Promise<unknown>) => {
    try {
      setError(null);
      await action();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // Only the owner can grant or revoke admin; nobody can create a second owner.
  const assignable: Role[] = isOwner ? ['admin', 'member', 'guest'] : ['member', 'guest'];

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <header>
        <h1 className="text-xl font-semibold text-gray-900">People &amp; Teams</h1>
        <p className="text-sm text-gray-500">
          {workspace.name} · you are {ROLE_LABEL[myRole].toLowerCase()}
          {!canManage && ' — only owners and admins can make changes here'}
        </p>
      </header>

      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Members <span className="font-normal">{members.length}</span></h2>
        {canManage && (
          <form
            className="mb-3 flex flex-wrap gap-2"
            onSubmit={(e) => { e.preventDefault(); if (email.trim()) run(() => workApi.addMember(workspace.id, email.trim(), role)).then(() => setEmail('')); }}
          >
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@verveadvisory.com"
              type="email"
              className="min-w-64 flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
            />
            <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as Role)} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm">
              {assignable.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
            <button type="submit" disabled={!email.trim()} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
              Add member
            </button>
            <p className="w-full text-xs text-gray-400">People need to sign in to Timetriq once before they can be added.</p>
          </form>
        )}
        <div className="overflow-hidden rounded-lg border border-gray-200">
          {members.map((m) => {
            const self = m.user.id === user?.uid;
            const manageable = canManage && m.role !== 'owner' && (isOwner || m.role !== 'admin');
            return (
              <div key={m.user.id} className="flex items-center gap-3 border-b border-gray-100 px-4 py-2.5 last:border-b-0">
                <Avatar user={m.user} size={30} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-gray-800">{m.user.display_name || m.user.email}{self && <span className="ml-1.5 text-xs text-gray-400">(you)</span>}</div>
                  <div className="truncate text-xs text-gray-500">{m.user.email}</div>
                </div>
                {manageable ? (
                  <select
                    aria-label={`Role for ${m.user.email}`}
                    value={m.role}
                    onChange={(e) => run(() => workApi.setMemberRole(workspace.id, m.user.id, e.target.value as Role))}
                    className="rounded-md border border-gray-200 px-2 py-1 text-sm"
                  >
                    {assignable.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                ) : (
                  <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">{ROLE_LABEL[m.role]}</span>
                )}
                {(manageable || (self && m.role !== 'owner')) && (
                  <button
                    type="button"
                    title={self ? 'Leave workspace' : 'Remove from workspace'}
                    onClick={() => window.confirm(self ? 'Leave this workspace?' : `Remove ${m.user.email} from the workspace?`) && run(() => workApi.removeMember(workspace.id, m.user.id))}
                    className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Teams <span className="font-normal">{teams.length}</span></h2>
          {canManage && (
            <button type="button" onClick={() => setDialog({ mode: 'create' })} className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">
              <Plus size={14} /> New Team
            </button>
          )}
        </div>
        <p className="mb-3 text-xs text-gray-500">Share any Space, Folder, List or task with a Team to give all its members access at once.</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {teams.map((team) => (
            <div key={team.id} className="rounded-lg border border-gray-200 p-4">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-indigo-700"><Users size={15} /></span>
                <h3 className="min-w-0 flex-1 truncate font-medium text-gray-900">{team.name}</h3>
                {canManage && (
                  <>
                    <button type="button" title={`Rename ${team.name}`} onClick={() => setDialog({ mode: 'rename', team })} className="rounded p-1 text-gray-400 hover:bg-gray-100"><Pencil size={14} /></button>
                    <button
                      type="button"
                      title={`Delete ${team.name}`}
                      onClick={() => window.confirm(`Delete the ${team.name} Team? Anything shared with it loses that access.`) && run(() => workApi.deleteTeam(team.id))}
                      className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 size={14} />
                    </button>
                  </>
                )}
              </div>
              <div className="mt-3 flex items-center gap-2">
                {team.members.length === 0 ? (
                  <span className="text-xs text-gray-400">No members yet</span>
                ) : (
                  <span className="flex -space-x-1.5">{team.members.slice(0, 8).map((u) => <Avatar key={u.id} user={u} size={24} />)}</span>
                )}
                <span className="text-xs text-gray-500">{team.members.length} member{team.members.length === 1 ? '' : 's'}</span>
                {team.lead_ids.length > 0 && (
                  <span className="truncate text-xs text-gray-500">
                    · Lead: {team.members.filter((u) => team.lead_ids.includes(u.id)).map((u) => u.display_name || u.email).join(', ')}
                  </span>
                )}
                {canManage && (
                  <button type="button" onClick={() => setEditingMembers(team)} className="ml-auto text-xs font-medium text-indigo-600 hover:underline">
                    Manage members
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {dialog && (
        <NameDialog
          title={dialog.mode === 'create' ? 'New Team' : `Rename ${dialog.team.name}`}
          initial={dialog.mode === 'rename' ? dialog.team.name : ''}
          confirmLabel={dialog.mode === 'create' ? 'Create' : 'Save'}
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            if (dialog.mode === 'create') await workApi.createTeam(workspace.id, name);
            else await workApi.renameTeam(dialog.team.id, name);
            await refresh();
          }}
        />
      )}
      {editingMembers && (
        <TeamMembersDialog
          team={editingMembers}
          onClose={() => setEditingMembers(null)}
          onSave={async (ids, leads) => { await workApi.setTeamMembers(editingMembers.id, ids, leads); await refresh(); setEditingMembers(null); }}
        />
      )}
    </div>
  );
};

const TeamMembersDialog: React.FC<{ team: Team; onClose: () => void; onSave: (ids: string[], leadIds: string[]) => Promise<void> }> = ({ team, onClose, onSave }) => {
  const { members } = useWork();
  const [selected, setSelected] = useState(() => new Set(team.members.map((m) => m.id)));
  const [leads, setLeads] = useState(() => new Set(team.lead_ids));
  const [error, setError] = useState<string | null>(null);
  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  return (
    <Portal>
      <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/30" onMouseDown={onClose}>
        <div role="dialog" aria-label={`Members of ${team.name}`} onMouseDown={(e) => e.stopPropagation()} className="flex max-h-[80vh] w-[28rem] max-w-[calc(100vw-2rem)] flex-col rounded-xl bg-white shadow-xl">
          <header className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
            <h3 className="font-semibold text-gray-900">Members of {team.name}</h3>
            <button type="button" title="Close" onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100"><X size={18} /></button>
          </header>
          <p className="px-5 pt-3 text-xs text-gray-500">Team leads manage the Team's dashboards, and can view their Team's dashboards and tracked time.</p>
          <div className="overflow-y-auto px-5 py-2">
            {members.map((m) => (
              <div key={m.user.id} className="flex items-center gap-3 py-2">
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                  <input type="checkbox" checked={selected.has(m.user.id)} onChange={() => toggle(m.user.id)} />
                  <Avatar user={m.user} size={26} />
                  <span className="min-w-0 flex-1 truncate text-sm text-gray-800">{m.user.display_name || m.user.email}</span>
                  <span className="text-xs text-gray-400">{ROLE_LABEL[m.role]}</span>
                </label>
                <label className={`flex cursor-pointer items-center gap-1 text-xs text-gray-600 ${selected.has(m.user.id) ? '' : 'invisible'}`}>
                  <input
                    type="checkbox"
                    aria-label={`${m.user.display_name || m.user.email} is a Team lead`}
                    checked={leads.has(m.user.id)}
                    onChange={() => setLeads((prev) => { const n = new Set(prev); if (n.has(m.user.id)) n.delete(m.user.id); else n.add(m.user.id); return n; })}
                  />
                  Lead
                </label>
              </div>
            ))}
          </div>
          {error && <p className="mx-5 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <footer className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3">
            <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
            <button
              type="button"
              onClick={() => onSave([...selected], [...leads].filter((id) => selected.has(id))).catch((e) => setError(e.message))}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Save members
            </button>
          </footer>
        </div>
      </div>
    </Portal>
  );
};
