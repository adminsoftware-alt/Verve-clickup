import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Archive, EyeOff, Zap, Settings2, Star, Tag as TagIcon, ChevronDown, ChevronRight, CircleDot, Copy, Folder, FolderOpen, LayoutTemplate, List as ListIcon, Lock, MoreHorizontal, MoveRight, Pencil, Plus, Share2, Trash2, Users, Blocks, Compass, Mail, Timer, Rows3, UserRound } from 'lucide-react';
import { ClickAppsDialog, DuplicateSpaceDialog, ListEmailDialog, SprintSettingsDialog } from './SpaceDialogs';
import { spacesApi } from './spacesApi';
import { SaveTemplateDialog, TemplateCenter } from './templates/Templates';
import { useFavorites } from './Favorites';
import { LocationSettingsDialog, TagManagerDialog } from './LocationSettings';
import { AutomationsDialog } from './AutomationsDialog';
import type { TemplateKind } from './api';
import { collabApi } from './collabApi';
import { ArchivedDialog, DuplicateLocationDialog, MoveLocationDialog, StatusEditorDialog } from './LocationDialogs';
import { useWork } from './WorkContext';
import { workApi, type FolderNode, type Level, type ListNode, type LocationKind, type SpaceNode } from './api';
import { Menu, NameDialog, type MenuItem } from './ui';
import { FEATURES } from '../config/features';
import { ShareLocationDialog } from './ShareLocationDialog';
import { notify } from '../components/notify';
import { ask } from '../components/ask';

const EXPANDED_KEY = 'timetriq.expanded';
const SPACE_COLORS = ['#7c3aed', '#0ea5e9', '#16a34a', '#ea580c', '#db2777', '#4f46e5', '#0d9488', '#b45309'];

export const pathFor = (kind: LocationKind, id: string) => `/${kind === 'space' ? 's' : kind === 'folder' ? 'f' : 'l'}/${id}`;

const canEdit = (level: Level) => level === 'edit' || level === 'full';
const canManage = (level: Level) => level === 'full';

type Dialog =
  | { type: 'create'; what: 'space' | 'folder' | 'list'; parent?: { kind: 'space' | 'folder'; id: string } }
  | { type: 'rename'; kind: LocationKind; id: string; name: string }
  | { type: 'statuses'; kind: LocationKind; id: string; name: string }
  | { type: 'move' | 'duplicate'; kind: 'folder' | 'list'; node: FolderNode | ListNode }
  | { type: 'archived' }
  | { type: 'save-template'; kind: 'list' | 'folder' | 'space'; id: string; name: string }
  | { type: 'clickapps' | 'duplicate-space'; id: string; name: string; canManage: boolean }
  | { type: 'sprints'; id: string; name: string }
  | { type: 'list-email'; id: string; name: string }
  | { type: 'templates'; kind?: TemplateKind; target?: string }
  | { type: 'settings'; kind: LocationKind; id: string }
  | { type: 'team'; kind: LocationKind; id: string; name: string; team: string | null }
  | { type: 'tags'; id: string; name: string; canEdit: boolean }
  | { type: 'automations'; kind: LocationKind; id: string; name: string; canManage: boolean };

