import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Archive, EyeOff, Zap, Settings2, Star, Tag as TagIcon, ChevronDown, ChevronRight, CircleDot, Copy, Folder, FolderOpen, LayoutTemplate, List as ListIcon, Lock, MoreHorizontal, MoveRight, Pencil, Plus, Share2, Trash2, Users } from 'lucide-react';
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
  | { type: 'save-template'; kind: 'list' | 'folder'; id: string; name: string }
  | { type: 'templates'; kind?: TemplateKind; target?: string }
  | { type: 'settings'; kind: LocationKind; id: string }
  | { type: 'tags'; id: string; name: string; canEdit: boolean }
  | { type: 'automations'; kind: LocationKind; id: string; name: string; canManage: boolean };

export const SpacesSidebar: React.FC = () => {
  const { workspace, hierarchy, error, needsWorkspace, loading, refresh, createWorkspace, locate } = useWork();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const favorites = useFavorites();
  // Hidden Spaces are a personal, per-browser choice, as in ClickUp's "Hide Space".
  const [hidden, setHidden] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('timetriq.hiddenSpaces') || '[]'); } catch { return []; } });
  const [showHidden, setShowHidden] = useState(false);
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
    if (!window.confirm(`Delete "${name}" and everything inside it? This cannot be undone.`)) return;
    try {
      await workApi.deleteLocation(kind, id);
      await refresh();
      if (activeId === id) navigate('/');
    } catch (e) {
      window.alert((e as Error).message);
    }
  };

  const submitDialog = async (name: string, isPrivate: boolean) => {
    if (!dialog || !workspace || (dialog.type !== 'create' && dialog.type !== 'rename')) return;
    if (dialog.type === 'rename') {
      await workApi.renameLocation(dialog.kind, dialog.id, name);
      await refresh();
      return;
    }
    let created: { id: string };
    if (dialog.what === 'space') created = await workApi.createSpace(workspace.id, name, isPrivate);
    else if (dialog.what === 'folder') created = await workApi.createFolder(dialog.parent!, name, isPrivate);
    else created = await workApi.createList(dialog.parent!, name, isPrivate);
    if (dialog.parent) open(dialog.parent.id);
    await refresh();
    navigate(pathFor(dialog.what, created.id));
  };

  const archive = async (kind: LocationKind, id: string, name: string) => {
    if (!window.confirm(`Archive "${name}"? It and its tasks are hidden until restored from "Archived".`)) return;
    try {
      await collabApi.setArchived(kind, id, true);
      await refresh();
      if (activeId === id) navigate('/');
    } catch (e) {
      window.alert((e as Error).message);
    }
  };

  const rowActions = (kind: LocationKind, node: SpaceNode | FolderNode | ListNode): MenuItem[] => [
    {
      label: favorites.isFavorite(kind, node.id) ? 'Remove from Favourites' : 'Add to Favourites', icon: <Star size={14} />,
      onClick: () => favorites.toggle(kind, node.id),
    },
    ...(canEdit(node.permission_level)
      ? [{ label: 'Rename', icon: <Pencil size={14} />, onClick: () => setDialog({ type: 'rename', kind, id: node.id, name: node.name }) }]
      : []),
    ...(canEdit(node.permission_level)
      ? [{ label: kind === 'list' ? 'List info & dates' : `${kind === 'space' ? 'Space' : 'Folder'} settings`, icon: <Settings2 size={14} />, onClick: () => setDialog({ type: 'settings', kind, id: node.id }) }]
      : []),
    ...(kind === 'space'
      ? [{ label: 'Tags', icon: <TagIcon size={14} />, onClick: () => setDialog({ type: 'tags', id: node.id, name: node.name, canEdit: canEdit(node.permission_level) }) }]
      : []),
    ...(kind === 'space'
      ? [{ label: 'Hide this Space', icon: <EyeOff size={14} />, onClick: () => setHidden((h) => [...h, node.id]) }]
      : []),
    ...(hierarchy?.role !== 'guest'
      ? [{ label: 'Automations', icon: <Zap size={14} />, onClick: () => setDialog({ type: 'automations', kind, id: node.id, name: node.name, canManage: canManage(node.permission_level) }) }]
      : []),
    ...(canManage(node.permission_level)
      ? [{ label: 'Edit statuses', icon: <CircleDot size={14} />, onClick: () => setDialog({ type: 'statuses', kind, id: node.id, name: node.name }) }]
      : []),
    ...(kind !== 'space' && canManage(node.permission_level)
      ? [{ label: 'Move', icon: <MoveRight size={14} />, onClick: () => setDialog({ type: 'move', kind: kind as 'folder' | 'list', node: node as FolderNode | ListNode }) }]
      : []),
    ...(kind !== 'space' && canEdit(node.permission_level)
      ? [{ label: 'Duplicate', icon: <Copy size={14} />, onClick: () => setDialog({ type: 'duplicate', kind: kind as 'folder' | 'list', node: node as FolderNode | ListNode }) }]
      : []),
    ...(kind !== 'space' && hierarchy?.role !== 'guest'
      ? [{ label: 'Save as template', icon: <LayoutTemplate size={14} />, onClick: () => setDialog({ type: 'save-template', kind: kind as 'list' | 'folder', id: node.id, name: node.name }) }]
      : []),
    ...(canManage(node.permission_level)
      ? [{ label: 'Archive', icon: <Archive size={14} />, onClick: () => archive(kind, node.id, node.name) }]
      : []),
    ...(canManage(node.permission_level)
      ? [{ label: 'Delete', icon: <Trash2 size={14} />, danger: true, onClick: () => remove(kind, node.id, node.name) }]
      : []),
  ];

  const createItems = (parent: { kind: 'space' | 'folder'; id: string }, allowFolder: boolean): MenuItem[] => [
    { label: 'List', icon: <ListIcon size={14} />, onClick: () => setDialog({ type: 'create', what: 'list', parent }) },
    ...(allowFolder
      ? [{ label: parent.kind === 'space' ? 'Folder' : 'Subfolder', icon: <Folder size={14} />, onClick: () => setDialog({ type: 'create', what: 'folder' as const, parent }) }]
      : []),
    {
      label: 'From template…', icon: <LayoutTemplate size={14} />,
      onClick: () => setDialog({ type: 'templates', kind: parent.kind === 'folder' ? 'list' : undefined, target: `${parent.kind === 'space' ? 's' : 'f'}:${parent.id}` }),
    },
  ];

  const renderList = (lst: ListNode, depth: number) => (
    <Row
      key={lst.id}
      to={pathFor('list', lst.id)}
      depth={depth}
      active={activeId === lst.id}
      icon={<ListIcon size={15} className="text-gray-500" />}
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
          icon={isOpen ? <FolderOpen size={15} className="text-gray-500" /> : <Folder size={15} className="text-gray-500" />}
          name={folder.name}
          isPrivate={folder.is_private}
          onToggle={() => toggle(folder.id)}
          isOpen={isOpen}
          createItems={canManage(folder.permission_level) ? createItems({ kind: 'folder', id: folder.id }, !isSub) : undefined}
          actions={rowActions('folder', folder)}
        />
        {isOpen && (
          <>
            {folder.folders.map((sub) => renderFolder(sub, depth + 1, true))}
            {folder.lists.map((lst) => renderList(lst, depth + 1))}
          </>
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
          icon={
            <span className="flex h-5 w-5 items-center justify-center rounded text-[11px] font-bold text-white" style={{ backgroundColor: color }}>
              {space.icon || space.name[0]?.toUpperCase()}
            </span>
          }
          name={space.name}
          bold
          isPrivate={space.is_private}
          onToggle={() => toggle(space.id)}
          isOpen={isOpen}
          createItems={canManage(space.permission_level) ? createItems({ kind: 'space', id: space.id }, true) : undefined}
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

  return (
    <div className="select-none">
      <div className="mb-1 flex items-center justify-between pl-3.5 pr-1">
        <span className="text-[0.65rem] font-bold uppercase tracking-wider text-gray-400">Spaces</span>
        {workspace && hierarchy?.role !== 'guest' && (
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
          onClick={() => createWorkspace('Verve Advisory').catch((e) => window.alert(e.message))}
          className="mx-2 w-[calc(100%-1rem)] rounded-md border border-dashed border-indigo-300 px-2.5 py-2 text-left text-xs text-indigo-700 hover:bg-indigo-50"
        >
          Create your workspace to start adding Spaces
        </button>
      )}

      {hierarchy?.spaces.filter((sp) => showHidden || !hidden.includes(sp.id)).map((sp) => renderSpace(sp, hierarchy.spaces.indexOf(sp)))}
      {hidden.some((h) => hierarchy?.spaces.some((sp) => sp.id === h)) && (
        <button type="button" onClick={() => setShowHidden(!showHidden)} className="flex w-full items-center gap-2 px-3.5 py-1 text-xs text-gray-400 hover:text-gray-600">
          <EyeOff size={12} /> {showHidden ? 'Hide hidden Spaces' : `Show ${hidden.filter((h) => hierarchy?.spaces.some((sp) => sp.id === h)).length} hidden Space(s)`}
        </button>
      )}
      {showHidden && hidden.length > 0 && (
        <button type="button" onClick={() => { setHidden([]); setShowHidden(false); }} className="w-full px-3.5 pb-1 text-left text-xs text-indigo-600 hover:underline">Unhide all</button>
      )}

      {hasShared && (
        <div className="mt-1">
          <Row
            depth={0}
            icon={<Share2 size={15} className="text-gray-500" />}
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

      {workspace && hierarchy?.role !== 'guest' && (
        <button
          type="button"
          onClick={() => setDialog({ type: 'create', what: 'space' })}
          className="mt-1 flex w-full items-center gap-2 rounded-lg px-3.5 py-1.5 text-sm text-gray-500 hover:bg-black/5"
        >
          <Plus size={15} /> New Space
        </button>
      )}

      {workspace && (
        <Link
          to="/people"
          className={`mt-1 flex w-full items-center gap-2 rounded-lg px-3.5 py-1.5 text-sm no-underline ${pathname.startsWith('/people') ? 'bg-indigo-50 text-indigo-700' : 'text-gray-500 hover:bg-black/5'}`}
        >
          <Users size={15} /> Teams &amp; People
        </Link>
      )}

      {workspace && (
        <button
          type="button"
          onClick={() => setDialog({ type: 'archived' })}
          className="mt-1 flex w-full items-center gap-2 rounded-lg px-3.5 py-1.5 text-sm text-gray-500 hover:bg-black/5"
        >
          <Archive size={15} /> Archived
        </button>
      )}
      {workspace && hierarchy?.role !== 'guest' && (
        <button
          type="button"
          onClick={() => setDialog({ type: 'templates' })}
          className="flex w-full items-center gap-2 rounded-lg px-3.5 py-1.5 text-sm text-gray-500 hover:bg-black/5"
        >
          <LayoutTemplate size={15} /> Templates
        </button>
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

      {(dialog?.type === 'create' || dialog?.type === 'rename') && (
        <NameDialog
          title={dialog.type === 'rename' ? 'Rename' : `New ${dialog.what === 'space' ? 'Space' : dialog.what === 'folder' ? 'Folder' : 'List'}`}
          initial={dialog.type === 'rename' ? dialog.name : ''}
          confirmLabel={dialog.type === 'rename' ? 'Save' : 'Create'}
          withPrivate={dialog.type === 'create'}
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
}> = ({ to, depth, active, icon, name, bold, isPrivate, trailing, onToggle, isOpen, createItems, actions }) => {
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
  const className = `group flex w-full items-center gap-1.5 rounded-lg py-1.5 pr-1.5 text-sm no-underline ${
    active ? 'bg-indigo-50 text-indigo-700' : 'hover:bg-black/5'
  }`;
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
