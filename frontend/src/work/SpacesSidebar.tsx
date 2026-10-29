import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight, Copy, Folder, FolderOpen, List as ListIcon, Lock, MoreHorizontal, MoveRight, Pencil, Plus, Share2, Trash2, Timer, UserRound, UserPlus } from 'lucide-react';
import { spacesApi } from './spacesApi';
// Admin is the shell's too, so anything it imports is in the first download. Only admins open
// it, and it brings the spreadsheet importer with it, so it waits until it is opened.
import { DuplicateLocationDialog, MoveLocationDialog } from './LocationDialogs';
import { DuplicateLocation } from './DuplicateLocation';
import { useWork } from './WorkContext';
import { spaceIconSrc, workApi, type FolderNode, type Level, type ListNode, type LocationKind, type SpaceNode } from './api';
import { Menu, NameDialog, type MenuItem } from './ui';
import { ShareLocationDialog } from './ShareLocationDialog';
import { AssignListDialog } from './AssignListDialog';
import { CreateSpaceDialog } from './CreateSpace';
import { spaceColor } from './spaceColors';
import { notify } from '../components/notify';
import { ask } from '../components/ask';
import { LinesSkeleton } from './Skeleton';

const EXPANDED_KEY = 'timetriq.expanded';

export const pathFor = (kind: LocationKind, id: string) => `/${kind === 'space' ? 's' : kind === 'folder' ? 'f' : 'l'}/${id}`;

const canEdit = (level: Level) => level === 'edit' || level === 'full';
const canManage = (level: Level) => level === 'full';

type Dialog =
  | { type: 'create'; what: 'space' | 'folder' | 'list'; parent?: { kind: 'space' | 'folder'; id: string } }
  | { type: 'rename'; kind: LocationKind; id: string; name: string }
  | { type: 'move' | 'duplicate'; kind: 'folder' | 'list'; node: FolderNode | ListNode }
  | { type: 'duplicate-space'; id: string; name: string }
  | { type: 'assign'; node: ListNode }
  | { type: 'team'; kind: LocationKind; id: string; name: string; team: string | null };