export const SpacesSidebar: React.FC = () => {
  const { workspace, hierarchy, error, needsWorkspace, loading, refresh, createWorkspace, locate, teams, me, members: people } = useWork();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const favorites = useFavorites();
  // Hidden Spaces are a personal, per-browser choice, as in ClickUp's "Hide Space".
  const [hidden, setHidden] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('timetriq.hiddenSpaces') || '[]'); } catch { return []; } });
  const [showHidden, setShowHidden] = useState(false);
  const hiddenIds = useMemo(
    () => new Set([...hidden, ...(hierarchy?.spaces.filter((sp) => sp.hidden).map((sp) => sp.id) ?? [])]),
    [hidden, hierarchy],
  );
  const hideSpace = async (id: string) => {
    if (!workspace) return;
    try { await spacesApi.setJoined(workspace.id, id, false); await refresh(); } catch { setHidden((h) => [...h, id]); }
  };
  const unhideAll = async () => {
    setHidden([]);
    setShowHidden(false);
    if (!workspace) return;
    await Promise.all((hierarchy?.spaces ?? []).filter((sp) => sp.hidden).map((sp) => spacesApi.setJoined(workspace.id, sp.id, true).catch(() => undefined)));
    await refresh();
  };
  const sections = hierarchy?.sections ?? [];
  const moveToSection = async (spaceId: string, sectionId: string | null) => {
    if (!workspace) return;
    try {
      if (sectionId === null) {
        const current = sections.find((x) => x.space_ids.includes(spaceId));
        if (current) await spacesApi.updateSection(workspace.id, current.id, { space_ids: current.space_ids.filter((x) => x !== spaceId) });
      } else {
        const target = sections.find((x) => x.id === sectionId)!;
        await spacesApi.updateSection(workspace.id, sectionId, { space_ids: [...target.space_ids, spaceId] });
      }
      await refresh();
    } catch (e) { notify.error(e); }
  };
  const newSection = async (spaceId?: string) => {
    const name = await ask.prompt('Name the sidebar section (only you see it)', 'Clients');
    if (!name?.trim() || !workspace) return;
    try { await spacesApi.addSection(workspace.id, name.trim(), spaceId ? [spaceId] : []); await refresh(); } catch (e) { notify.error(e); }
  };
  useEffect(() => { try { localStorage.setItem('timetriq.hiddenSpaces', JSON.stringify(hidden)); } catch { /* ignore */ } }, [hidden]);
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(EXPANDED_KEY) || '[]')); } catch { return new Set(); }
  });

  useEffect(() => { localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expanded])); }, [expanded]);

  // Keep the ancestors of whatever is open in the main pane expanded.
  useEffect(() => {
    const m = pathname.match(/^\/(s|f|l)\/([^/]+)/);
    if (!m) return;
    const kind: LocationKind = m[1] === 's' ? 'space' : m[1] === 'f' ? 'folder' : 'list';
    const found = locate(kind, m[2]);
    if (!found) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      found.path.slice(0, -1).forEach((c) => next.add(c.id));
      if (kind !== 'list') next.add(m[2]);
      return next;
    });
  }, [pathname, locate]);

  const toggle = (id: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const open = (id: string) => setExpanded((prev) => new Set(prev).add(id));

  const activeId = useMemo(() => pathname.match(/^\/(?:s|f|l)\/([^/]+)/)?.[1] ?? null, [pathname]);

  const remove = async (kind: LocationKind, id: string, name: string) => {
    if (!(await ask.confirm({ danger: true, title: `Delete "${name}" and everything inside it? This cannot be undone.` }))) return;
    try {
      await workApi.deleteLocation(kind, id);
      await refresh();
      if (activeId === id) navigate('/');
    } catch (e) {
      notify.error(e);
    }
  };

  const submitDialog = async (name: string, isPrivate: boolean, assignees: string[] = []) => {
    if (!dialog || !workspace || (dialog.type !== 'create' && dialog.type !== 'rename')) return;
    if (dialog.type === 'rename') {
      await workApi.renameLocation(dialog.kind, dialog.id, name);
      await refresh();
      return;
    }
    let created: { id: string };
    if (dialog.what === 'space') created = await workApi.createSpace(workspace.id, name, isPrivate);
    else if (dialog.what === 'folder') created = await workApi.createFolder(dialog.parent!, name, isPrivate);
    else created = await workApi.createList(dialog.parent!, name, isPrivate, assignees);
    if (dialog.parent) open(dialog.parent.id);
    await refresh();
    navigate(pathFor(dialog.what, created.id));
  };

  const archive = async (kind: LocationKind, id: string, name: string) => {
    if (!(await ask.confirm({ danger: true, title: `Archive "${name}"? It and its tasks are hidden until restored from "Archived".` }))) return;
    try {
      await collabApi.setArchived(kind, id, true);
      await refresh();
      if (activeId === id) navigate('/');
    } catch (e) {
      notify.error(e);
    }
  };

  const rowActions = (kind: LocationKind, node: SpaceNode | FolderNode | ListNode): MenuItem[] => [
    ...(FEATURES.spaceMenuFavourites
      ? [{
        label: favorites.isFavorite(kind, node.id) ? 'Remove from Favourites' : 'Add to Favourites',
        icon: <Star size={14} />,
        onClick: () => favorites.toggle(kind, node.id),
      }]
      : []),
    ...(isAdmin && canEdit(node.permission_level)
      ? [{ label: 'Rename', icon: <Pencil size={14} />, onClick: () => setDialog({ type: 'rename', kind, id: node.id, name: node.name }) }]
      : []),
    ...(FEATURES.spaceMenuSettings && canEdit(node.permission_level)
      ? [{ label: kind === 'list' ? 'List info & dates' : `${kind === 'space' ? 'Space' : 'Folder'} settings`, icon: <Settings2 size={14} />, onClick: () => setDialog({ type: 'settings', kind, id: node.id }) }]
      : []),
    ...(FEATURES.spaceMenuTags && kind === 'space'
      ? [{ label: 'Tags', icon: <TagIcon size={14} />, onClick: () => setDialog({ type: 'tags', id: node.id, name: node.name, canEdit: canEdit(node.permission_level) }) }]
      : []),
    ...(canManage(node.permission_level) && (kind === 'space' ? isAdmin : isManager)
      ? [{
        label: 'Share',
        icon: <Share2 size={14} />,
        onClick: () => setDialog({ type: 'team', kind, id: node.id, name: node.name, team: (node as { team?: { id: string } | null }).team?.id ?? null }),
      }]
      : []),
    ...(FEATURES.spaceMenuHide && kind === 'space'
      ? [{ label: 'Hide this Space', icon: <EyeOff size={14} />, onClick: () => hideSpace(node.id) }]
      : []),
    ...(FEATURES.spaceMenuSections && kind === 'space'
      ? [
          ...sections.filter((x) => !x.space_ids.includes(node.id)).map((x) => ({ label: `Move to section: ${x.name}`, icon: <Rows3 size={14} />, onClick: () => moveToSection(node.id, x.id) })),
          ...(sections.some((x) => x.space_ids.includes(node.id)) ? [{ label: 'Take out of its section', icon: <Rows3 size={14} />, onClick: () => moveToSection(node.id, null) }] : []),
          { label: 'New sidebar section…', icon: <Rows3 size={14} />, onClick: () => newSection(node.id) },
        ]
      : []),
    ...(FEATURES.spaceMenuClickApps && kind === 'space'
      ? [{ label: 'ClickApps', icon: <Blocks size={14} />, onClick: () => setDialog({ type: 'clickapps', id: node.id, name: node.name, canManage: canManage(node.permission_level) }) }]
      : []),
    // A copy of a Space is another part of the firm, so it follows the rule for making one.
    ...(isAdmin && kind === 'space' && canManage(node.permission_level)
      ? [{ label: 'Duplicate', icon: <Copy size={14} />, onClick: () => setDialog({ type: 'duplicate-space', id: node.id, name: node.name, canManage: true }) }]
      : []),
    ...(FEATURES.sprintFolders && kind === 'folder' && canManage(node.permission_level)
      ? [{ label: (node as FolderNode).is_sprint ? 'Sprint settings' : 'Make it a Sprint Folder', icon: <Timer size={14} />, onClick: () => setDialog({ type: 'sprints', id: node.id, name: node.name }) }]
      : []),
    ...(FEATURES.listEmail && kind === 'list' && canManage(node.permission_level)
      ? [{ label: 'Email to this List', icon: <Mail size={14} />, onClick: () => setDialog({ type: 'list-email', id: node.id, name: node.name }) }]
      : []),
    ...(hierarchy?.role !== 'guest'
      ? [{ label: 'Automations', icon: <Zap size={14} />, onClick: () => setDialog({ type: 'automations', kind, id: node.id, name: node.name, canManage: canManage(node.permission_level) }) }]
      : []),
    ...(FEATURES.spaceMenuStatuses && canManage(node.permission_level)
      ? [{ label: 'Edit statuses', icon: <CircleDot size={14} />, onClick: () => setDialog({ type: 'statuses', kind, id: node.id, name: node.name }) }]
      : []),
    ...(kind !== 'space' && canManage(node.permission_level)
      ? [{ label: 'Move', icon: <MoveRight size={14} />, onClick: () => setDialog({ type: 'move', kind: kind as 'folder' | 'list', node: node as FolderNode | ListNode }) }]
      : []),
    // Folders and Lists are structure: a manager's to add, and so a manager's to copy.
    ...(isManager && kind !== 'space' && canEdit(node.permission_level)
      ? [{ label: 'Duplicate', icon: <Copy size={14} />, onClick: () => setDialog({ type: 'duplicate', kind: kind as 'folder' | 'list', node: node as FolderNode | ListNode }) }]
      : []),
    ...(FEATURES.templates && hierarchy?.role !== 'guest'
      ? [{ label: 'Save as template', icon: <LayoutTemplate size={14} />, onClick: () => setDialog({ type: 'save-template', kind: kind as 'list' | 'folder' | 'space', id: node.id, name: node.name }) }]
      : []),
    ...(FEATURES.spaceMenuArchive && canManage(node.permission_level)
      ? [{ label: 'Archive', icon: <Archive size={14} />, onClick: () => archive(kind, node.id, node.name) }]
      : []),
    ...(isAdmin && canManage(node.permission_level)
      ? [{ label: 'Delete', icon: <Trash2 size={14} />, danger: true, onClick: () => remove(kind, node.id, node.name) }]
      : []),
  ];

  const createItems = (parent: { kind: 'space' | 'folder'; id: string }, allowFolder: boolean): MenuItem[] => [
    ...(isManager
      ? [{ label: 'List', icon: <ListIcon size={14} />, onClick: () => setDialog({ type: 'create', what: 'list' as const, parent }) }]
      : []),
    ...(allowFolder && isManager
      ? [{ label: parent.kind === 'space' ? 'Folder' : 'Subfolder', icon: <Folder size={14} />, onClick: () => setDialog({ type: 'create', what: 'folder' as const, parent }) }]
      : []),
    ...(FEATURES.templates && isManager
      ? [{
        label: 'From template…', icon: <LayoutTemplate size={14} />,
        onClick: () => setDialog({ type: 'templates', kind: parent.kind === 'folder' ? 'list' : undefined, target: `${parent.kind === 'space' ? 's' : 'f'}:${parent.id}` }),
      }]
      : []),
  ];

  const renderList = (lst: ListNode, depth: number) => (
    <Row
      key={lst.id}
      to={pathFor('list', lst.id)}
      depth={depth}
      active={activeId === lst.id}
      kind="list"
      icon={lst.assignee_id ? <UserRound size={15} aria-label="Assigned List" /> : <ListIcon size={15} />}
      name={lst.name}
      isPrivate={lst.is_private}
      trailing={lst.open_task_count > 0 ? <span className="text-xs text-gray-400">{lst.open_task_count}</span> : null}
      actions={rowActions('list', lst)}
    />
  );

  const renderFolder = (folder: FolderNode, depth: number, isSub: boolean): React.ReactNode => {
    const isOpen = expanded.has(folder.id);
    return (
      <div key={folder.id}>
        <Row
          to={pathFor('folder', folder.id)}
          depth={depth}
          active={activeId === folder.id}
          kind="folder"
          icon={folder.is_sprint ? <Timer size={16} /> : isOpen ? <FolderOpen size={16} /> : <Folder size={16} />}
          name={folder.name}
          isPrivate={folder.is_private}
          onToggle={() => toggle(folder.id)}
          isOpen={isOpen}
          createItems={isManager && canManage(folder.permission_level) ? createItems({ kind: 'folder', id: folder.id }, !isSub) : undefined}
          actions={rowActions('folder', folder)}
        />
        {isOpen && (
          <div className="side-branch" style={{ marginLeft: `${14 + depth * 14}px` }}>
            {folder.folders.map((sub) => renderFolder(sub, depth + 1, true))}
            {folder.lists.map((lst) => renderList(lst, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const renderSpace = (space: SpaceNode, index: number) => {
    const isOpen = expanded.has(space.id);
    const color = space.color || SPACE_COLORS[index % SPACE_COLORS.length];
    return (
      <div key={space.id}>
        <Row
          to={pathFor('space', space.id)}
          depth={0}
          active={activeId === space.id}
          kind="space"
          icon={
            <span className="flex h-5 w-5 items-center justify-center rounded-md text-[11px] font-bold text-white shadow-sm" style={{ backgroundColor: color }}>
              {space.icon || space.name[0]?.toUpperCase()}
            </span>
          }
          name={space.name}
          bold
          isPrivate={space.is_private}
          onToggle={() => toggle(space.id)}
          isOpen={isOpen}
          createItems={isManager && canManage(space.permission_level) ? createItems({ kind: 'space', id: space.id }, true) : undefined}
          actions={rowActions('space', space)}
        />
        {isOpen && (
          <>
            {space.folders.map((f) => renderFolder(f, 1, false))}
            {space.lists.map((l) => renderList(l, 1))}
            {space.folders.length === 0 && space.lists.length === 0 && (
              <div className="py-1 pl-10 text-xs text-gray-400">Empty — use + to add a List</div>
            )}
          </>
        )}
      </div>
    );
  };

  const shared = hierarchy?.shared_with_me;
  const hasShared = !!shared && (shared.folders.length + shared.lists.length > 0);

  // Spaces are the admins'; Folders are the managers' (a Team's leads); Lists and tasks are
  // everyone's, inside whatever they can open.
  const isAdmin = hierarchy?.role === 'owner' || hierarchy?.role === 'admin';
  const isManager = isAdmin || teams.some((t) => t.lead_ids.includes(me));
  const canAddSpace = isAdmin;

  return (
    <div className="select-none">
      <div className="mb-1 flex items-center justify-between pl-2.5 pr-1">
        <span className="side-head text-gray-400">Spaces</span>
        {workspace && canAddSpace && (
          <button
            type="button"
            title="New Space"
            onClick={() => setDialog({ type: 'create', what: 'space' })}
            className="rounded p-1 text-gray-400 hover:bg-black/5 hover:text-gray-700"
          >
            <Plus size={14} />
          </button>
        )}
      </div>

      {loading && <div className="px-3.5 py-1 text-xs text-gray-400">Loading…</div>}
      {error && <div className="mx-2 rounded-md bg-amber-50 px-2.5 py-2 text-xs text-amber-800">{error}</div>}
      {needsWorkspace && (
        <button
          type="button"
          onClick={() => createWorkspace('Verve Advisory').catch((e) => notify.error(e))}
          className="mx-2 w-[calc(100%-1rem)] rounded-md border border-dashed border-brand-300 px-2.5 py-2 text-left text-xs text-brand-700 hover:bg-brand-50"
        >
          Create your workspace to start adding Spaces
        </button>
      )}

      {(() => {
        const visible = (hierarchy?.spaces ?? []).filter((sp) => showHidden || !hiddenIds.has(sp.id));
        const inSection = new Set(sections.flatMap((x) => x.space_ids));
        return (
          <>
            {visible.filter((sp) => !inSection.has(sp.id)).map((sp) => renderSpace(sp, hierarchy!.spaces.indexOf(sp)))}
            {sections.map((section) => {
              const members = section.space_ids.map((sid) => visible.find((sp) => sp.id === sid)).filter((sp): sp is SpaceNode => !!sp);
              return (
                <div key={section.id} role="group" aria-label={`Section ${section.name}`} className="mt-1">
                  <div className="group flex items-center gap-1 pl-2 pr-1">
                    <button type="button" aria-expanded={!section.collapsed}
                      onClick={() => workspace && spacesApi.updateSection(workspace.id, section.id, { collapsed: !section.collapsed }).then(refresh)}
                      className="flex min-w-0 flex-1 items-center gap-1 py-1 text-left text-[0.65rem] font-bold uppercase tracking-wider text-gray-400 hover:text-gray-600">
                      {section.collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />} <span className="truncate">{section.name}</span>
                    </button>
                    <span className="hidden group-hover:flex">
                      <Menu align="right" label={`Section options for ${section.name}`} items={[
                        { label: 'Rename section', icon: <Pencil size={14} />, onClick: async () => { const n = await ask.prompt('Rename section', section.name); if (n?.trim() && workspace) spacesApi.updateSection(workspace.id, section.id, { name: n.trim() }).then(refresh); } },
                        { label: 'Remove section (keeps its Spaces)', icon: <Trash2 size={14} />, danger: true, onClick: () => workspace && spacesApi.deleteSection(workspace.id, section.id).then(refresh) },
                      ]} trigger={<span className="rounded p-0.5 text-gray-400 hover:bg-black/10"><MoreHorizontal size={13} /></span>} />
                    </span>
                  </div>
                  {!section.collapsed && members.map((sp) => renderSpace(sp, hierarchy!.spaces.indexOf(sp)))}
                  {!section.collapsed && members.length === 0 && <div className="py-1 pl-7 text-xs text-gray-400">Move Spaces here from their ··· menu</div>}
                </div>
              );
            })}
          </>
        );
      })()}
      {(hierarchy?.spaces ?? []).some((sp) => hiddenIds.has(sp.id)) && (
        <button type="button" onClick={() => setShowHidden(!showHidden)} className="flex w-full items-center gap-2 px-3.5 py-1 text-xs text-gray-400 hover:text-gray-600">
          <EyeOff size={12} /> {showHidden ? 'Hide hidden Spaces' : `Show ${(hierarchy?.spaces ?? []).filter((sp) => hiddenIds.has(sp.id)).length} hidden Space(s)`}
        </button>
      )}
      {showHidden && hiddenIds.size > 0 && (
        <button type="button" onClick={unhideAll} className="w-full px-3.5 pb-1 text-left text-xs text-brand-600 hover:underline">Unhide all</button>
      )}

      {hasShared && (
        <div className="mt-1">
          <Row
            depth={0}
            icon={<Share2 size={16} className="text-gray-500" />}
            name="Shared with me"
            onToggle={() => toggle('__shared')}
            isOpen={expanded.has('__shared')}
            actions={[]}
          />
          {expanded.has('__shared') && (
            <>
              {shared!.folders.map((f) => renderFolder(f, 1, false))}
              {shared!.lists.map((l) => renderList(l, 1))}
            </>
          )}
        </div>
      )}

      <div className="side-rule" aria-hidden />

      {workspace && canAddSpace && (
        <button
          type="button"
          onClick={() => setDialog({ type: 'create', what: 'space' })}
          className="side-row flex w-full items-center gap-2 pl-1.5 text-gray-500"
        >
          <span className="w-4 shrink-0" aria-hidden /><Plus size={16} /> New Space
        </button>
      )}

      {workspace && FEATURES.allSpacesPage && (
        <Link
          to="/all-spaces"
          className={`side-row flex w-full items-center gap-2 pl-1.5 no-underline ${pathname.startsWith('/all-spaces') ? 'is-active bg-brand-50 text-brand-700' : 'text-gray-500'}`}
        >
          <span className="w-4 shrink-0" aria-hidden /><Compass size={16} /> All Spaces
        </Link>
      )}

      {workspace && isManager && (
        <Link
          to="/people"
          className={`side-row flex w-full items-center gap-2 pl-1.5 no-underline ${pathname.startsWith('/people') ? 'is-active bg-brand-50 text-brand-700' : 'text-gray-500'}`}
        >
          <span className="w-4 shrink-0" aria-hidden /><Users size={16} /> Teams &amp; People
        </Link>
      )}

      {workspace && FEATURES.archived && (
        <button
          type="button"
          onClick={() => setDialog({ type: 'archived' })}
          className="side-row flex w-full items-center gap-2 pl-1.5 text-gray-500"
        >
          <span className="w-4 shrink-0" aria-hidden /><Archive size={16} /> Archived
        </button>
      )}
      {workspace && FEATURES.templates && hierarchy?.role !== 'guest' && (
        <button
          type="button"
          onClick={() => setDialog({ type: 'templates' })}
          className="side-row flex w-full items-center gap-2 pl-1.5 text-gray-500"
        >
          <span className="w-4 shrink-0" aria-hidden /><LayoutTemplate size={16} /> Templates
        </button>
      )}

      {dialog?.type === 'team' && (
        <ShareLocationDialog
          kind={dialog.kind} id={dialog.id} name={dialog.name} team={dialog.team}
          onClose={() => setDialog(null)}
          onDone={() => { setDialog(null); refresh(); }}
        />
      )}
      {dialog?.type === 'statuses' && (
        <StatusEditorDialog kind={dialog.kind} id={dialog.id} name={dialog.name} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); refresh(); window.dispatchEvent(new Event('timetriq:statuses')); }} />
      )}
      {dialog?.type === 'move' && (
        <MoveLocationDialog kind={dialog.kind} node={dialog.node} onClose={() => setDialog(null)} onDone={() => { setDialog(null); refresh(); }} />
      )}
      {dialog?.type === 'duplicate' && (
        <DuplicateLocationDialog kind={dialog.kind} node={dialog.node} onClose={() => setDialog(null)}
          onDone={(id) => { const kind = dialog.kind; setDialog(null); refresh().then(() => navigate(pathFor(kind, id))); }} />
      )}
      {dialog?.type === 'automations' && <AutomationsDialog kind={dialog.kind} id={dialog.id} name={dialog.name} canManage={dialog.canManage} onClose={() => setDialog(null)} />}
      {dialog?.type === 'settings' && <LocationSettingsDialog kind={dialog.kind} id={dialog.id} onClose={() => setDialog(null)} />}
      {dialog?.type === 'tags' && <TagManagerDialog spaceId={dialog.id} spaceName={dialog.name} canEdit={dialog.canEdit} onClose={() => setDialog(null)} />}
      {dialog?.type === 'archived' && <ArchivedDialog onClose={() => setDialog(null)} onRestored={refresh} />}
      {dialog?.type === 'save-template' && <SaveTemplateDialog kind={dialog.kind} id={dialog.id} name={dialog.name} onClose={() => setDialog(null)} />}
      {dialog?.type === 'templates' && <TemplateCenter kind={dialog.kind} target={dialog.target} onClose={() => setDialog(null)} />}
      {dialog?.type === 'clickapps' && <ClickAppsDialog spaceId={dialog.id} name={dialog.name} canEdit={dialog.canManage} onClose={() => setDialog(null)} onSaved={refresh} />}
      {dialog?.type === 'duplicate-space' && (
        <DuplicateSpaceDialog spaceId={dialog.id} name={dialog.name} onClose={() => setDialog(null)}
          onDone={(id) => { setDialog(null); refresh().then(() => navigate(pathFor('space', id))); }} />
      )}
      {dialog?.type === 'sprints' && <SprintSettingsDialog folderId={dialog.id} name={dialog.name} onClose={() => setDialog(null)} onSaved={refresh} />}
      {FEATURES.listEmail && dialog?.type === 'list-email' && <ListEmailDialog listId={dialog.id} name={dialog.name} onClose={() => setDialog(null)} />}

      {(dialog?.type === 'create' || dialog?.type === 'rename') && (
        <NameDialog
          title={dialog.type === 'rename' ? 'Rename' : `New ${dialog.what === 'space' ? 'Space' : dialog.what === 'folder' ? 'Folder' : 'List'}`}
          initial={dialog.type === 'rename' ? dialog.name : ''}
          confirmLabel={dialog.type === 'rename' ? 'Save' : 'Create'}
          withPrivate={dialog.type === 'create'}
          {...(dialog.type === 'create' && dialog.what === 'list' ? {
            assignTo: {
              people: people.map((m) => ({ id: m.user.id, name: m.user.display_name || m.user.email })),
              note: 'They get full access to the List, so it turns up in their own sidebar.',
            },
          } : {})}
          onSubmit={submitDialog}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
};

// --- one row of the tree -----------------------------------------------------

const Row: React.FC<{
  to?: string;
  depth: number;
  /** Space, Folder or List -- the three levels, which are styled apart. */
  kind?: 'space' | 'folder' | 'list';
  active?: boolean;
  icon: React.ReactNode;
  name: string;
  bold?: boolean;
  isPrivate?: boolean;
  trailing?: React.ReactNode;
  onToggle?: () => void;
  isOpen?: boolean;
  createItems?: MenuItem[];
  actions: MenuItem[];
}> = ({ to, depth, kind, active, icon, name, bold, isPrivate, trailing, onToggle, isOpen, createItems, actions }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const content = (
    <>
      <span className="flex w-4 shrink-0 justify-center">
        {onToggle && (
          <span
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggle(); }}
            className="rounded text-gray-400 hover:bg-black/10 hover:text-gray-700"
          >
            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
        )}
      </span>
      <span className="flex shrink-0 items-center">{icon}</span>
      <span className={`min-w-0 flex-1 truncate ${bold ? 'font-medium text-gray-800' : 'text-gray-700'}`}>{name}</span>
      {isPrivate && <Lock size={12} className="shrink-0 text-gray-400" />}
      <span className="flex shrink-0 items-center gap-0.5">
        {/* Hover actions stay visible while one of their menus is open. */}
        <span className={`items-center gap-0.5 ${menuOpen ? 'flex' : 'hidden group-hover:flex'}`}>
          {actions.length > 0 && (
            <Menu
              align="right"
              label={`More actions for ${name}`}
              items={actions}
              onOpenChange={setMenuOpen}
              trigger={<span className="rounded p-0.5 text-gray-500 hover:bg-black/10"><MoreHorizontal size={14} /></span>}
            />
          )}
          {createItems && (
            <Menu
              align="right"
              label={`Add to ${name}`}
              items={createItems}
              onOpenChange={setMenuOpen}
              trigger={<span className="rounded p-0.5 text-gray-500 hover:bg-black/10"><Plus size={14} /></span>}
            />
          )}
        </span>
        <span className={menuOpen ? 'hidden' : 'group-hover:hidden'}>{trailing}</span>
      </span>
    </>
  );
  const className = `group side-row flex w-full items-center gap-1.5 no-underline ${
    kind ? `side-${kind}` : ''
  } ${active ? 'is-active bg-brand-50 text-brand-700' : ''}`;
  const style = { paddingLeft: `${6 + depth * 14}px` };
  return to ? (
    <Link to={to} className={className} style={style} onClick={() => onToggle && !isOpen && onToggle()}>
      {content}
    </Link>
  ) : (
    <div className={`${className} cursor-pointer`} style={style} onClick={onToggle}>
      {content}
    </div>
  );
};
