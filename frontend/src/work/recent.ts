// Recently opened Spaces, Folders, Lists and tasks, remembered per browser for the "Recent" lists.
const KEY = 'timetriq.recent';
const LIMIT = 30;
/** Fired whenever something is remembered, so an open list of recents can redraw. */
export const RECENT_EVENT = 'timetriq:recent';

export interface RecentItem {
  kind: 'space' | 'folder' | 'list' | 'task';
  id: string;
  /** Tasks carry their name and List, so they can be shown without a request. */
  name?: string;
  listId?: string;
}

function read(): RecentItem[] {
  try {
    const items = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function remember(item: RecentItem): void {
  try {
    const next = [item, ...read().filter((r) => !(r.kind === item.kind && r.id === item.id))].slice(0, LIMIT);
    localStorage.setItem(KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(RECENT_EVENT));
  } catch {
    // Storage can be unavailable (private mode); recents are a nicety.
  }
}

export const rememberList = (listId: string) => remember({ kind: 'list', id: listId });
/** Any Space, Folder or List page, however it was reached: the sidebar, a link, a bookmark. */
export const rememberPlace = (kind: 'space' | 'folder' | 'list', id: string) => remember({ kind, id });
export const rememberTask = (id: string, name: string, listId: string) => remember({ kind: 'task', id, name, listId });

export const recentItems = (): RecentItem[] => read();

export const recentLists = (): string[] => read().filter((r) => r.kind === 'list').map((r) => r.id);
