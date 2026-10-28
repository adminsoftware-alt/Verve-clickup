import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../components/AuthContext';
import { ApiError, workApi, type FolderNode, type Hierarchy, type ListNode, type LocationKind, type Member, type SpaceNode, type TaskType, type Team, type Workspace } from './api';

const STORAGE_KEY = 'timetriq.workspaceId';
// The workspace last opened, so the next visit can start loading everything straight away
// instead of first waiting to be told which workspace it is. Checked against the server each time.
const MEMORY_KEY = 'timetriq.lastWorkspace';
interface Remembered { uid: string; me: string; workspace: Workspace }

function recall(uid: string): Remembered | null {
  try {
    const saved = JSON.parse(localStorage.getItem(MEMORY_KEY) ?? 'null') as Remembered | null;
    return saved && saved.uid === uid && saved.workspace?.id ? saved : null;
  } catch {
    return null;
  }
}

function remember(saved: Remembered | null) {
  try {
    if (saved) localStorage.setItem(MEMORY_KEY, JSON.stringify(saved));
    else localStorage.removeItem(MEMORY_KEY);
  } catch {
    // storage blocked: every visit just waits for the workspace list
  }
}

/** Keep the same object when nothing changed, so screens that load per workspace don't load twice. */
const sameWorkspace = (a: Workspace | null, b: Workspace) =>
  !!a && a.id === b.id && a.name === b.name && a.role === b.role && a.access_problem === b.access_problem;

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

/** Owner or admin. The workspace knows the role before the full tree has loaded. */
export const useIsAdmin = () => {
  const { hierarchy, workspace } = useWork();
  const role = hierarchy?.role ?? workspace?.role;
  return role === 'owner' || role === 'admin';
};

/**
 * An admin, or somebody who leads a Team.
 *
 * The same test the server applies (permissions.is_manager) and the same one the Spaces menu
 * uses, in one place so the answer cannot differ between two screens.
 */
export const useIsManager = () => {
  const { hierarchy, workspace, teams, me } = useWork();
  const role = hierarchy?.role ?? workspace?.role;
  const isAdmin = role === 'owner' || role === 'admin';
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
  // A brief database hiccup (the shared pool is full for a moment) shouldn't leave the sidebar
  // stuck on an error: a failed load tries again twice before saying so.
  const retries = useRef(0);

  const load = useCallback(async () => {
    if (!user) return;
    const tree = (id: string) => Promise.all([workApi.hierarchy(id), workApi.members(id), workApi.teams(id)]);
    // Start on the workspace from last time while the server confirms it: the sidebar, and every
    // screen waiting for a workspace, begin loading now rather than one round trip later.
    const guess = recall(user.uid);
    const early = guess ? tree(guess.workspace.id) : null;
    early?.catch(() => undefined); // only awaited if the guess was right
    let retrying = false;
    if (guess) {
      setMe((m) => m || guess.me);
      setWorkspace((w) => w ?? guess.workspace);
    }
    try {
      setError(null);
      const [workspaces, self] = await Promise.all([workApi.workspaces(), workApi.me()]);
      setMe(self.id);
      if (workspaces.length === 0) {
        remember(null);
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
        remember(null);
        setWorkspace(null);
        setHierarchy(null);
        setError(workspaces[0].access_problem ?? 'You cannot open this workspace.');
        return;
      }
      localStorage.setItem(STORAGE_KEY, current.id);
      remember({ uid: user.uid, me: self.id, workspace: current });
      setWorkspace((w) => (sameWorkspace(w, current) ? w : current));
      const [spaces, people, groups] = await (early && guess?.workspace.id === current.id ? early : tree(current.id));
      setHierarchy(spaces);
      setMembers(people);
      setTeams(groups);
      workApi.taskTypes(current.id).then(setTaskTypes).catch(() => setTaskTypes([]));
      retries.current = 0;
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      if ((status === 0 || status >= 500) && status !== 503 && retries.current < 2) {
        retries.current += 1;
        retrying = true;
        setTimeout(load, 1500 * retries.current);
        return;
      }
      retries.current = 0;
      setError(
        status === 503
          ? 'The work database is not configured on the server yet.'
          : status === 0
            ? 'Cannot reach the Verve Workflow server.'
            : (e as Error).message,
      );
    } finally {
      if (!retrying) setLoading(false);
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
