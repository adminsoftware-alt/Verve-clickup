import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { BarChart3, CheckSquare, ChevronDown, ChevronRight, Eye, Folder, List as ListIcon, Star, X, Target } from 'lucide-react';
import { workApi, type Favorite, type FavoriteKind } from './api';
import { useWork } from './WorkContext';

interface FavoritesValue {
  items: Favorite[];
  isFavorite: (kind: FavoriteKind, id: string) => boolean;
  toggle: (kind: FavoriteKind, id: string) => Promise<void>;
  reorder: (ids: string[]) => Promise<void>;
}
const Ctx = createContext<FavoritesValue | null>(null);
export const useFavorites = (): FavoritesValue => useContext(Ctx) ?? { items: [], isFavorite: () => false, toggle: async () => undefined, reorder: async () => undefined };

/** Your starred Spaces, Lists, tasks and Dashboards (ClickUp's Favorites), kept on the server. */
export const FavoritesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { workspace, hierarchy } = useWork();
  const [items, setItems] = useState<Favorite[]>([]);
  const ws = workspace?.id;
  useEffect(() => {
    if (!ws) return;
    workApi.favorites(ws).then(setItems).catch(() => setItems([]));
  }, [ws, hierarchy]); // the tree changing can hide or rename favourites
  const isFavorite = useCallback((kind: FavoriteKind, id: string) => items.some((f) => f.kind === kind && f.target_id === id), [items]);
  const toggle = useCallback(async (kind: FavoriteKind, id: string) => {
    if (!ws) return;
    setItems(await (isFavorite(kind, id) ? workApi.removeFavorite(ws, kind, id) : workApi.addFavorite(ws, kind, id)));
  }, [ws, isFavorite]);
  const reorder = useCallback(async (ids: string[]) => {
    if (!ws) return;
    setItems((cur) => ids.map((i) => cur.find((f) => f.id === i)!).filter(Boolean));
    setItems(await workApi.orderFavorites(ws, ids));
  }, [ws]);
  const value = useMemo(() => ({ items, isFavorite, toggle, reorder }), [items, isFavorite, toggle, reorder]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

/** A star button that adds or removes something from your Favourites. */
export const FavoriteStar: React.FC<{ kind: FavoriteKind; id: string; className?: string; size?: number }> = ({ kind, id, className, size = 15 }) => {
  const { isFavorite, toggle } = useFavorites();
  const on = isFavorite(kind, id);
  return (
    <button type="button" aria-pressed={on} title={on ? 'Remove from Favourites' : 'Add to Favourites'} aria-label={on ? 'Remove from Favourites' : 'Add to Favourites'}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(kind, id); }}
      className={`${className ?? ''} rounded p-1 ${on ? 'text-amber-500' : 'text-gray-300 hover:text-amber-500'}`}>
      <Star size={size} fill={on ? 'currentColor' : 'none'} />
    </button>
  );
};

const hrefOf = (f: Favorite): string => {
  if (f.kind === 'task') return `/l/${f.list_id}?task=${f.target_id}`;
  if (f.kind === 'dashboard') return `/dashboards/${f.target_id}`;
  if (f.kind === 'goal') return `/goals/${f.target_id}`;
  const seg = f.location_kind === 'space' ? 's' : f.location_kind === 'folder' ? 'f' : 'l';
  return f.kind === 'view' ? `/${seg}/${f.location_id}?v=${f.target_id}` : `/${seg}/${f.location_id}`;
};
const iconOf = (f: Favorite) => ({
  space: <span className="flex h-4 w-4 items-center justify-center rounded bg-brand-600 text-[9px] font-bold text-white">{f.name[0]?.toUpperCase()}</span>,
  folder: <Folder size={15} className="text-gray-500" />,
  list: <ListIcon size={15} className="text-gray-500" />,
  task: <CheckSquare size={15} className="text-gray-500" />,
  dashboard: <BarChart3 size={15} className="text-gray-500" />,
  view: <Eye size={15} className="text-gray-500" />,
  goal: <Target size={15} className="text-gray-500" />,
}[f.kind]);

/** The sidebar's Favourites section; hidden until you star something. Drag to reorder. */
export const FavoritesNav: React.FC = () => {
  const { items, toggle, reorder } = useFavorites();
  const { pathname, search } = useLocation();
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('timetriq.favOpen') !== '0'; } catch { return true; } });
  useEffect(() => { try { localStorage.setItem('timetriq.favOpen', open ? '1' : '0'); } catch { /* ignore */ } }, [open]);
  const dragging = useRef<string | null>(null);
  if (items.length === 0) return null;
  return (
    <nav aria-label="Favourites" className="mt-2 select-none">
      <button type="button" onClick={() => setOpen(!open)} className="mb-1 flex w-full items-center gap-1 pl-3.5 text-[0.65rem] font-bold uppercase tracking-wider text-gray-400">
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />} Favourites
      </button>
      {open && items.map((f) => {
        const href = hrefOf(f);
        const active = `${pathname}${search}` === href || pathname === href;
        return (
          <div key={f.id} draggable
            onDragStart={() => { dragging.current = f.id; }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              const from = dragging.current;
              dragging.current = null;
              if (!from || from === f.id) return;
              const ids = items.map((x) => x.id).filter((x) => x !== from);
              ids.splice(ids.indexOf(f.id), 0, from);
              reorder(ids);
            }}
            className={`group flex items-center gap-2 rounded-lg py-1 pl-6 pr-1 text-sm ${active ? 'bg-brand-50 text-brand-700' : 'text-gray-700 hover:bg-black/5'}`}>
            {iconOf(f)}
            <Link to={href} className="min-w-0 flex-1 truncate text-inherit no-underline">{f.name}</Link>
            <button type="button" title="Remove from Favourites" onClick={() => toggle(f.kind, f.target_id)} className="rounded p-0.5 text-gray-300 opacity-0 hover:text-gray-600 group-hover:opacity-100"><X size={12} /></button>
          </div>
        );
      })}
    </nav>
  );
};