export const SpacesSidebar: React.FC = () => {
  const { workspace, hierarchy, error, needsWorkspace, loading, refresh, createWorkspace, locate, teams, me, members: people } = useWork();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [dialog, setDialog] = useState<Dialog | null>(null);
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
    if (dialog.what === 'folder') created = await workApi.createFolder(dialog.parent!, name, isPrivate);
    else created = await workApi.createList(dialog.parent!, name, isPrivate, assignees);
    if (dialog.parent) open(dialog.parent.id);
    await refresh();
    navigate(pathFor(dialog.what, created.id));
  };

  const rowActions = (kind: LocationKind, node: SpaceNode | FolderNode | ListNode): MenuItem[] => [
    ...(isAdmin && canEdit(node.permission_level)
      ? [{ label: 'Rename', icon: <Pencil size={14} />, onClick: () => setDialog({ type: 'rename', kind, id: node.id, name: node.name }) }]
      : []),
    // Assigning a List hands it to people, which used to be a button on every List's header.
    // It lives here now, beside the List's other actions, for anyone with full access to it.
    ...(kind === 'list' && node.permission_level === 'full'
      ? [{ label: 'Assign to people', icon: <UserPlus size={14} />, onClick: () => setDialog({ type: 'assign', node: node as ListNode }) }]
      : []),
    ...(canManage(node.permission_level) && (kind === 'space' ? isAdmin : isManager)
      ? [{
        label: 'Share',
        icon: <Share2 size={14} />,
        onClick: () => setDialog({ type: 'team', kind, id: node.id, name: node.name, team: (node as { team?: { id: string } | null }).team?.id ?? null }),
      }]
      : []),
    ...(kind !== 'space' && canManage(node.permission_level)
      ? [{ label: 'Move', icon: <MoveRight size={14} />, onClick: () => setDialog({ type: 'move', kind: kind as 'folder' | 'list', node: node as FolderNode | ListNode }) }]
      : []),
    // A copy of a Space is another part of the firm, so it follows the rule for making one.
    ...(isAdmin && kind === 'space' && canManage(node.permission_level)
      ? [{ label: 'Duplicate', icon: <Copy size={14} />, onClick: () => setDialog({ type: 'duplicate-space', id: node.id, name: node.name }) }]
      : []),
    // Folders and Lists are structure: a manager's to add, and so a manager's to copy.
    ...(isManager && kind !== 'space' && canEdit(node.permission_level)
      ? [{ label: 'Duplicate', icon: <Copy size={14} />, onClick: () => setDialog({ type: 'duplicate', kind: kind as 'folder' | 'list', node: node as FolderNode | ListNode }) }]
      : []),
    ...(isAdmin && canManage(node.permission_level)
      ? [{ label: 'Delete', icon: <Trash2 size={14} />, danger: true, onClick: () => remove(kind, node.id, node.name) }]
      : []),
  ];

  const createItems = (parent: { kind: 'space' | 'folder'; id: string }, allowFolder: boolean): MenuItem[] => [
    // A List: anyone with full edit here (the menu only opens for them). A Folder: managers and admins.
    { label: 'List', icon: <ListIcon size={14} />, onClick: () => setDialog({ type: 'create', what: 'list' as const, parent }) },
    ...(allowFolder && isManager
      ? [{ label: parent.kind === 'space' ? 'Folder' : 'Subfolder', icon: <Folder size={14} />, onClick: () => setDialog({ type: 'create', what: 'folder' as const, parent }) }]
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
          createItems={canManage(folder.permission_level) ? createItems({ kind: 'folder', id: folder.id }, !isSub) : undefined}
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
    return (
      <div key={space.id}>
        <Row
          to={pathFor('space', space.id)}
          depth={0}
          active={activeId === space.id}
          kind="space"
          icon={
            <span className="flex h-5 w-5 items-center justify-center overflow-hidden rounded-md text-[11px] font-bold text-white" style={{ backgroundColor: spaceColor(space.color, index) }}>
              {spaceIconSrc(space.icon)
                ? <img src={spaceIconSrc(space.icon)!} alt="" className="h-full w-full object-cover" />
                : space.icon || space.name[0]?.toUpperCase()}
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
              <div className="py-1 pl-10 text-xs text-gray-400">{canManage(space.permission_level) ? 'No Lists yet — add one with +' : 'No Lists yet'}</div>
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

  return (
    <div className="select-none">
      <div className="mb-1 pl-2.5 pr-1">
        <span className="side-head text-gray-400">Spaces</span>
      </div>

      {/* New Space heads the list it adds to, so it is in view however many Spaces there are. */}
      {workspace && isAdmin && (
        <button
          type="button"
          onClick={() => setDialog({ type: 'create', what: 'space' })}
          className="side-row flex w-full items-center gap-2 pl-1.5 text-gray-500"
        >
          <span className="w-4 shrink-0" aria-hidden /><Plus size={16} /> New Space
        </button>
      )}

      {loading && <div className="px-3.5 py-1 text-xs text-gray-400"><LinesSkeleton /></div>}
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

      {(hierarchy?.spaces ?? []).map((sp, i) => renderSpace(sp, i))}

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



      {dialog?.type === 'team' && (
        <ShareLocationDialog
          kind={dialog.kind} id={dialog.id} name={dialog.name} team={dialog.team}
          onClose={() => setDialog(null)}
          onDone={() => { setDialog(null); refresh(); }}
        />
      )}
      {dialog?.type === 'move' && (
        <MoveLocationDialog kind={dialog.kind} node={dialog.node} onClose={() => setDialog(null)} onDone={() => { setDialog(null); refresh(); }} />
      )}
      {dialog?.type === 'duplicate' && (
        <DuplicateLocationDialog kind={dialog.kind} node={dialog.node} onClose={() => setDialog(null)}
          onDone={(id) => { const kind = dialog.kind; setDialog(null); refresh().then(() => navigate(pathFor(kind, id))); }} />
      )}
      {dialog?.type === 'duplicate-space' && (
        <DuplicateLocation kind="space" id={dialog.id} name={dialog.name} onClose={() => setDialog(null)}
          run={(body) => spacesApi.duplicateSpace(dialog.id, body)}
          onDone={(id) => { setDialog(null); refresh().then(() => navigate(pathFor('space', id))); }} />
      )}
      {dialog?.type === 'assign' && (
        <AssignListDialog
          listId={dialog.node.id}
          name={dialog.node.name}
          current={dialog.node.assignee_ids ?? [dialog.node.assignee_id].filter((x): x is string => !!x)}
          onClose={() => setDialog(null)} onDone={() => { setDialog(null); refresh(); }} />
      )}

      {dialog?.type === 'create' && dialog.what === 'space' && workspace && (
        <CreateSpaceDialog workspaceId={workspace.id} onClose={() => setDialog(null)}
          onCreated={(id) => { setDialog(null); refresh().then(() => navigate(pathFor('space', id))); }} />
      )}
      {((dialog?.type === 'create' && dialog.what !== 'space') || dialog?.type === 'rename') && (
        <NameDialog
          title={dialog.type === 'rename' ? 'Rename' : `New ${dialog.what === 'folder' ? 'Folder' : 'List'}`}
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

/**
 * A long name loses its middle, not its end. Eleven Lists called "Variant Task List - …" all
 * looked the same when the part that tells them apart was the part cut off, so the last piece
 * (after the final " - ", or the last few characters) always stays.
 */
function splitName(name: string): [string, string] {
  if (name.length <= 24) return [name, ''];
  const cut = name.lastIndexOf(' - ');
  const tail = cut > 0 && name.length - cut <= 22 ? name.slice(cut) : name.slice(-10);
  return [name.slice(0, name.length - tail.length), tail];
}

const RowName: React.FC<{ name: string; className: string }> = ({ name, className }) => {
  const [head, tail] = splitName(name);
  return (
    <span className={`flex min-w-0 flex-1 ${className}`}>
      <span className="min-w-0 truncate">{head}</span>
      {tail && <span className="min-w-0 max-w-[65%] shrink-0 truncate whitespace-pre">{tail}</span>}
    </span>
  );
};

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
      <RowName name={name} className={bold ? 'font-medium text-gray-800' : 'text-gray-700'} />
      {isPrivate && <Lock size={12} className="shrink-0 text-gray-400" />}
      {/* The count and the row's controls are always there, so nothing has to be found by
          pointing at it first. */}
      <span className="side-row-tools flex shrink-0 items-center gap-0.5">
        {trailing}
        {actions.length > 0 && (
          <Menu
            align="right"
            label={`More actions for ${name}`}
            items={actions}
            trigger={<span className="rounded p-0.5 text-gray-400 hover:bg-black/10 hover:text-gray-700"><MoreHorizontal size={14} /></span>}
          />
        )}
        {createItems && (
          <Menu
            align="right"
            label={`Add to ${name}`}
            items={createItems}
            trigger={<span className="rounded p-0.5 text-gray-400 hover:bg-black/10 hover:text-gray-700"><Plus size={14} /></span>}
          />
        )}
      </span>
    </>
  );
  const className = `side-row flex w-full items-center gap-1.5 no-underline ${
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
