// Recently opened Lists and tasks, remembered per browser for the "Recents" cards.
const KEY = 'timetriq.recent';
const LIMIT = 30;

export interface RecentItem {
  kind: 'list' | 'task';
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
    window.dispatchEvent(new Event('timetriq:recent'));
  } catch {
    // Storage can be unavailable (private mode); recents are a nicety.
  }
}

export const rememberList = (listId: string) => remember({ kind: 'list', id: listId });
export const rememberTask = (id: string, name: string, listId: string) => remember({ kind: 'task', id, name, listId });

export const recentItems = (): RecentItem[] => read();
export const recentLists = (): string[] => read().filter((r) => r.kind === 'list').map((r) => r.id);
