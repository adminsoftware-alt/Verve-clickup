import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Clock, Folder, List as ListIcon, Lock, Plus } from 'lucide-react';
import type { FolderNode, ListNode, SpaceNode } from '../api';
import { useWork } from '../WorkContext';
import { recentLists } from '../recent';

function allLists(node: SpaceNode | FolderNode): ListNode[] {
  return [...node.folders.flatMap(allLists), ...node.lists];
}

// Flat white cards with a hairline and a navy icon tile, as on the Dashboards.
const Card: React.FC<{ title: string; Icon: React.ElementType; count?: number; action?: React.ReactNode; children: React.ReactNode }> = ({ title, Icon, count, action, children }) => (
  <section className="flex min-h-48 flex-col rounded-lg border border-[#E4E8EE] bg-white">
    <header className="flex items-center gap-2.5 border-b border-[#EDF0F4] px-4 py-3">
      <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand-50 text-brand-600"><Icon size={15} /></span>
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      {count !== undefined && count > 0 && <span className="rounded-full bg-gray-100 px-2 text-xs font-medium text-gray-500">{count}</span>}
      <span className="ml-auto">{action}</span>
    </header>
    <div className="flex-1 px-3 py-2">{children}</div>
  </section>
);

const Empty: React.FC<{ text: string; action?: React.ReactNode }> = ({ text, action }) => (
  <div className="flex h-full flex-col items-center justify-center gap-3 py-6 text-sm text-gray-400">
    {text}
    {action}
  </div>
);

/** The first tab of a Space or Folder: what's in it, and what you opened recently. */
export const OverviewView: React.FC<{
  kind: 'space' | 'folder';
  node: SpaceNode | FolderNode;
  canCreate: boolean;
  /** Folders are managers' and admins' to add; Lists anyone's with full edit. */
  canAddFolder?: boolean;
  onAddList: () => void;
  onAddFolder: () => void;
}> = ({ kind, node, canCreate, canAddFolder = canCreate, onAddList, onAddFolder }) => {
  const { locate } = useWork();
  const lists = useMemo(() => allLists(node), [node]);
  const recent = useMemo(() => {
    const here = new Set(lists.map((l) => l.id));
    return recentLists().filter((id) => here.has(id)).slice(0, 8);
  }, [lists]);

  const addButton = (label: string, onClick: () => void) =>
    (onClick === onAddFolder ? canAddFolder : canCreate) ? (
      <button type="button" onClick={onClick} className="vf-tool inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium">
        <Plus size={12} /> {label}
      </button>
    ) : null;

  const listRow = (lst: ListNode, showPath: boolean) => {
    const path = locate('list', lst.id)?.path ?? [];
    const where = path.slice(1, -1).map((c) => c.name).join(' / ');
    return (
      <Link key={lst.id} to={`/l/${lst.id}`} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-gray-700 no-underline hover:bg-gray-50">
        <ListIcon size={15} className="shrink-0 text-gray-400" />
        <span className="min-w-0 truncate">{lst.name}</span>
        {lst.is_private && <Lock size={11} className="shrink-0 text-gray-400" />}
        {showPath && where && <span className="shrink-0 truncate text-xs text-gray-400">in {where}</span>}
        <span className="ml-auto shrink-0 text-xs text-gray-400">{lst.open_task_count || ''}</span>
      </Link>
    );
  };

  return (
    <div className="grid grid-cols-1 gap-4 px-6 py-5 xl:grid-cols-2">
      <Card title="Recent" Icon={Clock}>
        {recent.length === 0 ? (
          <Empty text="Lists you open here will show up here." />
        ) : (
          recent.map((id) => {
            const found = lists.find((l) => l.id === id);
            return found ? listRow(found, true) : null;
          })
        )}
      </Card>

      {kind === 'space' && (
        <Card title="Folders" Icon={Folder} count={node.folders.length} action={node.folders.length > 0 && addButton('Folder', onAddFolder)}>
          {node.folders.length === 0 ? (
            <Empty text="Add a Folder to group related Lists." action={addButton('Add Folder', onAddFolder)} />
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {node.folders.map((folder) => {
                const inside = allLists(folder);
                const open = inside.reduce((n, l) => n + l.open_task_count, 0);
                return (
                  <Link key={folder.id} to={`/f/${folder.id}`} className="flex items-center gap-3 rounded-md border border-[#E4E8EE] px-3 py-2.5 no-underline hover:border-brand-300 hover:bg-brand-50">
                    <Folder size={18} className="shrink-0 text-brand-400" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1 truncate text-sm font-medium text-gray-800">
                        {folder.name}{folder.is_private && <Lock size={11} className="text-gray-400" />}
                      </div>
                      <div className="text-xs text-gray-400">{inside.length} list{inside.length === 1 ? '' : 's'} · {open} open</div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </Card>
      )}

      <Card title="Lists" Icon={ListIcon} count={node.lists.length} action={node.lists.length > 0 && addButton('List', onAddList)}>
        {node.lists.length === 0 ? (
          <Empty
            text={kind === 'space' ? 'No Lists directly in this Space.' : 'No Lists in this Folder yet.'}
            action={addButton('Add List', onAddList)}
          />
        ) : (
          node.lists.map((lst) => listRow(lst, false))
        )}
      </Card>
    </div>
  );
};
