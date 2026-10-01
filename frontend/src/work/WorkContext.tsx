import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../components/AuthContext';
import { ApiError, workApi, type FolderNode, type Hierarchy, type ListNode, type LocationKind, type Member, type SpaceNode, type TaskType, type Team, type Workspace } from './api';

const STORAGE_KEY = 'timetriq.workspaceId';

export interface Crumb { kind: LocationKind; id: string; name: string }
export interface LocatedNode {
  kind: LocationKind;
  node: SpaceNode | FolderNode | ListNode;
  path: Crumb[]; // from the Space down to this node
}

interface WorkContextValue {
  /** Your user id in Verve Workflow. Usually your sign-in id, but not if an admin added you before you first signed in. */
  me: string;
  workspace: Workspace | null;
  hierarchy: Hierarchy | null;
  /** Active members: the people to assign, share with and pick. */
  members: Member[];
  /** Everyone, including people whose access was turned off (for names in history). */
  allMembers: Member[];
  teams: Team[];
  taskTypes: TaskType[];
  loading: boolean;
  error: string | null;
  needsWorkspace: boolean;
  refresh: () => Promise<void>;
  createWorkspace: (name: string) => Promise<void>;
  locate: (kind: LocationKind, id: string) => LocatedNode | null;
  listName: (listId: string) => string | null;
}

const WorkContext = createContext<WorkContextValue | null>(null);

/** Your user id in Verve Workflow (see WorkContextValue.me). */
export const useMe = () => useWork().me;

/** Owner or admin. */
export const useIsAdmin = () => {
  const { hierarchy } = useWork();
  return hierarchy?.role === 'owner' || hierarchy?.role === 'admin';
};

/**
 * An admin, or somebody who leads a Team.
 *
 * The same test the server applies (permissions.is_manager) and the same one the Spaces menu
 * uses, in one place so the answer cannot differ between two screens.
 */
export const useIsManager = () => {
  const { hierarchy, teams, me } = useWork();
  const isAdmin = hierarchy?.role === 'owner' || hierarchy?.role === 'admin';
  return isAdmin || teams.some((t) => t.lead_ids.includes(me));
};

export const useWork = () => {
  const ctx = useContext(WorkContext);
  if (!ctx) throw new Error('useWork must be used inside WorkProvider');
  return ctx;
};

function indexHierarchy(h: Hierarchy | null): Map<string, LocatedNode> {
  const index = new Map<string, LocatedNode>();
  if (!h) return index;
  const addList = (lst: ListNode, parent: Crumb[]) =>
    index.set(`list:${lst.id}`, { kind: 'list', node: lst, path: [...parent, { kind: 'list', id: lst.id, name: lst.name }] });
  const addFolder = (folder: FolderNode, parent: Crumb[]) => {
    const path = [...parent, { kind: 'folder' as const, id: folder.id, name: folder.name }];
    index.set(`folder:${folder.id}`, { kind: 'folder', node: folder, path });
    folder.folders.forEach((f) => addFolder(f, path));
    folder.lists.forEach((l) => addList(l, path));
  };
  h.spaces.forEach((space) => {
    const path = [{ kind: 'space' as const, id: space.id, name: space.name }];
    index.set(`space:${space.id}`, { kind: 'space', node: space, path });
    space.folders.forEach((f) => addFolder(f, path));
    space.lists.forEach((l) => addList(l, path));
  });
  h.shared_with_me.folders.forEach((f) => addFolder(f, []));
  h.shared_with_me.lists.forEach((l) => addList(l, []));
  if (h.personal_list) addList(h.personal_list, []);
  return index;
}

export const WorkProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [hierarchy, setHierarchy] = useState<Hierarchy | null>(null);
  const [allMembers, setMembers] = useState<Member[]>([]);
  const members = useMemo(() => allMembers.filter((m) => !m.deactivated), [allMembers]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [taskTypes, setTaskTypes] = useState<TaskType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsWorkspace, setNeedsWorkspace] = useState(false);
  const [me, setMe] = useState('');

  const load = useCallback(async () => {
    if (!user) return;
    try {
      setError(null);
      const [workspaces, self] = await Promise.all([workApi.workspaces(), workApi.me()]);
      setMe(self.id);
      if (workspaces.length === 0) {
        setNeedsWorkspace(true);
        setWorkspace(null);
        setHierarchy(null);
        return;
      }
      setNeedsWorkspace(false);
      const stored = localStorage.getItem(STORAGE_KEY);
      const usable = workspaces.filter((w) => !w.access_problem);
      const current = usable.find((w) => w.id === stored) ?? usable[0];
      if (!current) {
        // A member everywhere, but turned off or breaking a sign-in rule: say why instead of loading.
        setWorkspace(null);
        setHierarchy(null);
        setError(workspaces[0].access_problem ?? 'You cannot open this workspace.');
        return;
      }
      localStorage.setItem(STORAGE_KEY, current.id);
      setWorkspace(current);
      const [tree, people, groups] = await Promise.all([
        workApi.hierarchy(current.id),
        workApi.members(current.id),
        workApi.teams(current.id),
      ]);
      setHierarchy(tree);
      setMembers(people);
      setTeams(groups);
      workApi.taskTypes(current.id).then(setTaskTypes).catch(() => setTaskTypes([]));
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      setError(
        status === 503
          ? 'The work database is not configured on the server yet.'
          : status === 0
            ? 'Cannot reach the Verve Workflow server.'
            : (e as Error).message,
      );
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const createWorkspace = useCallback(async (name: string) => {
    const ws = await workApi.createWorkspace(name);
    localStorage.setItem(STORAGE_KEY, ws.id);
    await load();
  }, [load]);

  const index = useMemo(() => indexHierarchy(hierarchy), [hierarchy]);
  const locate = useCallback((kind: LocationKind, id: string) => index.get(`${kind}:${id}`) ?? null, [index]);
  const listName = useCallback((listId: string) => index.get(`list:${listId}`)?.node.name ?? null, [index]);

  const meId = me || user?.uid || '';
  const value = useMemo(
    () => ({ me: meId, workspace, hierarchy, members, allMembers, teams, taskTypes, loading, error, needsWorkspace, refresh: load, createWorkspace, locate, listName }),
    [meId, workspace, hierarchy, members, allMembers, teams, taskTypes, loading, error, needsWorkspace, load, createWorkspace, locate, listName],
  );
  return <WorkContext.Provider value={value}>{children}</WorkContext.Provider>;
};
